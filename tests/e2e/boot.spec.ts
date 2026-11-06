import { expect, test } from "./helpers/test";

test("boots into XR with the box in the lap and the home panel", async ({ page, boot }, testInfo) => {
  const app = await boot({ mode: "visual" });
  const s = await app.state();
  // The XR session was offered and accepted (boot accepts IWER's offer the way a player would).
  expect(s.screen).toBe("home");
  expect(s.xr.presenting).toBe(true);
  expect(s.xr.sessionMode).toBe("immersive-ar");
  expect(app.bootVirtualMs).toBeLessThanOrEqual(10_000);

  // The box is an entity in the scene, its back panel 55 cm in front of the seated head and 28 cm
  // below the eyes, at the default box size.
  expect(s.box.exists).toBe(true);
  expect(s.box.visible).toBe(true);
  expect(s.box.sizeM).toBeCloseTo(0.24, 6);
  expect(s.boxPose.source).toBe("head");
  const head = s.head!;
  const [x, y, z] = s.boxPose.position;
  expect(Math.hypot(x - head[0], z - head[2])).toBeCloseTo(0.55, 3);
  expect(head[1] - y).toBeCloseTo(0.28, 3);
  for (let i = 0; i < 3; i++) expect(s.box.world![i]).toBeCloseTo(s.boxPose.position[i]!, 4);

  // The home panel springs in with a body; its keys are full size (at least 40 mm) once at rest.
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 2_000, label: "home panel at rest" });
  const rest = await app.state();
  // Home on the open drawer: Continue, the Daily Box, Lessons, Collection, Settings (no trial row in v1).
  expect(rest.buttons.map((b) => b.id).sort()).toEqual(["home-collection", "home-continue", "home-daily", "home-lessons", "home-settings"]);
  for (const b of rest.buttons) expect(b.size[1]).toBeGreaterThanOrEqual(0.04);
  expect(await page.evaluate(() => window.__ns!.ui.drawer().state)).toBe("open");
  expect(await page.evaluate(() => window.__ns!.ui.slabCount())).toBe(1);
  await app.capture("boot-home");
  await app.captureHeadset("boot-home-headset", { x, y, z });

  const perf = await app.perf();
  expect(perf.frames).toBeGreaterThan(0);
  expect(Object.keys(perf.systems).sort()).toEqual(["drawer", "hand-pinch", "hands", "lantern", "menus", "shell", "sound"]);
  // Offline: nothing but the local server was asked for anything, and the Quest 3 controller
  // models came from our own origin.
  expect(app.foreignHosts()).toEqual([]);
  expect(app.requested("/input-profiles/meta-quest-touch-plus/left.glb")).toBe(true);
  expect(app.requested("/input-profiles/meta-quest-touch-plus/right.glb")).toBe(true);
  // No console errors at all, from the page or the app.
  expect(app.consoleLines.filter((l) => l.startsWith("error:") || l.startsWith("PAGEERROR"))).toEqual([]);
  expect(await page.title()).toBe("Shadow Locks");
  testInfo.annotations.push({
    type: "timing",
    description: `boot ${app.bootRealMs} ms real, ${app.bootVirtualMs.toFixed(0)} ms virtual from XR entry; calls ${perf.calls}, triangles ${perf.triangles}, our systems ${perf.frameMsAvg.toFixed(3)} ms/frame avg over ${perf.frames} frames (${Object.entries(perf.systems)
      .map(([name, t]) => `${name} ${t.avgMs.toFixed(3)} avg, ${t.maxMs.toFixed(1)} max`)
      .join("; ")})`,
  });
  console.log(testInfo.annotations.at(-1)?.description);
});
