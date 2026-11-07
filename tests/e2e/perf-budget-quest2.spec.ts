// e2e: exclusive (times real milliseconds at 6x throttle: scripts/e2e.sh runs this spec alone on the server)
// The performance budget on the older Quests: perf-budget.spec.ts's play case (helpers/perf-play.ts: box 15 played
// through the box session, the lantern carried back and forth in the right hand, the left hand's fingers casting in
// the beam) on IWER's Quest 2 profile (helpers/headset.ts), with the CPU throttled for a Quest 2 or Quest Pro.
//
// The throttle: perf-budget's 4x stands for a Quest 3. The XR2 Gen 2's CPU is "more than 33 percent" faster than the
// XR2 Gen 1's (Qualcomm and Meta at the Quest 3 launch), so a Quest 2 is about 4 x 1.33 = 5.3x; a Quest Pro in
// passthrough is held to CPU level 3 (1.38 GHz) where a Quest 2 runs level 4 (1.48 GHz: Meta's CPU and GPU levels
// page), 7% slower again: 5.7x. QUEST2_RATE rounds that up.
//
// The budgets: the same draw calls and triangles as perf-budget (the scene is the same on every headset, far inside
// Meta's Quest 2 guidance of 400-600 draws and 750k-1M triangles for a puzzle game). Our JS: perf-budget's 3 ms at 4x
// is at most 27% of a Quest 3 frame at 90 Hz (11.1 ms); the older Quests run at 72 Hz (src/app/headset.ts: 13.9 ms),
// and the same share of their frame is P95_MS. The whole frame on the main thread (every system's update, IWSDK's
// too, and the render's JavaScript) is held to WHOLE_P95_MS, half the 72 Hz frame, leaving the rest to the browser.
// Both by the stall rule (helpers/stall-rule.ts), the better of two windows.
import { CHROME_ARGS } from "./helpers/chromium";
import { emulateHeadset } from "./helpers/headset";
import { expectP95WithinBudget, frameStats, judgeWindowsP95, p95WithoutStalls, STALL_MS, TIMED_FRAMES } from "./helpers/lantern";
import { box15InPlay, timedWindows } from "./helpers/perf-play";
import { expect, test } from "./helpers/test";

const QUEST2_RATE = 6;
const MAX_CALLS = 50;
const MAX_TRIANGLES = 100_000;
const P95_MS = 3.75;
const WHOLE_P95_MS = 6.9;

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

test("Quest 2: box 15 in play at 72 Hz, the lantern moving and a hand in the beam, at 6x: draw calls, triangles, our JS and the whole frame within budget", async ({
  page,
  boot,
}, testInfo) => {
  await emulateHeadset(page, "metaQuest2");
  const app = await boot();
  expect(await page.evaluate(() => navigator.userAgent)).toContain("Quest 2");
  expect(await page.evaluate(() => window.__ns!.headset())).toMatchObject({ class: "xr2-gen1", frameRate: 72 });
  const sweep = await box15InPlay(app, page);
  const windows = await timedWindows(app, page, sweep, QUEST2_RATE);
  const st = (await page.evaluate(() => window.__sl!.session.state()))!;

  const judged = judgeWindowsP95(windows.map((w) => w.frames));
  const whole = judgeWindowsP95(windows.map((w) => w.whole));
  const lines = [
    ...windows.map((w, i) => {
      const s = frameStats(w.frames), rule = p95WithoutStalls(w.frames), all = frameStats(w.whole), allRule = p95WithoutStalls(w.whole);
      return (
        `perf-budget Quest 2, window ${i + 1}: ${w.calls} draw calls, ${w.triangles} triangles at most; at ${QUEST2_RATE}x over ${TIMED_FRAMES} frames: ` +
        `our JS mean ${s.meanMs.toFixed(3)}, median ${s.medianMs.toFixed(3)}, p95 ${s.p95Ms.toFixed(2)}, max ${s.maxMs.toFixed(2)} ms ` +
        `(${rule.stalls} stalls over ${STALL_MS} ms; p95 ${rule.p95Ms.toFixed(2)} without them); whole frame mean ${all.meanMs.toFixed(2)}, ` +
        `p95 ${allRule.p95Ms.toFixed(2)} ms without its ${allRule.stalls} stalls; server load ${w.load?.toFixed(1) ?? "?"}; ` +
        `p95 by system: ${Object.entries(w.systems).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}`
      );
    }),
    `perf-budget Quest 2: judged our JS on window ${judged.index + 1}: p95 ${judged.p95Ms.toFixed(2)} ms (${judged.stalls} stalls); ` +
      `the whole frame on window ${whole.index + 1}: p95 ${whole.p95Ms.toFixed(2)} ms (${whole.stalls} stalls); stage ${st.stage}, ${st.open.length} locks open`,
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
  expectP95WithinBudget(judged, P95_MS, `perf-budget Quest 2, our JS at ${QUEST2_RATE}x`);
  expectP95WithinBudget(whole, WHOLE_P95_MS, `perf-budget Quest 2, the whole frame at ${QUEST2_RATE}x`);
});
