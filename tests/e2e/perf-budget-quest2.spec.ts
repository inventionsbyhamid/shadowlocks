// e2e: exclusive (times real milliseconds at a Quest 2's throttle: scripts/e2e.sh runs this spec alone on the server)
// The performance budget on the older Quests: perf-budget.spec.ts's play case (helpers/perf-play.ts: box 15 played
// through the box session, the lantern carried back and forth in the right hand, the left hand's fingers casting in
// the beam) on IWER's Quest 2 profile (helpers/headset.ts), with the CPU throttled for a Quest 2.
//
// The throttle: perf-budget's 4x stands for a Quest 3. The XR2 Gen 2's CPU is "more than 33 percent" faster than the
// XR2 Gen 1's (Qualcomm and Meta at the Quest 3 launch), so a Quest 2 is QUEST2_RATE = 4 x 4/3. (A Quest Pro in
// passthrough is held to CPU level 3, 1.38 GHz, where a Quest 2 runs level 4, 1.48 GHz: Meta's CPU and GPU levels page;
// 7% slower again, about 5.7x. The report gives a run at 6x.) The stall rule is set for the throttle (STALL, MAX,
// SPREAD).
//
// The budgets: the same draw calls and triangles as perf-budget (the scene is the same on every headset, far inside
// Meta's Quest 2 guidance of 400-600 draws and 750k-1M triangles for a puzzle game). Our JS: the same share of the frame
// as perf-budget's, which holds 3 ms at 4x, 27% of a Quest 3 frame at 90 Hz (11.1 ms); the older Quests run at 72 Hz
// (src/app/headset.ts: 13.9 ms), and 27% of that is P95_MS, by the stall rule (helpers/stall-rule.ts), the better of
// two windows. Every system's update (IWSDK's input and UI too) and the render's time are reported, not judged: in the
// emulator the first carries IWER's own work (it makes up the hands' joints in JavaScript, where a headset hands them
// over), and the second waits on software rendering as a headset's does not.
import { CHROME_ARGS } from "./helpers/chromium";
import { emulateHeadset } from "./helpers/headset";
import { expectP95WithinBudget, frameStats, judgeWindowsP95, p95WithoutStalls, STALL_MS, TIMED_FRAMES } from "./helpers/lantern";
import { box15InPlay, timedWindows } from "./helpers/perf-play";
import { expect, test } from "./helpers/test";

const QUEST2_RATE = 16 / 3;
/**
 * The stall rule at this throttle. A stall stretches with it (STALL). And the stalls come more often the harder the
 * throttle: measured 46-70 ms each, whatever the throttle, in whichever system was running (hand-pinch, shell, lantern,
 * game, hands, sound), 2-6 a window of TIMED_FRAMES at 4x, 5-14 at this throttle over five runs, 13-15 at 6x: the
 * throttle's own pauses landing inside a frame, or the server's, not our code. So up to MAX of them (7.5% of the
 * window) leave the p95 to judge, as long as they are spread over SPREAD systems or more: a hitch of ours would keep
 * landing in one.
 */
const STALL = (STALL_MS * QUEST2_RATE) / 4;
const MAX = 15;
const SPREAD = 3;
const MAX_CALLS = 50;
const MAX_TRIANGLES = 100_000;
const P95_MS = 3.75;

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

test("Quest 2: box 15 in play at 72 Hz, the lantern moving and a hand in the beam, at a Quest 2's throttle: draw calls, triangles and our JS within budget", async ({
  page,
  boot,
}, testInfo) => {
  await emulateHeadset(page, "metaQuest2");
  const app = await boot();
  expect(await page.evaluate(() => navigator.userAgent)).toContain("Quest 2");
  expect(await page.evaluate(() => window.__ns!.headset())).toMatchObject({ class: "xr2-gen1", frameRate: 72 });
  const sweep = await box15InPlay(app, page);
  const rate = QUEST2_RATE, stall = STALL;
  const windows = await timedWindows(app, page, sweep, rate);
  const st = (await page.evaluate(() => window.__sl!.session.state()))!;
  // Where the last window's stalls fell: the system that took most of each stalled frame, and how long.
  const names = Object.keys(windows[windows.length - 1]!.systems);
  const bySystem = await page.evaluate(
    ({ names, n }) => Object.fromEntries(names.map((k) => [k, window.__ns!.perfFrames([k]).slice(-n)])),
    { names, n: TIMED_FRAMES },
  );
  const last = windows[windows.length - 1]!.frames;
  const owners: string[] = [];
  const whose: string[] = [];
  last.forEach((ms, i) => {
    if (ms < STALL) return;
    const [who, t] = Object.entries(bySystem).reduce((a, [k, xs]) => ((xs[i] ?? 0) > a[1] ? [k, xs[i] ?? 0] : a), ["?", 0] as [string, number]);
    owners.push(`frame ${i} ${ms.toFixed(1)} ms (${who} ${t.toFixed(1)})`);
    whose.push(who);
  });

  const judged = judgeWindowsP95(windows.map((w) => w.frames), stall);
  const update = judgeWindowsP95(windows.map((w) => w.update), stall);
  const x = `${rate.toFixed(2)}x`;
  const lines = [
    ...windows.map((w, i) => {
      const s = frameStats(w.frames), rule = p95WithoutStalls(w.frames, stall), u = p95WithoutStalls(w.update, stall);
      const r = p95WithoutStalls(w.render, stall);
      return (
        `perf-budget Quest 2, window ${i + 1}: ${w.calls} draw calls, ${w.triangles} triangles at most; at ${x} over ${TIMED_FRAMES} frames: ` +
        `our JS mean ${s.meanMs.toFixed(3)}, median ${s.medianMs.toFixed(3)}, p95 ${s.p95Ms.toFixed(2)}, max ${s.maxMs.toFixed(2)} ms ` +
        `(${rule.stalls} stalls over ${stall.toFixed(1)} ms; p95 ${rule.p95Ms.toFixed(2)} without them); every system p95 ${u.p95Ms.toFixed(2)} ms ` +
        `(${u.stalls} stalls), the render's (software GL) ${r.p95Ms.toFixed(2)} (${r.stalls} stalls); server load ${w.load?.toFixed(1) ?? "?"}; ` +
        `p95 by system: ${Object.entries(w.systems).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}`
      );
    }),
    `perf-budget Quest 2: judged our JS on window ${judged.index + 1}: p95 ${judged.p95Ms.toFixed(2)} ms (${judged.stalls} stalls); ` +
      `every system on window ${update.index + 1}: p95 ${update.p95Ms.toFixed(2)} ms (${update.stalls} stalls); stage ${st.stage}, ${st.open.length} locks open`,
    `perf-budget Quest 2: the last window's stalls: ${owners.join("; ") || "none"}`,
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
  expectP95WithinBudget(judged, P95_MS, `perf-budget Quest 2, our JS at ${x}`, STALL, MAX);
  // Many stalls all in one system would be a hitch of ours, not the throttle's or the server's.
  if (whose.length >= 2 * SPREAD) expect(new Set(whose).size, `the systems the stalls fell in: ${owners.join("; ")}`).toBeGreaterThanOrEqual(SPREAD);
});
