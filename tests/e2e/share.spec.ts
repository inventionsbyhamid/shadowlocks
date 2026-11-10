// Sharing end to end: the Daily Box's result card on its reward (made for a system screenshot or a cast). IWER's
// emulated headset and hands on the virtual clock; boxes solved through the test hooks (helpers/solve.ts).
import { COPY, fill } from "../../src/ui/copy";
import { boxInPlay, rewardUp, sessionState, solveBox } from "./helpers/solve";
import { expect, test } from "./helpers/test";

test("daily box reward shows the result card", async ({ page, boot }) => {
  const app = await boot({ mode: "visual" });
  // Box 3 solved (the Daily Box is open), a streak running from yesterday, and an earlier Daily Box to beat.
  await page.evaluate(() =>
    window.__ns!.ui.profile({
      nextBox: 4,
      daily: { streak: 2, best: 2, lastDay: "2026-11-01", current: null },
      collection: [{ key: "shadow-locks/daily/2026-11-01", owner: "the Clockmaker", loot: "a silver thimble", shapes: ["Key"], atMs: 0, timeMs: 3_600_000, hints: 0 }],
    }),
  );
  await page.evaluate(() => window.__sl!.session.play({ kind: "daily", day: "2026-11-02" }));
  const s = await boxInPlay(app, "the Daily Box in play");
  // One hint on the first lock: its tile is the hinted one.
  await page.evaluate(() => window.__sl!.session.hint());
  const hinted = (await sessionState(page))!.hintLevel;
  await solveBox(app, s);
  await rewardUp(app, 100);
  const { shown, card, world } = await page.evaluate(() => window.__sl!.session.card());
  const done = (await sessionState(page))!;
  expect(shown).toBe(true);
  expect(card!.title).toBe(fill(COPY.menus.collection.daily, { day: "Nov 2" }));
  expect(card!.tiles).toHaveLength(s.locks.length);
  expect(card!.tiles.filter((t) => t === "hinted")).toHaveLength(Object.keys(hinted).length);
  expect(card!.tiles.filter((t) => t === "clear")).toHaveLength(s.locks.length - Object.keys(hinted).length);
  const secs = Math.floor(done.elapsedMs / 1000);
  expect(card!.time).toBe(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`);
  // The streak moved on to 3, and an hour-long Daily Box before it: a new best.
  expect(card!.lines).toEqual([fill(COPY.menus.home.streak, { n: 3 }), COPY.share.newBest]);
  expect(card!.site).toBe("shadowlocks.pages.dev");
  await app.captureHeadset("share-daily-card", { x: world[0], y: world[1], z: world[2] });
  // Taken (by itself after 8 s): the card stays up with the open box until the next one.
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "offered", { maxMs: 10_000, dt: 100, label: "the reward taken" });
  expect((await page.evaluate(() => window.__sl!.session.card())).shown).toBe(true);
  await app.captureHeadset("share-daily-card-taken", { x: world[0], y: world[1], z: world[2] });
});
