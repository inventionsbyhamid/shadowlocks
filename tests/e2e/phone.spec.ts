/* eslint-disable @typescript-eslint/no-explicit-any */
// A phone in AR (Chrome's WebXR on ARCore), as near as the emulator comes: IWER's Quest 3 told to report the WebXR AR
// module's "screen-space" interaction mode (a handheld's), its controllers put away. IWER has no screen input, so the
// fingers go in through the test hooks as rays from the head (window.__sl.touch); everything after the ray is the
// game's own: the box placed in the camera's view, the lantern dragged with its shadows moving, the drawer tapped
// open, a menu key tapped, a finger cast in the light. The owner's phone check covers the real touch input sources.
import type { Page } from "@playwright/test";
import type { Vec3 } from "../../src/core/types";
import { add, dist, lantern, shadows, sub, toWorld, unit } from "./helpers/lantern";
import { relaxIwer } from "./helpers/page-scripts";
import { type BootFn, expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

/** Holding a phone at the chest, pointed down at a table in front. */
const PHONE = { position: { x: 0, y: 1.25, z: -1.4 }, lookAt: { x: 0, y: 0.95, z: -1.95 } };

/**
 * Boot into XR as a phone: the session's interaction mode set to screen-space before it is accepted (unless
 * `screenSpace` is false: a browser that does not say so), no controllers.
 */
async function bootPhone(boot: BootFn, page: Page, screenSpace = true): Promise<XrApp> {
  const app = await boot({ enterXR: false, head: PHONE });
  if (screenSpace) {
    await page.evaluate(() => {
      const d = (window as any).IWER_DEVICE;
      const key = Object.getOwnPropertySymbols(d).find((s) => d[s] && typeof d[s] === "object" && "interactionMode" in d[s]);
      if (!key) throw new Error("no IWER device state to make a handheld of");
      d[key].interactionMode = "screen-space";
    });
  }
  await app.waitReal((_ns, w) => w.IWER_DEVICE.sessionOffered === true, { label: "XR session offer" });
  await app.command("accept_session");
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR presenting" });
  await page.evaluate(relaxIwer);
  await app.command("set_connected", { device: "controller-left", connected: false });
  await app.command("set_connected", { device: "controller-right", connected: false });
  await app.stepUntil(
    (ns) => {
      const st = ns.state();
      return st.screen === "home" && st.boxPose.source !== "default";
    },
    { maxMs: 10_000, label: "home with the box placed" },
  );
  return app;
}

/** The menus away and box `n` shown in play. */
async function showBox(app: XrApp, page: Page, n = 1): Promise<void> {
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate((k) => window.__ns!.scene.show({ n: k }), n);
  await app.step(2);
}

const touch = (page: Page, list: { id: number; at: Vec3 }[]) => page.evaluate((l) => window.__sl!.touch.set(l), list);
const roles = (page: Page) => page.evaluate(() => window.__sl!.touch.roles());
const head = async (page: Page): Promise<Vec3> => (await page.evaluate(() => window.__ns!.state().head))!;

test("a phone's session places the box in the camera's view", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  expect(await page.evaluate(() => window.__sl!.touch.phone())).toBe(true);
  const st = await app.state();
  expect(st.xr.sessionMode).toBe("immersive-ar");
  expect(st.boxPose.source).toBe("view");
  // The box's middle 65 cm along the camera's view, where the phone points.
  const h = await head(page);
  const mid = await toWorld(page, [0, 0, 0.5]);
  const view = unit([PHONE.lookAt.x - PHONE.position.x, PHONE.lookAt.y - PHONE.position.y, PHONE.lookAt.z - PHONE.position.z]);
  expect(dist(mid, h)).toBeCloseTo(0.65, 2);
  expect(dist(unit(sub(mid, h)), view)).toBeLessThan(0.02);
});

test("a phone whose session does not say so is known by its first touch, and the box comes into view", async ({ page, boot }) => {
  const app = await bootPhone(boot, page, false);
  expect(await page.evaluate(() => window.__sl!.touch.phone())).toBe(false);
  expect((await app.state()).boxPose.source).toBe("head");
  const h = await head(page);
  const ahead: Vec3 = add(h, unit([PHONE.lookAt.x - PHONE.position.x, PHONE.lookAt.y - PHONE.position.y, PHONE.lookAt.z - PHONE.position.z]), 0.4);
  // The screen touch an Android phone's browser lists (here fed as a ray): the session is a phone's from now on.
  await touch(page, [{ id: 1, at: ahead }]);
  await app.step(3);
  expect(await page.evaluate(() => window.__sl!.touch.phone())).toBe(true);
  expect((await app.state()).boxPose.source).toBe("view");
  await touch(page, []);
  await app.step(3);
  expect(await page.evaluate(() => window.__sl!.touch.phone())).toBe(true);
});

test("on a phone a touch drags the lantern, its shadows moving, and lifting lets it go", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  await showBox(app, page, 1);
  const before = await shadows(page);
  expect(before.length, "shadows on the panel").toBeGreaterThan(0);
  const h = await head(page);
  const start = await toWorld(page, (await lantern(page)).pos);
  const depth = dist(start, h);

  await touch(page, [{ id: 1, at: start }]);
  await app.step(2);
  expect(await roles(page)).toEqual(["lantern"]);
  expect(await lantern(page)).toMatchObject({ held: true, holder: "right" });

  // The finger slides 4 cm left and 2 cm down on the screen, over a third of a second.
  const aim = add(start, [-0.04, -0.02, 0]);
  for (let i = 1; i <= 10; i++) {
    await touch(page, [{ id: 1, at: add(start, sub(aim, start), i / 10) }]);
    await app.step(2);
  }
  await app.step(30);
  const held = await lantern(page);
  expect(held.held).toBe(true);
  // On the finger's new ray, at the depth it was touched at.
  const want = add(h, unit(sub(aim, h)), depth);
  expect(dist(await toWorld(page, held.pos), want), "the lantern follows the finger").toBeLessThan(0.005);
  const after = await shadows(page);
  expect(after).toHaveLength(before.length);
  expect(after, "the shadows moved with the lantern").not.toEqual(before);

  // Lifted: let go where it is.
  await touch(page, []);
  await app.step(4);
  const let_ = await lantern(page);
  expect(let_.held).toBe(false);
  expect(dist(let_.pos, held.pos)).toBeLessThan(0.02);
  expect(await roles(page)).toEqual([]);
});

test("on a phone a tap on the drawer opens the menus and a tap on a key presses it", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  await showBox(app, page, 1);
  // The lantern up and out of the way of the drawer's handle.
  await page.evaluate(() => window.__sl!.placeLantern([0.4, 0.4, 1.2]));
  await app.step(2);
  const handle = (await page.evaluate(() => window.__ns!.ui.drawer())).handle;
  await touch(page, [{ id: 1, at: handle }]);
  await app.step(2);
  expect(await roles(page)).toEqual(["drawer"]);
  await touch(page, []);
  await app.stepUntil((ns) => ns.state().screen === "home" && !ns.ui.busy(), { maxMs: 5_000, label: "Home up and at rest" });
  expect((await app.events("drawer")).length).toBe(1);

  const key = (await app.state()).buttons.find((b) => b.id === "home-settings")!;
  expect(key, "Home's Settings key").toBeTruthy();
  await touch(page, [{ id: 2, at: key.world }]);
  await app.step(12);
  expect(await roles(page)).toEqual(["key"]);
  await touch(page, []);
  await app.stepUntil((ns) => ns.state().screen === "settings", { maxMs: 3_000, label: "Settings after the tap" });
  expect((await app.events("press")).map((e) => (e as { id?: string }).id)).toContain("home-settings");
});

test("on a phone a touch on the gap fills box 3's finger lock: the piece forms and the lock opens", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  // Played as the game plays it, the lantern set on the finger lock's spot (by hook: dragging it there is the test above).
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 3 }));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.key === "shadow-locks/3" && s.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "box 3 in play" },
  );
  let [lock] = await page.evaluate(() => window.__sl!.fingerLocks());
  expect(lock, "box 3 has a finger lock").toBeTruthy();
  await page.evaluate((L) => window.__sl!.placeLantern(L), lock!.spot);
  await app.step(3);
  [lock] = await page.evaluate(() => window.__sl!.fingerLocks());
  expect(lock!.coverage.gap, "the gap is empty").toBeLessThan(0.78);
  // A touch on the gap's middle as it shows on the panel, held still.
  const n = lock!.piece.length;
  const mid: Vec3 = [lock!.piece.reduce((s, p) => s + p[0], 0) / n, lock!.piece.reduce((s, p) => s + p[1], 0) / n, 0];
  await touch(page, [{ id: 1, at: await toWorld(page, mid) }]);
  await app.step(3);
  expect(await roles(page)).toEqual(["finger"]);
  [lock] = await page.evaluate(() => window.__sl!.fingerLocks());
  console.log(`phone finger on box 3's gap: ${JSON.stringify(lock!.coverage)}`);
  expect(lock!.meets, "the touch's finger fills the gap").toBe(true);
  await app.stepUntil((_ns, w) => w.__sl.fingerLocks()[0].state === "done", { maxMs: 3_000, label: "the finger hold done" });
  await touch(page, []);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock!.lock, maxMs: 3_000, label: "the finger lock open" });
});

test("on a phone a touch on the box puts a finger in the light, its shadow under the touch", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  await showBox(app, page, 1);
  await page.evaluate(() => window.__sl!.placeLantern([0.35, 0.3, 1.4]));
  await app.step(2);
  // A touch reaching the panel a little left of its middle.
  const at = await toWorld(page, [-0.1, -0.05, 0]);
  await touch(page, [{ id: 1, at }]);
  await app.step(3);
  expect(await roles(page)).toEqual(["finger"]);
  const hands = await page.evaluate(() => window.__sl!.hands());
  expect(hands.standIn?.by).toBe("right");
  expect(hands.finger.length).toBeGreaterThan(0);
  // The finger's shadow is centred where the touch meets the panel.
  const pts = hands.finger.flat();
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  expect(Math.hypot(cx + 0.1, cy + 0.05)).toBeLessThan(0.03);
  await touch(page, []);
  await app.step(3);
  expect((await page.evaluate(() => window.__sl!.hands())).finger.length).toBe(0);
});
