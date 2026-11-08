// Every silhouette as the player sees it solved on the panel: in the first box that deals it, the lantern on its
// lock's spot and what hangs in the box hidden, so only the panel's shadows show, read at headset density (25 px per
// degree) as the seated eye sees the box. Each silhouette's shadow must fill its outline (the missing piece of a
// finger lock aside); crops go to test-results/shots/silhouette-<name>.png (at the spot, then opened) and all of them
// to silhouette-sheet.png, for looking at.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { generateBox } from "../../src/core/generator";
import { inPoly, segDist } from "../../src/core/geom";
import { SILHOUETTES } from "../../src/core/shapes";
import { boxSilhouettes } from "../../src/core/silhouette-deck";
import { lockSamples } from "../../src/core/solve";
import type { Lock, V2, V3, Vec3 } from "../../src/core/types";
import { outlineEdges } from "../../src/render/outline";
import { expect, test } from "./helpers/test";
import { SHOTS_DIR, type XrApp } from "./helpers/xr-app";

/** Luma (0-255) a point in full shadow stays under, as shadows.spec.ts reads it. */
const DARK = 70;
/** The crops: CELL px square each in the sheet, COLS silhouettes (two crops each) a row. */
const CELL = 240;
const COLS = 3;

/** Turn the emulated head to `target` (world metres) at 25 px per degree, run fn, put the view back. */
async function headsetView<T>(app: XrApp, target: Vec3, fn: () => Promise<T>): Promise<T> {
  const saved = await app.page.evaluate((target) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const d = w.IWER_DEVICE, canvas = w.__ns.world.renderer.domElement as HTMLCanvasElement;
    const was = { fovy: d.fovy as number, q: [d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w] };
    d.fovy = ((canvas.height / 25) * Math.PI) / 180;
    const p = d.position, dx = target[0] - p.x, dy = target[1] - p.y, dz = target[2] - p.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    return was;
  }, target);
  await app.step(2);
  try {
    return await fn();
  } finally {
    await app.page.evaluate((was) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (window as any).IWER_DEVICE;
      d.fovy = was.fovy;
      d.quaternion.set(was.q[0], was.q[1], was.q[2], was.q[3]);
    }, saved);
    await app.step(1);
  }
}

/**
 * Step a frame; read the luma at box points `probe`, and crop the square round box points `frame` (with a margin) as
 * a PNG data URL, CELL px wide. Read in the same task as the frame, as shadows.spec.ts does.
 */
function shoot(page: Page, probe: V3[], frame: V3[]): Promise<{ luma: number[]; png: string }> {
  return page.evaluate(
    ({ probe, frame, cell }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__vt.step(1000 / 72);
      const renderer = w.__ns.world.renderer, canvas = renderer.domElement as HTMLCanvasElement, xr = renderer.xr;
      const cam = xr.getCamera().cameras[0], layer = xr.getBaseLayer?.();
      const W = canvas.width, H = canvas.height;
      const sx = W / (layer?.framebufferWidth ?? W), sy = H / (layer?.framebufferHeight ?? H);
      const V = cam.matrixWorldInverse.elements as number[], P = cam.projectionMatrix.elements as number[], vp = cam.viewport;
      const px = (pts: number[][]) =>
        (w.__ns.scene.toWorld(pts) as number[][]).map(([x, y, z]) => {
          const vx = V[0]! * x! + V[4]! * y! + V[8]! * z! + V[12]!, vy = V[1]! * x! + V[5]! * y! + V[9]! * z! + V[13]!;
          const vz = V[2]! * x! + V[6]! * y! + V[10]! * z! + V[14]!;
          const cx = P[0]! * vx + P[4]! * vy + P[8]! * vz + P[12]!, cy = P[1]! * vx + P[5]! * vy + P[9]! * vz + P[13]!;
          const cw = P[3]! * vx + P[7]! * vy + P[11]! * vz + P[15]!;
          return [(vp.x + ((cx / cw + 1) / 2) * vp.z) * sx, H - (vp.y + ((cy / cw + 1) / 2) * vp.w) * sy];
        });
      const c2 = document.createElement("canvas");
      c2.width = W;
      c2.height = H;
      const g = c2.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(canvas, 0, 0);
      const data = g.getImageData(0, 0, W, H).data;
      const luma = px(probe).map(([x, y]) => {
        const i = (Math.min(H - 1, Math.max(0, Math.floor(y!))) * W + Math.min(W - 1, Math.max(0, Math.floor(x!)))) * 4;
        return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      });
      const f = px(frame), xs = f.map((p) => p[0]!), ys = f.map((p) => p[1]!);
      const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 14;
      const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
      const out = document.createElement("canvas");
      out.width = out.height = cell;
      out.getContext("2d")!.drawImage(canvas, mx - half, my - half, 2 * half, 2 * half, 0, 0, cell, cell);
      return { luma, png: out.toDataURL("image/png") };
    },
    { probe, frame, cell: CELL },
  );
}

/** Show or hide the box's smoked glass lid. */
function setGlass(page: Page, v: boolean): Promise<void> {
  return page.evaluate((v) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scene = (window.__ns!.world as any).scene;
    for (const name of ["Box Glass", "Box Lid"]) scene.getObjectByName(name).visible = v;
  }, v);
}

/** Points inside the outline, clear of its edges and of a finger lock's missing piece: they must be in shadow. */
function deepInside(l: Lock): V2[] {
  const edges = outlineEdges(l.target), gap = l.missing >= 0 ? l.target[l.missing]! : null;
  return lockSamples(l.target, 0.01).inside.filter((p) => edges.every(([a, b]) => segDist(p, a, b) >= 0.014) && !(gap && inPoly(p, gap)));
}

test("every silhouette fills its outline on the panel from its spot: shots of each, at the spot and opened", async ({ page, boot }) => {
  test.setTimeout(20 * 60_000);
  const app = await boot({ mode: "visual" });
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const rows: string[] = [], crops: { name: string; png: string[] }[] = [];
  for (const name of SILHOUETTES) {
    let n = 5;
    while (!boxSilhouettes({ kind: "box", n }).includes(name)) n++;
    const box = generateBox({ kind: "box", n }), lock = box.locks.find((l) => l.shape === name)!;
    expect(lock.hidden).toBe(true);
    await page.evaluate((n) => window.__ns!.scene.show({ n }), n);
    await page.evaluate(() => window.__sl!.showHanging(false));
    await page.evaluate((L) => window.__sl!.placeLantern(L), lock.L);
    await app.step(2);
    const inside = deepInside(lock).map(([x, y]): V3 => [x, y, 0]), frame = lock.target.flat().map(([x, y]): V3 => [x, y, 0]);
    const centre = (await page.evaluate((c) => window.__ns!.scene.toWorld([[c[0], c[1], 0]]), lock.center))[0]!;
    const shots = await headsetView(app, centre, async () => {
      const atSpot = await shoot(page, [], frame);
      // The panel's own pixels, read without the smoked glass lid that lifts its upper part from the seated eye.
      await setGlass(page, false);
      const bare = await shoot(page, inside, frame);
      await setGlass(page, true);
      await page.evaluate((i) => window.__sl!.setOpen(i), lock.i);
      await app.step(40);
      const opened = await shoot(page, [], frame);
      return [atSpot, opened, bare];
    });
    const dark = shots[2]!.luma.filter((v) => v < DARK).length / shots[2]!.luma.length;
    rows.push(`${name} (box ${n}, lock ${lock.i}${lock.finger ? ", finger" : ""}): ${(100 * dark).toFixed(1)}% of ${inside.length} points dark`);
    expect(dark, `${name} in box ${n}`).toBeGreaterThanOrEqual(0.97);
    crops.push({ name, png: [shots[0]!.png, shots[1]!.png] });
    await page.evaluate(() => window.__sl!.showHanging(true));
  }
  // One picture per silhouette (at the spot, then opened) and a sheet of them all, composed in the page.
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const sheet = await page.evaluate(
    async ({ crops, cell, cols }) => {
      const load = (src: string) => new Promise<HTMLImageElement>((ok) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.src = src;
      });
      const rowsN = Math.ceil(crops.length / cols), gap = 6;
      const c = document.createElement("canvas");
      c.width = cols * (2 * cell + gap) + gap;
      c.height = rowsN * (cell + gap) + gap;
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      const pairs: string[] = [];
      for (let i = 0; i < crops.length; i++) {
        const x = gap + (i % cols) * (2 * cell + gap), y = gap + Math.floor(i / cols) * (cell + gap);
        const pair = document.createElement("canvas");
        pair.width = 2 * cell;
        pair.height = cell;
        for (let k = 0; k < 2; k++) pair.getContext("2d")!.drawImage(await load(crops[i]!.png[k]!), k * cell, 0);
        g.drawImage(pair, x, y);
        pairs.push(pair.toDataURL("image/png"));
      }
      return { sheet: c.toDataURL("image/png"), pairs };
    },
    { crops, cell: CELL, cols: COLS },
  );
  const save = (file: string, url: string) => fs.writeFileSync(path.join(SHOTS_DIR, file), Buffer.from(url.split(",")[1] ?? "", "base64"));
  crops.forEach((c, i) => save(`silhouette-${String(i + 1).padStart(2, "0")}-${c.name}.png`, sheet.pairs[i]!));
  save("silhouette-sheet.png", sheet.sheet);
  console.log(rows.join("\n"));
});
