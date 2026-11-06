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
