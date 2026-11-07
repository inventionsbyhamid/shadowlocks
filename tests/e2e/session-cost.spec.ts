/* eslint-disable @typescript-eslint/no-explicit-any */
// What the box session costs a frame once the engine has optimised it, and what it allocates. Box 5 (three locks)
// in play, the lantern moved every frame on a small circle 5 cm (box units 0.05) from a lock's spot: that lock is
// measured on every frame (the scraps' shadows cast, the solve rule's samples tested), its warmth changes, the head's
// gaze is cast, the stuck watch and the hint lantern and plate keys run, and nothing opens. The "game" system is
// timed by the per-system ring at 4x CPU throttle (V8 told to optimise early, as lantern-cost.spec.ts does) in
// WINDOWS windows of TIMED_FRAMES frames, judged by the stall rule the other cost checks use (helpers/lantern.ts: host
// stalls left out and counted, the better window held to the budget); then the heap sampler runs alone.
//
// Allocation: under ALLOC_BUDGET bytes a frame in the session's per-frame files, and under FUNCTION_BUDGET in any one
// function of its new modules (optimised code still boxes a float passed to a call it did not inline; nothing else).
// The box scene's own shadow path is reported beside it (Task 18 looks at it).
import { CHROME_ARGS } from "./helpers/chromium";
import {
  expectWithinBudget,
  frameStats,
  type HeapProfile,
  judgeWindows,
  loadAverage,
  MEAN_BUDGET_MS,
  ourAllocations,
  STALL_MS,
  TIMED_FRAMES,
  WINDOWS,
  withoutStalls,
} from "./helpers/lantern";
import { expect, test } from "./helpers/test";
import { DT } from "./helpers/xr-app";

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

const ALLOC_BUDGET = 250;
const FUNCTION_BUDGET = 48;
/** The session's per-frame path. */
const FILES = [
  "/src/app/box-session.ts",
  "/src/app/session-fingers.ts",
  "/src/app/session-rules.ts",
  "/src/app/game.ts",
  "/src/app/hints.ts",
  "/src/app/events.ts",
  "/src/core/solve.ts",
  "/src/core/geom.ts",
  "/src/feel/gaze-focus.ts",
  "/src/feel/stuck-watch.ts",
  "/src/render/fx/lock-open.ts",
  "/src/render/fx/box-open.ts",
  "/src/render/reward.ts",
  "/src/render/finger-key.ts",
  "/src/render/placement.ts",
  "/src/ui/plate.ts",
  "/src/ui/hint-lantern.ts",
  "/src/ui/poke-key.ts",
  "/src/audio/hums.ts",
];
/** The box scene's own per-frame shadow path (run by the shell system): reported, not judged here. */
const SCENE_FILES = ["/src/render/shadow-mesh.ts", "/src/render/box-shadows.ts", "/src/render/box-scene.ts", "/src/render/panel.ts"];
const NEW_MODULES = FILES.filter((f) => /box-session|session-|game|hints|events|fx\/|reward|plate|hint-lantern|poke-key/.test(f)).map((f) => f.slice(1));

test("the box session costs well under 0.5 ms a frame at 4x CPU throttle and allocates only boxed floats", async ({ page, boot }, testInfo) => {
  const app = await boot();
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 5 }));
  await app.stepUntil((_ns, w) => w.__sl.session.state()?.stage === "playing" && w.__sl.session.state().revealed, { maxMs: 10_000, label: "box 5 in play" });
  const s = (await page.evaluate(() => window.__sl!.session.state()))!;
  const spot = s.locks[0]!.spot;
  await page.evaluate(
    ({ spot, dt }) => {
      const w = window as any;
      let k = 0;
      w.__drive = (n: number) => {
        for (let i = 0; i < n; i++, k++) {
          const a = k * 0.21;
          w.__sl.placeLantern([spot[0] + 0.05 * Math.cos(a), spot[1] + 0.05 * Math.sin(a), spot[2]]);
          w.__vt.step(dt);
        }
      };
    },
    { spot, dt: DT },
  );
  const drive = (n: number) => page.evaluate((m) => (window as any).__drive(m), n);
  await drive(400);
  const mid = (await page.evaluate(() => window.__sl!.session.state()))!;
  expect(mid.open).toEqual([]);
  expect(mid.warmth[0]).toBeGreaterThan(0);

  const cdp = await page.context().newCDPSession(page);
  const windows: { frames: number[]; load: number | undefined }[] = [];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (let k = 0; k < WINDOWS; k++) {
      const before = loadAverage();
      await page.evaluate(() => window.__ns!.resetPerf());
      await drive(TIMED_FRAMES);
      const xs = (await page.evaluate(() => window.__ns!.perfFrames(["game"]))).slice(-TIMED_FRAMES);
      expect(xs).toHaveLength(TIMED_FRAMES);
      const loads = [before, loadAverage()].filter((l): l is number => l !== undefined);
      windows.push({ frames: xs, load: loads.length ? Math.max(...loads) : undefined });
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 64, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
  const f0 = await page.evaluate(() => (window as any).__vt.frames as number);
  await drive(TIMED_FRAMES);
  const frames = (await page.evaluate(() => (window as any).__vt.frames as number)) - f0;
  const { profile } = (await cdp.send("HeapProfiler.stopSampling")) as unknown as { profile: HeapProfile };
  expect((await page.evaluate(() => window.__sl!.session.state()))!.open).toEqual([]);

  const judged = judgeWindows(windows.map((w) => w.frames));
  const allocs = ourAllocations(profile, frames, FILES);
  const scene = ourAllocations(profile, frames, SCENE_FILES);
  const list = (by: Map<string, number>) => (by.size ? `: ${[...by].map(([k, b]) => `${k} ${b.toFixed(0)}`).join("; ")}` : "");
  const lines = [
    ...windows.map((w, i) => {
      const st = frameStats(w.frames), rule = withoutStalls(w.frames);
      return (
        `session cost, window ${i + 1}: "game" over ${TIMED_FRAMES} frames at 4x CPU throttle: mean ${st.meanMs.toFixed(3)} ms, ` +
        `median ${st.medianMs.toFixed(3)}, p95 ${st.p95Ms.toFixed(2)}, max ${st.maxMs.toFixed(2)}; ${rule.stalls} host stalls over ` +
        `${STALL_MS} ms, mean ${rule.meanMs.toFixed(3)} ms without them; server load ${w.load?.toFixed(1) ?? "?"}`
      );
    }),
    `session cost: judged on window ${judged.index + 1}: ${judged.meanMs.toFixed(3)} ms a frame without host stalls (${judged.stalls} of them)`,
    `session cost: allocated in the session's per-frame files, about ${allocs.bytesPerFrame.toFixed(0)} bytes a frame over ${frames} frames${list(allocs.byFunction)}`,
    `session cost (reported only): the box scene's own shadow path allocated about ${scene.bytesPerFrame.toFixed(0)} bytes a frame${list(scene.byFunction)}`,
  ];
  for (const l of lines) {
    testInfo.annotations.push({ type: "perf", description: l });
    console.log(l);
  }
  expectWithinBudget(judged, MEAN_BUDGET_MS, "the box session");
  expect(allocs.bytesPerFrame).toBeLessThan(ALLOC_BUDGET);
  const over = [...allocs.byFunction].filter(([k, b]) => NEW_MODULES.some((m) => k.startsWith(m)) && b > FUNCTION_BUDGET).map(([k, b]) => `${k} ${b.toFixed(0)}`);
  expect(over).toEqual([]);
});
