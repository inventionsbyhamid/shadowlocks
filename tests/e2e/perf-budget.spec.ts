// e2e: exclusive (times real milliseconds at 4x throttle: scripts/e2e.sh runs this spec alone on the server)
// The performance budget for a box in play (the plan's rule): box 15, played through the box session, with the
// lantern carried back and forth in the right hand and the left hand's fingers in the beam, casting. At most 50 draw
// calls and 100k triangles in any one frame (every frame counted); our JS (every
// app system the perf hook times: hands, lantern, the game, shell with the box and the theatre, menus, sound) at most
// 3 ms a frame at p95 with the CPU throttled 4x; and no objects, arrays or closures made per frame. Then box 15
// opened through the box session, its last lock's sunburst and sparkle running into the box's opening and the
// reward's rise: at most 100 draw calls and 100k triangles in its busiest frame.
//
// Time is real CPU time on a shared server, judged as the other cost checks are (helpers/lantern.ts): WINDOWS
// windows of TIMED_FRAMES frames one after the other, the better window held to the budget, host stalls (frames
// over STALL_MS) reported. p95 is robust to a few stalls by itself.
//
// Allocation: V8 boxes a float that crosses a call it did not inline (12-16 bytes), and the heap sampler cannot tell
// those from objects; Rulings 58 and 80 accept them within a byte budget that a per-frame array or object per shadow
// would break. Measured: about 980 bytes a frame in all, the most in one function the shadow mesh's cast (about 550;
// how it splits with box-scene's syncShadows depends on what the engine inlines). An object made per shadow a frame
// (60 shadows, 32 bytes or more each) would add about 2 KB, past both budgets.
import { CHROME_ARGS } from "./helpers/chromium";
import { axisOf, fingerLocks, hands, onRay, Pointer, worldOf } from "./helpers/finger";
import { Hands } from "./helpers/hands";
import {
  carry,
  frameStats,
  grab,
  type HeapProfile,
  lantern,
  loadAverage,
  ourAllocations,
  STALL_MS,
  TIMED_FRAMES,
  toWorld,
  WINDOWS,
  withoutStalls,
} from "./helpers/lantern";
import { expect, test } from "./helpers/test";

const MAX_CALLS = 50;
const MAX_TRIANGLES = 100_000;
const P95_MS = 3;
/** Bytes a frame all of our per-frame code may allocate (boxed floats only), and any one function. */
const ALLOC_BUDGET = 1600;
const FUNCTION_BUDGET = 900;
/** Test-only modules: they time and log the frames, they are not the game. */
const TEST_ONLY = ["src/app/test-hooks.ts", "src/app/virtual-clock.ts"];
const SYSTEMS = ["hand-pinch", "hands", "lantern", "game", "menus", "shell", "sound"];
/** The busiest frame of a box opening: draw calls at most. */
const MAX_PEAK_CALLS = 100;
/** A finger lay this deep in the beam (box units). */
const FINGER_Z = 0.5;

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

test("box 15 in play, the lantern moving and a hand in the beam: draw calls, triangles, our JS at 4x and allocations within budget", async ({
  page,
  boot,
}, testInfo) => {
  // Box 15 played through the box session, so its frame ("game") and its view (plate, hint lantern, marks) are
  // timed and drawn as in play.
  const app = await boot();
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 15 }));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "box 15 in play" },
  );
  // The lantern in front of the box's middle, picked up by the right hand and carried between two points in front of
  // the mouth (inside the comfort envelope).
  const right = new Hands(app, "right");
  await page.evaluate(() => window.__sl!.placeLantern([0.05, -0.1, 1.25]));
  await app.step(2);
  const off = await grab(app, page, right);
  const a = await toWorld(page, [-0.12, -0.18, 1.2]);
  const b = await toWorld(page, [0.18, -0.28, 1.38]);
  // The left hand's fingers in the beam, casting.
  const left = new Pointer(app, "left");
  const [tip] = await worldOf(page, [[0.1, 0.05, 0.6]]);
  await left.point(tip!, [1, 0, 0], [0, 0, -1]);
  const sweep = async (i: number) => carry(right, off, i % 2 ? a : b, 600);
  for (let i = 0; i < 8; i++) await sweep(i);
  const h = await hands(page);
  expect((await lantern(page)).held).toBe(true);
  expect(h.left!.outlines).toBeGreaterThan(0);

  const cdp = await page.context().newCDPSession(page);
  const windows: { frames: number[]; calls: number; triangles: number; load: number | undefined; systems: Record<string, number> }[] = [];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (let w = 0; w < WINDOWS; w++) {
      const load0 = loadAverage();
      await page.evaluate(() => window.__ns!.resetPerf());
      for (let i = 0; (await app.perf()).frames < TIMED_FRAMES; i++) await sweep(i);
      const frames = (await page.evaluate((s) => window.__ns!.perfFrames(s), SYSTEMS)).slice(-TIMED_FRAMES);
      // Draw calls and triangles: the most in any one frame of the window, every frame counted.
      const perf = await app.perf();
      const loads = [load0, loadAverage()].filter((l): l is number => l !== undefined);
      windows.push({
        frames,
        calls: perf.callsMax,
        triangles: perf.trianglesMax,
        load: loads.length ? Math.max(...loads) : undefined,
        systems: Object.fromEntries(Object.entries(perf.systems).map(([k, v]) => [k, v.p95Ms])),
      });
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.startSampling", {
      samplingInterval: 64,
      includeObjectsCollectedByMinorGC: true,
      includeObjectsCollectedByMajorGC: true,
    });
    const f0 = await page.evaluate(() => (window as unknown as { __vt: { frames: number } }).__vt.frames);
    for (let i = 0; i < 4; i++) await sweep(i);
    const nFrames = (await page.evaluate(() => (window as unknown as { __vt: { frames: number } }).__vt.frames)) - f0;
    const { profile } = (await cdp.send("HeapProfiler.stopSampling")) as unknown as { profile: HeapProfile };
    // Measured in play: the session ran the box all along (the carry opened none of its locks).
    const st = (await page.evaluate(() => window.__sl!.session.state()))!;
    const all = ourAllocations(profile, nFrames, ["/src/"]);
    const game = [...all.byFunction].filter(([k]) => !TEST_ONLY.some((t) => k.startsWith(t)));
    const bytes = game.reduce((s, [, v]) => s + v, 0);

    const stats = windows.map((w) => ({ ...frameStats(w.frames), rule: withoutStalls(w.frames) }));
    const best = stats.reduce((bi, s, i) => (s.p95Ms < stats[bi]!.p95Ms ? i : bi), 0);
    const lines = [
      ...windows.map(
        (w, i) =>
          `perf-budget, window ${i + 1}: ${w.calls} draw calls, ${w.triangles} triangles at most; our JS over ${TIMED_FRAMES} frames at 4x: ` +
          `mean ${stats[i]!.meanMs.toFixed(3)}, median ${stats[i]!.medianMs.toFixed(3)}, p95 ${stats[i]!.p95Ms.toFixed(2)}, ` +
          `max ${stats[i]!.maxMs.toFixed(2)} ms (${stats[i]!.rule.stalls} host stalls over ${STALL_MS} ms); server load ${w.load?.toFixed(1) ?? "?"}; ` +
          `p95 by system: ${Object.entries(w.systems).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}`,
      ),
      `perf-budget: judged on window ${best + 1}: p95 ${stats[best]!.p95Ms.toFixed(2)} ms a frame; box 15 through the box ` +
        `session, stage ${st.stage}, ${st.open.length} locks open`,
      `perf-budget: our per-frame code allocated about ${bytes.toFixed(0)} bytes a frame over ${nFrames} frames` +
        (game.length ? `: ${game.sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join("; ")}` : ""),
    ];
    for (const d of lines) {
      testInfo.annotations.push({ type: "perf", description: d });
      console.log(d);
    }
    expect(st.stage).toBe("playing");
    expect(st.open).toEqual([]);
    for (const w of windows) {
      expect(w.calls).toBeLessThanOrEqual(MAX_CALLS);
      expect(w.triangles).toBeLessThanOrEqual(MAX_TRIANGLES);
    }
    expect(stats[best]!.p95Ms).toBeLessThanOrEqual(P95_MS);
    expect(bytes).toBeLessThan(ALLOC_BUDGET);
    expect(game.filter(([, v]) => v > FUNCTION_BUDGET).map(([k, v]) => `${k} ${v.toFixed(0)} bytes a frame`)).toEqual([]);
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});

test("prewarm: nothing the box or the theatre can show compiles a shader the first time it shows", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate(() => window.__ns!.scene.show({ n: 3 }));
  await app.step(3);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = () => page.evaluate(() => (window.__ns!.world as any).renderer.info.programs.length as number);
  const before = await count();
  // Everything hidden in the box (a crystallise's fill, piece and glitter, the settle ripple, the ring beam), the
  // theatre (its veil and its studio) and the hand mask, shown for two frames.
  const shown = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any, scene = w.__ns.world.scene;
    const hidden: { visible: boolean; name: string }[] = [];
    for (const name of ["Box", "Theatre Veil", "Theatre Room", "Hand Mask"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scene.getObjectByName(name)?.traverse((o: any) => {
        if (!o.visible) {
          o.visible = true;
          hidden.push(o);
        }
      });
    }
    w.__shownForTest = hidden;
    return hidden.map((o) => o.name);
  });
  await app.step(2);
  const after = await count();
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const o of (window as any).__shownForTest) o.visible = false;
  });
  console.log(`prewarm: ${before} programs after boot; ${after} once ${shown.length} hidden things showed (${shown.join(", ")})`);
  expect(shown.length).toBeGreaterThan(5);
  expect(after).toBe(before);
});

test("boot at 4x CPU throttle: the first panel lays out on the page, before the session, and the session's frames stay short", async ({
  page,
  boot,
}, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  try {
    const app = await boot({ enterXR: false });
    // The page before XR (the hosted link's landing, or the installed app while its session starts): the home
    // panel is painted at start and lays out on the page's first frames.
    await app.step(10);
    const before = await app.perf();
    await page.evaluate(() => window.__ns!.resetPerf());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.evaluate(() => (window.__ns!.world as any).launchXR({ sessionMode: "immersive-ar" }));
    await app.stepUntil((ns) => ns.state().xr.presenting && ns.state().boxPose.source !== "default", { maxMs: 5_000, label: "in XR" });
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "home at rest" });
    await app.step(20);
    const xr = await app.perf();
    const fmt = (p: typeof xr) =>
      `${p.frames} frames, our JS max ${p.frameMsMax.toFixed(1)} ms, p95 ${p.frameMsP95.toFixed(2)} ms; max by system: ` +
      Object.entries(p.systems)
        .map(([k, v]) => `${k} ${v.maxMs.toFixed(1)}`)
        .join(", ");
    const lines = [`boot at 4x, the page before XR: ${fmt(before)}`, `boot at 4x, the session: ${fmt(xr)}`];
    for (const d of lines) {
      testInfo.annotations.push({ type: "perf", description: d });
      console.log(d);
    }
    expect(xr.frames).toBeGreaterThan(20);
    // The menus' first lay-out happened on the page: in the session the home panel springs in without a long frame.
    expect(xr.systems.menus!.maxMs).toBeLessThan(before.systems.menus!.maxMs);
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});

test("box 15 opening: its busiest frame stays within 100 draw calls and 100k triangles", async ({ page, boot }, testInfo) => {
  const app = await boot();
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 15 }));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "box 15 in play" },
  );
  const s = (await page.evaluate(() => window.__sl!.session.state()))!;
  const open = (lock: number, label: string) =>
    app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, batch: 1, label });
  // The finger locks first, each by the right index finger laid in its gap with the lantern on its spot.
  const hand = new Pointer(app, "right");
  for (const f of await fingerLocks(page)) {
    await page.evaluate((L) => window.__sl!.placeLantern(L), f.spot);
    await app.step(3);
    const { mid, angle } = axisOf(f.piece);
    const sign = Math.cos(angle) >= 0 ? -1 : 1;
    const laid = await hand.lay(onRay(f.spot, mid, FINGER_Z), [sign * Math.cos(angle), sign * Math.sin(angle), 0]);
    expect(laid.off).toBeLessThan(0.01);
    await open(f.lock, `finger lock ${f.lock} open`);
    const [inBox, out] = await worldOf(page, [[0, 0, FINGER_Z], [0, 0, 1.6]]);
    await hand.shift([out![0] - inBox![0], out![1] - inBox![1], out![2] - inBox![2]]);
    await app.step(3);
  }
  // Then the plain locks by the lantern: the last one's sunburst and sparkle run into the box's opening.
  for (const l of s.locks.filter((x) => !x.finger)) {
    await page.evaluate((L) => window.__sl!.placeLantern(L), l.spot);
    await open(l.i, `lock ${l.i} open`);
  }
  // Every frame from the last opening to the reward floating (frames of up to 100 ms of play, the session's longest).
  let peak = { calls: 0, triangles: 0, stage: "", ms: 0 }, ms = 0;
  for (; ms < 6_000; ms += 100) {
    await app.step(1, 100);
    const p = await app.perf();
    const stage = (await page.evaluate(() => window.__sl!.session.state()?.stage ?? "")) as string;
    if (p.calls > peak.calls) peak = { calls: p.calls, triangles: p.triangles, stage, ms };
    peak.triangles = Math.max(peak.triangles, p.triangles);
    if (stage === "reward" && ms > 3_000) break;
  }
  const line = `perf-budget, box 15 opening: busiest frame ${peak.calls} draw calls at ${peak.ms} ms after the last lock (${peak.stage}), ${peak.triangles} triangles at most`;
  testInfo.annotations.push({ type: "perf", description: line });
  console.log(line);
  expect(await app.events("box-open")).toHaveLength(1);
  expect(peak.calls).toBeLessThanOrEqual(MAX_PEAK_CALLS);
  expect(peak.triangles).toBeLessThanOrEqual(MAX_TRIANGLES);
});
