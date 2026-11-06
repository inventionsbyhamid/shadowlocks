// What the hands in the box cost a frame once the engine has optimised them: the "hands" system (the depth mask, both
// hands' shadow outlines from the lantern, and box 3's finger lock measured with the finger every frame) at 4x CPU
// throttle, and what it allocates. Both hands in the beam, the right one's finger sliding along just beside the gap,
// so the lock never opens and keeps measuring: the most the system does in a frame. The box's update ("shell"), which
// now casts the hands' 36 outlines into the panel's shadow mesh every frame, is timed over the same frames and
// reported.
//
// V8 is told to optimise after a few calls (as lantern-cost.spec.ts does), so a short test sees steady-state code.
// The path makes no objects, arrays or closures per frame; optimised code still boxes floats at calls it did not
// inline, which the heap sampler cannot tell from objects, so the check is a byte budget that only boxed floats fit.
import type { Vec3 } from "../../src/core/types";
import { CHROME_ARGS } from "./helpers/chromium";
import { atFingerLock, fingerLocks, hands, Pointer, worldOf } from "./helpers/finger";
import {
  add,
  frameStats,
  type HeapProfile,
  loadAverage,
  MEAN_BUDGET_MS,
  ourAllocations,
  play,
  TIMED_FRAMES,
  WINDOWS,
} from "./helpers/lantern";
import { expect, test } from "./helpers/test";

/**
 * A frame of the hands system this long (ms, at 4x) is a host stall, not our code: about seven times the whole 3 ms
 * budget of all our systems. This server stalls 40-60 ms now and then (one or two in 200 frames of late, often both in
 * one window), so stalls are left out of the mean and counted; a window with more than MAX_STALLS of them is no
 * measure at all, and a regression that slow would show in every frame anyway.
 */
const STALL_MS = 20;
const MAX_STALLS = 5;
/** Bytes a frame allocated in the hands' per-frame files, at most (optimised; boxed floats only). */
const ALLOC_BUDGET = 150;
/** Bytes a frame any one function of the new modules may allocate. */
const FUNCTION_BUDGET = 48;
const FILES = [
  "/src/input/hand-joints.ts",
  "/src/render/hand-shadow.ts",
  "/src/render/hand-mask.ts",
  "/src/render/live-attribute.ts",
  "/src/app/hand-system.ts",
  "/src/app/finger-lock.ts",
  "/src/feel/finger-hold.ts",
  "/src/core/solve.ts",
  "/src/core/geom.ts",
  // The box's update, which casts the hands' outlines into the shadow mesh every frame.
  "/src/render/box-scene.ts",
  "/src/render/shadow-mesh.ts",
  "/src/render/fx/crystallise.ts",
];
const NEW_MODULES = [
  "src/render/hand-shadow.ts",
  "src/render/hand-mask.ts",
  "src/app/hand-system.ts",
  "src/app/finger-lock.ts",
  "src/render/box-scene.ts",
  "src/render/fx/crystallise.ts",
];

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

test("the hands in the box cost well under 0.5 ms a frame at 4x CPU throttle and allocate only boxed floats", async ({ page, boot }, testInfo) => {
  const app = await play(boot, page);
  const { mid, dir } = await atFingerLock(app, page, 0.5);
  // The right finger along the gap's line, beside it by more than its shadow's width; the left hand in the beam too.
  const right = new Pointer(app, "right");
  await right.lay(add(mid, [-dir[1] * 0.15, dir[0] * 0.15, 0]), dir);
  const left = new Pointer(app, "left");
  const [tip] = await worldOf(page, [[0.15, -0.2, 0.6]]);
  await left.point(tip!, [1, 0, 0], [0, 0, -1]);
  const [a, b] = await worldOf(page, [[0, 0, 0.5], add([0, 0, 0.5], dir, 0.06)]);
  const along: Vec3 = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const base = right.tip;
  const toXyz = (p: Vec3) => ({ x: p[0], y: p[1], z: p[2] });
  // Back and forth along the gap's line, 1.4 cm either side, 0.6 s each way.
  const slideOnce = async (i: number) => {
    await app.queue("animate_to", { device: right.device, anchor: "index-tip", position: toXyz(add(base, along, i % 2 ? -1 : 1)), duration: 0.6 });
    await app.settle(10_000, 0);
  };
  for (let i = 0; i < 8; i++) await slideOnce(i);
  const h = await hands(page);
  expect(h.left!.outlines).toBeGreaterThan(0);
  expect(h.right!.outlines).toBeGreaterThan(0);
  expect(h.finger.length).toBeGreaterThanOrEqual(2);
  expect(h.mask).toBeGreaterThanOrEqual(36);

  const cdp = await page.context().newCDPSession(page);
  const series = async (names: string[]) => (await page.evaluate((s) => window.__ns!.perfFrames(s), names)).slice(-TIMED_FRAMES);
  // WINDOWS windows of TIMED_FRAMES frames one after the other, judged on the better (as the lantern's cost is: a busy
  // shared server can spoil one window with host stalls; the code is the same in both).
  const windows: { hands: number[]; shell: number[]; load: number | undefined }[] = [];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (let w = 0; w < WINDOWS; w++) {
      const load0 = loadAverage();
      await page.evaluate(() => window.__ns!.resetPerf());
      for (let i = 0; (await app.perf()).frames < TIMED_FRAMES; i++) await slideOnce(i);
      const load1 = loadAverage();
      const loads = [load0, load1].filter((l): l is number => l !== undefined);
      windows.push({ hands: await series(["hands"]), shell: await series(["shell"]), load: loads.length ? Math.max(...loads) : undefined });
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.startSampling", {
      samplingInterval: 64,
      includeObjectsCollectedByMinorGC: true,
      includeObjectsCollectedByMajorGC: true,
    });
    const f0 = await page.evaluate(() => (window as unknown as { __vt: { frames: number } }).__vt.frames);
    for (let i = 0; i < 4; i++) await slideOnce(i);
    const frames = (await page.evaluate(() => (window as unknown as { __vt: { frames: number } }).__vt.frames)) - f0;
    const { profile } = (await cdp.send("HeapProfiler.stopSampling")) as unknown as { profile: HeapProfile };
    // It measured every frame and never opened.
    expect((await fingerLocks(page))[0]!.state).toBe("idle");

    const stats = windows.map((w) => {
      expect(w.hands).toHaveLength(TIMED_FRAMES);
      const kept = w.hands.filter((ms) => ms < STALL_MS);
      return {
        hands: frameStats(w.hands),
        shell: frameStats(w.shell),
        load: w.load,
        stalls: w.hands.length - kept.length,
        keptMs: kept.reduce((a, b) => a + b, 0) / Math.max(1, kept.length),
      };
    });
    const best = stats.reduce((a, b) => (b.keptMs < a.keptMs ? b : a));
    const allocs = ourAllocations(profile, frames, FILES);
    const fmt = (x: (typeof stats)[number]["hands"]) =>
      `mean ${x.meanMs.toFixed(3)} (${x.trimmedMs.toFixed(3)} without the worst frame), median ${x.medianMs.toFixed(3)}, ` +
      `p95 ${x.p95Ms.toFixed(2)}, max ${x.maxMs.toFixed(2)} ms`;
    const lines = [
      ...stats.map(
        (w, i) =>
          `hands cost, window ${i + 1}: hands over ${TIMED_FRAMES} frames at 4x CPU throttle: ${fmt(w.hands)}; ` +
          `${w.stalls} host stalls over ${STALL_MS} ms, mean ${w.keptMs.toFixed(3)} ms without them; shell (the box's update, ` +
          `casting the hands' shadows) ${fmt(w.shell)}; server load ${w.load?.toFixed(1) ?? "?"}`,
      ),
      `hands cost: ${h.outlines.length} outlines, ${h.mask} mask capsules; allocated in the hands' per-frame files, about ` +
        `${allocs.bytesPerFrame.toFixed(0)} bytes a frame over ${frames} frames` +
        (allocs.byFunction.size ? `: ${[...allocs.byFunction].map(([k, v]) => `${k} ${v.toFixed(0)}`).join("; ")}` : ""),
    ];
    for (const d of lines) {
      testInfo.annotations.push({ type: "perf", description: d });
      console.log(d);
    }
    expect(best.stalls, `host stalls in the better window`).toBeLessThanOrEqual(MAX_STALLS);
    expect(best.keptMs, `hands, mean ms a frame over ${TIMED_FRAMES} frames without host stalls, better window`).toBeLessThanOrEqual(
      MEAN_BUDGET_MS,
    );
    expect(allocs.bytesPerFrame).toBeLessThan(ALLOC_BUDGET);
    const over = [...allocs.byFunction]
      .filter(([k, v]) => NEW_MODULES.some((m) => k.startsWith(m)) && v > FUNCTION_BUDGET)
      .map(([k, v]) => `${k} ${v.toFixed(0)} bytes a frame`);
    expect(over).toEqual([]);
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});
