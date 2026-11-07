/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import type { FeedbackEvent } from "../../../src/app/bus";
import type { NsApi, NsButton, NsPerf, NsState } from "../../../src/app/test-api";
import type { XYZ } from "./page-scripts";

/**
 * How far a poke goes along a button's normal from its plate: 4 mm behind it, which is 12 mm past
 * the face of a keycap standing 8 mm proud (a key cancels a poke more than 16 mm past its face).
 */
export const POKE_DEPTH_M = -0.004;

/** One emulated frame at 72 Hz. */
export const DT = 1000 / 72;
/** Screenshots land here (pulled back with `--pull test-results`). */
export const SHOTS_DIR = path.join("test-results", "shots");
/** Notes for the person running the tests: remote.sh prints this file at the end of the run. */
export const NOTES_FILE = path.join("test-results", "notes.txt");

/** Add one line to the notes printed at the end of the run (emptied by global setup). */
export function addRunNote(line: string): void {
  fs.mkdirSync(path.dirname(NOTES_FILE), { recursive: true });
  fs.appendFileSync(NOTES_FILE, `${line}\n`);
}

export type BootMode = "logic" | "visual";

type Pred<A> = (ns: NsApi, w: any, arg: A) => boolean;

export interface StepUntilOptions<A> {
  /** Virtual ms budget; throws when the predicate is still false after it. Default 10 000. */
  maxMs?: number;
  dt?: number;
  /** Frames per round trip to the page (async work such as fetch or workers lands between batches). */
  batch?: number;
  label?: string;
  /** Passed to the predicate as its third argument (predicates cannot close over test variables). */
  arg?: A;
}

const add = (a: number[], b: number[], k = 1): XYZ => ({
  x: (a[0] as number) + (b[0] as number) * k,
  y: (a[1] as number) + (b[1] as number) * k,
  z: (a[2] as number) + (b[2] as number) * k,
});

/**
 * A booted app in headless Chromium with IWER, always on the virtual clock: nothing moves unless a
 * helper steps frames, so results do not depend on how slow software rendering is.
 */
export class XrApp {
  /** Real ms boot() took. */
  bootRealMs = 0;
  /** Virtual ms from entering XR until the home screen. */
  bootVirtualMs = 0;
  private hand: "left" | "right" | null = null;

  constructor(
    readonly page: Page,
    readonly mode: BootMode,
    readonly consoleLines: string[],
    private readonly testInfo?: TestInfo,
    private readonly hosts: Set<string> = new Set(),
    private readonly paths: Set<string> = new Set(),
  ) {}

  /** True when the page requested a local path containing `part` (e.g. "/input-profiles/generic-hand/"). */
  requested(part: string): boolean {
    for (const p of this.paths) if (p.includes(part)) return true;
    return false;
  }

  /** Hosts other than localhost the page has requested since boot (the game must stay offline). */
  foreignHosts(): string[] {
    return [...this.hosts].sort();
  }

  /** Step `frames` frames of `dt` ms; returns the real ms the page spent in frame callbacks. */
  step(frames = 1, dt = DT): Promise<number> {
    return this.page.evaluate(([n, d]) => (window as any).__vt.steps(n, d) as number, [frames, dt] as const);
  }

  /** Virtual time now (ms). */
  now(): Promise<number> {
    return this.page.evaluate(() => (window as any).__vt.now as number);
  }

  /**
   * Step frames until `pred(window.__ns, window, arg)` is true; returns the virtual ms it took.
   * The predicate runs in the page, so it can only use its arguments.
   */
  async stepUntil<A = undefined>(pred: Pred<A>, o: StepUntilOptions<A> = {}): Promise<number> {
    const maxMs = o.maxMs ?? 10_000;
    const src = pred.toString();
    const start = await this.now();
    for (;;) {
      const r = await this.page.evaluate(
        ({ src, n, dt, arg }) => {
          const w = window as any;
          const f = (0, eval)(`(${src})`) as (ns: unknown, w: unknown, a: unknown) => boolean;
          for (let i = 0; i < n; i++) {
            if (f(w.__ns, w, arg)) return { done: true, now: w.__vt.now as number };
            w.__vt.step(dt);
          }
          return { done: !!f(w.__ns, w, arg), now: w.__vt.now as number };
        },
        { src, n: o.batch ?? 4, dt: o.dt ?? DT, arg: o.arg as unknown },
      );
      if (r.done) return r.now - start;
      if (r.now - start > maxMs) {
        throw new Error(`still false after ${maxMs} ms of virtual time: ${o.label ?? src}`);
      }
    }
  }

  /**
   * Wait in real time (assets, workers, the XR offer), stepping one frame per poll so anything that
   * waits on a frame can move too.
   */
  async waitReal<A = undefined>(pred: Pred<A>, o: { timeoutMs?: number; label?: string; arg?: A } = {}): Promise<void> {
    const src = pred.toString();
    const end = Date.now() + (o.timeoutMs ?? 120_000);
    for (;;) {
      const ok = await this.page.evaluate(
        ({ src, arg }) => {
          const w = window as any;
          const f = (0, eval)(`(${src})`) as (ns: unknown, w: unknown, a: unknown) => boolean;
          if (f(w.__ns, w, arg)) return true;
          w.__vt.step(1000 / 72);
          return false;
        },
        { src, arg: o.arg as unknown },
      );
      if (ok) return;
      if (Date.now() > end) throw new Error(`timed out waiting for ${o.label ?? src}`);
      await this.page.waitForTimeout(50);
    }
  }

  state(): Promise<NsState> {
    return this.page.evaluate(() => (window as any).__ns.state() as NsState);
  }

  perf(): Promise<NsPerf> {
    return this.page.evaluate(() => (window as any).__ns.perf() as NsPerf);
  }

  events(type?: string): Promise<FeedbackEvent[]> {
    return this.page.evaluate((t) => (window as any).__ns.events(t) as FeedbackEvent[], type);
  }

  /** Queue an IWER remote command without waiting for it (it runs on the next frames). */
  async queue(method: string, params: Record<string, unknown> = {}): Promise<number> {
    return this.page.evaluate(
      ({ method, params }) => {
        const w = window as any;
        const box = (w.__nsCmd ||= {
          next: 1,
          results: {} as Record<number, unknown>,
          failed: [] as string[],
          history: [] as string[],
        });
        const id = box.next++;
        const line = `#${id} f${w.__vt?.frames ?? "?"} ${method} ${JSON.stringify(params)}`;
        const note = (outcome: string) => {
          box.history.push(`${line} -> ${outcome} at f${w.__vt?.frames ?? "?"}`);
          if (box.history.length > 300) box.history.shift();
        };
        w.IWER_DEVICE.remote.dispatch(method, params).then(
          (r: unknown) => {
            box.results[id] = { ok: true, r };
            note("ok");
          },
          (e: any) => {
            const msg = String(e?.message ?? e);
            box.results[id] = { ok: false, e: msg };
            box.failed.push(`${method}: ${msg}`);
            note(`FAILED ${msg}`);
          },
        );
        return id as number;
      },
      { method, params },
    );
  }

  /** Run an IWER remote command, stepping frames until it resolves; returns its result. */
  async command<T = unknown>(method: string, params: Record<string, unknown> = {}, maxMs = 10_000): Promise<T> {
    const id = await this.queue(method, params);
    await this.stepUntil((_ns, w, i) => !!w.__nsCmd.results[i], { arg: id, maxMs, label: `IWER ${method}` });
    const res = await this.page.evaluate((i) => {
      const box = (window as any).__nsCmd;
      const r = box.results[i];
      delete box.results[i];
      return r as { ok: boolean; r?: unknown; e?: string };
    }, id);
    if (!res.ok) throw new Error(`IWER ${method} failed: ${res.e}`);
    return res.r as T;
  }

  /** Step until IWER's command queue is empty, then a few frames more for the app to react. */
  async settle(maxMs = 10_000, extraFrames = 6): Promise<void> {
    await this.stepUntil((_ns, w) => w.IWER_DEVICE.remote.queueLength === 0, { maxMs, label: "IWER queue empty" });
    await this.step(extraFrames);
    const failed = await this.page.evaluate(() => {
      const box = (window as any).__nsCmd;
      return box ? (box.failed.splice(0) as string[]) : [];
    });
    if (failed.length) throw new Error(`IWER commands failed: ${failed.join("; ")}`);
  }

  private async useHand(hand: "left" | "right"): Promise<void> {
    if (this.hand === hand) return;
    await this.queue("set_input_mode", { mode: "hand" });
    await this.queue("set_hand_pose", { device: `hand-${hand}`, poseId: "point" });
    this.hand = hand;
  }

  /**
   * Poke a button on the current screen with the index fingertip: come in along the button's
   * normal, press 12 mm past the face of its cap (POKE_DEPTH_M from the plate), and back out. The
   * key presses at 80% of its travel and acts once the finger is back out past it.
   */
  async poke(buttonId: string, o: { hand?: "left" | "right" } = {}): Promise<NsButton> {
    const hand = o.hand ?? "right";
    // Panels spring in and numbers count up; poke a key only once it has come to rest.
    await this.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "menus at rest" });
    const s = await this.state();
    const b = s.buttons.find((x) => x.id === buttonId);
    if (!b) throw new Error(`no button "${buttonId}" on screen "${s.screen}" (have: ${s.buttons.map((x) => x.id).join(", ")})`);
    const device = `hand-${hand}`;
    await this.useHand(hand);
    await this.queue("set_transform", { device, anchor: "index-tip", position: add(b.world, b.normal, 0.15), orientation: "auto" });
    await this.queue("animate_to", { device, anchor: "index-tip", position: add(b.world, b.normal, 0.05), duration: 0.3, easing: "minimum-jerk" });
    await this.queue("animate_to", { device, anchor: "index-tip", position: add(b.world, b.normal, POKE_DEPTH_M), duration: 0.15, easing: "minimum-jerk" });
    await this.queue("animate_to", { device, anchor: "index-tip", position: add(b.world, b.normal, 0.08), duration: 0.15, easing: "minimum-jerk" });
    await this.settle();
    return b;
  }

  /**
   * Step one frame and save what it rendered (room plus app) as `test-results/shots/<name>.png`.
   * Returns the file path.
   */
  async capture(name: string): Promise<string> {
    const dataUrl = await this.page.evaluate((dt) => {
      const w = window as any;
      // The room is drawn in this frame only (page-scripts roomOnCaptureOnly).
      w.__nsRoomFrame = true;
      try {
        w.__vt.step(dt);
      } finally {
        w.__nsRoomFrame = false;
      }
      return w.__nsCapture("image/png") as string;
    }, DT);
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const file = path.join(SHOTS_DIR, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1] ?? "", "base64"));
    await this.testInfo?.attach(name, { path: file, contentType: "image/png" });
    return file;
  }

  /**
   * A headset-equivalent shot: Quest 3 shows about 25 pixels per degree, so the emulated view is
   * narrowed to that density (vertical field of view = height / 25 degrees, 28.8 degrees at 720p)
   * and turned to look at `target` from where the head is. The box and panels stay where they
   * were placed. Field of view and head turn are restored afterwards. Returns the file path.
   */
  async captureHeadset(name: string, target: XYZ, pxPerDegree = 25): Promise<string> {
    const saved = await this.page.evaluate(
      ({ target, ppd }) => {
        const w = window as any;
        const d = w.IWER_DEVICE;
        const canvas = w.__ns.world.renderer.domElement as HTMLCanvasElement;
        const was = { fovy: d.fovy as number, q: [d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w] };
        d.fovy = ((canvas.height / ppd) * Math.PI) / 180;
        const p = d.position;
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dz = target.z - p.z;
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.atan2(dy, Math.hypot(dx, dz));
        const cy = Math.cos(yaw / 2);
        const sy = Math.sin(yaw / 2);
        const cp = Math.cos(pitch / 2);
        const sp = Math.sin(pitch / 2);
        d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
        return was;
      },
      { target, ppd: pxPerDegree },
    );
    await this.step(2);
    const file = await this.capture(name);
    await this.page.evaluate((was) => {
      const d = (window as any).IWER_DEVICE;
      d.fovy = was.fovy;
      d.quaternion.set(was.q[0], was.q[1], was.q[2], was.q[3]);
    }, saved);
    await this.step(1);
    return file;
  }

  /** Console lines from the page (errors included), for failure reports. */
  logs(): string {
    return this.consoleLines.join("\n");
  }
}
