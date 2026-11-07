// The look on a Quest 2, whose passthrough is grey and grainy: the same frames composited over the room as Quest 3
// shows it (colour) and as Quest 2 does (greyscale, flatter, with sensor grain), on IWER's Quest 2 profile
// (helpers/headset.ts). The game draws the same on both headsets (the older Quests only run at 72 Hz:
// src/app/headset.ts), so each pair shows the room changing under the same picture: the room's dimming, the lantern's
// warm light, the gold and the shadows against a grey room. Shots: test-results/shots/q2look-<name>-{colour,grey}.png.
import fs from "node:fs";
import path from "node:path";
import { generateBox } from "../../src/core/generator";
import { emulateHeadset } from "./helpers/headset";
import type { XYZ } from "./helpers/page-scripts";
import { expect, test } from "./helpers/test";
import { DT, SHOTS_DIR, type XrApp } from "./helpers/xr-app";

/** Quest 2 shows about 20 pixels per degree in the middle of its view. */
const PPD = 20;

/**
 * One frame of `app` composited twice: over the room in colour, and over it as Quest 2's passthrough shows it
 * (greyscale, lower contrast, a fixed grain). With `target`, the view narrowed to PPD and turned to it first, as
 * XrApp.captureHeadset does. Saves q2look-<name>-colour.png and -grey.png; returns the mean luma of the room in each
 * composite's top corners (nothing of the game is drawn there) for the record.
 */
async function pair(app: XrApp, name: string, target?: XYZ): Promise<{ colour: number; grey: number }> {
  const res = await app.page.evaluate(
    ({ dt, target, ppd }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const d = w.IWER_DEVICE;
      const was = { fovy: d.fovy as number, q: [d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w] };
      const canvas = w.__ns.world.renderer.domElement as HTMLCanvasElement;
      if (target) {
        d.fovy = ((canvas.height / ppd) * Math.PI) / 180;
        const p = d.position, dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
        const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
        w.__vt.step(dt);
        w.__vt.step(dt);
      }
      w.__nsRoomFrame = true;
      try {
        w.__vt.step(dt);
      } finally {
        w.__nsRoomFrame = false;
      }
      const env = w.IWER_DEVICE.sem.environmentCanvas as HTMLCanvasElement;
      const W = canvas.width, H = canvas.height;
      const compose = (grey: boolean) => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.fillStyle = "#000";
        g.fillRect(0, 0, W, H);
        if (grey) g.filter = "grayscale(1) contrast(0.8) brightness(0.92)";
        g.drawImage(env, 0, 0, W, H);
        g.filter = "none";
        if (grey) {
          // Sensor grain: a fixed pattern (the same in every shot), about +-10 levels of luma.
          const img = g.getImageData(0, 0, W, H);
          let s = 12345;
          for (let i = 0; i < img.data.length; i += 4) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const n = ((s >> 8) % 21) - 10;
            for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k]! + n));
          }
          g.putImageData(img, 0, 0);
        }
        g.drawImage(canvas, 0, 0, W, H);
        const px = g.getImageData(0, 0, W, Math.floor(H * 0.2)).data;
        let l = 0, n = 0;
        for (let y = 0; y < Math.floor(H * 0.2); y += 3) {
          for (let x = 0; x < W; x += 3) {
            if (x > W * 0.15 && x < W * 0.85) continue;
            const i = (y * W + x) * 4;
            l += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
            n++;
          }
        }
        return { url: c.toDataURL("image/png"), luma: l / Math.max(1, n) };
      };
      const colour = compose(false), grey = compose(true);
      if (target) {
        d.fovy = was.fovy;
        d.quaternion.set(was.q[0], was.q[1], was.q[2], was.q[3]);
      }
      return { colour, grey };
    },
    { dt: DT, target: target ?? null, ppd: PPD },
  );
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const k of ["colour", "grey"] as const) {
    fs.writeFileSync(path.join(SHOTS_DIR, `q2look-${name}-${k}.png`), Buffer.from(res[k].url.split(",")[1] ?? "", "base64"));
  }
  await app.step(1);
  return { colour: res.colour.luma, grey: res.grey.luma };
}

test("Quest 2 look: the menu, a box in play at a lock's spot, the lock opening in gold, the box open, against a grey room", async ({
  page,
  boot,
}) => {
  await emulateHeadset(page, "metaQuest2");
  const app = await boot({ mode: "visual" });
  expect(await page.evaluate(() => navigator.userAgent)).toContain("Quest 2");
  const panel = (await app.state()).boxPose.position;
  const target = { x: panel[0], y: panel[1], z: panel[2] };
  const rooms: string[] = [];
  const note = (name: string, r: { colour: number; grey: number }) => rooms.push(`${name} room luma ${r.colour.toFixed(0)} colour, ${r.grey.toFixed(0)} grey`);

  // The menu over the box, the room at 55%.
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "home at rest" });
  await app.step(Math.ceil(1000 / DT));
  note("menu", await pair(app, "menu-wide"));
  const home = (await page.evaluate(() => window.__ns!.ui.panelBox("home")))!;
  await pair(app, "menu-headset", { x: home.center[0], y: home.center[1], z: home.center[2] });

  // Box 5 in play (the room at 35%), from its plain lock's spot: the shadows fill the shape, the lock warms.
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const box5 = generateBox({ kind: "box", n: 5 });
  const plain = box5.locks.find((l) => !l.hidden && !l.finger)!;
  await page.evaluate(() => window.__ns!.scene.show({ n: 5 }));
  await page.evaluate((L) => window.__sl!.placeLantern(L), plain.L);
  await app.step(Math.ceil(1000 / DT));
  note("play", await pair(app, "box5-spot-wide"));
  await pair(app, "box5-spot-headset", target);
  await page.evaluate((i) => window.__sl!.setWarmth(i, 1), plain.i);
  await app.step(40);
  await pair(app, "box5-warm-headset", target);
  // The lock opening in gold, then open.
  await page.evaluate((i) => window.__sl!.setOpen(i), plain.i);
  await app.step(Math.round(200 / DT));
  await pair(app, "box5-opening-headset", target);
  await app.step(40);
  await pair(app, "box5-open-headset", target);

  // Box 1 played to its opening: the room comes up, the reward glows.
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 1 }));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "box 1 in play" },
  );
  const s = (await page.evaluate(() => window.__sl!.session.state()))!;
  await page.evaluate((L) => window.__sl!.placeLantern(L), s.locks[0]!.spot);
  await app.stepUntil((_ns, w) => w.__ns.events("box-open").length > 0, { maxMs: 4_000, dt: 100, label: "the box opens" });
  for (let t = 0; t < 2100; t += 100) await app.step(1, 100);
  note("open", await pair(app, "box1-open-wide"));
  const r = (await page.evaluate(() => window.__sl!.session.reward()))!;
  await pair(app, "box1-reward-headset", { x: r.world[0], y: r.world[1], z: r.world[2] });
  console.log(`quest2 look: ${rooms.join("; ")}`);
});
