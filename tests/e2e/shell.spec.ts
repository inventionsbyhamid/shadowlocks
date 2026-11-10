/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from "@playwright/test";
import { NOT_SAVED_NOTICE } from "../../src/app/profile-store";
import type { V3, Vec3 } from "../../src/core/types";
import { SEATED } from "./helpers/boot";
import { type Quat, turnQuat } from "./helpers/finger";
import { Hands } from "./helpers/hands";
import { add, dist, sub, unit } from "./helpers/lantern";
import { relaxIwer, setHeadset, type XYZ } from "./helpers/page-scripts";
import { expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

type HeadPose = { position: XYZ; lookAt: XYZ };

/** `p` turned `deg` to the left about the up axis, in the same place. */
function turnedLeft(p: HeadPose, deg: number): HeadPose {
  const a = (deg * Math.PI) / 180, dx = p.lookAt.x - p.position.x, dz = p.lookAt.z - p.position.z;
  return { position: p.position, lookAt: { x: p.position.x + dx * Math.cos(a) + dz * Math.sin(a), y: p.lookAt.y, z: p.position.z - dx * Math.sin(a) + dz * Math.cos(a) } };
}

const summon = (page: Page) => page.evaluate(() => window.__sl!.summon());

/**
 * Far enough round that no part of the box is left in view: IWER's emulated view is wide (90 degrees up and down, about
 * 120 across in the 16:9 page), so a quarter turn still shows the edge of the box in the lap.
 */
const AWAY_DEG = 135;
/** The heading of a head turned AWAY_DEG to the left from SEATED's (which looks down -z: heading 0). */
const AWAY_YAW = (AWAY_DEG * Math.PI) / 180;

/** The head turned well round to the left, away from the box, until the arrow shows (it waits 2 s); its place. */
async function lookAwayForArrow(app: XrApp, page: Page): Promise<Vec3> {
  await page.evaluate(setHeadset, turnedLeft(SEATED, AWAY_DEG));
  const t0 = await app.now();
  await app.stepUntil((_ns, w) => w.__sl.summon().arrow !== null, { maxMs: 4_000, label: "the arrow up" });
  expect((await app.now()) - t0, "the arrow waits 2 s").toBeGreaterThanOrEqual(2000);
  // It follows the head loosely: let it settle.
  await app.step(60);
  return (await summon(page)).arrow!;
}

test("a fingertip poke on Settings opens it, and Done comes back home", async ({ boot }) => {
  const app = await boot();
  await app.poke("home-settings");
  await app.stepUntil((ns) => ns.state().screen === "settings", { maxMs: 5_000, label: "settings after the poke" });
  const s = await app.state();
  expect(s.buttons.map((b) => b.id)).toContain("settings-done");
  // Every menu button is at least 40 mm tall (comfort envelope).
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 2_000, label: "settings at rest" });
  for (const b of (await app.state()).buttons) expect(Math.min(b.size[0], b.size[1]), b.id).toBeGreaterThanOrEqual(0.04);
  await app.poke("settings-done");
  await app.stepUntil((ns) => ns.state().screen === "home", { maxMs: 5_000, label: "home after Done" });
  const events = await app.events();
  expect(events.filter((e) => e.type === "press").map((e) => (e as { id: string }).id)).toEqual(["home-settings", "settings-done"]);
  expect(events).toContainEqual({ type: "screen", from: "home", to: "settings" });
  expect(events).toContainEqual({ type: "screen", from: "settings", to: "home" });
});

test("a stepper changes the setting live and the box follows its size", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => (window as any).__ns.ui.go("settings"));
  expect((await app.state()).box.sizeM).toBeCloseTo(0.24, 6);
  await app.poke("box-up");
  await app.stepUntil((ns) => ns.ui.settings().boxSizeCm === 26, { maxMs: 2_000, label: "box size 26 cm" });
  expect((await app.state()).box.sizeM).toBeCloseTo(0.26, 6);
  expect(await page.evaluate(() => (window as any).__ns.ui.text("box-value"))).toBe("26 cm");
  expect(await app.events("slider")).toEqual([{ type: "slider", id: "box-up", k: 8 / 12 }]);
  // A toggle latches and lights its cap.
  await app.poke("toggle-motion");
  await app.stepUntil((ns) => ns.ui.settings().reducedMotion === true, { maxMs: 2_000, label: "less motion on" });
  expect(await page.evaluate(() => (window as any).__ns.ui.key("toggle-motion").lit)).toBe(true);
});

test("Recenter places the box again in front of where the head looks now", async ({ page, boot }) => {
  const app = await boot();
  const first = (await app.state()).boxPose;
  await app.poke("home-settings");
  await app.stepUntil((ns) => ns.state().screen === "settings", { maxMs: 5_000, label: "settings" });
  // The player turns a quarter to the left and leans a little.
  await page.evaluate(setHeadset, { position: { x: 0.1, y: 1.15, z: -1.38 }, lookAt: { x: -1, y: 0.9, z: -1.38 } });
  await app.step(2);
  expect((await app.state()).boxPose).toEqual(first);
  await app.poke("settings-recenter");
  await app.stepUntil((ns) => Math.abs(ns.state().boxPose.yaw - Math.PI / 2) < 0.01, { maxMs: 2_000, label: "box turned with the head" });
  const s = await app.state();
  const head = s.head!;
  expect(s.boxPose.position[0]).toBeCloseTo(head[0] - 0.55, 3);
  expect(s.boxPose.position[2]).toBeCloseTo(head[2], 3);
  expect(head[1] - s.boxPose.position[1]).toBeCloseTo(0.28, 3);
  for (let i = 0; i < 3; i++) expect(s.box.world![i]).toBeCloseTo(s.boxPose.position[i]!, 4);
  // The settings panel moved with it once the finger left (it stands on the box's drawer).
  await app.stepUntil((ns) => !ns.ui.layoutHeld(), { maxMs: 2_000, label: "panel follows the box" });
  const done = (await app.state()).buttons.find((b) => b.id === "settings-done")!.world;
  expect(done[0]).toBeLessThan(head[0] - 0.12);
  expect(done[0]).toBeGreaterThan(head[0] - 0.55);
});

test("without passthrough the game runs in VR", async ({ page, boot }) => {
  const app = await boot({ enterXR: false });
  await page.evaluate(() => (window as any).__ns.world.launchXR({ sessionMode: "immersive-vr" }));
  await app.stepUntil((ns) => ns.state().xr.presenting && ns.state().boxPose.source !== "default", { maxMs: 5_000 });
  const s = await app.state();
  expect(s.xr.sessionMode).toBe("immersive-vr");
  expect(s.xr.blendMode).toBe("opaque");
  expect(s.box.visible).toBe(true);
});

test("__ns.clock steps frames on the virtual clock", async ({ page, boot }) => {
  await boot();
  const c = await page.evaluate(() => {
    const ns = (window as any).__ns;
    const t0 = ns.clock.now();
    const t1 = ns.clock.step(100);
    return { paused: ns.clock.paused, t0, t1, t2: ns.clock.now() };
  });
  expect(c.paused).toBe(true);
  expect(c.t1 - c.t0).toBeCloseTo(100, 6);
  expect(c.t2).toBe(c.t1);
});

test("when storage is unavailable the game still starts and says once that progress is not saved", async ({ page, boot }) => {
  await page.addInitScript(() => Object.defineProperty(window, "indexedDB", { value: undefined }));
  const app = await boot();
  const s = await app.state();
  expect(s.persistent).toBe(false);
  // Home shows it once in the headset, which clears it.
  expect(await page.evaluate(() => (window as any).__ns.ui.text("home-notice-text"))).toBe(NOT_SAVED_NOTICE);
  expect(s.notice).toBeNull();
  await page.evaluate(() => (window as any).__ns.ui.setSettings({ musicVol: 0.5 }));
  await app.step(10); // a save happens
  expect(await app.events("notice")).toEqual([{ type: "notice", text: NOT_SAVED_NOTICE }]);
});

test.describe("offline guard", () => {
  test.use({ allowedHosts: ["fetch.example.invalid", "ws.example.invalid", "popup.example.invalid"] });

  test("sees fetches, WebSockets and popups from the page", async ({ page, boot }) => {
    const app = await boot({ enterXR: false });
    await page.evaluate(() => {
      fetch("https://fetch.example.invalid/x").catch(() => {});
      try {
        new WebSocket("wss://ws.example.invalid/socket");
      } catch {
        // the event still fires
      }
      window.open("https://popup.example.invalid/");
    });
    await expect
      .poll(() => app.foreignHosts())
      .toEqual(["fetch.example.invalid", "popup.example.invalid", "ws.example.invalid"]);
  });
});

test("headset: looking away at launch still puts the box in front", async ({ page, boot }) => {
  // The session starts with the head turned 70 degrees to the left, and it turns to face forward.
  const app = await boot({ enterXR: false, head: turnedLeft(SEATED, 70) });
  await app.waitReal((_ns, w) => w.IWER_DEVICE.sessionOffered === true, { label: "XR session offer" });
  await app.command("accept_session");
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR presenting" });
  await page.evaluate(relaxIwer);
  for (let deg = 60; deg >= 0; deg -= 10) {
    await page.evaluate(setHeadset, turnedLeft(SEATED, deg));
    await app.step(3);
    const st = await app.state();
    expect(st.boxPose.source, `${deg} degrees left: not placed while the head turns`).toBe("default");
    // Nothing shows before it is placed: neither the box nor a menu panel.
    expect(st.box.visible, `${deg} degrees left: the box hidden`).toBe(false);
    expect(await page.evaluate(() => window.__ns!.ui.slabCount()), `${deg} degrees left: no panel`).toBe(0);
  }
  const still = await app.now();
  await app.stepUntil((ns) => ns.state().boxPose.source === "head", { maxMs: 3_000, label: "the box placed" });
  expect((await app.now()) - still).toBeGreaterThanOrEqual(400);
  // In front, where the head faces now (SEATED looks down -z: heading 0), not where it faced at the start.
  const st = await app.state();
  expect(st.boxPose.yaw).toBeCloseTo(0, 2);
  expect(st.boxPose.tiltDeg).toBe(10);
  expect(st.box.visible).toBe(true);
  await app.stepUntil((ns) => ns.state().screen === "home" && !ns.ui.busy(), { maxMs: 3_000, label: "Home up" });
  expect(await page.evaluate(() => window.__ns!.ui.slabCount())).toBeGreaterThan(0);
});

test("headset: the box never moves on its own; the arrow shows instead, and Quest's own recenter still works", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await page.evaluate(() => window.__ns!.scene.show({ n: 1 }));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const first = (await app.state()).boxPose;
  expect((await summon(page)).arrow).toBeNull();
  // Looking away for 10 s: the box stays where it was placed.
  await lookAwayForArrow(app, page);
  const t0 = await app.now();
  await app.stepUntil((_ns, w, end) => w.__vt.now >= end, { arg: t0 + 8_000, maxMs: 9_000, label: "10 s looking away" });
  expect((await app.state()).boxPose).toEqual(first);
  // The arrow costs one draw call while it shows, and the frame stays within the play budget (the box is out of view).
  const sm = await summon(page);
  expect(sm.arrow).not.toBeNull();
  expect(sm.calls).toBe(1);
  await page.evaluate(() => window.__ns!.resetPerf());
  await app.step(5);
  const perf = await app.perf();
  console.log(`headset looking away: the arrow up, ${perf.callsMax} draw calls a frame at most (both views)`);
  expect(perf.callsMax).toBeLessThanOrEqual(50);
  // Quest's own recenter (hold the Meta button) resets the reference space: the box comes in front at once.
  await page.evaluate(() => (window.__ns!.world as any).renderer.xr.getReferenceSpace().dispatchEvent(new Event("reset")));
  await app.stepUntil((ns, _w, y) => Math.abs(ns.state().boxPose.yaw - y) < 0.01, { arg: AWAY_YAW, maxMs: 1_000, label: "the box in front after the reset" });
  await app.step(2);
  expect((await summon(page)).arrow).toBeNull();
  expect((await summon(page)).fade).toBe(0);
});

test("headset: the arrow brings the box back and keeps the solve state", async ({ page, boot }) => {
  const app = await boot();
  // A left-handed player: the box is mirrored.
  await page.evaluate(() => window.__ns!.ui.setSettings({ handed: "left" }));
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 2 }));
  await app.stepUntil((_ns, w) => w.__sl.session.state()?.stage === "playing" && w.__sl.session.state().revealed, { maxMs: 10_000, label: "box 2 in play" });
  const s = (await page.evaluate(() => window.__sl!.session.state()))!;
  expect((await page.evaluate(() => window.__ns!.scene.box()))!.mirrored).toBe(true);
  const lock = s.locks.find((l) => !l.finger)!;
  await page.evaluate((L) => window.__sl!.placeLantern(L), lock.spot);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock.i, maxMs: 2_000, batch: 1, label: "a lock open" });
  const before = { pose: (await app.state()).boxPose, lantern: (await page.evaluate(() => window.__sl!.lantern())).pos, open: (await page.evaluate(() => window.__sl!.session.state()))!.open };
  const arrow = await lookAwayForArrow(app, page);
  expect((await app.state()).boxPose).toEqual(before.pose);
  const h = (await app.state()).head!;
  expect(dist(arrow, h)).toBeCloseTo(0.45, 2);
  // Record the fade and the arrow each frame while a hand pinches the arrow.
  await page.evaluate(() => {
    const w = window as any;
    w.__summonTrail = [];
    if (!w.__summonOn) {
      const step = w.__vt.step.bind(w.__vt);
      w.__vt.step = (ms: number) => {
        const r = step(ms);
        if (w.__summonTrail) {
          const x = w.__sl.summon();
          w.__summonTrail.push({ phase: x.phase, fade: x.fade, calls: x.calls, yaw: w.__ns.state().boxPose.yaw });
        }
        return r;
      };
      w.__summonOn = true;
    }
  });
  const hand = new Hands(app, "right");
  await hand.pinchAt(arrow);
  await app.stepUntil((ns, w, y) => w.__sl.summon().phase === "idle" && Math.abs(ns.state().boxPose.yaw - y) < 0.01, { arg: AWAY_YAW, maxMs: 2_000, label: "the box brought back" });
  const trail: { phase: string; fade: number; calls: number; yaw: number }[] = await page.evaluate(() => (window as any).__summonTrail);
  // A fade out to black and back in, the box moved while it was dark (no slide), never more than one extra draw call.
  const peak = Math.max(...trail.map((t) => t.fade));
  expect(peak).toBe(1);
  const moved = trail.findIndex((t) => Math.abs(t.yaw - before.pose.yaw) > 1e-6);
  expect(moved).toBeGreaterThan(0);
  expect(trail[moved]!.fade, "the box moves on the frame the view is dark").toBe(1);
  expect(trail[moved - 1]!.fade, "after fading out").toBeGreaterThan(0);
  expect(Math.max(...trail.map((t) => t.calls))).toBeLessThanOrEqual(1);
  // In front of the head now, and everything in the box as it was: the lantern, the open lock, the mirror.
  const st = await app.state();
  expect(st.boxPose.yaw).toBeCloseTo(AWAY_YAW, 2);
  expect(dist((await page.evaluate(() => window.__sl!.lantern())).pos, before.lantern)).toBeLessThan(1e-9);
  expect((await page.evaluate(() => window.__sl!.session.state()))!.open).toEqual(before.open);
  expect((await page.evaluate(() => window.__ns!.scene.box()))!.mirrored).toBe(true);
  expect((await summon(page)).arrow).toBeNull();
  expect(app.consoleLines.filter((l) => l.includes("box out of view: brought back by the arrow"))).toHaveLength(1);
  await hand.release();
});

test("headset: a controller's trigger with its ray on the arrow brings the box back", async ({ page, boot }) => {
  const app = await boot();
  const arrow = await lookAwayForArrow(app, page);
  await app.queue("set_input_mode", { mode: "controller" });
  await app.settle();
  // The right controller 25 cm from the arrow, its ray turned onto it (read back from the ray it gives, and corrected).
  const h = (await app.state()).head!;
  const at: Vec3 = add(arrow, unit(sub(h, arrow)), 0.25);
  const rayOf = () =>
    page.evaluate(() => {
      const r = (window.__ns!.world as any).player.raySpaces.right;
      r.updateWorldMatrix(true, false);
      const e = r.matrixWorld.elements;
      const l = Math.hypot(e[8], e[9], e[10]);
      return { o: [e[12], e[13], e[14]] as V3, d: [-e[8] / l, -e[9] / l, -e[10] / l] as V3 };
    });
  let q: Quat = { x: 0, y: 0, z: 0, w: 1 };
  for (let i = 0; i < 4; i++) {
    await app.queue("set_transform", { device: "controller-right", position: { x: at[0], y: at[1], z: at[2] }, orientation: q });
    await app.settle(10_000, 2);
    const r = await rayOf();
    q = turnQuat(q, r.d, unit(sub(arrow, r.o)));
  }
  await app.queue("set_transform", { device: "controller-right", position: { x: at[0], y: at[1], z: at[2] }, orientation: q });
  await app.settle(10_000, 2);
  const r = await rayOf();
  const v = sub(arrow, r.o), t = v[0] * r.d[0] + v[1] * r.d[1] + v[2] * r.d[2];
  const off = Math.sqrt(Math.max(0, v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - t * t));
  console.log(`controller ray: ${off.toFixed(4)} m off the arrow's middle, ${dist(r.o, arrow).toFixed(3)} m from it`);
  expect(off).toBeLessThan(0.02);
  // Not taken by being near: only the trigger takes it.
  expect((await summon(page)).phase).toBe("arrow");
  await app.queue("set_gamepad_state", { device: "controller-right", buttons: [{ index: 0, value: 1 }] });
  await app.stepUntil((ns, w, y) => w.__sl.summon().phase === "idle" && Math.abs(ns.state().boxPose.yaw - y) < 0.01, { arg: AWAY_YAW, maxMs: 2_000, label: "the box brought back" });
  await app.queue("set_gamepad_state", { device: "controller-right", buttons: [{ index: 0, value: 0 }] });
  await app.settle();
});
