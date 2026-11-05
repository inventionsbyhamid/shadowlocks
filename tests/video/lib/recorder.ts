// Frame-by-frame recording on the virtual clock. Every recorded frame is one page round trip: wait for
// async work in flight, pose the headset from the camera track, step exactly 1/fps, collect the
// frame's bus events, capture. Frames already on disk from an interrupted run are stepped without
// drawing and checked against their recorded state fingerprint; the last one is drawn again and its
// PNG compared byte for byte; then recording carries on from the first missing frame.
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import type { Page } from "@playwright/test";
import type { FeedbackEvent } from "../../../src/app/bus";
import type { NsApi } from "../../../src/app/test-api";
import { DT, type StepUntilOptions, XrApp } from "../../e2e/helpers/xr-app";
import type { FrameEvents } from "./audio";
import type { CameraTrack } from "./camera";
import { type FrameStore, pngSha } from "./journal";
import { alignStep, type FrameResult, setupStep, videoFrame } from "./page-video";

/** The shot did not replay the same as the frames on disk: render it again from the start. */
export class Diverged extends Error {}
/** STOP_AFTER reached (a resume check): the frames so far are kept. */
export class Stopped extends Error {}
/** The disk ran low or the frames passed their budget: stopped with the frames kept, to resume later. */
export class DiskStop extends Error {}

/** Free bytes on the disk that holds `dir`. */
export function freeBytes(dir: string): number {
  const st = fs.statfsSync(dir);
  return Number(st.bavail) * Number(st.bsize);
}

/** Why recording must stop now (free disk or the frames' budget), or null. */
export function diskProblem(free: number, framesBytes: number, o: { minFreeGb: number; expectGb: number }): string | null {
  const gb = (n: number) => (n / 1e9).toFixed(1);
  if (free < o.minFreeGb * 1e9) return `free disk ${gb(free)} GB < ${o.minFreeGb} GB`;
  if (o.expectGb > 0 && framesBytes > o.expectGb * 1e9) return `frames take ${gb(framesBytes)} GB, more than the ${o.expectGb} GB declared (--expect-gb)`;
  return null;
}

export interface RecorderOptions {
  shot: string;
  fps: number;
  stopAfter: number;
  solidHands: boolean;
  minFreeGb: number;
  expectGb: number;
  /** Expected frames of the shot (for the progress line); 0 when unknown. */
  expectFrames: number;
  log: (line: string) => void;
}

/** How often (frames) the disk is checked and a progress line is printed. */
const CHECK_EVERY = 60;

export interface RecorderStats {
  recorded: number;
  skipped: number;
  /** Real ms per recorded frame: the round trip (step + draw + capture + transfer), then the PNG write. */
  frameMs: number[];
  writeMs: number[];
  /** Real ms per fast-forwarded frame. */
  skipMs: number[];
  /** In-page real ms of recorded frames: step (systems, IWER, draw submit) and capture (finish, PNG). */
  stepMs: number[];
  captureMs: number[];
  pngBytes: number;
  maxCalls: number;
  maxTriangles: number;
  hands: { solid: number; contour: number } | null;
  /** Frames (recorded or replayed) on which `__sl.frameState()` reported a box in play. */
  gameFrames: number;
  /** Real ms frames waited for async work before stepping (total). */
  idleMs: number;
  /** The last frame on disk was drawn again on resume and matched byte for byte. */
  redrawMatched: boolean | null;
}

export class Recorder {
  index = 0;
  active = false;
  /** Frames that had bus events, with their time, head pose and the buttons on screen. */
  readonly events: FrameEvents[] = [];
  readonly stats: RecorderStats = {
    recorded: 0,
    skipped: 0,
    frameMs: [],
    writeMs: [],
    skipMs: [],
    stepMs: [],
    captureMs: [],
    pngBytes: 0,
    maxCalls: 0,
    maxTriangles: 0,
    hands: null,
    gameFrames: 0,
    idleMs: 0,
    redrawMatched: null,
  };

  constructor(
    readonly page: Page,
    readonly store: FrameStore,
    readonly camera: CameraTrack,
    readonly o: RecorderOptions,
  ) {}

  get dt(): number {
    return 1000 / this.o.fps;
  }

  /** Shot time of the next frame, in seconds. */
  time(): number {
    return this.index / this.o.fps;
  }

  private async raw(skip: boolean, capture: boolean, t: number): Promise<FrameResult> {
    const pose = this.camera.poseAt(t);
    return this.page.evaluate(videoFrame, {
      dt: this.dt,
      position: pose.position,
      quaternion: pose.quaternion,
      skip,
      capture,
      solidHands: this.o.solidHands,
    });
  }

  /**
   * Right after boot: step without drawing to the fixed virtual time `startMs`, so whatever boot took
   * (it differs in every run) the shot's setup and frames start from the same clock, and shaders that
   * animate with absolute time are in the same phase. Throws when boot already went past it.
   */
  static async alignTo(page: Page, startMs: number, dt: number): Promise<number> {
    const now = await page.evaluate(() => (window as any).__vt.now as number);
    if (now > startMs - 500) {
      throw new Error(`boot took the clock to ${Math.round(now)} ms, past the shot's start at ${startMs} ms; raise startMs`);
    }
    let steps = 0;
    for (let left = startMs - now; left > 1e-6; steps++) left = await page.evaluate(alignStep, { target: startMs, dt });
    return steps;
  }

  /**
   * After the shot's setup: hold the first view for a second without drawing, draw two frames to
   * compile shaders, and from then on only the recorder steps the clock. Same frames in every run.
   */
  async start(): Promise<void> {
    await this.page.evaluate(() => {
      (window as any).__nsVideoSetup = false;
    });
    for (let i = 0; i < this.o.fps; i++) await this.raw(true, false, 0);
    const a = Date.now();
    for (let i = 0; i < 2; i++) await this.raw(false, true, 0);
    const now = await this.page.evaluate(() => {
      const w = window as any;
      w.__ns.clearEvents();
      w.__nsVideoSeen = [];
      w.__nsVideoRecording = true;
      return w.__vt.now as number;
    });
    this.o.log(`recording from ${now.toFixed(1)} ms of virtual time; warm-up frames took ${Date.now() - a} ms`);
    this.check();
    this.active = true;
  }

  /** Recording is over: other code may step the clock again. Returns app timers started meanwhile. */
  async finish(): Promise<string[]> {
    this.active = false;
    const timers = await this.page.evaluate(() => {
      const w = window as any;
      w.__nsVideoRecording = false;
      return [...(w.__nsVideoAppTimers ?? [])] as string[];
    });
    if (timers.length) this.o.log(`warning: the app started ${timers.length} real-time timers during setup or recording: ${timers.slice(0, 5).join(" | ")}`);
    return timers;
  }

  private check(): void {
    const why = diskProblem(freeBytes(this.store.dir), this.store.bytes, this.o);
    if (why) throw new DiskStop(`${why}: stopped with ${this.store.count} frames kept; run again to resume`);
  }

  /** Record (or fast-forward past) the next frame. */
  async frame(): Promise<FrameResult> {
    const i = this.index;
    const skip = i < this.store.count;
    // The last frame on disk is drawn again: its pixels must match, not only its state.
    const redraw = skip && i === this.store.count - 1;
    const a = Date.now();
    const r = await this.raw(skip && !redraw, !skip || redraw, i / this.o.fps);
    const ms = Date.now() - a;
    const s = this.stats;
    s.idleMs += r.idleMs;
    if (skip) {
      if (r.hash !== this.store.hashes[i]) {
        throw new Diverged(`frame ${i} replayed differently (state ${r.hash}, on disk ${this.store.hashes[i]})`);
      }
      if (redraw) {
        const sha = pngSha(Buffer.from((r.img ?? "").split(",")[1] ?? "", "base64"));
        s.redrawMatched = sha === this.store.shas[i];
        if (!s.redrawMatched) throw new Diverged(`frame ${i} drew different pixels on resume (png ${sha}, on disk ${this.store.shas[i]})`);
        this.o.log(`frame ${i} drawn again on resume: same pixels`);
      }
      s.skipped++;
      s.skipMs.push(ms);
    } else {
      const png = Buffer.from((r.img ?? "").split(",")[1] ?? "", "base64");
      if (png.length === 0) throw new Error(`frame ${i}: empty capture`);
      const w0 = Date.now();
      this.store.add(i, png, r.hash);
      s.writeMs.push(Date.now() - w0);
      s.frameMs.push(ms);
      s.stepMs.push(r.stepMs);
      s.captureMs.push(r.captureMs);
      s.pngBytes += png.length;
      s.recorded++;
      s.maxCalls = Math.max(s.maxCalls, r.calls);
      s.maxTriangles = Math.max(s.maxTriangles, r.triangles);
    }
    if (r.hands) s.hands = r.hands;
    if (r.game) s.gameFrames++;
    // Events with the frame's time, head pose and buttons (the sound is mixed from them).
    if (r.events.length) {
      this.events.push({
        t: i / this.o.fps,
        events: r.events as FrameEvents["events"],
        head: r.head,
        buttons: r.buttons,
      });
    }
    if (!skip && s.recorded % CHECK_EVERY === 0) {
      this.check();
      const n = this.o.expectFrames;
      const recent = s.frameMs.slice(-CHECK_EVERY);
      const per = recent.reduce((x, y) => x + y, 0) / recent.length;
      const eta = n > i ? Math.round(((n - i - 1) * per) / 1000) : 0;
      // One machine-readable line for the detached render's status file.
      this.o.log(
        `[video-status] ${JSON.stringify({ shot: this.o.shot, frame: i + 1, frames: n || null, msPerFrame: Math.round(per), etaSec: n ? eta : null })}`,
      );
    }
    if (i % 60 === 0) {
      this.o.log(
        `frame ${i} (${(i / this.o.fps).toFixed(2)} s) ${skip ? "replayed" : "recorded"} in ${ms} ms` +
          (skip ? "" : `, step ${r.stepMs.toFixed(0)} ms, capture ${r.captureMs.toFixed(0)} ms, ${r.calls} calls, ${r.triangles} tris`) +
          ` [${r.screen}${r.game ? `, box ${r.game.boxKey}` : ", no box"}]`,
      );
    }
    this.index++;
    if (!skip && this.o.stopAfter > 0 && s.recorded >= this.o.stopAfter) {
      throw new Stopped(`stopped after ${s.recorded} new frames (STOP_AFTER), ${this.index} on disk`);
    }
    return r;
  }
}

/**
 * The e2e XrApp, with frames routed through a recorder once recording starts: `step`, `stepUntil`,
 * `settle`, `command` and `poke` (and the e2e `Hands` built on them) then record every frame at the
 * video rate. Before that (shot setup) it is the plain fast XrApp.
 */
export class VideoApp extends XrApp {
  rec: Recorder | null = null;
  /**
   * Shot setup (after the clock line-up, before recording): frames are stepped one per round trip,
   * undrawn, each after the same wait for async work as a recorded frame, so the setup too lands the
   * same in every run.
   */
  setup = false;

  static from(app: XrApp): VideoApp {
    const v = new VideoApp(app.page, app.mode, app.consoleLines);
    v.bootRealMs = app.bootRealMs;
    v.bootVirtualMs = app.bootVirtualMs;
    return v;
  }

  private get recording(): Recorder | null {
    return this.rec?.active ? this.rec : null;
  }

  override async step(frames = 1, dt?: number): Promise<number> {
    const rec = this.recording;
    if (!rec && this.setup) {
      for (let i = 0; i < frames; i++) await this.page.evaluate(setupStep, { dt: dt ?? DT, src: null, arg: null });
      return 0;
    }
    if (!rec) return super.step(frames, dt);
    let js = 0;
    for (let i = 0; i < frames; i++) js += (await rec.frame()).stepMs;
    return js;
  }

  override async stepUntil<A = undefined>(
    pred: (ns: NsApi, w: any, arg: A) => boolean,
    o: StepUntilOptions<A> = {},
  ): Promise<number> {
    const rec = this.recording;
    if (!rec && this.setup) {
      const maxMs = o.maxMs ?? 10_000;
      const src = pred.toString();
      const start = await this.now();
      for (;;) {
        const r = await this.page.evaluate(setupStep, { dt: o.dt ?? DT, src, arg: (o.arg ?? null) as unknown });
        if (r.done) return r.now - start;
        if (r.now - start > maxMs) throw new Error(`still false after ${maxMs} ms of virtual time: ${o.label ?? src}`);
      }
    }
    if (!rec) return super.stepUntil(pred, o);
    const maxMs = o.maxMs ?? 10_000;
    const src = pred.toString();
    const start = rec.time() * 1000;
    for (;;) {
      const done = await this.page.evaluate(
        ({ src, arg }) => {
          const w = window as any;
          const f = (0, eval)(`(${src})`) as (ns: unknown, w: unknown, a: unknown) => boolean;
          return !!f(w.__ns, w, arg);
        },
        { src, arg: o.arg as unknown },
      );
      const elapsed = rec.time() * 1000 - start;
      if (done) return elapsed;
      if (elapsed > maxMs) throw new Error(`still false after ${maxMs} ms of shot time: ${o.label ?? src}`);
      await rec.frame();
    }
  }

  /** Bus events since recording started (each frame drains the app's log), else the app's log. */
  override events(type?: string): Promise<FeedbackEvent[]> {
    return this.page.evaluate((t) => {
      const w = window as any;
      return (w.__nsVideoRecording ? w.__nsVideoEvents(t ?? undefined) : w.__ns.events(t ?? undefined)) as FeedbackEvent[];
    }, type ?? null);
  }

  /** Hold still for `ms`: video frames while recording (at the video rate), else setup steps. */
  async hold(ms: number): Promise<void> {
    const rec = this.recording;
    if (rec) {
      const end = rec.index + Math.round((ms / 1000) * rec.o.fps);
      while (rec.index < end) await rec.frame();
      return;
    }
    const t0 = await this.now();
    await this.stepUntil((_ns, w, end) => w.__vt.now >= end, { arg: t0 + ms, maxMs: ms + 1000, label: "hold" });
  }

  /** While recording, gestures follow each other without the e2e helpers' extra frames. */
  override async settle(maxMs = 10_000, extraFrames?: number): Promise<void> {
    return super.settle(maxMs, extraFrames ?? (this.recording ? 0 : 6));
  }
}
