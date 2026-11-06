// e2e: exclusive (long and timing-heavy: scripts/e2e.sh runs this spec alone on the server)
// The jitter bot (helpers/jitter.ts) with Touch controllers only (the store declares them): the trigger is
// the pinch, 1 mm of tremor, 0.3-0.6 cm of drift as the trigger lets go, 200 ms out of tracking every 10 s. It must
// solve boxes 1 to 20 as bot.spec.ts's hands do; on a finger lock the controller's tip casts the fingertip. Results:
// test-results/bot/controllers.json.
import { boxLine, lockLine, pageErrors, solveBoxes } from "./helpers/jitter";
import { expect, test } from "./helpers/test";

test("bot solves boxes 1 to 20 under jitter with controllers", async ({ boot }, testInfo) => {
  test.setTimeout(60 * 60_000);
  const app = await boot();
  const out = await solveBoxes(app, { input: "controllers", jitter: { seed: 2 }, from: 1, to: 20, name: "controllers" }, testInfo);
  expect(out).toHaveLength(20);
  // Every lock the controller could try opened on the first approach, and every box whose locks it could all try was
  // solved.
  for (const r of out) {
    for (const l of r.locks.filter((x) => !x.blocked)) expect(l.open && l.attempts === 1, `${r.key}: ${lockLine(l)}`).toBe(true);
    if (!r.locks.some((l) => l.blocked)) expect(r.solved, boxLine("controllers", r)).toBe(true);
  }
  expect(pageErrors(app)).toEqual([]);
  // Last, so everything above is checked first: a finger lock needs the controller's tip to cast a fingertip.
  const blocked = out.flatMap((r) => r.locks.filter((l) => l.blocked).map((l) => `${r.key} lock ${l.lock}: ${l.blocked}`));
  expect(blocked, "finger locks the controller could not try").toEqual([]);
});
