/* eslint-disable @typescript-eslint/no-explicit-any */
// A phone in AR (Chrome's WebXR on ARCore), as near as the emulator comes: IWER's Quest 3 told to report the WebXR AR
// module's "screen-space" interaction mode (a handheld's), its controllers put away. IWER has no screen input, so the
// fingers go in through the test hooks as rays from the head (window.__sl.touch); everything after the ray is the
// game's own: the box placed in the camera's view, the lantern dragged with its shadows moving, the drawer tapped
// open, a menu key tapped, a finger cast in the light. The owner's phone check covers the real touch input sources.
import type { Page } from "@playwright/test";
import { LESSON_1 } from "../../src/core/lessons-data";
import type { V3, Vec3 } from "../../src/core/types";
import { add, dist, lantern, type P3, shadows, sub, toWorld, unit } from "./helpers/lantern";
import { relaxIwer, setHeadset, type XYZ } from "./helpers/page-scripts";
import { type BootFn, expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

/**
 * What of the box must be in view, from its middle (box units): the frame, the plinth and the drawer's handle (the
 * placement's BOX_EXTENT, written out: the spec does not load the game's three.js modules).
 */
const BOX_EXTENT = { x: 0.56, up: 0.56, down: 0.65, back: 0.56, front: 0.59 };

type HeadPose = { position: XYZ; lookAt: XYZ };

/** Holding a phone at the chest, pointed down at a table in front (29 degrees down). */
const PHONE: HeadPose = { position: { x: 0, y: 1.25, z: -1.4 }, lookAt: { x: 0, y: 0.95, z: -1.95 } };
/** Holding a phone level at the chest: the pose that put the lantern in front of the panel. */
const PHONE_LEVEL: HeadPose = { position: { x: 0, y: 1.25, z: -1.4 }, lookAt: { x: 0, y: 1.25, z: -1.95 } };

/**
 * Far enough round that no part of the box is left in view: IWER's emulated view is wide (90 degrees up and down, about
 * 120 across in the 16:9 page), and at its 0.4 m the box's sphere spans 37 degrees each way, so a quarter turn still
 * shows its edge.
 */
const AWAY_DEG = 135;

/** `p` turned `deg` to the left about the up axis, in the same place. */
function turnedLeft(p: HeadPose, deg: number): HeadPose {
  const a = (deg * Math.PI) / 180, dx = p.lookAt.x - p.position.x, dz = p.lookAt.z - p.position.z;
  return { position: p.position, lookAt: { x: p.position.x + dx * Math.cos(a) + dz * Math.sin(a), y: p.lookAt.y, z: p.position.z - dx * Math.sin(a) + dz * Math.cos(a) } };
}

const along = (p: HeadPose): Vec3 => unit([p.lookAt.x - p.position.x, p.lookAt.y - p.position.y, p.lookAt.z - p.position.z]);

/** A world point in box units, through the box root's matrix (a turn and one uniform scale). */
function boxUnits(m: number[], p: P3): Vec3 {
  const d = [p[0] - m[12]!, p[1] - m[13]!, p[2] - m[14]!], s2 = m[0]! * m[0]! + m[1]! * m[1]! + m[2]! * m[2]!;
  return [0, 4, 8].map((c) => (m[c]! * d[0]! + m[c + 1]! * d[1]! + m[c + 2]! * d[2]!) / s2) as Vec3;
}

/**
 * Start XR as a phone: the session's interaction mode set to screen-space before it is accepted (unless `screenSpace`
 * is false: a browser that does not say so), and no controllers from the start (a session that ever lists a hand or a
 * controller is a headset's). Returns once the session presents, before the box is placed.
 */
async function startPhone(boot: BootFn, page: Page, screenSpace = true, head: HeadPose = PHONE): Promise<XrApp> {
  const app = await boot({ enterXR: false, head });
  await page.evaluate((screen) => {
    const d = (window as any).IWER_DEVICE;
    d.controllers.left.connected = false;
    d.controllers.right.connected = false;
    if (!screen) return;
    const key = Object.getOwnPropertySymbols(d).find((s) => d[s] && typeof d[s] === "object" && "interactionMode" in d[s]);
    if (!key) throw new Error("no IWER device state to make a handheld of");
    d[key].interactionMode = "screen-space";
  }, screenSpace);
  await app.waitReal((_ns, w) => w.IWER_DEVICE.sessionOffered === true, { label: "XR session offer" });
  await app.command("accept_session");
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR presenting" });
  await page.evaluate(relaxIwer);
  return app;
}

/** Boot into XR as a phone (startPhone), held still at `head` until the box is placed. */
async function bootPhone(boot: BootFn, page: Page, screenSpace = true, head: HeadPose = PHONE): Promise<XrApp> {
  const app = await startPhone(boot, page, screenSpace, head);
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
  // The box's middle along the camera's view, where the phone points.
  const h = await head(page);
  const mid = await toWorld(page, [0, 0, 0.5]);
  const view = unit([PHONE.lookAt.x - PHONE.position.x, PHONE.lookAt.y - PHONE.position.y, PHONE.lookAt.z - PHONE.position.z]);
  // At least the nearest the placement allows (IWER's wide view puts it right there).
  expect(dist(mid, h)).toBeGreaterThanOrEqual(0.4 - 1e-6);
  expect(dist(mid, h)).toBeLessThan(1.6);
  expect(dist(unit(sub(mid, h)), view)).toBeLessThan(0.02);
  // The whole box, plinth and drawer handle included, inside the XR camera's view (with its margin).
  await app.step(1);
  const ndc = await page.evaluate((E) => {
    const w = window.__ns!.world as any;
    const cam = w.renderer.xr.getCamera().cameras[0];
    const root = w.scene.getObjectByName("Box");
    const V = root.position.constructor;
    const out: [number, number][] = [];
    for (const x of [-E.x, E.x]) {
      for (const y of [-E.down, E.up]) {
        for (const z of [-E.back, E.front]) {
          const p = new V(x, y, 0.5 + z).applyMatrix4(root.matrixWorld).project(cam);
          out.push([p.x, p.y]);
        }
      }
    }
    return out;
  }, BOX_EXTENT);
  const worst = Math.max(...ndc.flat().map(Math.abs));
  console.log(`phone placement: box ${dist(mid, h).toFixed(3)} m away, its farthest corner at ${worst.toFixed(3)} of the view`);
  expect(worst).toBeLessThanOrEqual(1);
});

test("a hand or a controller appearing makes the session a headset's: the box goes back to the lap", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  expect(await page.evaluate(() => window.__sl!.touch.phone())).toBe(true);
  expect((await app.state()).boxPose.source).toBe("view");
  await app.command("set_connected", { device: "controller-right", connected: true });
  await app.step(3);
  expect(await page.evaluate(() => window.__sl!.touch.phone())).toBe(false);
  expect((await app.state()).boxPose.source).toBe("head");
  // Put down again: still a headset's session, the box stays in the lap.
  await app.command("set_connected", { device: "controller-right", connected: false });
  await app.step(3);
  expect(await page.evaluate(() => window.__sl!.touch.phone())).toBe(false);
  expect((await app.state()).boxPose.source).toBe("head");
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

/** Where box points (box units) are drawn through the XR camera: normalised device x and y each (the first view). */
const ndcOf = (page: Page, pts: V3[]) =>
  page.evaluate((P) => {
    const w = window.__ns!.world as any;
    const cam = w.renderer.xr.getCamera().cameras[0];
    const root = w.scene.getObjectByName("Box");
    const V = root.position.constructor;
    return P.map((p) => {
      const v = new V(p[0], p[1], p[2]).applyMatrix4(root.matrixWorld).project(cam);
      return [v.x, v.y] as [number, number];
    });
  }, pts);

/** The lantern's drawn shape round its light (box units): the foot's rim 0.058 out and 0.087 down, the ring's top 0.174 up. */
function lanternCorners(L: P3): V3[] {
  const out: V3[] = [];
  for (const x of [-0.058, 0.058]) for (const y of [-0.087, 0.174]) for (const z of [-0.058, 0.058]) out.push([L[0] + x, L[1] + y, L[2] + z]);
  return out;
}

/** Box `n` played through the box session (its clock, its locks), the menus away. */
async function playBox(app: XrApp, page: Page, n: number) {
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate((k) => window.__sl!.session.play({ kind: "box", n: k }), n);
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: `box ${n} in play` },
  );
  return (await page.evaluate(() => window.__sl!.session.state()))!;
}

test("on a phone held level the lantern at each of lesson 1's spots is drawn below the panel", async ({ page, boot }) => {
  const app = await bootPhone(boot, page, true, PHONE_LEVEL);
  const st = await app.state();
  expect(st.boxPose.source).toBe("view");
  // Held level, the box leans 20 degrees toward the phone: seen from 20 degrees above its axis, as a seated eye sees it.
  expect(st.boxPose.tiltDeg).toBeCloseTo(-20, 1);
  // The menus keep the lap's angle to the box: Home stands in front of the box's mouth (box z > 1), top and bottom.
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "Home at rest" });
  const home = (await page.evaluate(() => window.__ns!.ui.panelBox("home")))!;
  const m = await page.evaluate(() => window.__ns!.scene.matrix());
  const top = boxUnits(m, add(home.center, home.up, home.height / 2)), bottom = boxUnits(m, add(home.center, home.up, -home.height / 2));
  console.log(`phone held level: Home's top at box z ${top[2].toFixed(3)} (y ${top[1].toFixed(3)}), its bottom at z ${bottom[2].toFixed(3)}`);
  expect(top[2], "Home's top in front of the box mouth").toBeGreaterThan(1);
  expect(bottom[2], "Home's bottom in front of the box mouth").toBeGreaterThan(1);

  await showBox(app, page, 1);
  // The panel's lower edge as drawn.
  const [bl, br] = await ndcOf(page, [[-0.5, -0.5, 0], [0.5, -0.5, 0]]);
  const panelBottom = Math.min(bl![1], br![1]);
  for (const l of LESSON_1.locks) {
    await page.evaluate((L) => window.__sl!.placeLantern(L), [l.L[0], l.L[1], l.L[2]] as V3);
    await app.step(2);
    const at = (await lantern(page)).pos;
    expect(dist(at, l.L)).toBeLessThan(1e-6);
    const top = Math.max(...(await ndcOf(page, lanternCorners(at))).map((p) => p[1]));
    console.log(`phone held level, lesson 1 lock ${l.i}: the lantern's top drawn at ${top.toFixed(3)}, the panel's lower edge at ${panelBottom.toFixed(3)}`);
    expect(top, `lock ${l.i}'s spot: the lantern below the panel`).toBeLessThan(panelBottom);
  }
});

test("on a phone a held lantern is drawn see-through, and solid again once let go", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  await showBox(app, page, 1);
  // At its start, below the panel as the camera sees it: solid.
  expect((await lantern(page)).see).toBe(0);
  const start = await toWorld(page, (await lantern(page)).pos);
  await touch(page, [{ id: 1, at: start }]);
  await app.step(20);
  expect(await lantern(page)).toMatchObject({ held: true, see: 1 });
  await touch(page, []);
  await app.step(20);
  expect(await lantern(page)).toMatchObject({ held: false, see: 0 });
});

test("on a phone the box first appears where the phone points once it is held still", async ({ page, boot }) => {
  // AR starts with the phone pointed 80 degrees to the left, then it swings round to the table in front.
  const app = await startPhone(boot, page, true, turnedLeft(PHONE, 80));
  for (let deg = 70; deg >= 0; deg -= 10) {
    await page.evaluate(setHeadset, turnedLeft(PHONE, deg));
    await app.step(3);
    const st = await app.state();
    expect(st.boxPose.source, `${deg} degrees left: not placed while it turns`).toBe("default");
    expect(st.box.visible, `${deg} degrees left: hidden until placed`).toBe(false);
  }
  const still = await app.now();
  await app.stepUntil((ns) => ns.state().boxPose.source !== "default", { maxMs: 3_000, label: "the box placed" });
  // Placed once held still for 0.4 s, where the phone points now; and shown.
  expect((await app.now()) - still).toBeGreaterThanOrEqual(400);
  const st = await app.state();
  expect(st.boxPose.source).toBe("view");
  expect(st.box.visible).toBe(true);
  const h = await head(page);
  const mid = await toWorld(page, [0, 0, 0.5]);
  expect(dist(unit(sub(mid, h)), along(PHONE))).toBeLessThan(0.02);
});

test("on a phone a box out of view comes back in front, the lantern and open locks unchanged", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  const s = await playBox(app, page, 2);
  const plain = s.locks.filter((l) => !l.finger);
  expect(s.locks.length, "box 2 keeps a lock closed after the first opens").toBeGreaterThanOrEqual(2);
  await page.evaluate((L) => window.__sl!.placeLantern(L), plain[0]!.spot);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: plain[0]!.i, maxMs: 2_000, batch: 1, label: "lock open" });
  const before = { pose: (await app.state()).boxPose, lantern: (await lantern(page)).pos, open: (await page.evaluate(() => window.__sl!.session.state()))!.open };
  // The phone turned well round to the left (AWAY_DEG) and held there.
  const away = turnedLeft(PHONE, AWAY_DEG);
  // Timed from the last frame before the turn: the box is out of view from the next one.
  const turnedAt = await app.now();
  await page.evaluate(setHeadset, away);
  await app.step(2);
  expect((await page.evaluate(() => window.__sl!.summon())).lostMs).toBeGreaterThan(0);
  await app.stepUntil((ns, _w, y) => Math.abs(ns.state().boxPose.yaw - y) > 0.5, { arg: before.pose.yaw, maxMs: 3_000, label: "the box placed again" });
  const waited = (await app.now()) - turnedAt;
  console.log(`phone turned away: the box came back after ${waited.toFixed(0)} ms`);
  expect(waited).toBeGreaterThanOrEqual(2000);
  // In front again, along the new view; nothing in the box changed.
  const h = await head(page);
  const mid = await toWorld(page, [0, 0, 0.5]);
  expect(dist(unit(sub(mid, h)), along(away))).toBeLessThan(0.02);
  expect(dist((await lantern(page)).pos, before.lantern)).toBeLessThan(1e-9);
  expect((await page.evaluate(() => window.__sl!.session.state()))!.open).toEqual(before.open);
  expect(app.consoleLines.filter((l) => l.includes("box out of view: placed again"))).toHaveLength(1);
  // A headset's arrow never shows on a phone.
  expect((await page.evaluate(() => window.__sl!.summon())).arrow).toBeNull();
});

test("on a phone the box never moves while the lantern is held", async ({ page, boot }) => {
  const app = await bootPhone(boot, page);
  await showBox(app, page, 1);
  const pose = (await app.state()).boxPose;
  const start = await toWorld(page, (await lantern(page)).pos);
  await touch(page, [{ id: 1, at: start }]);
  await app.step(3);
  expect(await lantern(page)).toMatchObject({ held: true });
  // Turned away for 3 s, the finger still on the lantern: the box stays where it is.
  await page.evaluate(setHeadset, turnedLeft(PHONE, AWAY_DEG));
  const t0 = await app.now();
  await app.stepUntil((_ns, w, end) => w.__vt.now >= end, { arg: t0 + 3000, maxMs: 4_000, label: "3 s turned away" });
  expect((await app.state()).boxPose).toEqual(pose);
  expect((await page.evaluate(() => window.__sl!.summon())).lostMs).toBeGreaterThanOrEqual(2000);
  // The finger lifts: then it comes back in front.
  await touch(page, []);
  await app.stepUntil((ns, _w, y) => Math.abs(ns.state().boxPose.yaw - y) > 0.5, { arg: pose.yaw, maxMs: 1_000, label: "placed again once let go" });
});
