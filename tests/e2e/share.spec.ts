// Sharing end to end: the Daily Box's result card on its reward (made for a system screenshot or a cast); a shared
// link's landing on a headset and on a computer (Meta's Web Launch, Copy link); today's Daily Box from a link counting
// as the player's own once, then as practice; the 2D page's share button after the session. IWER's emulated headset
// and hands on the virtual clock; boxes solved through the test hooks (helpers/solve.ts).
import path from "node:path";
import { webLaunchUrl } from "../../src/core/share";
import { COPY, fill } from "../../src/ui/copy";
import { watch } from "./helpers/boot";
import { storedInProgress, storedProfile } from "./helpers/page-scripts";
import { LESSON_STEPS } from "../../src/app/lessons-director";
import { boxInPlay, pokeBoxKey, rewardTaken, rewardUp, sessionState, solveBox } from "./helpers/solve";
import { expect, test } from "./helpers/test";
import { addRunNote, SHOTS_DIR } from "./helpers/xr-app";

/** A friend's link for the Daily Box of the page's default day (helpers/boot.ts DEFAULT_DATE). */
const DAILY_LINK = "/?day=2026-11-02&t=252&h=1&g=4";
/** A friend's "beat my time" link for box 2: 3:42, no hints. */
const BOX_LINK = "/?box=2&t=222&h=0&g=4";

/** A player who has done the lessons and solved up to box 5, box 2's reward kept at 2:40. */
const PLAYER = {
  nextBox: 6,
  lessons: { l1: true, l2: true, step: null },
  collection: [{ key: "shadow-locks/2", owner: "the Clockmaker", loot: "a silver thimble", shapes: ["Key"], atMs: 0, timeMs: 160_000, hints: 0 }],
};

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
  // What the reward with its card costs to draw (the opening's busiest frame is before it: perf-budget.spec.ts).
  await app.step(1, 100);
  addRunNote(`share: the reward up with its result card: ${(await app.perf()).calls} draw calls`);
  await app.captureHeadset("share-daily-card", { x: world[0], y: world[1], z: world[2] });
  // Taken (by itself after 8 s): the card stays up with the open box until the next one.
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "offered", { maxMs: 10_000, dt: 100, label: "the reward taken" });
  expect((await page.evaluate(() => window.__sl!.session.card())).shown).toBe(true);
  await app.captureHeadset("share-daily-card-taken", { x: world[0], y: world[1], z: world[2] });
});

test("a shared daily link lands, explains itself and starts the box", async ({ page, boot }) => {
  // A player with box 3 solved and the lessons done, no Daily Box yet.
  let app = await boot();
  await page.evaluate(() => window.__ns!.ui.profile({ nextBox: 4, lessons: { l1: true, l2: true, step: null } }));
  await expect.poll(() => page.evaluate(storedProfile)).toMatchObject({ nextBox: 4 });

  // The landing before the headset goes on: what was shared, what the friend says, what Open the box does. A headset
  // gets neither Web Launch nor Copy link.
  app = await boot({ url: DAILY_LINK, enterXR: false });
  await expect(page.locator("#shared-line")).toHaveText(fill(COPY.share.sentDaily, { day: "Nov 2" }));
  await expect(page.locator("#shared-says")).toHaveText(fill(COPY.share.saysHints, { time: "4:12", help: "1 hint" }));
  await expect(page.locator("#shared-note")).toHaveText(COPY.share.todayTurn);
  await expect(page.locator("#quest-launch")).toBeHidden();
  await expect(page.locator("#copy-link")).toBeHidden();
  await expect(page.locator("#enter")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "share-landing-headset.png") });

  // Open the box: the player's own Daily Box, and its solve counts (streak 1, in the collection).
  app = await boot({ url: DAILY_LINK, expectScreen: "play" });
  const s = await boxInPlay(app, "the Daily Box from the link");
  expect([s.spec, s.practice]).toEqual([{ kind: "daily", day: "2026-11-02" }, false]);
  await solveBox(app, s);
  await rewardUp(app);
  const opened = (await sessionState(page))!;
  await expect.poll(() => page.evaluate(storedProfile)).toMatchObject({ daily: { streak: 1, lastDay: "2026-11-02" } });
  const stored = (await page.evaluate(storedProfile)) as { collection: { key: string }[] };
  expect(stored.collection.map((c) => c.key)).toEqual(["shadow-locks/daily/2026-11-02"]);

  // The session ends: back on the 2D page, today's result to share, its text selectable by hand.
  await page.evaluate(() => (window.__ns!.world as unknown as { session?: XRSession }).session?.end());
  await app.stepUntil((ns) => !ns.state().xr.presenting, { maxMs: 5_000, label: "out of XR" });
  const secs = Math.floor(opened.elapsedMs / 1000);
  const url = `https://shadowlocks.pages.dev/?day=2026-11-02&t=${secs}&h=0&g=4`;
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#share-result")).toHaveText(COPY.share.shareToday);
  const text = (await page.locator("#result-text").textContent())!;
  expect(text.split("\n")).toEqual([
    "Shadow Locks · Daily Box Nov 2",
    `${"🟨".repeat(s.locks.length)} ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`,
    "Streak 1",
    url,
  ]);
  // No share sheet in this browser: the clipboard, else the plain word.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator("#share-result").click();
  await expect.poll(() => page.locator("#share-note").textContent()).not.toBe("");
  const note = await page.locator("#share-note").textContent();
  expect([COPY.share.copied, COPY.share.manual]).toContain(note);
  if (note === COPY.share.copied) expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: path.join(SHOTS_DIR, "share-result-page.png"), fullPage: true });

  // The same link again: today's Daily Box is solved, so it plays as practice, and its solve changes nothing.
  app = await boot({ url: DAILY_LINK, expectScreen: "play" });
  await expect(page.locator("#shared-note")).toHaveText(COPY.share.practiceTurn);
  const again = await boxInPlay(app, "the Daily Box again, as practice");
  expect([again.key, again.practice]).toEqual(["shadow-locks/daily/2026-11-02", true]);
  const before = await page.evaluate(storedProfile);
  await solveBox(app, again);
  await app.stepUntil((ns) => ns.events("box-open").length > 0, { maxMs: 2_000, batch: 1, label: "the practice box opens" });
  await page.evaluate(() => window.__sl!.session.save());
  await app.step(3);
  const after = (await page.evaluate(storedProfile)) as Record<string, unknown>;
  for (const k of ["nextBox", "current", "daily", "collection"]) expect(after[k], k).toEqual((before as Record<string, unknown>)[k]);
});

test("a shared link on a computer: Open on my Meta Quest sends it to the headset, Copy link copies it", async ({ page }) => {
  // A desktop browser: no headset emulator, the browser's own user agent.
  const seen = watch(page);
  await page.route(
    (u) => u.pathname.endsWith("/@iwer-injection-runtime"),
    (route) => route.fulfill({ contentType: "application/javascript", body: "export {};" }),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(DAILY_LINK, { waitUntil: "load" });
  const link = "https://shadowlocks.pages.dev/?day=2026-11-02&t=252&h=1&g=4";
  await expect(page.locator("#shared-line")).toHaveText(fill(COPY.share.sentDaily, { day: "Nov 2" }), { timeout: 60_000 });
  await expect(page.locator("#quest-launch")).toBeVisible();
  await expect(page.locator("#quest-launch")).toHaveText(COPY.share.openQuest);
  await expect(page.locator("#quest-launch")).toHaveAttribute("href", webLaunchUrl(link));
  await expect(page.locator("#copy-link")).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator("#copy-link").click();
  await expect(page.locator("#share-note")).toHaveText(COPY.share.copied);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.screenshot({ path: path.join(SHOTS_DIR, "share-landing-desktop.png") });
  // A link is only an address: nothing was fetched from anywhere but our own server.
  expect([...seen.hosts]).toEqual([]);
});

test("beat my time: the receiver sees both results", async ({ page, boot }) => {
  let app = await boot();
  await page.evaluate((p) => window.__ns!.ui.profile(p), PLAYER);
  await expect.poll(() => page.evaluate(storedProfile)).toMatchObject({ nextBox: 6 });

  // The friend's box 2 as practice, the landing saying so.
  app = await boot({ mode: "visual", url: BOX_LINK, expectScreen: "play" });
  await expect(page.locator("#shared-line")).toHaveText(fill(COPY.share.sentBox, { n: 2 }));
  await expect(page.locator("#shared-says")).toHaveText(fill(COPY.share.saysHints, { time: "3:42", help: COPY.share.noHints }));
  await expect(page.locator("#shared-note")).toHaveText(COPY.share.practiceTurn);
  const s = await boxInPlay(app, "the friend's box 2");
  expect([s.key, s.practice]).toEqual(["shadow-locks/2", true]);
  await page.evaluate(() => window.__sl!.session.hint());
  await solveBox(app, s);
  await rewardUp(app, 100);
  const done = (await sessionState(page))!;
  const secs = Math.floor(done.elapsedMs / 1000);
  const mine = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const { shown, card, world } = await page.evaluate(() => window.__sl!.session.card());
  expect(shown).toBe(true);
  // Their own record of box 2, then both results.
  expect(card!.lines).toEqual([
    fill(COPY.share.best, { time: "2:40" }),
    fill(COPY.share.you, { time: mine, help: "1 hint" }),
    fill(COPY.share.friend, { time: "3:42", help: COPY.share.noHints }),
  ]);
  await app.captureHeadset("share-beat-card", { x: world[0], y: world[1], z: world[2] });

  // Next goes Home, not to box 3.
  await rewardTaken(app, 100);
  await pokeBoxKey(app, "plate-next");
  await app.stepUntil((ns) => ns.state().screen === "home", { maxMs: 3_000, label: "Home after the friend's box" });
  expect((await sessionState(page))!.key).toBe("shadow-locks/2");

  // Back on the 2D page: send yours back, with this time and hint.
  await page.evaluate(() => (window.__ns!.world as unknown as { session?: XRSession }).session?.end());
  await app.stepUntil((ns) => !ns.state().xr.presenting, { maxMs: 5_000, label: "out of XR" });
  await expect(page.locator("#share-result")).toHaveText(COPY.share.sendBack);
  expect((await page.locator("#result-text").textContent())!.split("\n").slice(2)).toEqual([COPY.share.beat, `https://shadowlocks.pages.dev/?box=2&t=${secs}&h=1&g=4`]);
  await page.screenshot({ path: path.join(SHOTS_DIR, "share-send-back-page.png"), fullPage: true });
});

test("a new player with a shared link goes through lesson 1 first", async ({ page, boot }) => {
  // A first launch with a friend's link: Lesson 1, not the friend's box, and the landing says so.
  const app = await boot({ url: BOX_LINK, lessons: true, expectScreen: "play" });
  await expect(page.locator("#shared-note")).toHaveText(COPY.share.lessonFirst);
  const lesson = () => page.evaluate(() => window.__sl!.lessons.state());
  expect([(await lesson()).lesson, (await sessionState(page))?.spec]).toEqual(["l1", { kind: "lesson", id: "l1" }]);
  // Lesson 1 from its reward step (as a reload there resumes it): its box opens, the reward is taken by itself, and the
  // lesson is done. Then the friend's box comes, as practice, in place of lesson 2.
  const reward = LESSON_STEPS.l1.findIndex((x) => x.kind === "reward");
  expect(reward).toBeGreaterThan(0);
  await page.evaluate((n) => window.__sl!.lessons.start("l1", n, false), reward);
  await app.stepUntil(
    (_ns, w) => {
      const st = w.__sl.session.state();
      return st?.key === "shadow-locks/2" && st.stage === "playing" && st.revealed;
    },
    { maxMs: 30_000, dt: 50, label: "the friend's box after lesson 1" },
  );
  expect((await lesson()).progress).toEqual({ l1: true, l2: false, step: null });
  const s = (await sessionState(page))!;
  expect(s.practice).toBe(true);
  // The 2D page (seen after the session) now says what this box is.
  await expect(page.locator("#shared-note")).toHaveText(COPY.share.practiceTurn);
  // Solved; its Next is lesson 2 (the onboarding goes on), never box 3.
  await solveBox(app, s);
  await rewardTaken(app, 100);
  await pokeBoxKey(app, "plate-next");
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().lesson === "l2", { maxMs: 5_000, label: "lesson 2 after the friend's box" });
  expect((await sessionState(page))?.spec).toEqual({ kind: "lesson", id: "l2" });
  // Nothing of the friend's box was kept: no box moved on, its reward not collected (lesson 1's is).
  const stored = (await page.evaluate(storedProfile)) as { nextBox: number; collection: { key: string }[] };
  expect(stored.nextBox).toBe(1);
  expect(stored.collection.map((c) => c.key)).not.toContain("shadow-locks/2");
});

test("a shared numbered box does not change saved progress", async ({ page, boot }) => {
  // Box 7 in progress with one lock open, a streak running, box 2 kept: all saved.
  let app = await boot();
  await page.evaluate((p) => window.__ns!.ui.profile({ ...p, nextBox: 7, daily: { streak: 3, best: 3, lastDay: "2026-11-01", current: null } }), PLAYER);
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 7 }));
  const s7 = await boxInPlay(app, "box 7 in play");
  const first = s7.locks.find((l) => !l.finger)!;
  await page.evaluate((L) => window.__sl!.placeLantern(L), first.spot);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: first.i, maxMs: 2_000, batch: 1, label: "box 7's first lock" });
  await page.evaluate(() => window.__sl!.session.save());
  await expect.poll(() => page.evaluate(storedInProgress)).toMatchObject({ key: s7.key, open: [first.i] });
  const before = (await page.evaluate(storedProfile)) as Record<string, unknown>;

  // A friend's box 3: practice, solved, its Next poked (Home), saved on the way.
  app = await boot({ url: "/?box=3&t=100&h=2&g=4", expectScreen: "play" });
  const s3 = await boxInPlay(app, "the friend's box 3");
  expect([s3.key, s3.practice]).toEqual(["shadow-locks/3", true]);
  await solveBox(app, s3);
  await rewardTaken(app, 100);
  await pokeBoxKey(app, "plate-next");
  await app.stepUntil((ns) => ns.state().screen === "home", { maxMs: 3_000, label: "Home after the friend's box" });
  await page.evaluate(() => window.__sl!.session.save());
  await app.step(3);
  const after = (await page.evaluate(storedProfile)) as Record<string, unknown>;
  for (const k of ["nextBox", "current", "daily", "collection", "lessons", "tipsSeen"]) expect(after[k], k).toEqual(before[k]);

  // Loaded again with no link: box 7 is still the box in progress, one lock open.
  app = await boot();
  expect(await page.evaluate(() => window.__sl!.session.continue())).toBe(true);
  const back = await boxInPlay(app, "box 7 again");
  expect([back.key, back.open, back.practice]).toEqual([s7.key, [first.i], false]);
});

