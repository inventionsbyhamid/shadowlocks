/* eslint-disable @typescript-eslint/no-explicit-any */
// The drawer's menus: the drawer opens only with a pinch and a pull, Home and its keys, the Daily Box
// before and after box 3, settings that survive a reload, the trial screens with fake billing (the
// store edition with the paywall forced on, test builds only), and how every panel looks in the
// headset (screenshots for review).
import { STORE_PAGE_URL } from "../../src/app/edition";
import type { Vec3 } from "../../src/core/types";
import { COPY } from "../../src/ui/copy";
import { DEFAULT_DATE } from "./helpers/boot";
import { Hands } from "./helpers/hands";
import { expect, test } from "./helpers/test";
import { addRunNote, type XrApp } from "./helpers/xr-app";

// Code passed to page.evaluate runs in the page: it reaches the hooks through window.__ns, never a helper here.
const along = (p: Vec3, d: Vec3, k: number): Vec3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];

/** An element of the current screen shows `want` (a repaint lays out on the next frame). */
async function shows(app: XrApp, id: string, want: string): Promise<void> {
  await app.stepUntil((n, _w, a) => n.ui.text(a.id) === a.want, { arg: { id, want }, maxMs: 1_000, label: `${id} shows "${want}"` });
}

/** Close the menus (as Continue does with nothing to play yet): the drawer slides shut. */
async function closeMenus(app: XrApp): Promise<void> {
  await app.page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((n) => n.ui.drawer().out === 0 && !n.ui.busy() && n.ui.slabCount() === 0, { maxMs: 3_000, label: "drawer shut, no panel" });
}

test("drawer opens only with a pull", async ({ page, boot }) => {
  const app = await boot();
  await closeMenus(app);
  const d = await page.evaluate(() => window.__ns!.ui.drawer());
  expect(d.state).toBe("closed");
  const hand = new Hands(app, "right");

  // A fingertip poke on the handle, pushing in and dragging out toward the player: nothing.
  await app.queue("set_input_mode", { mode: "hand" });
  await app.queue("set_hand_pose", { device: "hand-right", poseId: "point" });
  await app.queue("set_transform", { device: "hand-right", anchor: "index-tip", position: xyz(along(d.handle, d.toward, 0.06)), orientation: "auto" });
  await app.queue("animate_to", { device: "hand-right", anchor: "index-tip", position: xyz(along(d.handle, d.toward, -0.01)), duration: 0.3 });
  await app.queue("animate_to", { device: "hand-right", anchor: "index-tip", position: xyz(along(d.handle, d.toward, 0.08)), duration: 0.3 });
  await app.settle();
  expect((await app.state()).screen).toBe("play");
  expect(await page.evaluate(() => window.__ns!.ui.drawer().state)).toBe("closed");

  // A pinch on the handle pulled 2 cm and let go: it slides back shut.
  await hand.pinchAt(d.handle);
  expect(await page.evaluate(() => window.__ns!.ui.drawer().state)).toBe("opening");
  await hand.moveTo(along(d.handle, d.toward, 0.02), 300);
  expect(await page.evaluate(() => window.__ns!.ui.drawer().out)).toBeGreaterThan(0);
  await hand.release();
  addRunNote(`drawer after a short pull let go: ${JSON.stringify(await page.evaluate(() => window.__ns!.ui.drawer()))}`);
  await app.stepUntil((n) => n.ui.drawer().out === 0, { maxMs: 2_000, label: "drawer back shut" });
  expect((await app.state()).screen).toBe("play");

  // A pinch made away from the handle and dragged through it: nothing.
  await hand.pinchAt(along(along(d.handle, d.toward, 0.02), [0, 1, 0], 0.09));
  await hand.moveTo(along(d.handle, d.toward, 0.07), 400);
  await hand.release();
  expect((await app.state()).screen).toBe("play");
  expect(await page.evaluate(() => window.__ns!.ui.drawer().opened)).toBe(0);

  // Pinch the handle and pull 6 cm toward you: it opens, clunks, and Home rises on it.
  await page.evaluate(() => window.__ns!.audio.clear());
  await hand.pinchAt(d.handle);
  await hand.moveTo(along(d.handle, d.toward, 0.06), 400);
  await app.stepUntil((n) => n.state().screen === "home", { maxMs: 2_000, label: "home after the pull" });
  await hand.release();
  const after = await page.evaluate(() => window.__ns!.ui.drawer());
  expect(after).toMatchObject({ state: "open", opened: 1 });
  expect(await app.events("drawer")).toEqual([{ type: "drawer", hand: "right" }]);
  expect((await page.evaluate(() => window.__ns!.audio.log())).map((s) => s.id)).toContain("drawer_pull");
  await app.stepUntil((n) => !n.ui.busy(), { maxMs: 3_000, label: "home at rest" });
  expect((await app.state()).buttons.map((b) => b.id)).toContain("home-continue");
});

test("daily locked until box 3", async ({ page, boot }) => {
  const app = await boot();
  const key = () => page.evaluate(() => window.__ns!.ui.key("home-daily"));
  // A first launch: the Daily Box is there, says when it opens, and a poke does not press it.
  expect(await page.evaluate(() => window.__ns!.ui.text("home-daily-sub"))).toBe(COPY.menus.home.dailyLocked);
  expect((await key())!.enabled).toBe(false);
  await app.poke("home-daily");
  await app.step(20);
  expect((await app.events("press")).map((e: any) => e.id)).not.toContain("home-daily");
  expect((await app.state()).screen).toBe("home");
  // Box 2 solved: still locked. Box 3 solved: open.
  await page.evaluate(() => window.__ns!.ui.profile({ nextBox: 3 }));
  expect((await key())!.enabled).toBe(false);
  await page.evaluate(() => window.__ns!.ui.profile({ nextBox: 4 }));
  expect((await key())!.enabled).toBe(true);
  expect(await page.evaluate(() => window.__ns!.ui.text("home-daily-sub"))).toBe(COPY.menus.home.dailyNew);
  await app.poke("home-daily");
  await app.step(20);
  expect((await app.events("press")).map((e: any) => e.id)).toContain("home-daily");
});

test("settings persist after reload", async ({ page, boot }) => {
  let app = await boot();
  await app.poke("home-settings");
  await app.stepUntil((n) => n.state().screen === "settings", { maxMs: 5_000, label: "settings" });
  for (const id of ["music-down", "effects-down", "box-up", "toggle-warmth", "toggle-captions", "toggle-motion", "toggle-dimming", "toggle-hand"]) {
    await app.poke(id);
  }
  const want = { musicVol: 0.6, sfxVol: 0.8, boxSizeCm: 26, warmth: false, captions: false, reducedMotion: true, dimming: false, handed: "left" };
  await app.stepUntil((n, _w, a) => Object.entries(a).every(([k, v]) => n.ui.settings()[k] === v), { arg: want, maxMs: 3_000, label: "every setting changed" });
  expect(await page.evaluate(() => window.__ns!.ui.key("toggle-hand"))).toMatchObject({ lit: true });
  await app.step(90); // the save lands
  app = await boot();
  expect(await page.evaluate(() => window.__ns!.ui.settings())).toEqual(want);
  expect((await app.state()).box.sizeM).toBeCloseTo(0.26, 6);
  await app.poke("home-settings");
  await app.stepUntil((n) => n.state().screen === "settings", { maxMs: 5_000, label: "settings again" });
  expect(await page.evaluate(() => window.__ns!.ui.text("music-value"))).toBe("60%");
  expect(await page.evaluate(() => window.__ns!.ui.text("toggle-hand-state"))).toBe("On");
  expect(await page.evaluate(() => window.__ns!.ui.key("toggle-warmth"))).toMatchObject({ lit: false });
  // Reset progress asks first; keeping it changes nothing, resetting keeps the settings.
  await page.evaluate(() => window.__ns!.ui.profile({ nextBox: 5 }));
  await app.poke("settings-reset");
  await app.stepUntil((n) => n.state().screen === "reset", { maxMs: 5_000, label: "reset confirm" });
  await app.poke("reset-keep");
  await app.stepUntil((n) => n.state().screen === "settings", { maxMs: 5_000, label: "kept" });
  await app.poke("settings-reset");
  await app.stepUntil((n) => n.state().screen === "reset", { maxMs: 5_000, label: "reset confirm again" });
  await app.poke("reset-confirm");
  await app.stepUntil((n) => n.state().screen === "home", { maxMs: 5_000, label: "home after reset" });
  await shows(app, "home-notice-text", COPY.menus.home.reset);
  await shows(app, "home-continue-sub", "Start Box No. 1");
  expect(await page.evaluate(() => window.__ns!.ui.settings())).toEqual(want);
});

test("trial screens with fake billing", async ({ page, boot }) => {
  // v1: no trial anywhere (the default edition here is the judge's, and the paywall is off).
  let app = await boot();
  expect(await page.evaluate(() => window.__ns!.ui.access())).toMatchObject({ edition: "judge", paywall: false, ent: { kind: "unlocked" } });
  expect((await app.state()).buttons.map((b) => b.id)).not.toContain("home-trial");

  // The store edition with the paywall forced on, in the installed app (billing sells). A player
  // whose first launch was on an earlier build owns the game, so this one first launched on the
  // paywall build.
  app = await boot({ url: "/?edition=store&paywall=1&billing=app" });
  await page.evaluate((atMs) => window.__ns!.ui.profile({ firstLaunch: { atMs, build: "2.0.0" } }), new Date(DEFAULT_DATE).getTime());
  await app.stepUntil((n) => n.ui.access().ent.kind === "trial", { maxMs: 2_000, label: "trial resolved" });
  expect(await page.evaluate(() => window.__ns!.ui.access())).toMatchObject({ edition: "store", paywall: true, ent: { kind: "trial", daysLeft: 7 }, canBuy: true });
  await shows(app, "home-trial-label", "Your trial: 7 days left");
  await app.poke("home-trial");
  await app.stepUntil((n) => n.state().screen === "trial", { maxMs: 5_000, label: "trial screen" });
  await shows(app, "trial-days", "Your trial: 7 days left");
  let ids = (await app.state()).buttons.map((b) => b.id);
  expect(ids).toContain("trial-buy");
  expect(ids).not.toContain("trial-store");
  // The store says no: nothing changes. Then it sells.
  await page.evaluate(() => window.__ns!.ui.billing({ buyResult: "cancelled" }));
  await app.poke("trial-buy");
  await app.step(20);
  expect(await page.evaluate(() => window.__ns!.ui.access().ent.kind)).toBe("trial");
  await page.evaluate(() => window.__ns!.ui.billing({ buyResult: "bought" }));
  await app.poke("trial-buy");
  await app.stepUntil((n) => n.ui.access().ent.kind === "owned", { maxMs: 2_000, label: "owned" });
  await app.stepUntil((n) => n.ui.text("trial-status") === "Thank you. The full game is yours.", { maxMs: 2_000, label: "thanks" });
  await app.poke("trial-back");
  await app.stepUntil((n) => n.state().screen === "home", { maxMs: 5_000, label: "home" });
  await app.stepUntil((n) => !n.ui.busy(), { maxMs: 3_000, label: "home at rest" });
  expect((await app.state()).buttons.map((b) => b.id)).not.toContain("home-trial");

  // On the web there is no billing: the store link instead of Buy.
  app = await boot({ url: "/?edition=store&paywall=1&billing=web" });
  await app.stepUntil((n) => n.ui.access().ent.kind === "trial", { maxMs: 2_000, label: "trial on the web" });
  await app.poke("home-trial");
  await app.stepUntil((n) => n.state().screen === "trial", { maxMs: 5_000, label: "trial screen on the web" });
  ids = (await app.state()).buttons.map((b) => b.id);
  expect(ids).toContain("trial-store");
  expect(ids).not.toContain("trial-buy");
  expect(await page.evaluate(() => window.__ns!.ui.text("trial-store-label"))).toBe("Get it on the Meta Horizon Store");
  await app.poke("trial-store");
  await app.step(20);
  expect(await page.evaluate(() => window.__ns!.ui.opened())).toEqual([STORE_PAGE_URL]);

  // Eight days after the first launch: the trial is over, Continue goes to the trial screen, the Daily Box stays.
  // (The page clock is set once per test, so the first launch moves back instead.)
  app = await boot({ url: "/?edition=store&paywall=1&billing=app" });
  await page.evaluate((atMs) => window.__ns!.ui.profile({ firstLaunch: { atMs, build: "2.0.0" } }), new Date(DEFAULT_DATE).getTime() - 8 * 86_400_000);
  await app.stepUntil((n) => n.ui.access().ent.kind === "trialOver", { maxMs: 2_000, label: "trial over" });
  await shows(app, "home-continue-sub", COPY.menus.home.trialOver);
  await app.poke("home-continue");
  await app.stepUntil((n) => n.state().screen === "trial", { maxMs: 5_000, label: "trial screen after Continue" });
  await shows(app, "trial-days", "Your trial has ended.");
  await shows(app, "trial-keeps", "The Daily Box and the lessons stay open.");
});

/** Pull the drawer open with the right hand (pinch its handle, 6 cm toward you, let go) and wait for Home at rest. */
async function pullDrawer(app: XrApp): Promise<void> {
  await app.stepUntil((n) => n.ui.drawer().out === 0, { maxMs: 3_000, label: "drawer shut" });
  const d = await app.page.evaluate(() => window.__ns!.ui.drawer());
  const hand = new Hands(app, "right");
  const say = async (when: string) =>
    addRunNote(
      `pull ${when}: ${JSON.stringify(
        await app.page.evaluate(() => ({
          drawer: window.__ns!.ui.drawer(),
          screen: window.__ns!.state().screen,
          stage: window.__sl!.session.state()?.stage,
          lantern: window.__sl!.lantern(),
        })),
      )}`,
    );
  await hand.pinchAt(d.handle);
  if ((await app.page.evaluate(() => window.__ns!.ui.drawer().state)) !== "opening") await say("after the pinch");
  await hand.moveTo(along(d.handle, d.toward, 0.06), 400);
  try {
    await app.stepUntil((n) => n.state().screen === "home", { maxMs: 2_000, label: "home after the pull" });
  } catch (err) {
    await say("after 6 cm");
    throw err;
  }
  await hand.release();
  await hand.moveTo(along(d.handle, d.toward, 0.3), 300);
  await app.stepUntil((n) => !n.ui.busy(), { maxMs: 3_000, label: "home at rest" });
}

/** Wait for the box session to play `key` with its etching shown; returns its state. */
async function playing(app: XrApp, key: string): Promise<any> {
  await app.stepUntil(
    (_n, w, k) => {
      const s = (w as any).__sl.session.state();
      return s?.stage === "playing" && s.revealed && s.key === k;
    },
    { arg: key, maxMs: 10_000, label: `${key} in play` },
  );
  return app.page.evaluate(() => window.__sl!.session.state());
}

test("poke every home button", async ({ page, boot }) => {
  const app = await boot();
  const screenAfter = async (key: string, screen: string) => {
    await app.poke(key);
    await app.stepUntil((n, _w, s) => n.state().screen === s, { arg: screen, maxMs: 5_000, label: `${screen} after ${key}` });
  };
  // Lessons, Collection and Settings open their panels, and each comes back.
  await screenAfter("home-lessons", "lessons");
  await screenAfter("lessons-back", "home");
  await screenAfter("home-collection", "collection");
  await screenAfter("collection-back", "home");
  await screenAfter("home-settings", "settings");
  await screenAfter("settings-done", "home");
  // The Daily Box before box 3: no press.
  await app.poke("home-daily");
  await app.step(20);
  expect((await app.events("press")).map((e: any) => e.id)).not.toContain("home-daily");
  // Continue starts box 1 (a first launch with lessons not wired yet opens on Home).
  await shows(app, "home-continue-sub", "Start Box No. 1");
  await screenAfter("home-continue", "play");
  await playing(app, "shadow-locks/1");
  expect(await page.evaluate(() => window.__ns!.ui.held())).toBe(false);
  // Pull the drawer over play: the box waits behind the menu, held, and Continue goes back to it.
  await pullDrawer(app);
  expect(await page.evaluate(() => window.__ns!.ui.behind())).toEqual({ kind: "box", n: 1 });
  expect(await page.evaluate(() => window.__ns!.ui.held())).toBe(true);
  await shows(app, "home-continue-sub", "Box No. 1");
  const t0 = (await page.evaluate(() => window.__sl!.session.state()))!.elapsedMs;
  await app.step(60);
  expect((await page.evaluate(() => window.__sl!.session.state()))!.elapsedMs).toBe(t0);
  await screenAfter("home-continue", "play");
  expect(await page.evaluate(() => window.__ns!.ui.held())).toBe(false);
  expect((await page.evaluate(() => window.__sl!.session.state()))!.key).toBe("shadow-locks/1");
  // Box 3 solved: the Daily Box opens today's box; the drawer over it, Continue goes back to it.
  await page.evaluate(() => window.__ns!.ui.profile({ nextBox: 4 }));
  await pullDrawer(app);
  await shows(app, "home-daily-sub", COPY.menus.home.dailyNew);
  await screenAfter("home-daily", "play");
  const daily = await playing(app, "shadow-locks/daily/2026-11-02");
  expect(daily.spec).toEqual({ kind: "daily", day: "2026-11-02" });
  await pullDrawer(app);
  expect(await page.evaluate(() => window.__ns!.ui.behind())).toEqual({ kind: "daily" });
  await shows(app, "home-continue-sub", COPY.menus.home.backToDaily);
  await screenAfter("home-daily", "play");
  expect((await page.evaluate(() => window.__sl!.session.state()))!.key).toBe("shadow-locks/daily/2026-11-02");
  const presses = (await app.events("press")).map((e: any) => e.id);
  for (const id of ["home-lessons", "home-collection", "home-settings", "home-continue", "home-daily"]) expect(presses, id).toContain(id);
});

test("lessons rows replay", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => window.__ns!.ui.profile({ tipsSeen: ["ringless"], nextBox: 5 }));
  // Box 5 in play, then the drawer: the replays happen with the box waiting behind the menu.
  await app.poke("home-continue");
  await playing(app, "shadow-locks/5");
  await pullDrawer(app);
  const before = await page.evaluate(() => ({ behind: window.__ns!.ui.behind(), s: window.__sl!.session.snapshot() }));
  expect(before.behind).toEqual({ kind: "box", n: 5 });
  await app.poke("home-lessons");
  await app.stepUntil((n) => n.state().screen === "lessons", { maxMs: 5_000, label: "lessons" });
  // Every example and the tip seen are rows; each asks the lessons to replay it.
  const ids = (await app.state()).buttons.map((b) => b.id);
  for (const id of ["lesson-move", "lesson-near-far", "lesson-rings", "lesson-finger", "tip-0"]) expect(ids).toContain(id);
  expect(ids).not.toContain("tip-1");
  await shows(app, "tip-0-label", COPY.menus.lessons.ringless);
  for (const id of ["lesson-move", "lesson-near-far", "lesson-rings", "lesson-finger", "tip-0"]) {
    await app.poke(id);
    await app.step(20);
  }
  const asked = (await page.evaluate(() => window.__ns!.ui.replays())).map((r) => `${r.kind} ${r.id}`);
  expect(asked).toEqual(["example move", "example near-far", "example rings", "example finger", "tip ringless"]);
  // A replay never touches box progress: the same box waits, as it was, and Continue goes back to it.
  const after = await page.evaluate(() => ({ behind: window.__ns!.ui.behind(), s: window.__sl!.session.snapshot() }));
  expect(after).toEqual(before);
  await app.poke("lessons-back");
  await app.stepUntil((n) => n.state().screen === "home", { maxMs: 5_000, label: "home" });
  await app.poke("home-continue");
  await app.stepUntil((n) => n.state().screen === "play", { maxMs: 5_000, label: "back to box 5" });
  expect((await page.evaluate(() => window.__sl!.session.state()))!.key).toBe("shadow-locks/5");
});

test("box size change keeps the solve state", async ({ page, boot }) => {
  const app = await boot();
  // Box 5: three locks (box 1 has one, and opening it opens the box, when the drawer stays shut).
  await page.evaluate(() => window.__ns!.ui.profile({ nextBox: 5 }));
  await app.poke("home-continue");
  const s = await playing(app, "shadow-locks/5");
  // Open the first lock that needs no finger, with the lantern on its spot.
  const lock = s.locks.find((l: any) => !l.finger);
  await page.evaluate((L) => window.__sl!.placeLantern(L), lock.spot);
  await app.stepUntil((_n, w, i) => (w as any).__sl.session.state().open.includes(i), { arg: lock.i, maxMs: 3_000, batch: 1, label: "a lock open" });
  // The lantern back near its start, off the spot (an open lock stays open), and clear of the drawer's handle:
  // a pinch that starts by the lantern takes the lantern, not the drawer.
  await page.evaluate(() => {
    const st = window.__ns!.scene.box()!.start;
    window.__sl!.placeLantern([st[0], st[1] + 0.1, st[2]]);
  });
  await app.step(5);
  const was = await page.evaluate(() => ({ s: window.__sl!.session.state()!, lantern: window.__sl!.lantern().pos }));
  expect(was.s.stage).toBe("playing");
  // The drawer, Settings, the box two steps bigger.
  await pullDrawer(app);
  await app.poke("home-settings");
  await app.stepUntil((n) => n.state().screen === "settings", { maxMs: 5_000, label: "settings" });
  await app.poke("box-up");
  await app.poke("box-up");
  await app.stepUntil((n) => n.ui.settings().boxSizeCm === 28, { maxMs: 3_000, label: "box 28 cm" });
  expect((await app.state()).box.sizeM).toBeCloseTo(0.28, 6);
  await app.poke("settings-done");
  await app.stepUntil((n) => n.state().screen === "home", { maxMs: 5_000, label: "home" });
  await app.poke("home-continue");
  await app.stepUntil((n) => n.state().screen === "play", { maxMs: 5_000, label: "play" });
  await app.step(10);
  const now = await page.evaluate(() => ({ s: window.__sl!.session.state()!, lantern: window.__sl!.lantern().pos }));
  // Everything lives in box units: the same box, the same open locks, the lantern where it was.
  expect(now.s.key).toBe(was.s.key);
  expect(now.s.open).toEqual(was.s.open);
  expect(now.s.crystals).toEqual(was.s.crystals);
  for (let i = 0; i < 3; i++) expect(now.lantern[i]).toBeCloseTo(was.lantern[i]!, 5);
  expect(now.s.stage).toBe("playing");
});

test("the drawer stays shut while the box opens", async ({ page, boot }) => {
  const app = await boot();
  await app.poke("home-continue");
  const s = await playing(app, "shadow-locks/1");
  // Box 1's one lock: the box opens.
  await page.evaluate((L) => window.__sl!.placeLantern(L), s.locks[0].spot);
  await app.stepUntil((_n, w) => (w as any).__sl.session.state().stage === "opening", { maxMs: 3_000, batch: 1, label: "the box opening" });
  const d = await page.evaluate(() => window.__ns!.ui.drawer());
  const hand = new Hands(app, "right");
  await hand.pinchAt(d.handle);
  await hand.moveTo(along(d.handle, d.toward, 0.06), 400);
  await hand.release();
  expect((await app.state()).screen).toBe("play");
  expect(await page.evaluate(() => window.__ns!.ui.drawer())).toMatchObject({ opened: 0, state: "closed" });
});

test("no live button within 10 cm of the box mouth during play", async ({ page, boot }) => {
  const app = await boot();
  await app.poke("home-continue");
  await playing(app, "shadow-locks/1");
  await app.step(30);
  const near = await page.evaluate(() => {
    const ns = window.__ns!, sl = window.__sl!;
    const m = ns.scene.matrix();
    const size = ns.state().box.sizeM;
    // A world point to box units (the box matrix is a turn and one uniform scale).
    const toBox = (p: number[]) => {
      const dx = p[0]! - m[12]!, dy = p[1]! - m[13]!, dz = p[2]! - m[14]!;
      const s2 = m[0]! * m[0]! + m[1]! * m[1]! + m[2]! * m[2]!;
      return [(m[0]! * dx + m[1]! * dy + m[2]! * dz) / s2, (m[4]! * dx + m[5]! * dy + m[6]! * dz) / s2, (m[8]! * dx + m[9]! * dy + m[10]! * dz) / s2];
    };
    // Distance (m) from a point to the mouth: the open front, x and y in [-0.5, 0.5] at z = 1.
    const toMouth = (p: number[]) => {
      const b = toBox(p);
      const cx = Math.min(0.5, Math.max(-0.5, b[0]!)), cy = Math.min(0.5, Math.max(-0.5, b[1]!));
      return Math.hypot(b[0]! - cx, b[1]! - cy, b[2]! - 1) * size;
    };
    const live: { id: string; d: number }[] = [];
    // The menus' keys on the screen shown (none in play), and every key of a panel still drawn.
    for (const b of ns.state().buttons) live.push({ id: b.id, d: toMouth(b.world) });
    // The box's own keys (the plate's Next, the hint lantern and its choices) that are live now.
    for (const k of sl.session.keys()) if (k.live) live.push({ id: k.id, d: toMouth(k.world) });
    // Every menu key in the scene that is drawn (a hidden panel is not drawn): keys carry their id as the name.
    const world = (ns.world as any).scene;
    const tmp = { x: 0, y: 0, z: 0 };
    world.traverseVisible((o: any) => {
      if (!o.name || !/^(home|lessons|lesson|tip|collection|coll|settings|toggle|music|effects|box|reset|trial)-[a-z0-9-]+$/.test(o.name)) return;
      o.updateWorldMatrix(true, false);
      const e = o.matrixWorld.elements;
      tmp.x = e[12];
      tmp.y = e[13];
      tmp.z = e[14];
      live.push({ id: `drawn ${o.name}`, d: toMouth([tmp.x, tmp.y, tmp.z]) });
    });
    return { screen: ns.state().screen, live };
  });
  expect(near.screen).toBe("play");
  expect(near.live.length).toBeGreaterThan(0);
  for (const k of near.live) expect(k.d, k.id).toBeGreaterThan(0.1);
});

/**
 * A whole panel in the headset's view: half Quest 3's pixel density (12 px per degree, a 60 degree tall
 * view at 720p), so the panel fits; the text is then drawn about half as sharp as on the device.
 */
async function look(app: XrApp, screen: string, name = screen): Promise<void> {
  await app.page.evaluate((s) => window.__ns!.ui.go(s as any), screen);
  await app.stepUntil((n, _w, s) => n.state().screen === s && !n.ui.busy(), { arg: screen, maxMs: 3_000, label: `${screen} at rest` });
  const p = await app.page.evaluate((s) => window.__ns!.ui.panelBox(s as any), screen);
  await app.captureHeadset(`menu-${name}`, { x: p!.center[0], y: p!.center[1], z: p!.center[2] }, 12);
}

test("menus in the headset (screenshots for review)", async ({ page, boot }) => {
  const app = await boot({ mode: "visual" });
  await page.evaluate(() =>
    window.__ns!.ui.profile({
      nextBox: 6,
      tipsSeen: ["decoys", "ringless"],
      daily: { streak: 3, best: 3, lastDay: "2026-11-01", current: null },
      collection: [1, 2, 3, 4, 5].map((n) => ({ key: `shadow-locks/${n}`, owner: "the Clockmaker", loot: "a brass cipher disc", shapes: ["Moon"], atMs: n, timeMs: 60_000, hints: 0 })),
    }),
  );
  for (const s of ["lessons", "collection", "settings", "reset", "home"]) await look(app, s);
  // The drawer shut, a hand near its handle (the gold glows), and the box as it is in play.
  await closeMenus(app);
  const d = await page.evaluate(() => window.__ns!.ui.drawer());
  const hand = new Hands(app, "left");
  await hand.pinchAt(along(d.handle, d.toward, 0.06), { pinch: false });
  await app.captureHeadset("menu-drawer-shut", { x: d.handle[0], y: d.handle[1] + 0.05, z: d.handle[2] }, 12);
  expect(app.consoleLines.filter((l) => l.startsWith("error:") || l.startsWith("PAGEERROR"))).toEqual([]);
});

test("the trial screens in the headset (screenshots for review)", async ({ page, boot }) => {
  // The paywall update only, as the installed app shows it.
  const app = await boot({ mode: "visual", url: "/?edition=store&paywall=1&billing=app" });
  await page.evaluate((atMs) => window.__ns!.ui.profile({ firstLaunch: { atMs, build: "2.0.0" } }), new Date(DEFAULT_DATE).getTime());
  await app.stepUntil((n) => n.ui.access().ent.kind === "trial", { maxMs: 2_000, label: "trial" });
  await look(app, "home", "home-trial");
  await look(app, "trial");
});

function xyz(p: Vec3): { x: number; y: number; z: number } {
  return { x: p[0], y: p[1], z: p[2] };
}
