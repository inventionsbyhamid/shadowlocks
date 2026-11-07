/* eslint-disable @typescript-eslint/no-explicit-any */
// The lessons end to end, in IWER's emulated headset with scripted hands on the virtual clock: a first launch going
// straight into lesson 1 and through it (a hand picks the lantern up, the locks are opened from their spots, both
// staged examples run with the lantern parked in its cradle and the scraps swinging home, the reward is lifted out
// by hand), lesson 2 (shadow puppets, the ghost finger's example, the player's crown filled by a finger, the real
// drawer pulled by hand), the drawer over a lesson (it waits; Continue goes back; a progress reset lets it go), "Show
// me" replaying an example without touching progress (the drawer shut meanwhile), a reload resuming the lesson step,
// lesson 1 for a left-handed player, the `?lesson=` address, a lesson 2 left half done going on from Home after a
// reload, a hidden headset holding the lesson's clock, and what the idle ghost and the examples cost in draw calls.
import type { Page } from "@playwright/test";
import type { SlLessonsState, SlSessionState } from "../../src/app/test-api";
import { COPY } from "../../src/ui/copy";
import type { V3 } from "../../src/core/types";
import { axisOf, fingerLocks, onRay, Pointer, worldOf } from "./helpers/finger";
import { Hands } from "./helpers/hands";
import { add, sub, unit } from "./helpers/lantern";
import { storedInProgress } from "./helpers/page-scripts";
import { expect, test } from "./helpers/test";
import { POKE_DEPTH_M, type XrApp } from "./helpers/xr-app";

const C = COPY.lessons;
const lessons = (page: Page): Promise<SlLessonsState> => page.evaluate(() => window.__sl!.lessons.state());
const session = (page: Page): Promise<SlSessionState> => page.evaluate(() => window.__sl!.session.state()!);

/** Step until the lesson is at `step` (of `lesson`), at most `maxMs` of play. */
async function untilStep(app: XrApp, lesson: string, step: number, maxMs = 30_000): Promise<void> {
  await app.stepUntil(
    (_ns, w, a) => {
      const s = w.__sl.lessons.state();
      return s.lesson === a.lesson && s.step === a.step && !s.replaying;
    },
    { arg: { lesson, step }, maxMs, label: `${lesson} step ${step}` },
  );
}

/**
 * Reach for the menu drawer's handle with the right hand, pinch it and draw it 6 cm toward you; let go and take the
 * hand away. Returns whether Home came up (false: the drawer would not come).
 */
async function pullDrawer(app: XrApp): Promise<boolean> {
  const d = await app.page.evaluate(() => window.__ns!.ui.drawer());
  const along = (k: number): V3 => add(d.handle as V3, [d.toward[0] * k, d.toward[1] * k, d.toward[2] * k]);
  const hand = new Hands(app, "right");
  await hand.pinchAt(d.handle);
  await hand.moveTo(along(0.06), 400);
  let home = true;
  try {
    await app.stepUntil((n) => n.state().screen === "home", { maxMs: 1_500, label: "home after the pull" });
  } catch {
    home = false;
  }
  await hand.release();
  await hand.moveTo(along(0.3), 300);
  return home;
}

/** The session's box is `key`, in play and shown. */
async function untilBox(app: XrApp, key: string, maxMs = 10_000): Promise<void> {
  await app.stepUntil(
    (_ns, w, k) => {
      const s = w.__sl.session.state();
      return s?.key === k && s.stage === "playing" && s.revealed;
    },
    { arg: key, maxMs, label: `box ${key} in play` },
  );
}

/** Put the lantern on lock `lock`'s spot and step until the session opens it. */
async function openAtSpot(app: XrApp, page: Page, lock: number): Promise<void> {
  const spot = (await session(page)).locks[lock]!.spot;
  await page.evaluate((L) => window.__sl!.placeLantern(L), spot);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, batch: 1, label: `lock ${lock} open` });
}

/**
 * Watch a staged example run to its end: what the frame showed (lines, the cradle, the ghost light, the scraps'
 * layout, clicks), and that the session opened nothing meanwhile (the ghost solves a twin, never the player's lock).
 */
async function watchExample(
  app: XrApp,
  page: Page,
  lock: number,
): Promise<{ lines: string[]; park: number; ghostLight: boolean; minLayout: number; clicks: number; frozen: boolean; ghost: number; calls: number }> {
  const seen = { lines: [] as string[], park: 0, ghostLight: false, minLayout: 1, clicks: 0, frozen: false, ghost: 0, calls: 0 };
  const start = await lessons(page);
  const openBefore = (await session(page)).open;
  for (let i = 0; i < 400; i++) {
    await app.step(6);
    const s = await lessons(page);
    if (s.line && seen.lines[seen.lines.length - 1] !== s.line) seen.lines.push(s.line);
    seen.park = Math.max(seen.park, s.park);
    seen.ghostLight ||= s.ghostLight;
    seen.minLayout = Math.min(seen.minLayout, s.layout[lock]!);
    seen.frozen ||= s.frozen;
    seen.ghost = Math.max(seen.ghost, s.hand.opacity);
    seen.clicks = s.clicks - start.clicks;
    seen.calls = Math.max(seen.calls, await callsPerView(app));
    expect((await session(page)).open).toEqual(openBefore);
    if (start.replaying ? s.replaying === null : s.step !== start.step) return seen;
  }
  throw new Error("the example never ended");
}

/** The last frame's draw calls for one eye (the renderer draws the scene once per view without multiview). */
async function callsPerView(app: XrApp): Promise<number> {
  const views = await app.page.evaluate(() => {
    const xr = (window.__ns!.world as { renderer: { xr: { isPresenting: boolean; getCamera(): { cameras: unknown[] } } } }).renderer.xr;
    return xr.isPresenting ? xr.getCamera().cameras.length : 1;
  });
  return (await app.perf()).calls / Math.max(1, views);
}

/** The reward lifted out of the drawer by hand: pinched where it floats and dropped 12 cm toward the head. */
async function takeReward(app: XrApp, page: Page, side: "left" | "right" = "left"): Promise<void> {
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "reward", { maxMs: 5_000, label: "the reward up" });
  const r = (await page.evaluate(() => window.__sl!.session.reward()))!;
  const head = (await app.state()).head!;
  const hand = new Hands(app, side);
  await hand.pinchAt(r.world);
  await app.step(6);
  await hand.moveTo(add(r.world, unit(sub(head, r.world)), 0.12), 400);
  await hand.release();
  await hand.moveTo(add(r.world, [side === "left" ? -0.25 : 0.25, 0.25, 0.2]), 200);
  // Taken: the stage moves on (in a lesson the next one may start in the same frame, so "offered" can pass unseen).
  await app.stepUntil((_ns, w) => w.__sl.session.state()?.stage !== "reward", { maxMs: 9_000, batch: 1, label: "the reward taken" });
  expect((await app.events("reward-taken")).length).toBeGreaterThan(0);
}

/** Pick the lantern up by hand where it stands, then let it go there. */
async function pickUpLantern(app: XrApp, page: Page, side: "left" | "right"): Promise<void> {
  const L = (await page.evaluate(() => window.__sl!.lantern())).pos;
  const [w] = await worldOf(page, [L]);
  const hand = new Hands(app, side);
  await hand.pinchAt(w!);
  await app.stepUntil((_ns, win) => win.__sl.lantern().held, { maxMs: 2_000, batch: 1, label: "the lantern held" });
  await hand.release();
  await hand.moveTo(add(w!, [side === "left" ? -0.2 : 0.2, 0.2, 0.25]), 200);
}

/** Play lesson 1 from its intro to its end with the lantern on each spot; returns what each example showed. */
async function playLesson1(app: XrApp, page: Page, side: "left" | "right") {
  await untilBox(app, "shadow-locks/lesson/l1");
  let s = await lessons(page);
  expect([s.lesson, s.step]).toEqual(["l1", 0]);
  // The box forms out of light, then the one line; no ghost before 4 s without input.
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().form >= 1, { maxMs: 3_000, label: "the box formed" });
  s = await lessons(page);
  expect(s.line).toBe(C.pickUp);
  expect(s.hand.opacity).toBe(0);
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().hand.opacity > 0.5, { maxMs: 4_000, label: "the ghost after 4 s idle" });
  expect((await lessons(page)).hand.side).toBe(side);
  // What the idle ghost costs: interactive play's draw-call budget holds.
  let idleCalls = 0;
  for (let i = 0; i < 12; i++) {
    await app.step(3);
    idleCalls = Math.max(idleCalls, await callsPerView(app));
  }
  // A hand picks the lantern up: lock I.
  await pickUpLantern(app, page, side);
  await untilStep(app, "l1", 1, 2_000);
  expect((await lessons(page)).line).toBe(C.watchMove);
  await openAtSpot(app, page, 0);
  // Example 1, then the player's arrow.
  await untilStep(app, "l1", 2, 2_000);
  const ex1 = await watchExample(app, page, 1);
  expect((await lessons(page)).step).toBe(3);
  await openAtSpot(app, page, 1);
  // Example 2, then the player's Key.
  await untilStep(app, "l1", 4, 2_000);
  const ex2 = await watchExample(app, page, 2);
  expect((await lessons(page)).step).toBe(5);
  await openAtSpot(app, page, 2);
  // The box opens; the first reward is lifted out by hand.
  await untilStep(app, "l1", 6, 2_000);
  await takeReward(app, page, side === "left" ? "right" : "left");
  return { ex1, ex2, idleCalls };
}

test("lesson 1 completes with scripted hands", async ({ page, boot }, testInfo) => {
  // A first launch goes straight into lesson 1.
  const app = await boot({ lessons: true, expectScreen: "play" });
  const { ex1, ex2, idleCalls } = await playLesson1(app, page, "right");
  // Draw calls per eye: the first minute's idle ghost is interactive play (at most 50); an example, with the player's
  // lantern parked, is a staged peak like the box opening (at most 100).
  const calls = `draw calls per eye: idle ghost ${idleCalls}, Example 1 at most ${ex1.calls}, Example 2 at most ${ex2.calls}`;
  testInfo.annotations.push({ type: "draw-calls", description: calls });
  console.log(calls);
  expect(idleCalls, calls).toBeLessThanOrEqual(50);
  expect(Math.max(ex1.calls, ex2.calls), calls).toBeLessThanOrEqual(100);
  for (const [ex, lines] of [
    [ex1, [C.watch, C.nearSwing, C.yourTurn]],
    [ex2, [C.watch, C.lineUp, C.slide, C.yourTurn]],
  ] as const) {
    expect(ex.lines).toEqual(lines);
    expect(ex.park).toBe(1);
    expect(ex.frozen).toBe(true);
    expect(ex.ghostLight).toBe(true);
    expect(ex.minLayout).toBe(0);
    expect(ex.clicks).toBe(1);
    expect(ex.ghost).toBe(1);
  }
  // Lesson 1 is done and saved, and lesson 2 starts.
  await untilStep(app, "l2", 0, 3_000);
  const s = await lessons(page);
  expect(s.progress).toEqual({ l1: true, l2: false, step: { id: "l2", index: 0 } });
  expect(await app.events("box-open")).toContainEqual({ type: "box-open", key: "shadow-locks/lesson/l1" });
  expect(app.logs()).not.toMatch(/PAGEERROR/);
});

test("lesson 2 completes and teaches the drawer", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => window.__sl!.lessons.start("l2"));
  await untilBox(app, "shadow-locks/lesson/l2");
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().form >= 1, { maxMs: 3_000, label: "the box formed" });
  expect((await lessons(page)).line).toBe(C.puppets);
  // Shadow puppets: a hand in the beam for 5 s (on the crown's left, clear of its missing prong on the right).
  const [inBeam] = await worldOf(page, [[-0.22, -0.12, 0.75]]);
  const puppet = new Hands(app, "right");
  await puppet.pinchAt(inBeam!, { pinch: false });
  await app.stepUntil((_ns, w) => w.__sl.hands().outlines.length > 0, { maxMs: 1_000, batch: 1, label: "the hand casts" });
  await untilStep(app, "l2", 1, 7_000);
  await puppet.moveTo(add(inBeam!, [0.3, 0.3, 0.3]), 200);
  // Example 3: a ghost finger fills the twin crown's prong; the player's lantern settles on the spot.
  const ex3 = await watchExample(app, page, 0);
  expect(ex3.lines).toEqual([C.watch, C.finger, C.yourTurn]);
  expect(ex3.clicks).toBe(1);
  expect(ex3.minLayout).toBe(0);
  const st = await session(page);
  const L = (await page.evaluate(() => window.__sl!.lantern())).pos;
  st.locks[0]!.spot.forEach((v, k) => expect(L[k]).toBeCloseTo(v, 6));
  // The player's crown: a finger in its gap.
  const l = (await fingerLocks(page)).find((f) => f.lock === 0)!;
  const { mid, angle } = axisOf(l.piece);
  const sign = Math.cos(angle) >= 0 ? -1 : 1;
  const hand = new Pointer(app, "right");
  const laid = await hand.lay(onRay(l.spot, mid, 0.6), [sign * Math.cos(angle), sign * Math.sin(angle), 0]);
  expect(laid.off).toBeLessThan(0.01);
  await app.stepUntil((_ns, w) => w.__sl.session.state().open.includes(0), { maxMs: 3_000, batch: 1, label: "the crown open" });
  await hand.shift([0.3, 0.3, 0.3]);
  await untilStep(app, "l2", 3, 2_000);
  // The drawer: its line once the box's celebration is over, until the drawer is pulled once.
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "offered", { maxMs: 13_000, label: "the reward collected" });
  await app.stepUntil((_ns, w, t) => w.__sl.lessons.state().line === t, { arg: C.drawer, maxMs: 2_000, label: "the drawer line" });
  await app.step(120);
  expect((await lessons(page)).done).toBe(false);
  // The real drawer, pulled by hand: Home comes up and the lesson is over; nothing waits behind the menu, so Continue
  // starts the first box.
  expect(await pullDrawer(app)).toBe(true);
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().done, { maxMs: 1_000, label: "lesson 2 done" });
  const s = await lessons(page);
  expect(s.progress).toEqual({ l1: false, l2: true, step: null });
  expect(s.running).toBe(false);
  expect((await app.state()).screen).toBe("home");
  expect(await page.evaluate(() => window.__ns!.ui.behind())).toBeNull();
  await app.stepUntil((n) => n.ui.text("home-continue-sub") === "Start Box No. 1", { maxMs: 2_000, label: "Continue starts box 1" });
  await app.step(30);
  expect((await lessons(page)).coach.opacity).toBe(0);
});

test("the drawer over a lesson: the lesson waits, Continue goes back, a reset lets it go", async ({ page, boot }) => {
  const app = await boot({ lessons: true, expectScreen: "play" });
  await untilBox(app, "shadow-locks/lesson/l1");
  await app.stepUntil((_ns, w, t) => w.__sl.lessons.state().line === t, { arg: C.pickUp, maxMs: 4_000, label: "pick up the lantern" });
  // Idle, the ghost hand shows how to take the lantern.
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().ghost > 0.5, { maxMs: 8_000, label: "the idle ghost" });
  // The drawer: Home over the lesson, "Your lesson" behind it, the ghost and the coach line put away.
  expect(await pullDrawer(app)).toBe(true);
  expect(await page.evaluate(() => window.__ns!.ui.behind())).toEqual({ kind: "lesson" });
  await app.stepUntil((n, _w, t) => n.ui.text("home-continue-sub") === t, { arg: COPY.menus.home.backToLesson, maxMs: 2_000, label: "Your lesson" });
  await app.step(60);
  let s = await lessons(page);
  expect([s.lesson, s.step, s.running]).toEqual(["l1", 0, true]);
  expect(s.coach.opacity).toBe(0);
  expect(s.ghost).toBe(0);
  // Continue: back to the lesson, its line again.
  await app.poke("home-continue");
  await app.stepUntil((n) => n.state().screen === "play", { maxMs: 5_000, label: "back to the lesson" });
  await app.stepUntil((_ns, w, t) => w.__sl.lessons.state().coach.text === t, { arg: C.pickUp, maxMs: 3_000, label: "the line again" });
  // A progress reset from Settings: the lesson is let go, nothing waits, nothing more is saved.
  expect(await pullDrawer(app)).toBe(true);
  await app.poke("home-settings");
  await app.stepUntil((n) => n.state().screen === "settings", { maxMs: 5_000, label: "settings" });
  await app.poke("settings-reset");
  await app.stepUntil((n) => n.state().screen === "reset", { maxMs: 5_000, label: "reset confirm" });
  await app.poke("reset-confirm");
  await app.stepUntil((n) => n.state().screen === "home", { maxMs: 5_000, label: "home after reset" });
  await app.step(30);
  s = await lessons(page);
  expect([s.lesson, s.running, s.replaying]).toEqual([null, false, null]);
  expect(s.progress).toEqual({ l1: false, l2: false, step: null });
  expect(await page.evaluate(() => window.__ns!.ui.behind())).toBeNull();
  expect(app.logs()).not.toMatch(/PAGEERROR/);
});

test("replay leaves progress unchanged", async ({ page, boot }) => {
  const app = await boot();
  // Box 2 in play, one lock open.
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 2 }));
  await untilBox(app, "shadow-locks/2");
  await openAtSpot(app, page, 0);
  await page.evaluate(() => window.__sl!.session.save());
  await app.step(10);
  const profileOf = () =>
    page.evaluate(() => {
      const s = window.__sl!.session.state()!;
      return { nextBox: s.nextBox, collected: s.collected, lessons: window.__sl!.lessons.state().progress };
    });
  const before = { profile: await profileOf(), snap: await page.evaluate(() => window.__sl!.session.snapshot()) };
  // The box in progress as saved on the device.
  const stored = () => page.evaluate(storedInProgress) as Promise<{ key: string; open: number[]; lantern: V3 } | null>;
  const storedBefore = await stored();
  expect(storedBefore?.key).toBe("shadow-locks/2");
  // "Show me" on the hint lantern: poke the lantern, then its "Show me".
  for (const id of ["hint-lantern", "hint-show-me"]) {
    const k = (await page.evaluate(() => window.__sl!.session.keys())).find((x) => x.id === id);
    if (!k?.live) throw new Error(`no live key ${id}`);
    const at = (dd: number) => ({ x: k.world[0] + k.normal[0] * dd, y: k.world[1] + k.normal[1] * dd, z: k.world[2] + k.normal[2] * dd });
    const device = "hand-right";
    await app.queue("set_input_mode", { mode: "hand" });
    await app.queue("set_connected", { device, connected: true });
    await app.queue("set_hand_pose", { device, poseId: "point" });
    await app.queue("set_transform", { device, anchor: "index-tip", position: at(0.15), orientation: "auto" });
    await app.queue("animate_to", { device, anchor: "index-tip", position: at(0.05), duration: 0.3, easing: "minimum-jerk" });
    await app.queue("animate_to", { device, anchor: "index-tip", position: at(POKE_DEPTH_M), duration: 0.15, easing: "minimum-jerk" });
    await app.queue("animate_to", { device, anchor: "index-tip", position: at(0.12), duration: 0.15, easing: "minimum-jerk" });
    await app.settle();
    await app.step(10);
  }
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().replaying !== null, { maxMs: 2_000, label: "the replay started" });
  const r = await lessons(page);
  expect(["near-far", "rings", "finger"]).toContain(r.replaying);
  expect(r.box).toBe(r.replaying === "finger" ? "l2" : "l1");
  expect([r.running, r.drawerAllowed]).toEqual([true, false]);
  await untilBox(app, `shadow-locks/lesson/${r.box}`);
  // The drawer stays shut while the example shows.
  expect(await pullDrawer(app)).toBe(false);
  expect((await app.state()).screen).toBe("play");
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().replaying === null, { maxMs: 25_000, label: "the replay over" });
  // The box is back as it was, and nothing about progress changed.
  await untilBox(app, "shadow-locks/2");
  const after = await page.evaluate(() => window.__sl!.session.snapshot());
  expect(after!.key).toBe(before.snap!.key);
  expect(after!.open).toEqual(before.snap!.open);
  after!.lantern.forEach((v, k) => expect(v).toBeCloseTo(before.snap!.lantern[k]!, 6));
  expect(await profileOf()).toEqual(before.profile);
  const storedAfter = await stored();
  expect(storedAfter?.key).toBe(storedBefore!.key);
  expect(storedAfter?.open).toEqual(storedBefore!.open);
  expect((await lessons(page)).progress).toEqual({ l1: false, l2: false, step: null });
});

test("reload resumes the lesson step", async ({ page, boot }) => {
  let app = await boot({ lessons: true, expectScreen: "play" });
  await untilBox(app, "shadow-locks/lesson/l1");
  await pickUpLantern(app, page, "right");
  await untilStep(app, "l1", 1, 2_000);
  await openAtSpot(app, page, 0);
  await untilStep(app, "l1", 2, 2_000);
  await watchExample(app, page, 1);
  await untilStep(app, "l1", 3, 1_000);
  expect((await lessons(page)).progress.step).toEqual({ id: "l1", index: 3 });
  await app.step(30);
  // The page loaded again: the lesson comes back at the start of its step, lock I open, the arrow in the player's
  // layout.
  app = await boot({ lessons: true, expectScreen: "play" });
  await untilBox(app, "shadow-locks/lesson/l1");
  const s = await lessons(page);
  expect([s.lesson, s.step]).toEqual(["l1", 3]);
  expect(s.layout).toEqual([1, 1, 1]);
  expect((await session(page)).open).toEqual([0]);
  await app.step(10);
  expect((await lessons(page)).line).toBe(C.yourTurn);
});

test("left-handed lesson 1", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => window.__ns!.ui.setSettings({ handed: "left" }));
  await page.evaluate(() => window.__sl!.lessons.start("l1"));
  // Everything mirrored: the lantern starts on the left, the spots too, the ghost is a left hand, the cradle right.
  await untilBox(app, "shadow-locks/lesson/l1");
  const st = await session(page);
  expect((await page.evaluate(() => window.__sl!.lantern())).pos[0]).toBeLessThan(0);
  expect(st.locks[1]!.spot[0]).toBeLessThan(0);
  expect(st.locks[2]!.spot[0]).toBeLessThan(0);
  const { ex1, ex2 } = await playLesson1(app, page, "left");
  for (const ex of [ex1, ex2]) {
    expect(ex.clicks).toBe(1);
    expect(ex.minLayout).toBe(0);
  }
  await untilStep(app, "l2", 0, 3_000);
  expect((await lessons(page)).progress.l1).toBe(true);
});

/** The cradle is on the weak side: right for a left-handed player. */
test("the lantern parks on the weak side", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => window.__sl!.lessons.start("l1", 2, true));
  await untilBox(app, "shadow-locks/lesson/l1");
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().park >= 1, { maxMs: 2_000, label: "parked" });
  const parked = (await page.evaluate(() => window.__sl!.lantern())).pos as V3;
  expect(parked[0]).toBeLessThan(-0.5);
  // Practice: nothing about progress changes.
  expect((await lessons(page)).progress).toEqual({ l1: false, l2: false, step: null });
});

test("the ?lesson= address plays a lesson as practice, from its start, saving nothing", async ({ page, boot }) => {
  const app = await boot({ url: "/?lesson=l2", expectScreen: "play" });
  await untilBox(app, "shadow-locks/lesson/l2");
  const s = await lessons(page);
  expect([s.lesson, s.step, s.practice]).toEqual(["l2", 0, true]);
  await app.stepUntil((_ns, w, t) => w.__sl.lessons.state().line === t, { arg: C.puppets, maxMs: 4_000, label: "the puppets line" });
  // On past the puppets (their timeout, with the ghost showing how): still nothing saved.
  await untilStep(app, "l2", 1, 14_000);
  expect((await lessons(page)).progress).toEqual({ l1: false, l2: false, step: null });
  expect((await session(page)).practice).toBe(true);
});

test("a lesson 2 left half done opens on Home, and Continue goes on with it at its step", async ({ page, boot }) => {
  let app = await boot();
  // Lesson 1 done; lesson 2 played to its third step (the player's crown), as a player who stopped there left it.
  await page.evaluate(() => window.__ns!.ui.profile({ lessons: { l1: true, l2: false, step: null } }));
  await page.evaluate(() => window.__sl!.lessons.start("l2", 2));
  await untilBox(app, "shadow-locks/lesson/l2");
  expect((await lessons(page)).progress).toEqual({ l1: true, l2: false, step: { id: "l2", index: 2 } });
  await app.step(30);
  // The page loads again: a later launch opens on Home (only a first launch goes straight in; lesson 1 is done here, so
  // the e2e boot's first-launch switch plays no part).
  app = await boot();
  expect((await app.state()).screen).toBe("home");
  expect(await page.evaluate(() => window.__ns!.ui.behind())).toEqual({ kind: "lesson" });
  await app.stepUntil((n, _w, t) => n.ui.text("home-continue-sub") === t, { arg: COPY.menus.home.backToLesson, maxMs: 2_000, label: "Your lesson" });
  await app.poke("home-continue");
  await untilBox(app, "shadow-locks/lesson/l2");
  const s = await lessons(page);
  expect([s.lesson, s.step, s.practice, s.running]).toEqual(["l2", 2, false, true]);
  expect((await app.state()).screen).toBe("play");
});

test("a hidden headset holds the lesson's clock", async ({ page, boot }) => {
  const app = await boot({ lessons: true, expectScreen: "play" });
  await untilBox(app, "shadow-locks/lesson/l1");
  await app.stepUntil((_ns, w, t) => w.__sl.lessons.state().line === t, { arg: C.pickUp, maxMs: 4_000, label: "pick up the lantern" });
  expect((await lessons(page)).hand.opacity).toBe(0);
  const shown = async (visible: boolean) => {
    await page.evaluate((v) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => !v });
      document.dispatchEvent(new Event("visibilitychange"));
    }, visible);
  };
  // Six seconds hidden count nothing: the idle ghost (after 4 s without input) never comes.
  await shown(false);
  await app.step(72 * 6);
  expect((await lessons(page)).hand.opacity).toBe(0);
  // Seen again, the clock runs on and the ghost comes.
  await shown(true);
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().hand.opacity > 0.5, { maxMs: 6_000, label: "the idle ghost once seen again" });
});
