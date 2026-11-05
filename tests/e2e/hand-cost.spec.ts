// What the hands in the box cost a frame once the engine has optimised them: the "hands" system (the depth mask, both
// hands' shadow outlines from the lantern, and box 3's finger lock measured with the finger every frame) at 4x CPU
// throttle, and what it allocates. Both hands in the beam, the right one's finger sliding along just beside the gap,
// so the lock never opens and keeps measuring: the most the system does in a frame.
//
// V8 is told to optimise after a few calls (as lantern-cost.spec.ts does), so a short test sees steady-state code.
// The path makes no objects, arrays or closures per frame; optimised code still boxes floats at calls it did not
// inline, which the heap sampler cannot tell from objects, so the check is a byte budget that only boxed floats fit.
import type { Vec3 } from "../../src/core/types";
import { CHROME_ARGS } from "./helpers/chromium";
import { atFingerLock, fingerLocks, hands, Pointer, worldOf } from "./helpers/finger";
import { add, type HeapProfile, loadAverage, MAX_LOAD, ourAllocations, play } from "./helpers/lantern";
import { expect, test } from "./helpers/test";
import { addRunNote } from "./helpers/xr-app";

/** Mean ms a frame of the "hands" system at 4x throttle, at most (strict when the server is quiet). */
const BUDGET_MS = 0.5;
/** Its p95 at 4x, at most, whatever the load (0.1 ms timer steps times 4). */
const LOOSE_MS = 3;
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
];
const NEW_MODULES = ["src/render/hand-shadow.ts", "src/render/hand-mask.ts", "src/app/hand-system.ts", "src/app/finger-lock.ts"];

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
  const slide = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await app.queue("animate_to", { device: right.device, anchor: "index-tip", position: toXyz(add(base, along, i % 2 ? -1 : 1)), duration: 0.6 });
      await app.settle(10_000, 0);
    }
  };
  await slide(8);
  const h = await hands(page);
  expect(h.left!.outlines).toBeGreaterThan(0);
  expect(h.right!.outlines).toBeGreaterThan(0);
  expect(h.finger.length).toBeGreaterThanOrEqual(2);
  expect(h.mask).toBeGreaterThanOrEqual(36);

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
    const f0 = await page.evaluate(() => (window as unknown as { __vt: { frames: number } }).__vt.frames);
    await slide(4);
    const frames = (await page.evaluate(() => (window as unknown as { __vt: { frames: number } }).__vt.frames)) - f0;
    const { profile } = (await cdp.send("HeapProfiler.stopSampling")) as unknown as { profile: HeapProfile };
    // It measured every frame and never opened.
    expect((await fingerLocks(page))[0]!.state).toBe("idle");

    const s = perf.systems.hands!;
    const n = perf.frames;
    const trimmed = (s.avgMs * n - s.maxMs) / (n - 1);
    const allocs = ourAllocations(profile, frames, FILES);
    const known = loads.filter((l): l is number => l !== undefined);
    const load = known.length ? Math.max(...known) : undefined;
    const lines = [
      `hands cost: over ${n} frames at 4x CPU throttle: ${s.avgMs.toFixed(3)} avg (${trimmed.toFixed(3)} without its worst frame) / ` +
        `${s.p95Ms.toFixed(2)} p95 / ${s.maxMs.toFixed(2)} max ms; ${h.outlines.length} outlines, ${h.mask} mask capsules; server load ${load?.toFixed(1) ?? "?"}`,
      `hands cost: allocated in the hands' per-frame files, about ${allocs.bytesPerFrame.toFixed(0)} bytes a frame over ${frames} frames` +
        (allocs.byFunction.size ? `: ${[...allocs.byFunction].map(([k, v]) => `${k} ${v.toFixed(0)}`).join("; ")}` : ""),
    ];
    for (const d of lines) {
      testInfo.annotations.push({ type: "perf", description: d });
      console.log(d);
    }
    expect(n).toBeGreaterThanOrEqual(150);
    expect(allocs.bytesPerFrame).toBeLessThan(ALLOC_BUDGET);
    const over = [...allocs.byFunction]
      .filter(([k, v]) => NEW_MODULES.some((m) => k.startsWith(m)) && v > FUNCTION_BUDGET)
      .map(([k, v]) => `${k} ${v.toFixed(0)} bytes a frame`);
    expect(over).toEqual([]);
    expect(s.p95Ms).toBeLessThanOrEqual(LOOSE_MS);
    if (load !== undefined && load > MAX_LOAD) {
      const note = `hands cost: not strictly asserted, server load ${load.toFixed(1)} > ${MAX_LOAD}; ${trimmed.toFixed(3)} ms a frame (budget ${BUDGET_MS} ms)`;
      testInfo.annotations.push({ type: "perf", description: note });
      addRunNote(note);
      console.log(note);
    } else {
      expect(trimmed).toBeLessThan(BUDGET_MS);
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});
