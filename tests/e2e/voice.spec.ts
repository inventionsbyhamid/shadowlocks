/* eslint-disable @typescript-eslint/no-explicit-any */
// The voice guide end to end, with the real voice pack, in IWER's emulated headset on the virtual clock. Chromium's
// autoplay policy is lifted (a test-only launch flag); the game still starts audio only on its first pinch (the lantern
// picked up), so the first line, held until then, is said if still shown. Lesson 1 says its goal and each turn line
// once; with the Voice guide off nothing is said and the pause after a win is as before; with no voice pack the lesson
// is text only and its timings are the voice-off ones.
import type { Page } from "@playwright/test";
import type { SlLessonsState, SlSessionState, SlVoiceState } from "../../src/app/test-api";
import { COPY } from "../../src/ui/copy";
import { CHROME_ARGS } from "./helpers/chromium";
import { worldOf } from "./helpers/finger";
import { Hands } from "./helpers/hands";
import { add } from "./helpers/lantern";
import { expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

test.use({ launchOptions: { args: [...CHROME_ARGS, "--autoplay-policy=no-user-gesture-required"] } });

const lessons = (page: Page): Promise<SlLessonsState> => page.evaluate(() => window.__sl!.lessons.state());
const session = (page: Page): Promise<SlSessionState> => page.evaluate(() => window.__sl!.session.state()!);
const voice = (page: Page): Promise<SlVoiceState> => page.evaluate(() => window.__sl!.voice.state());

async function untilStep(app: XrApp, lesson: string, step: number, maxMs = 30_000): Promise<void> {
  await app.stepUntil(
    (_ns, w, a) => {
      const s = w.__sl.lessons.state();
      return s.lesson === a.lesson && s.step === a.step && !s.replaying;
    },
    { arg: { lesson, step }, maxMs, label: `${lesson} step ${step}` },
  );
}

/** Pick the lantern up by hand where it stands (the first pinch: audio starts), then let it go there. */
async function pickUpLantern(app: XrApp, page: Page): Promise<void> {
  const L = (await page.evaluate(() => window.__sl!.lantern())).pos;
  const [w] = await worldOf(page, [L]);
  const hand = new Hands(app, "right");
  await hand.pinchAt(w!);
  await app.stepUntil((_ns, win) => win.__sl.lantern().held, { maxMs: 2_000, batch: 1, label: "the lantern held" });
  await hand.release();
  await hand.moveTo(add(w!, [0.2, 0.2, 0.25]), 200);
}

async function openAtSpot(app: XrApp, page: Page, lock: number): Promise<void> {
  const spot = (await session(page)).locks[lock]!.spot;
  await page.evaluate((L) => window.__sl!.placeLantern(L), spot);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, batch: 1, label: `lock ${lock} open` });
}

/** Lesson 1 into its first lock (the lantern picked up: audio runs), with the voice pack read. */
async function intoLockOne(app: XrApp, page: Page, pack = true): Promise<void> {
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().key === "pickUp", { maxMs: 6_000, label: "the first line" });
  if (pack) await app.stepUntil((_ns, w) => w.__sl.voice.state().loaded, { maxMs: 10_000, label: "the voice pack read" });
  await pickUpLantern(app, page);
  await untilStep(app, "l1", 1, 2_000);
  await app.stepUntil((ns) => ns.audio.running(), { maxMs: 2_000, label: "audio running after the pinch" });
}

/** The pause from lock I opening to Example 1's first line (virtual ms). */
async function winPause(app: XrApp, page: Page): Promise<number> {
  await openAtSpot(app, page, 0);
  expect((await lessons(page)).key).toBe("lockOpen");
  return app.stepUntil((_ns, w) => w.__sl.lessons.state().key === "watchNearFar", { maxMs: 8_000, label: "Example 1" });
}

test("lesson 1 speaks the goal and each turn line once", async ({ page, boot }) => {
  const app = await boot({ lessons: true, expectScreen: "play" });
  await intoLockOne(app, page);
  await app.stepUntil((_ns, w) => w.__sl.voice.state().said.includes("lessons.goal"), { maxMs: 2_000, label: "the goal said" });
  expect((await lessons(page)).line).toBe(COPY.lessons.goal);
  // The win is said after the lock's layers, and Example 1 waits for it.
  const pause = await winPause(app, page);
  expect(pause).toBeGreaterThan(4_500);
  await untilStep(app, "l1", 3, 30_000);
  await openAtSpot(app, page, 1);
  await untilStep(app, "l1", 5, 40_000);
  await openAtSpot(app, page, 2);
  await untilStep(app, "l1", 6, 3_000);
  const said = (await voice(page)).said;
  const count = (k: string) => said.filter((x) => x === k).length;
  for (const k of ["lessons.goal", "lessons.turnNearFar", "lessons.yourTurn"]) expect(count(k), `${k} in ${said.join(", ")}`).toBe(1);
  for (const k of ["lessons.lockOpen", "lessons.watchNearFar", "lessons.nearSwing", "lessons.twoOpen", "lessons.watchRings"]) {
    expect(count(k), `${k} in ${said.join(", ")}`).toBe(1);
  }
  // Only this part's clips are decoded: a few MiB, never the whole pack.
  const v = await voice(page);
  expect(v.decodedBytes).toBeLessThan(8 * 1024 * 1024);
  expect(app.logs()).not.toMatch(/PAGEERROR/);
});

test("voice off: timings as before, and nothing said", async ({ page, boot }) => {
  const app = await boot({ lessons: true, expectScreen: "play" });
  await page.evaluate(() => window.__ns!.ui.setSettings({ voice: false }));
  await intoLockOne(app, page);
  const pause = await winPause(app, page);
  expect(pause).toBeGreaterThan(2_400);
  expect(pause).toBeLessThan(3_000);
  expect((await voice(page)).said).toEqual([]);
  expect(await page.evaluate(() => window.__sl!.voice.ms("lessons.lockOpen"))).toBe(0);
});

test("no pack: text only", async ({ page, boot }) => {
  await page.route("**/audio/voice/**", (r) => r.abort());
  const app = await boot({ lessons: true, expectScreen: "play" });
  await intoLockOne(app, page, false);
  expect((await voice(page)).loaded).toBe(false);
  expect((await lessons(page)).line).toBe(COPY.lessons.goal);
  const pause = await winPause(app, page);
  expect(pause).toBeLessThan(3_000);
  expect((await voice(page)).said).toEqual([]);
  expect(app.logs()).not.toMatch(/PAGEERROR/);
});
