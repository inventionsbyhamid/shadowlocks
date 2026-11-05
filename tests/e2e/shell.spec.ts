/* eslint-disable @typescript-eslint/no-explicit-any */
import { NOT_SAVED_NOTICE } from "../../src/app/profile-store";
import { setHeadset } from "./helpers/page-scripts";
import { expect, test } from "./helpers/test";

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
  // The player turns a quarter to the left and leans a little.
  await page.evaluate(setHeadset, { position: { x: 0.1, y: 1.15, z: -1.38 }, lookAt: { x: -1, y: 0.9, z: -1.38 } });
  await app.step(2);
  expect((await app.state()).boxPose).toEqual(first);
  await app.poke("home-recenter");
  await app.stepUntil((ns) => Math.abs(ns.state().boxPose.yaw - Math.PI / 2) < 0.01, { maxMs: 2_000, label: "box turned with the head" });
  const s = await app.state();
  const head = s.head!;
  expect(s.boxPose.position[0]).toBeCloseTo(head[0] - 0.55, 3);
  expect(s.boxPose.position[2]).toBeCloseTo(head[2], 3);
  expect(head[1] - s.boxPose.position[1]).toBeCloseTo(0.28, 3);
  for (let i = 0; i < 3; i++) expect(s.box.world![i]).toBeCloseTo(s.boxPose.position[i]!, 4);
  // The home panel moved with it (it sits in front of the box).
  expect(s.buttons.find((b) => b.id === "home-settings")!.world[0]).toBeLessThan(head[0] - 0.3);
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
