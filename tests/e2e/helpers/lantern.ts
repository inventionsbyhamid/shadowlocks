/* eslint-disable @typescript-eslint/no-explicit-any */
// Helpers for the lantern specs: read the lantern through window.__sl, show a box, pinch and carry the lantern with an
// IWER hand, record it frame by frame, and measure what holding it costs.
import fs from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import type { SlLantern } from "../../../src/app/test-api";
import type { V2, V3, Vec3 } from "../../../src/core/types";
import { Hands } from "./hands";
import { type BootFn, expect } from "./test";
import type { XrApp } from "./xr-app";

export type P3 = readonly [number, number, number];
export const add = (a: P3, b: P3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const sub = (a: P3, b: P3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: P3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: P3, b: P3): number => len(sub(a, b));
export const unit = (a: P3): Vec3 => add([0, 0, 0], a, 1 / len(a));
export const cross = (a: P3, b: P3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Distance from `p` to the line through `a` along `d`. */
export const offLine = (p: P3, a: P3, d: P3): number => {
  const u = unit(d), v = sub(p, a);
  return len(sub(v, add([0, 0, 0], u, dot(v, u))));
};

/** The lantern after one frame: where it is (box units), held or not, its mode, and what of it is drawn. */
export interface Sample {
  t: number;
  pos: V3;
  held: boolean;
  mode: string;
  beam: boolean;
  ripple: boolean;
}

export const lantern = (page: Page): Promise<SlLantern> => page.evaluate(() => window.__sl!.lantern());
export const shadows = (page: Page): Promise<V2[][]> => page.evaluate(() => window.__sl!.shadows());
export const feelEvents = (page: Page) => page.evaluate(() => window.__sl!.feelEvents());

export async function toWorld(page: Page, p: P3): Promise<Vec3> {
  const [w] = await page.evaluate((q) => window.__ns!.scene.toWorld([q]), [p[0], p[1], p[2]] as V3);
  return w!;
}

/**
 * Seated, the menus away and a numbered box shown (the lantern at its start). With `rings`, the first box from 1 up
 * whose locks have sight rings.
 */
export async function play(boot: BootFn, page: Page, o: { rings?: boolean; mode?: "logic" | "visual" } = {}): Promise<XrApp> {
  const app = await boot({ mode: o.mode });
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  for (let n = 1; n <= 12; n++) {
    await page.evaluate((k) => window.__ns!.scene.show({ n: k }), n);
    await app.step(2);
    if (!o.rings || (await page.evaluate(() => window.__sl!.ringLines().length)) > 0) return app;
  }
  throw new Error("no box from 1 to 12 has sight rings");
}

/** The box's first ring line: its spot, and the unit direction along the line out of the box (box units). */
export async function firstLine(page: Page): Promise<{ lock: number; mark: V3; spot: V3; out: Vec3 }> {
  const line = (await page.evaluate(() => window.__sl!.ringLines()))[0]!;
  const box = (await page.evaluate(() => window.__ns!.scene.box()))!;
  const spot = box.spots[line.lock]!;
  // The line runs from the mark on the panel through the rings to the spot, so along `dir` is out of the box.
  return { lock: line.lock, mark: line.mark, spot, out: unit(line.dir) };
}

/**
 * Pinch the lantern where it stands (or `above` its light, at its ring) and wait until it is held and at rest.
 * Returns the lantern's offset from the hand's grasp point (world): with the grasp at Q - offset, the lantern is at Q.
 */
export async function grab(app: XrApp, page: Page, hand: Hands, above = 0): Promise<Vec3> {
  const at = add(await toWorld(page, (await lantern(page)).pos), [0, above, 0]);
  await hand.pinchAt(at);
  await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 2_000, batch: 1, label: "lantern held" });
  await app.step(30);
  return sub(await toWorld(page, (await lantern(page)).pos), at);
}

/** Carry the held lantern to `q` (world) in `ms`. */
export const carry = (hand: Hands, off: P3, q: P3, ms: number): Promise<void> => hand.moveTo(sub(q, off), ms);

/** Record the lantern after every frame from now on (the virtual clock's step is wrapped once). */
export async function startTrail(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (!w.__trailOn) {
      const step = w.__vt.step.bind(w.__vt);
      w.__vt.step = (ms: number) => {
        const r = step(ms);
        if (w.__trail) {
          const l = w.__sl.lantern();
          const parts: string[] = w.__ns.scene.draws().parts;
          w.__trail.push({
            t: w.__vt.now,
            pos: l.pos,
            held: l.held,
            mode: l.mode,
            beam: parts.includes("Ring Beam"),
            ripple: parts.includes("Lantern Ripple"),
          });
        }
        return r;
      };
      w.__trailOn = true;
    }
    w.__trail = [];
  });
}

/** The samples recorded since startTrail, and stop recording. */
export const takeTrail = (page: Page): Promise<Sample[]> =>
  page.evaluate(() => {
    const w = window as any;
    const s = w.__trail as Sample[];
    w.__trail = null;
    return s;
  });

/** Where the samples put the lantern at time `t`: straight between the two frames around it. */
export function posAt(s: Sample[], t: number): V3 {
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!, b = s[i]!;
    if (a.t <= t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return add(a.pos, sub(b.pos, a.pos), f);
    }
  }
  throw new Error(`no samples around t = ${t}`);
}

// --- Cost -------------------------------------------------------------------------------------------------------

/** Frames in one timed window at 4x CPU throttle. */
export const TIMED_FRAMES = 200;
/** Windows timed one after the other; the cost is judged on the better one. */
export const WINDOWS = 2;
/**
 * A per-frame path (the lantern's two systems together, or the hands system) costs at most this (ms a frame) at 4x
 * CPU throttle on optimised code, by the stall rule (judgeWindows): the mean of a window of TIMED_FRAMES frames
 * without its host stalls, in the better of WINDOWS windows. The mean only: p95 moves in the timer's 0.1 ms steps
 * (times 4) and is reported, not held to a limit.
 */
export const MEAN_BUDGET_MS = 0.5;

// The stall rule, the one place both cost checks take it from. A frame this long (ms, at 4x) is a host stall, not
// our code: about seven times the whole 3 ms budget of all our systems. This shared server stalls 40-60 ms now and
// then, one or two in 200 frames of late and often both in one window, which leaving out a window's single worst
// frame cannot absorb (a check failed at 0.56 ms with a median of 0.15). So stalls are left out of the mean and
// counted; a window with more than MAX_STALLS of them is no measure at all, and a regression that slow would show in
// every frame anyway.
export const STALL_MS = 20;
export const MAX_STALLS = 5;

/** A window judged by the stall rule: its mean without host stalls and how many there were. */
export interface StallMean {
  meanMs: number;
  stalls: number;
}

/** A window's frame times (ms) by the stall rule. */
export function withoutStalls(frames: readonly number[]): StallMean {
  const kept = frames.filter((ms) => ms < STALL_MS);
  return { meanMs: kept.reduce((a, b) => a + b, 0) / Math.max(1, kept.length), stalls: frames.length - kept.length };
}

/** Of WINDOWS windows' frame times, the one the cost is judged on (the lower mean without stalls) and its index. */
export function judgeWindows(windows: readonly (readonly number[])[]): StallMean & { index: number } {
  const judged = windows.map(withoutStalls);
  const index = judged.reduce((best, w, i) => (w.meanMs < judged[best]!.meanMs ? i : best), 0);
  return { ...judged[index]!, index };
}

/** The cost check: the judged window has at most MAX_STALLS host stalls and a mean of at most `budgetMs`. */
export function expectWithinBudget(j: StallMean, budgetMs: number, what: string): void {
  expect(j.stalls, `${what}: host stalls over ${STALL_MS} ms in the judged window`).toBeLessThanOrEqual(MAX_STALLS);
  expect(j.meanMs, `${what}: mean ms a frame over ${TIMED_FRAMES} frames without host stalls, the better of ${WINDOWS} windows`).toBeLessThanOrEqual(
    budgetMs,
  );
}
/** The systems on the path, as the perf hook names them. */
const PATH_SYSTEMS = ["hand-pinch", "lantern"];
/** Files on the per-frame lantern path: none of them may allocate while a lantern is held and moved. */
const OUR_FILES = [
  "/src/input/hand-joints.ts",
  "/src/input/lantern-grab.ts",
  "/src/input/grab-system.ts",
  "/src/input/pinch.ts",
  "/src/input/one-euro.ts",
  "/src/feel/lantern-controller.ts",
  "/src/feel/lantern-ctx.ts",
  "/src/app/lantern-system.ts",
  "/src/render/ring-beam.ts",
  "/src/render/lantern-view.ts",
  "/src/render/placement.ts",
  "/src/core/rings.ts",
  "/src/core/geom.ts",
];

export function loadAverage(): number | undefined {
  try {
    const v = Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
    return Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

interface HeapNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: HeapNode[];
}

export interface HeapProfile {
  head: HeapNode;
  /** One per sampled allocation: its exact size and where it was made. */
  samples: { size: number; nodeId: number }[];
}

/** The heap sampler takes one sample per this many bytes allocated, on average. */
export const SAMPLE_BYTES = 64;

/** Sampled allocations in our files' functions: bytes per frame in all, and by function (file:function:line). */
export interface Allocations {
  bytesPerFrame: number;
  byFunction: Map<string, number>;
}

/** Sampled allocations in `files` (the lantern's per-frame files by default) over `frames` frames. */
export function ourAllocations(profile: HeapProfile, frames: number, files: readonly string[] = OUR_FILES): Allocations {
  const ours = new Map<number, string>();
  const walk = (n: HeapNode) => {
    const url = n.callFrame.url;
    if (files.some((f) => url.includes(f))) {
      ours.set(n.id, `${url.replace(/^.*\/src\//, "src/").replace(/\?.*$/, "")}:${n.callFrame.functionName}:${n.callFrame.lineNumber + 1}`);
    }
    for (const c of n.children) walk(c);
  };
  walk(profile.head);
  const byFunction = new Map<string, number>();
  let n = 0;
  for (const s of profile.samples) {
    const key = ours.get(s.nodeId);
    if (!key) continue;
    n++;
    byFunction.set(key, (byFunction.get(key) ?? 0) + SAMPLE_BYTES / frames);
  }
  return { bytesPerFrame: (n * SAMPLE_BYTES) / frames, byFunction };
}

/** Per-frame times (ms): mean, mean without the single worst frame, median, p95, max. */
export interface FrameStats {
  meanMs: number;
  trimmedMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export function frameStats(xs: number[]): FrameStats {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    meanMs: sum / n,
    trimmedMs: (sum - s[n - 1]!) / (n - 1),
    medianMs: n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2,
    p95Ms: s[Math.min(n - 1, Math.floor(n * 0.95))]!,
    maxMs: s[n - 1]!,
  };
}

/** One timed window of TIMED_FRAMES frames at 4x CPU throttle. */
export interface CostWindow {
  /** hand-pinch and lantern together, per frame. */
  path: FrameStats;
  /** The same frames by the stall rule. */
  pathRule: StallMean;
  /** Their frame times (ms). */
  pathFrames: number[];
  /** Each system on its own, over the same frames (reported). */
  pinch: FrameStats;
  lan: FrameStats;
  /** The server's 1-minute load average around the window (reported). */
  load: number | undefined;
}

export interface Cost {
  /** The WINDOWS timed windows, in order. */
  windows: CostWindow[];
  /** The window the stall rule judges the path on (judgeWindows): its mean without host stalls is the lower. */
  best: CostWindow;
  judged: StallMean & { index: number };
  /** Frames per window. */
  frames: number;
  allocs: Allocations;
}

/**
 * Hold the lantern on a ring line (riding it, the beam showing) and slide it back and forth: after a warm-up of
 * about 400 frames, our two systems' update time per frame in WINDOWS windows of TIMED_FRAMES frames each, one after
 * the other, at 4x CPU throttle; then (on their own, the sampler is heavy) the bytes allocated in our per-frame files
 * over about 200 more frames, sampled every 64 bytes with collected objects counted too. Logged and attached under
 * `label`.
 */
export async function measureCost(boot: BootFn, page: Page, testInfo: TestInfo, label: string): Promise<Cost> {
  const app = await play(boot, page, { rings: true });
  const sizeM = (await app.state()).box.sizeM;
  const hand = new Hands(app, "right");
  const { spot, out } = await firstLine(page);
  const off = await grab(app, page, hand);
  const near = await toWorld(page, add(spot, out, 0.06 / sizeM));
  const far = await toWorld(page, add(spot, out, 0.085 / sizeM));
  await carry(hand, off, near, 500);
  await app.step(40);
  expect((await lantern(page)).mode).toBe("line");
  const slide = async (n: number) => {
    for (let i = 0; i < n; i++) await carry(hand, off, i % 2 ? near : far, 600);
  };
  await slide(8);

  const cdp = await page.context().newCDPSession(page);
  const series = async (names: string[]) =>
    (await page.evaluate((s) => window.__ns!.perfFrames(s), names)).slice(-TIMED_FRAMES);
  const windows: CostWindow[] = [];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (let w = 0; w < WINDOWS; w++) {
      const before = loadAverage();
      await page.evaluate(() => window.__ns!.resetPerf());
      for (let i = 0; (await app.perf()).frames < TIMED_FRAMES; i++) await carry(hand, off, i % 2 ? near : far, 600);
      const both = await series(PATH_SYSTEMS);
      expect(both).toHaveLength(TIMED_FRAMES);
      const loads = [before, loadAverage()].filter((l): l is number => l !== undefined);
      windows.push({
        path: frameStats(both),
        pathRule: withoutStalls(both),
        pathFrames: both,
        pinch: frameStats(await series(["hand-pinch"])),
        lan: frameStats(await series(["lantern"])),
        load: loads.length ? Math.max(...loads) : undefined,
      });
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.startSampling", {
      samplingInterval: 64,
      includeObjectsCollectedByMinorGC: true,
      includeObjectsCollectedByMajorGC: true,
    });
    const f0 = await page.evaluate(() => (window as any).__vt.frames as number);
    await slide(4);
    const frames = (await page.evaluate(() => (window as any).__vt.frames as number)) - f0;
    const { profile } = (await cdp.send("HeapProfiler.stopSampling")) as unknown as { profile: HeapProfile };
    expect((await lantern(page)).mode).toBe("line");

    const judged = judgeWindows(windows.map((w) => w.pathFrames));
    const best = windows[judged.index]!;
    const allocs = ourAllocations(profile, frames);
    const fmt = (s: FrameStats) =>
      `mean ${s.meanMs.toFixed(3)} (${s.trimmedMs.toFixed(3)} without the worst frame), median ${s.medianMs.toFixed(3)}, ` +
      `p95 ${s.p95Ms.toFixed(2)}, max ${s.maxMs.toFixed(2)} ms`;
    const lines = [
      ...windows.flatMap((w, i) => [
        `${label}, window ${i + 1}: hand-pinch + lantern over ${TIMED_FRAMES} frames at 4x CPU throttle: ${fmt(w.path)}; ` +
          `${w.pathRule.stalls} host stalls over ${STALL_MS} ms, mean ${w.pathRule.meanMs.toFixed(3)} ms without them; ` +
          `server load ${w.load?.toFixed(1) ?? "?"}`,
        `${label}, window ${i + 1}: hand-pinch ${fmt(w.pinch)}; lantern ${fmt(w.lan)}`,
      ]),
      `${label}: judged on window ${judged.index + 1}, hand-pinch + lantern ${judged.meanMs.toFixed(3)} ms a frame ` +
        `(mean without host stalls, ${judged.stalls} of them)`,
      `${label}: allocated in our per-frame files, about ${allocs.bytesPerFrame.toFixed(0)} bytes a frame over ${frames} frames ` +
        `(heap sampler, one sample per ${SAMPLE_BYTES} bytes, collected objects included)` +
        (allocs.byFunction.size ? `: ${[...allocs.byFunction].map(([k, b]) => `${k} ${b.toFixed(0)}`).join("; ")}` : ""),
    ];
    for (const d of lines) {
      testInfo.annotations.push({ type: "perf", description: d });
      console.log(d);
    }
    return { windows, best, judged, frames: TIMED_FRAMES, allocs };
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
}
