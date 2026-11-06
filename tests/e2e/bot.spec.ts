// e2e: exclusive (long and timing-heavy: scripts/e2e.sh runs this spec alone on the server)
// The jitter bot (helpers/jitter.ts) with hands: a careful player whose hand shakes 3 mm, drifts 1-1.5 cm as it lets
// go and drops out of tracking for 200 ms every 10 s plays the box session through IWER's emulated right hand. It
// must solve boxes 1 to 20 by the feel layer's assists (the speed gate, the settle, the ring line lock, the release
// lookback), every lock on the first careful approach. The same bot with Touch controllers is bot-controllers.spec.ts;
// the fast sweeps are bot-sweeps.spec.ts (one spec would run far over the e2e budget). Results: test-results/bot/.
import { boxLine, lockLine, pageErrors, solveBoxes } from "./helpers/jitter";
import { expect, test } from "./helpers/test";

test("bot solves boxes 1 to 20 under jitter", async ({ boot }, testInfo) => {
  test.setTimeout(60 * 60_000);
  const app = await boot();
  const out = await solveBoxes(app, { input: "hands", jitter: { seed: 1 }, from: 1, to: 20, name: "hands" }, testInfo);
  expect(out).toHaveLength(20);
  for (const r of out) {
    expect(r.solved, boxLine("hands", r)).toBe(true);
    for (const l of r.locks) expect(l.open && l.attempts === 1, `${r.key}: ${lockLine(l)}`).toBe(true);
  }
  expect(pageErrors(app)).toEqual([]);
});
