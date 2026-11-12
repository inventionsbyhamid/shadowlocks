// Rendering one shot: boot, line the clock up on START, setup, record frames (resuming frames already
// on disk), then a lossless mezzanine (and the PNG frames go); then deliver.ts makes the sound from the
// recorded events and one delivery encode from the mezzanine. Everything a later step needs is kept
// on the server: the mezzanine, the events (in the sidecar JSON) and the effects stem, so a change to
// the sound only re-mixes and a new edit only re-cuts. Only MP4s, contact sheets, stills and JSON land
// in test-results (pulled back to the Mac). This file is part of the frames' version: it holds the
// start time, the epoch, the boot options and the order of the steps before frame 0.
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { MusicState } from "../../../src/audio/manifest";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { Side } from "../../e2e/helpers/hands";
import type { BootFn } from "../../e2e/helpers/test";
import { CameraTrack, fovyFor } from "./camera";
import { finishShot } from "./deliver";
import { ffmpeg, mediaFacts } from "./ffrun";
import { FRAME_PATTERN, type FramesMeta, FrameStore } from "./journal";
import { mezzanineArgs } from "./mixdown";
import { framesDir, mezzDir, type VideoOptions, workDir } from "./options";
import { readRecord, type ShotRecord, shotFile, writeRecord } from "./records";
import { darkStage, frameFingerprint, videoInit, videoPrepare } from "./page-video";
import { Diverged, DiskStop, diskProblem, freeBytes, Recorder, Stopped, VideoApp } from "./recorder";
import { DARK_BACKDROP, type PlayContext, type Shot, ShotHand } from "./shot";
import { shotVersions, type Versions } from "./version";

const ROOT = process.cwd();
/** Default fixed virtual time the setup starts from (see Recorder.alignTo). */
export const START_MS = 30_000;
/** Frame folders untouched for this long are pruned at the start of a render. */
const STALE_FRAMES_MS = 7 * 24 * 3600 * 1000;

const summary = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return {
    n: s.length,
    avg: Math.round(s.reduce((x, y) => x + y, 0) / s.length),
    p50: Math.round(s[Math.floor(s.length / 2)] as number),
    p95: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] as number),
    max: Math.round(s[s.length - 1] as number),
  };
};

/** The music on a screen when a shot starts (as the game's cues choose it: a box in play is calm). */
function musicFromScreen(screen: string): MusicState {
  return screen === "play" ? "calm" : "menu";
}

/**
 * Remove frame folders of `shot` from another version, and any frame folder untouched for a week.
 * Frames of other shots in progress are kept.
 */
export function pruneFrames(o: VideoOptions, shot: string, version: string, log: (s: string) => void): void {
  const root = path.join(o.cacheRoot, "frames");
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    let meta: FramesMeta | null = null;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as FramesMeta;
    } catch {
      meta = null;
    }
    const old = Date.now() - fs.statSync(dir).mtimeMs > STALE_FRAMES_MS;
    if (old || (meta && meta.shot === shot && meta.version !== version)) {
      fs.rmSync(dir, { recursive: true, force: true });
      log(`pruned stale frames ${name}${old ? " (a week old)" : ""}`);
    }
  }
}

/**
 * A disk stop, also told on one tagged line ([video-stop] {"reason": ...}) that the detached render's
 * watchdog reads to end as "stopped" (frames kept) instead of "failed". Plain characters only.
 */
function diskStop(name: string, why: string, log: (s: string) => void): DiskStop {
  log(diskStopLine(name, why));
  return new DiskStop(`${name}: ${why}`);
}

/** The tagged line, in the plain characters the watchdog accepts. */
export function diskStopLine(name: string, why: string): string {
  const reason = `${name}: ${why}`.replace(/</g, "under").replace(/[^A-Za-z0-9 .,:-]+/g, " ").replace(/\s+/g, " ").trim();
  return `[video-stop] ${JSON.stringify({ reason })}`;
}

/**
 * A shot that stopped before it finished (STOP_AFTER or the disk) leaves a note in the work folder,
 * so an edit in the same run skips instead of cutting a stale or missing shot. Gone once it finishes.
 */
export const stoppedNote = (o: VideoOptions, shot: string): string => path.join(workDir(o), `${shot}.stopped`);

function noteStopped(o: VideoOptions, shot: string, why: string): void {
  fs.mkdirSync(workDir(o), { recursive: true });
  fs.writeFileSync(stoppedNote(o, shot), `${why}\n`);
}

export interface ShotRun {
  record: ShotRecord | null;
  stopped: string | null;
  /** "cached": nothing to do; "remixed": sound and delivery only; "rendered": frames too. */
  did: "cached" | "remixed" | "rendered" | "stopped";
}

export interface ShotContext {
  /** Playwright's retry number: FRESH applies to the first attempt only (a retry resumes). */
  retry: number;
  log: (s: string) => void;
}

/** Render `shot`, or reuse what is still valid. Throws Diverged after deleting frames that did not replay. */
export async function renderShot(shot: Shot<any>, page: Page, boot: BootFn, opts: VideoOptions, ctx: ShotContext): Promise<ShotRun> {
  const o: VideoOptions = { ...opts, fresh: opts.fresh && ctx.retry === 0 };
  const log = ctx.log;
  const name = shot.name;
  for (const d of [o.outDir, mezzDir(o), workDir(o)]) fs.mkdirSync(d, { recursive: true });
  const v = shotVersions(ROOT, shotFile(name), o);
  pruneFrames(o, name, v.frames, log);
  const mezz = path.join(mezzDir(o), `${name}.mkv`);
  const mp4 = path.join(o.outDir, `${name}.mp4`);
  const old = o.fresh ? null : readRecord(o, name);
  const haveFrames = old !== null && fs.existsSync(mezz) && old.width === o.width && old.height === o.height && old.fps === o.fps;
  let base: ShotRecord | null = null;
  if (old && haveFrames && old.frameVersion === v.frames && old.imageId === o.imageId) base = old;
  else if (old && haveFrames && o.reuseStale) {
    log(`${name}: reusing frames made from another app or library version (${old.frameVersion}, now ${v.frames}) because REUSE_STALE=1`);
    base = old;
  } else if (old && haveFrames) {
    log(`${name}: the app, image or shot changed since its frames (${old.frameVersion} -> ${v.frames}); rendering again`);
  }

  let did: ShotRun["did"] = "remixed";
  if (!base) {
    const r = await renderFrames(shot, page, boot, o, v, mezz, log);
    if (r.record === null) return { record: null, stopped: r.stopped, did: "stopped" };
    base = r.record;
    did = "rendered";
  } else if (
    base.mixVersion === v.mix &&
    base.crf === o.crf &&
    base.preset === o.preset &&
    (base.outWidth ?? base.width) === o.outWidth &&
    (base.outHeight ?? base.height) === o.outHeight &&
    fs.existsSync(mp4)
  ) {
    log(`${name}: up to date (${base.frames} frames, frames ${base.frameVersion}, sound ${base.mixVersion}); FRESH=1 renders it again`);
    fs.rmSync(stoppedNote(o, name), { force: true });
    return { record: base, stopped: null, did: "cached" };
  }
  const record = await finishShot(base, o, v, mezz, log);
  fs.rmSync(stoppedNote(o, name), { force: true });
  return { record, stopped: null, did };
}

/** Boot, setup, record and keep a lossless mezzanine; writes a sidecar without delivery yet. */
async function renderFrames(
  shot: Shot<any>,
  page: Page,
  boot: BootFn,
  o: VideoOptions,
  v: Versions,
  mezz: string,
  log: (s: string) => void,
): Promise<{ record: ShotRecord; stopped: null } | { record: null; stopped: string }> {
  const name = shot.name;
  const t0 = Date.now();
  const dir = framesDir(o, name);
  const store = FrameStore.open(dir, { shot: name, version: v.frames, width: o.width, height: o.height, fps: o.fps, hfovDeg: o.hfovDeg }, { fresh: o.fresh });
  const early = diskProblem(freeBytes(dir), store.bytes, o);
  if (early) {
    noteStopped(o, name, early);
    throw diskStop(name, `${early}; not starting, ${store.count} frames kept`, log);
  }
  log(`${name}: ${store.count ? `resuming after ${store.count} frames on disk` : "starting"} at ${o.width}x${o.height} ${o.fps} fps, ${o.hfovDeg} degrees (frames ${v.frames}, image ${o.imageId.slice(0, 19)})`);

  await page.addInitScript(videoInit);
  if (shot.profile) {
    await page.addInitScript((p) => {
      (window as any).__nsVideoProfile = p;
    }, shot.profile);
  }
  const booted = await boot({ mode: "visual", viewport: { width: o.width, height: o.height }, room: shot.room, head: shot.head, date: shot.date });
  const app = VideoApp.from(booted);
  const epochMs = new Date(shot.date ?? DEFAULT_DATE).getTime();
  const prep = await page.evaluate(videoPrepare, { fovy: fovyFor(o.hfovDeg, o.width, o.height), epochMs, fingerprint: frameFingerprint.toString() });
  if (prep.canvas[0] !== o.width || prep.canvas[1] !== o.height) throw new Error(`the XR canvas is ${prep.canvas.join("x")}, not ${o.width}x${o.height}`);
  if (shot.darkStage) {
    const backdrop = typeof shot.darkStage === "object" ? shot.darkStage.backdrop : DARK_BACKDROP;
    const r = await page.evaluate(darkStage, { backdrop });
    if (r.dimming !== "off") log(`warning: ${name}: the Dim room setting is ${r.dimming}; the dark stage may show the theatre veil`);
  }
  const bootMs = Date.now() - t0;
  // Nothing before the first frame is drawn (the recorder turns drawing on per frame).
  await page.evaluate(() => {
    (window as any).__nsVideoSkip = true;
  });
  const alignAt = Date.now();
  const startMs = shot.startMs ?? START_MS;
  const alignSteps = await Recorder.alignTo(page, startMs, 1000 / o.fps);
  const alignMs = Date.now() - alignAt;

  const hands = new Map<Side, ShotHand>();
  const hand = (side: Side) => {
    let h = hands.get(side);
    if (!h) {
      h = new ShotHand(app, side);
      hands.set(side, h);
    }
    return h;
  };
  const setupStart = Date.now();
  app.setup = true;
  // From here on only the video stepping functions may move the clock (see videoPrepare).
  await page.evaluate(() => {
    (window as any).__nsVideoSetup = true;
  });
  const data = await shot.setup({ app, page, hand });
  app.setup = false;
  const setupMs = Date.now() - setupStart;

  const camera = new CameraTrack(shot.firstView(data), shot.sway ?? { mm: 1.5, deg: 0.12 }, o.hfovDeg);
  const rec = new Recorder(page, store, camera, {
    shot: name,
    fps: o.fps,
    stopAfter: o.stopAfter,
    solidHands: !shot.outlineHands,
    minFreeGb: o.minFreeGb,
    expectGb: o.expectGb,
    expectFrames: Math.round((shot.seconds ?? 0) * o.fps),
    width: o.width,
    height: o.height,
    log,
  });
  app.rec = rec;
  const pctx: PlayContext = {
    app,
    page,
    time: () => rec.time(),
    camera: {
      cut: (view) => camera.cut(rec.time(), view),
      move: (view, ms, ease) => camera.move(rec.time(), view, ms, ease),
      view: () => camera.viewAt(rec.time()),
    },
    hand,
    wait: async (ms) => {
      const end = rec.index + Math.round((ms / 1000) * o.fps);
      while (rec.index < end) await rec.frame();
    },
    until: async (seconds) => {
      const end = Math.round(seconds * o.fps);
      while (rec.index < end) await rec.frame();
    },
    state: () => app.state(),
  };
  let warmMs = 0;
  let firstScreen = "";
  let playStart = Date.now();
  try {
    // The warm-up checks the disk too: a stop there is a disk stop like any other.
    const warmAt = Date.now();
    await rec.start();
    warmMs = Date.now() - warmAt;
    firstScreen = (await app.state()).screen;
    playStart = Date.now();
    await shot.play(pctx, data);
  } catch (e) {
    if (e instanceof Stopped) {
      log(`${name}: ${e.message}`);
      noteStopped(o, name, e.message);
      return { record: null, stopped: e.message };
    }
    if (e instanceof Diverged) {
      log(`${name}: ${e.message}; deleting its frames so the retry starts clean`);
      store.remove();
    }
    if (e instanceof DiskStop) {
      noteStopped(o, name, e.message);
      throw diskStop(name, e.message, log);
    }
    throw e;
  }
  const appTimers = await rec.finish();
  const playMs = Date.now() - playStart;
  const frames = rec.index;
  if (store.count !== frames) throw new Error(`${frames} frames played but ${store.count} on disk`);

  // Lossless mezzanine, verified, then the PNG frames go.
  const mezzAt = Date.now();
  const tmp = `${mezz}.tmp.mkv`;
  ffmpeg(mezzanineArgs({ framesPattern: path.join(dir, FRAME_PATTERN), fps: o.fps, frames, out: tmp }));
  const mf = mediaFacts(tmp, { audio: false });
  if (mf.frames !== frames || mf.width !== o.width || mf.height !== o.height) {
    throw new Error(`${name}: mezzanine has ${mf.frames} frames of ${mf.width}x${mf.height}, expected ${frames} of ${o.width}x${o.height} (frames kept)`);
  }
  fs.renameSync(tmp, mezz);
  const mezzMs = Date.now() - mezzAt;
  const framesBytes = store.bytes;
  if (!o.keepFrames) store.remove();

  const s = rec.stats;
  const record: ShotRecord = {
    shot: name,
    frameVersion: v.frames,
    mixVersion: "",
    imageId: o.imageId,
    width: o.width,
    height: o.height,
    fps: o.fps,
    hfovDeg: o.hfovDeg,
    frames,
    duration: frames / o.fps,
    quality: o.quality,
    crf: o.crf,
    preset: o.preset,
    mp4: "",
    contact: "",
    stills: [],
    mezz: path.relative(ROOT, mezz),
    fx: "",
    events: rec.events,
    music: { initial: shot.audio?.music ?? musicFromScreen(firstScreen), offsetSec: shot.audio?.musicOffsetSec ?? 0, changes: [] },
    ambience: !!shot.audio?.ambience,
    ducks: [],
    cues: [],
    loudness: null,
    stats: {
      recordedThisRun: s.recorded,
      replayed: s.skipped,
      redrawMatched: s.redrawMatched,
      frameMs: summary(s.frameMs),
      writeMs: summary(s.writeMs),
      stepMs: summary(s.stepMs),
      captureMs: summary(s.captureMs),
      replayMs: summary(s.skipMs),
      idleMsTotal: Math.round(s.idleMs),
      appTimers: appTimers.length,
      // Server seconds to record one second of video (round trip and PNG write per frame, times fps).
      renderSecondsPerVideoSecond: s.recorded
        ? Number(((([...s.frameMs, ...s.writeMs].reduce((x, y) => x + y, 0) / s.recorded) * o.fps) / 1000).toFixed(1))
        : null,
      pngMbPerFrame: s.recorded ? Number((s.pngBytes / s.recorded / 1e6).toFixed(2)) : null,
      framesOnDiskMb: Number((framesBytes / 1e6).toFixed(0)),
      mezzMb: Number((fs.statSync(mezz).size / 1e6).toFixed(1)),
      maxCalls: s.maxCalls,
      maxTriangles: s.maxTriangles,
      hands: s.hands,
      // Frames on which __sl.frameState() had a box in play (0 until the game layer fills the hook).
      gameFrames: s.gameFrames,
      startMs,
      alignSteps,
      ms: { boot: bootMs, align: alignMs, setup: setupMs, warm: warmMs, play: playMs, mezzanine: mezzMs, frames: Date.now() - t0 },
    },
  };
  // Saved now, so a failure in the sound or the delivery encode never costs the frames.
  writeRecord(o, record);
  log(`${name}: ${frames} frames (${record.duration.toFixed(2)} s) -> mezzanine ${record.stats.mezzMb} MB`);
  return { record, stopped: null };
}
