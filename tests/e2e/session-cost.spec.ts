/* eslint-disable @typescript-eslint/no-explicit-any */
// What the box session costs a frame once the engine has optimised it, and what it allocates. Box 5 (three locks)
// in play, the lantern moved every frame on a small circle 5 cm (box units 0.05) from a lock's spot: that lock is
// measured on every frame (the scraps' shadows cast, the solve rule's samples tested), its warmth changes, the head's
// gaze is cast, the stuck watch and the hint lantern and plate keys run, and nothing opens. The "game" system is
// timed by the per-system ring at 4x CPU throttle (V8 told to optimise early, as lantern-cost.spec.ts does) in two
// windows of 200 frames, each window's single worst frame left out; then the heap sampler runs alone over about 200
// more frames.
//
// Budgets: the mean must stay under MEAN_BUDGET_MS when the server is quiet (load 8 or less; otherwise a run note,
// as the other cost specs do), p95 under 3 ms always. Allocation: under ALLOC_BUDGET bytes a frame in all the session's
// per-frame files, and under FUNCTION_BUDGET in any one function of its new modules (optimised code still boxes a
// float passed to a call it did not inline; nothing else).
import fs from "node:fs";
import { CHROME_ARGS } from "./helpers/chromium";
import { expect, test } from "./helpers/test";
import { addRunNote, DT } from "./helpers/xr-app";

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

const FRAMES = 200;
const WINDOWS = 2;
const MEAN_BUDGET_MS = 0.5;
const QUIET_LOAD = 8;
const ALLOC_BUDGET = 250;
const FUNCTION_BUDGET = 48;
const SAMPLE_BYTES = 64;
/** The session's per-frame path. */
const FILES = [
  "/src/app/box-session.ts",
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
/** The box scene's own per-frame shadow path (Task 10's, run by the shell system): reported, not judged here. */
const SCENE_FILES = ["/src/render/shadow-mesh.ts", "/src/render/box-scene.ts", "/src/render/panel.ts"];
const NEW_MODULES = FILES.filter((f) => /box-session|game|hints|events|fx\/|reward|plate|hint-lantern|poke-key/.test(f)).map((f) => f.slice(1));

interface HeapNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children: HeapNode[];
}

function loadAverage(): number | undefined {
  try {
    const v = Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
    return Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b), n = s.length, sum = s.reduce((a, b) => a + b, 0);
  return { mean: sum / n, trimmed: (sum - s[n - 1]!) / (n - 1), p95: s[Math.min(n - 1, Math.floor(n * 0.95))]!, max: s[n - 1]! };
}

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
  const windows: (ReturnType<typeof stats> & { load: number | undefined })[] = [];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (let k = 0; k < WINDOWS; k++) {
      const before = loadAverage();
      await page.evaluate(() => window.__ns!.resetPerf());
      await drive(FRAMES);
      const xs = (await page.evaluate(() => window.__ns!.perfFrames(["game"]))).slice(-FRAMES);
      expect(xs).toHaveLength(FRAMES);
      const loads = [before, loadAverage()].filter((l): l is number => l !== undefined);
      windows.push({ ...stats(xs), load: loads.length ? Math.max(...loads) : undefined });
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: SAMPLE_BYTES, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
  const f0 = await page.evaluate(() => (window as any).__vt.frames as number);
  await drive(FRAMES);
  const frames = (await page.evaluate(() => (window as any).__vt.frames as number)) - f0;
  const { profile } = (await cdp.send("HeapProfiler.stopSampling")) as unknown as { profile: { head: HeapNode; samples: { size: number; nodeId: number }[] } };
  const tally = (files: string[]) => {
    const ours = new Map<number, string>();
    const walk = (node: HeapNode) => {
      const url = node.callFrame.url;
      if (files.some((f) => url.includes(f))) {
        ours.set(node.id, `${url.replace(/^.*\/src\//, "src/").replace(/\?.*$/, "")}:${node.callFrame.functionName}:${node.callFrame.lineNumber + 1}`);
      }
      for (const c of node.children) walk(c);
    };
    walk(profile.head);
    const by = new Map<string, number>();
    let count = 0;
    for (const smp of profile.samples) {
      const key = ours.get(smp.nodeId);
      if (!key) continue;
      count++;
      by.set(key, (by.get(key) ?? 0) + SAMPLE_BYTES / frames);
    }
    return { bytes: (count * SAMPLE_BYTES) / frames, by };
  };
  const { bytes: bytesPerFrame, by: byFunction } = tally(FILES);
  const scene = tally(SCENE_FILES);
  expect((await page.evaluate(() => window.__sl!.session.state()))!.open).toEqual([]);

  const best = windows.reduce((a, b) => (b.trimmed < a.trimmed ? b : a));
  const lines = [
    ...windows.map(
      (w, i) =>
        `session cost, window ${i + 1}: "game" over ${FRAMES} frames at 4x CPU throttle: mean ${w.mean.toFixed(3)} ms ` +
        `(${w.trimmed.toFixed(3)} without the worst frame), p95 ${w.p95.toFixed(2)}, max ${w.max.toFixed(2)}; server load ${w.load?.toFixed(1) ?? "?"}`,
    ),
    `session cost: allocated in the session's per-frame files, about ${bytesPerFrame.toFixed(0)} bytes a frame over ${frames} frames` +
      (byFunction.size ? `: ${[...byFunction].map(([k, b]) => `${k} ${b.toFixed(0)}`).join("; ")}` : ""),
    `session cost (reported only): the box scene's own shadow path allocated about ${scene.bytes.toFixed(0)} bytes a frame` +
      (scene.by.size ? `: ${[...scene.by].map(([k, b]) => `${k} ${b.toFixed(0)}`).join("; ")}` : ""),
  ];
  for (const l of lines) {
    testInfo.annotations.push({ type: "perf", description: l });
    console.log(l);
  }
  expect(best.p95).toBeLessThanOrEqual(3);
  if (best.load === undefined || best.load <= QUIET_LOAD) expect(best.trimmed).toBeLessThanOrEqual(MEAN_BUDGET_MS);
  else addRunNote(`session cost: not strictly asserted, server load ${best.load.toFixed(1)} > ${QUIET_LOAD}; ${best.trimmed.toFixed(3)} ms a frame (budget ${MEAN_BUDGET_MS} ms)`);
  expect(bytesPerFrame).toBeLessThan(ALLOC_BUDGET);
  const over = [...byFunction].filter(([k, b]) => NEW_MODULES.some((m) => k.startsWith(m)) && b > FUNCTION_BUDGET).map(([k, b]) => `${k} ${b.toFixed(0)}`);
  expect(over).toEqual([]);
});
