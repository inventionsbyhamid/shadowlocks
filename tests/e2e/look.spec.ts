// e2e: exclusive (its theatre test reads the fade frame by frame and its shots run long: run alone on the server)
// The look, as the owner and the judges see it: headset-density shots (25 px per degree) of the box in the lap
// and wide shots of the room around it. Box 1 as the player first meets it, box 5 (three locks, one a hidden
// silhouette) lit from a lock's spot and warming, a lock opening in gold, box 3's finger lock filling with gold,
// box 15's upper locks under the glass lid, and the menu. Shots go to test-results/shots/look-*.png.
// The theatre lights: the room at 55% in menus, 35% in play, full with dimming off, a studio without passthrough.
import type { Page } from "@playwright/test";
import { generateBox } from "../../src/core/generator";
import type { V3 } from "../../src/core/types";
import { installCapture } from "./helpers/page-scripts";
import { expect, test } from "./helpers/test";
import { DT, type XrApp } from "./helpers/xr-app";

/** Put the lantern (box units) and step a frame, so its view and the shadows have caught up. */
async function place(app: XrApp, p: V3): Promise<void> {
  await app.page.evaluate((q) => window.__sl!.placeLantern(q), p);
  await app.step(1);
}

/**
 * How much of the room's light shows, read from the rendered pixels after one frame: in the top corners of the view
 * (walls and window; nothing of the game is drawn there), the page's alpha (the veil's opacity: what the headset
 * shows of the room is what the page leaves transparent), and the room's luma through the page against the room's
 * own (the capture's composite, as the emulator lays the page over the room).
 */
function roomLight(page: Page): Promise<{ veil: number; share: number }> {
  return page.evaluate((dt) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    // The synthetic room is drawn only in frames that read it (page-scripts roomOnCaptureOnly), as XrApp.capture does.
    w.__nsRoomFrame = true;
    try {
      w.__vt.step(dt);
    } finally {
      w.__nsRoomFrame = false;
    }
    const app = w.__ns.world.renderer.domElement as HTMLCanvasElement;
    const env = w.IWER_DEVICE.sem.environmentCanvas as HTMLCanvasElement;
    const W = app.width, H = app.height;
    const read = (draw: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      draw(g);
      return g.getImageData(0, 0, W, H).data;
    };
    const own = read((g) => g.drawImage(app, 0, 0, W, H));
    const room = read((g) => g.drawImage(env, 0, 0, W, H));
    const both = read((g) => {
      g.drawImage(env, 0, 0, W, H);
      g.drawImage(app, 0, 0, W, H);
    });
    let alpha = 0, lumRoom = 0, lumBoth = 0, n = 0;
    const luma = (d: Uint8ClampedArray, i: number) => 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    for (let y = 0; y < Math.floor(H * 0.3); y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (x > W * 0.15 && x < W * 0.85) continue;
        const i = (y * W + x) * 4;
        alpha += own[i + 3]! / 255;
        lumRoom += luma(room, i);
        lumBoth += luma(both, i);
        n++;
      }
    }
    return { veil: alpha / n, share: lumBoth / lumRoom };
  }, DT);
}

/** The menus away and the box in play: the screen the theatre dims for. */
async function inPlay(app: XrApp): Promise<void> {
  await app.page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
}

test("look shots: the menu, box 1, box 5 at a spot and warming, a lock opening, the finger's gold, box 15 under the lid", async ({ page, boot }) => {
  const app = await boot({ mode: "visual" });
  const panel = (await app.state()).boxPose.position;
  const target = { x: panel[0], y: panel[1], z: panel[2] };
  // The menu over the box (the home screen), once its panel is at rest and any fade has run.
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "home at rest" });
  await app.step(Math.ceil(1000 / DT));
  await app.capture("look-menu-wide");
  // The menu panel itself (it stands on the drawer at the plinth, below the box's middle), wide enough to hold it.
  const home = (await page.evaluate(() => window.__ns!.ui.panelBox("home")))!;
  await app.captureHeadset("look-menu-headset", { x: home.center[0], y: home.center[1], z: home.center[2] }, 18);

  await inPlay(app);
  // Box 1 as the player first meets it: the lantern at its start.
  await page.evaluate(() => window.__ns!.scene.show({ n: 1 }));
  await app.step(Math.ceil(1000 / DT));
  await app.captureHeadset("look-box1-start-headset", target);
  await app.capture("look-box1-start-wide");

  // Box 5 from its first shown lock's spot, then that lock warming.
  const box5 = generateBox({ kind: "box", n: 5 });
  const shown = box5.locks.find((l) => !l.hidden)!;
  await page.evaluate(() => window.__ns!.scene.show({ n: 5 }));
  await place(app, shown.L);
  await app.step(10);
  await app.captureHeadset("look-box5-spot-headset", target);
  await app.capture("look-box5-spot-wide");
  await page.evaluate((i) => window.__sl!.setWarmth(i, 0.8), shown.i);
  await app.step(40);
  await app.captureHeadset("look-box5-warm-headset", target);

  // The lock opening: its gold fill part way up, then full.
  await page.evaluate((i) => window.__sl!.setOpen(i), shown.i);
  await app.step(Math.round(200 / DT));
  await app.captureHeadset("look-lock-opening-headset", target);
  await app.step(40);
  await app.captureHeadset("look-lock-open-headset", target);

  // The hero shots: box 5's plain lock (shown, no finger) from its spot, the shape filled by its shadows, warming,
  // then opening in gold over them.
  const plain = box5.locks.find((l) => !l.hidden && !l.finger)!;
  await page.evaluate(() => window.__ns!.scene.show({ n: 5 }));
  await place(app, plain.L);
  await app.step(10);
  await app.captureHeadset("look-hero-spot-headset", target);
  // The panel alone (what hangs in the box hidden): from its spot the shadows fill the shape.
  await page.evaluate(() => window.__sl!.showHanging(false));
  await app.captureHeadset("look-hero-spot-panel-headset", target);
  await page.evaluate(() => window.__sl!.showHanging(true));
  await page.evaluate((i) => window.__sl!.setWarmth(i, 1), plain.i);
  await app.step(40);
  await app.captureHeadset("look-hero-warm-headset", target);
  await page.evaluate((i) => window.__sl!.setOpen(i), plain.i);
  await app.step(Math.round(200 / DT));
  await app.captureHeadset("look-hero-opening-headset", target);
  await app.step(40);
  await app.captureHeadset("look-hero-open-headset", target);
  await app.capture("look-hero-open-wide");
  await page.evaluate(() => window.__sl!.showHanging(false));
  await app.captureHeadset("look-hero-open-panel-headset", target);
  await page.evaluate(() => window.__sl!.showHanging(true));

  // Box 3's finger lock: the gold fill 200 ms in, then the piece formed.
  const box3 = generateBox({ kind: "box", n: 3 });
  const finger = box3.locks.find((l) => l.finger)!;
  await page.evaluate(() => window.__ns!.scene.show({ n: 3 }));
  await place(app, finger.L);
  await page.evaluate((i) => window.__sl!.crystallise(i, 0.45), finger.i);
  await app.step(Math.round(200 / DT) - 3);
  await app.captureHeadset("look-finger-fill-headset", target);
  await app.step(Math.ceil(600 / DT));
  await app.captureHeadset("look-finger-piece-headset", target);

  // Box 15: its upper locks lie under the smoked glass lid from the seated eye.
  const box15 = generateBox({ kind: "box", n: 15 });
  const upper = box15.locks.reduce((a, b) => (b.center[1] > a.center[1] ? b : a));
  await page.evaluate(() => window.__ns!.scene.show({ n: 15 }));
  await place(app, upper.L);
  await app.step(4);
  await app.captureHeadset("look-box15-upper-headset", target);
  expect((await app.state()).screen).toBe("play");
});

/** The theatre's veil opacity as the scene draws it (0 while hidden). */
const veilNow = (page: Page): Promise<number> =>
  page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (window.__ns!.world as any).scene.getObjectByName("Theatre Veil");
    return v.visible ? (v.material.opacity as number) : 0;
  });

test("theatre lights: the room at 55% with a menu up, 35% in play, back up smoothly, and full with dimming off", async ({ page, boot }) => {
  const app = await boot({ mode: "visual" });
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "home at rest" });
  await app.step(Math.ceil(1000 / DT));
  const menu = await roomLight(page);
  await app.capture("look-theatre-menu-wide");

  // Into play: the light goes down over 0.8 s, a little every frame, never a jump.
  await page.evaluate(() => window.__ns!.ui.go("play"));
  const fade: number[] = [];
  for (let i = 0; i < Math.ceil(900 / DT); i++) {
    await app.step(1);
    fade.push(await veilNow(page));
  }
  const play = await roomLight(page);
  await app.capture("look-theatre-play-wide");
  for (let i = 1; i < fade.length; i++) {
    expect(fade[i]!).toBeGreaterThanOrEqual(fade[i - 1]! - 1e-6);
    expect(fade[i]! - fade[i - 1]!).toBeLessThan(0.03);
  }
  expect(fade.at(-1)).toBeCloseTo(0.65, 3);

  // Room dimming off (the setting): the light comes all the way up.
  await page.evaluate(() => window.__ns!.ui.setSettings({ dimming: false }));
  await app.step(Math.ceil(1000 / DT));
  const off = await roomLight(page);
  await app.capture("look-theatre-off-wide");
  await page.evaluate(() => window.__ns!.ui.setSettings({ dimming: true }));

  console.log(
    `theatre: veil ${menu.veil.toFixed(3)} / ${play.veil.toFixed(3)} / ${off.veil.toFixed(3)} (menu / play / off); ` +
      `room luma kept ${menu.share.toFixed(3)} / ${play.share.toFixed(3)} / ${off.share.toFixed(3)}`,
  );
  // What the page leaves of the room: 55% with a menu up, 35% in play, all of it with dimming off.
  expect(menu.veil).toBeCloseTo(0.45, 1);
  expect(play.veil).toBeCloseTo(0.65, 1);
  expect(off.veil).toBeLessThan(0.01);
  expect(menu.share).toBeGreaterThan(0.5);
  expect(menu.share).toBeLessThan(0.62);
  expect(play.share).toBeGreaterThan(0.33);
  expect(play.share).toBeLessThan(0.42);
  expect(off.share).toBeGreaterThan(0.97);
  // Without passthrough there is no room to dim: the studio shows instead (and only then).
  const studio = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.evaluate(() => (window.__ns!.world as any).scene.getObjectByName("Theatre Room").visible as boolean);
  expect(await studio()).toBe(false);
});

test("without passthrough the theatre shows its studio and dims it the same way", async ({ page, boot }) => {
  const app = await boot({ mode: "visual", enterXR: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window.__ns!.world as any).launchXR({ sessionMode: "immersive-vr" }));
  await app.stepUntil((ns) => ns.state().xr.presenting && ns.state().boxPose.source !== "default", { maxMs: 5_000 });
  // boot() installs the capture only when it enters XR itself.
  await page.evaluate(installCapture);
  expect((await app.state()).xr.blendMode).toBe("opaque");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const studio = () => page.evaluate(() => (window.__ns!.world as any).scene.getObjectByName("Theatre Room").visible as boolean);
  expect(await studio()).toBe(true);
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await page.evaluate(() => window.__ns!.scene.show({ n: 5 }));
  await app.step(Math.ceil(1000 / DT));
  expect(await veilNow(page)).toBeCloseTo(0.65, 3);
  await app.capture("look-vr-studio-wide");
  const box = (await app.state()).boxPose.position;
  await app.captureHeadset("look-vr-studio-headset", { x: box[0], y: box[1], z: box[2] });
});

test("celebrations: a lock opening with its glints, the box opening and the light coming up, the reward's glow, the next box dims again", async ({
  page,
  boot,
}) => {
  const app = await boot({ mode: "visual" });
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 1 }));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "box 1 in play" },
  );
  await app.step(Math.ceil(1000 / DT));
  expect(await veilNow(page)).toBeCloseTo(0.65, 3);
  const s = (await page.evaluate(() => window.__sl!.session.state()))!;
  const panel = (await app.state()).boxPose.position;
  const at = { x: panel[0], y: panel[1], z: panel[2] };
  // Frames of 100 ms of play (the session's longest step), as session.spec.ts does: the sequence in few rendered frames.
  const playFor = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) await app.step(1, 100);
  };
  const sparkle = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (window.__ns!.world as any).scene.getObjectByName("Lock Sparkle");
      return p.visible as boolean;
    });
  await page.evaluate((L) => window.__sl!.placeLantern(L), s.locks[0]!.spot);
  await app.stepUntil((_ns, w) => w.__sl.session.state().open.includes(0), { maxMs: 2_000, batch: 1, label: "lock I open" });
  // The sunburst, then the first glint a third of a second on (the box's flash budget), the glitter rising.
  await playFor(200);
  await app.captureHeadset("look-celebrate-lock-burst-headset", at);
  await playFor(300);
  expect(await sparkle()).toBe(true);
  await app.captureHeadset("look-celebrate-lock-glints-headset", at);
  // The box opens: the sweep, the room's light coming up, the walls and lid lifting away.
  await app.stepUntil((_ns, w) => w.__ns.events("box-open").length > 0, { maxMs: 3_000, dt: 100, label: "the box opens" });
  await playFor(300);
  await app.captureHeadset("look-celebrate-box-sweep-headset", at);
  await playFor(1100);
  await app.captureHeadset("look-celebrate-box-walls-headset", at);
  await app.capture("look-celebrate-box-open-wide");
  expect(await veilNow(page)).toBe(0);
  // The hinged lid has faded away (it never stands behind the plate as a dark pane); the box's own lid is hidden.
  const lid = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scene = (window.__ns!.world as any).scene;
    return { open: scene.getObjectByName("Box Lid Open").parent.visible as boolean, shut: scene.getObjectByName("Box Lid").visible as boolean };
  });
  expect(lid).toEqual({ open: false, shut: false });
  // Half way up (2.1 s after the box opened) the reward's glow is at its peak; then it settles.
  await playFor(700);
  const rising = (await page.evaluate(() => window.__sl!.session.reward()))!;
  await app.captureHeadset("look-celebrate-reward-bloom-headset", { x: rising.world[0], y: rising.world[1], z: rising.world[2] });
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "reward", { maxMs: 4_000, dt: 100, label: "the reward up" });
  const r = (await page.evaluate(() => window.__sl!.session.reward()))!;
  await app.captureHeadset("look-celebrate-reward-headset", { x: r.world[0], y: r.world[1], z: r.world[2] });
  // Taken by itself after a while; the plate offers the next box (its key's corners: no dark fringe).
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "offered", { maxMs: 9_000, dt: 100, label: "the reward taken" });
  await playFor(500);
  const next = (await page.evaluate(() => window.__sl!.session.keys())).find((k) => k.id === "plate-next")!;
  await app.captureHeadset("look-celebrate-plate-next-headset", { x: next.world[0], y: next.world[1], z: next.world[2] }, 60);
  // The next box: the room goes down again.
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 2 }));
  await app.stepUntil((_ns, w) => w.__sl.session.state()?.stage === "playing", { maxMs: 10_000, label: "box 2 in play" });
  await app.step(Math.ceil(1000 / DT));
  expect(await veilNow(page)).toBeCloseTo(0.65, 3);
});

test("owner's look shots: lesson 1 forming, its idle ghost hand, and Example 1 with the ghost lantern and the cradle", async ({
  page,
  boot,
}, testInfo) => {
  // A first launch goes straight into lesson 1.
  const app = await boot({ lessons: true, expectScreen: "play" });
  const inLesson = () =>
    app.stepUntil(
      (_ns, w) => {
        const s = w.__sl.session.state();
        return s?.key === "shadow-locks/lesson/l1" && s.stage === "playing" && s.revealed;
      },
      { maxMs: 10_000, label: "lesson 1 in play" },
    );
  await inLesson();
  const panel = (await app.state()).boxPose.position;
  const at = { x: panel[0], y: panel[1], z: panel[2] };
  // The box forming out of light.
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().form >= 0.5, { maxMs: 3_000, label: "the box half formed" });
  await app.captureHeadset("look-owner-lesson1-forming-headset", at);
  // Idle: the ghost hand shows how to take the lantern.
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().hand.opacity > 0.9, { maxMs: 8_000, label: "the idle ghost hand" });
  await page.evaluate(() => window.__ns!.resetPerf());
  await app.step(30);
  const idle = await app.perf();
  await app.captureHeadset("look-owner-lesson1-ghost-headset", at);
  await app.capture("look-owner-lesson1-ghost-wide");
  // Example 1 (practice, from its step): the ghost lantern swings over the twin while the player's waits in its cradle.
  await page.evaluate(() => window.__sl!.lessons.start("l1", 2, true));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.lessons.state();
      return s.park >= 1 && s.lamp.opacity > 0.9 && s.hand.opacity > 0.9;
    },
    { maxMs: 12_000, dt: 50, label: "Example 1 running, the lantern in its cradle" },
  );
  await page.evaluate(() => window.__ns!.resetPerf());
  await app.step(30);
  const example = await app.perf();
  await app.captureHeadset("look-owner-lesson1-example-headset", at);
  await app.capture("look-owner-lesson1-example-wide");
  // Draw calls, both views counted as perf-budget counts them (the busiest frame of 30).
  const line = `look, lesson 1 draw calls (both views): idle ghost ${idle.callsMax}, Example 1 ${example.callsMax}`;
  testInfo.annotations.push({ type: "draw-calls", description: line });
  console.log(line);
  expect(idle.callsMax).toBeLessThanOrEqual(100);
});
