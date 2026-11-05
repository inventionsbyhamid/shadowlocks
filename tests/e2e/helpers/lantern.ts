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

/** Above this 1-minute load average the server is too busy to hold a frame-time budget to. */
export const MAX_LOAD = 8;
/** Our per-frame lantern path (hand-pinch reads the hands; lantern runs the grab, the feel and the view), p95 sum. */
export const BUDGET_MS = 1;
export const LOOSE_MS = 3;
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

function loadAverage(): number | undefined {
  try {
    const v = Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
    return Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

interface HeapNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: HeapNode[];
}

/** Bytes the sampling heap profile puts in each of our files' functions (file:function:line of the function). */
function ourAllocations(root: HeapNode): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (n: HeapNode) => {
    const url = n.callFrame.url;
    if (n.selfSize > 0 && OUR_FILES.some((f) => url.includes(f))) {
      const key = `${url.replace(/^.*\/src\//, "src/").replace(/\?.*$/, "")}:${n.callFrame.functionName}:${n.callFrame.lineNumber + 1}`;
      out.set(key, (out.get(key) ?? 0) + n.selfSize);
    }
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

export interface Cost {
  pinch: { avgMs: number; p95Ms: number; maxMs: number };
  lan: { avgMs: number; p95Ms: number; maxMs: number };
  frames: number;
  allocs: Map<string, number>;
  load: number | undefined;
}

/**
 * Hold the lantern on a ring line (riding it, the beam showing) and slide it back and forth: after a warm-up of
 * about 400 frames, our systems' update time over about 200 frames at 4x CPU throttle, then (on their own, the
 * sampler is heavy) the bytes allocated in our per-frame files over about 200 more, sampled every 64 bytes with
 * collected objects counted too. Logged and attached under `label`.
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
  const loads = [loadAverage()];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.evaluate(() => window.__ns!.resetPerf());
    await slide(4);
    const perf = await app.perf();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    loads.push(loadAverage());
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.startSampling", {
      samplingInterval: 64,
      includeObjectsCollectedByMinorGC: true,
      includeObjectsCollectedByMajorGC: true,
    });
    await slide(4);
    const { profile } = (await cdp.send("HeapProfiler.stopSampling")) as unknown as { profile: { head: HeapNode } };
    expect((await lantern(page)).mode).toBe("line");

    const sys = (k: string) => perf.systems[k] ?? { avgMs: Number.NaN, p95Ms: Number.NaN, maxMs: Number.NaN };
    const pinch = sys("hand-pinch"), lan = sys("lantern");
    const allocs = ourAllocations(profile.head);
    const known = loads.filter((l): l is number => l !== undefined);
    const load = known.length ? Math.max(...known) : undefined;
    const lines = [
      `${label}: over ${perf.frames} frames at 4x CPU throttle: hand-pinch ${pinch.avgMs.toFixed(3)} avg / ${pinch.p95Ms.toFixed(2)} p95 / ` +
        `${pinch.maxMs.toFixed(2)} max ms; lantern ${lan.avgMs.toFixed(3)} avg / ${lan.p95Ms.toFixed(2)} p95 / ${lan.maxMs.toFixed(2)} max ms; ` +
        `all our systems ${perf.frameMsAvg.toFixed(3)} avg / ${perf.frameMsP95.toFixed(2)} p95 ms; server load ${load?.toFixed(1) ?? "?"}`,
      allocs.size
        ? `${label}: bytes allocated in our per-frame files over about 200 frames: ${[...allocs].map(([k, b]) => `${k} ${b}`).join("; ")}`
        : `${label}: no allocation sampled in our per-frame files over about 200 frames (every 64 bytes, collected objects included)`,
    ];
    for (const d of lines) {
      testInfo.annotations.push({ type: "perf", description: d });
      console.log(d);
    }
    expect(perf.frames).toBeGreaterThanOrEqual(150);
    return { pinch, lan, frames: perf.frames, allocs, load };
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
}
