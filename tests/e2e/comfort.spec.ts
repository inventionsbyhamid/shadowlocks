// The comfort spike (the airplane-seat test): with the box placed from a seated head (eyes 1.20 m
// high), every lantern spot the generator makes, and the start, must be reachable without raising the
// arm or reaching far: at sternum height or lower, near the chest, clear of the face, and off the line
// of sight to the panel so the lantern never sits in front of what the player reads. Checked in world
// space with what the app draws, at the default box size and at both ends of the size setting. (The
// whole envelope, not just these boxes, is swept in tests/unit/comfort-envelope.test.ts.)
import fs from "node:fs";
import type { Page } from "@playwright/test";
import type { V3, Vec3 } from "../../src/core/types";
import { broken, comfortOf, Worst } from "../unit/helpers/comfort";
import { setHeadset } from "./helpers/page-scripts";
import { expect, test } from "./helpers/test";

const SIZES_CM = [24, 18, 30];
const BOXES = Array.from({ length: 30 }, (_, i) => ({ n: i + 1 }));
const DAYS = Array.from({ length: 10 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, "0")}` }));

interface Shown {
  key: string;
  mirrored: boolean;
  spots: V3[];
  start: V3;
}

/** Every box's spots and start (box units), as the page generates and shows them. */
async function allBoxes(page: Page): Promise<Shown[]> {
  return page.evaluate(
    ({ specs }) => {
      const sc = window.__ns!.scene;
      const out: Shown[] = [];
      for (const spec of specs) {
        for (const mirrored of [false, true]) {
          sc.show(spec, mirrored);
          const b = sc.box()!;
          out.push({ key: b.key, mirrored: b.mirrored, spots: b.spots, start: b.start });
        }
      }
      sc.show({ n: 5 });
      return out;
    },
    { specs: [...BOXES, ...DAYS] as ({ n: number } | { day: string })[] },
  );
}

/**
 * How two shots differ in their middle (30% of the width, 40% of the height, where only the panel and scraps show):
 * the largest difference between their mean channels (0-255), and the share of pixels where any channel moved
 * by more than 24.
 */
async function middleDiff(page: Page, a: string, b: string): Promise<{ mean: number; changed: number }> {
  return page.evaluate(
    async ([da, db]) => {
      const pixels = async (data: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const x = Math.round(img.width * 0.35), y = Math.round(img.height * 0.3), w = Math.round(img.width * 0.3), h = Math.round(img.height * 0.4);
        return g.getImageData(x, y, w, h).data;
      };
      const pa = await pixels(da!), pb = await pixels(db!);
      const sa = [0, 0, 0], sb = [0, 0, 0];
      let changed = 0;
      for (let i = 0; i < pa.length; i += 4) {
        let moved = false;
        for (let k = 0; k < 3; k++) {
          sa[k]! += pa[i + k]!;
          sb[k]! += pb[i + k]!;
          if (Math.abs(pa[i + k]! - pb[i + k]!) > 24) moved = true;
        }
        if (moved) changed++;
      }
      const n = pa.length / 4;
      return { mean: Math.max(...sa.map((s, k) => Math.abs(s - sb[k]!) / n)), changed: changed / n };
    },
    [fs.readFileSync(a).toString("base64"), fs.readFileSync(b).toString("base64")],
  );
}

test("every lantern spot of boxes 1-30 and 10 days sits in the seated comfort envelope at every box size", async ({ page, boot }, testInfo) => {
  const app = await boot();
  await page.evaluate(() => window.__ns!.ui.go("play"));
  const head = (await app.state()).head!;
  expect(head[1]).toBeCloseTo(1.2, 3);
  const boxes = await allBoxes(page);
  expect(boxes).toHaveLength((BOXES.length + DAYS.length) * 2);
  const lines: string[] = [];
  const failures: string[] = [];
  for (const cm of SIZES_CM) {
    await page.evaluate((c) => window.__ns!.ui.setSettings({ boxSizeCm: c }), cm);
    // The box's scale lives in IWSDK's float32 transform storage.
    await app.stepUntil((ns, _w, c) => Math.abs(ns.state().box.sizeM - c / 100) < 1e-6, { arg: cm, maxMs: 2_000, label: `box ${cm} cm` });
    const s = await app.state();
    const eye = s.head!;
    const panel = s.box.world!;
    const points = boxes.flatMap((b) => [...b.spots, b.start]);
    const world: Vec3[] = await page.evaluate((pts) => window.__ns!.scene.toWorld(pts), points);
    const worst = new Worst();
    let k = 0;
    for (const b of boxes) {
      for (const name of [...b.spots.map((_, i) => `spot ${i + 1}`), "start"]) {
        const c = comfortOf(eye, s.boxPose.yaw, panel, world[k++]!);
        worst.add(c);
        failures.push(...broken(c, `${cm} cm ${b.key}${b.mirrored ? " mirrored" : ""} ${name}`));
      }
    }
    lines.push(`${cm} cm, ${points.length} points: ${worst.line()}`);
  }
  testInfo.annotations.push({ type: "comfort", description: lines.join("\n") });
  console.log(lines.join("\n"));
  expect(failures.slice(0, 20), `${failures.length} comfort failures`).toEqual([]);
});

test("comfort shots: box 5 from the seated eye at each spot, a hidden and a glowing piece, a turned seat, box 15's draw calls", async ({ page, boot }, testInfo) => {
  const app = await boot({ mode: "visual" });
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const key = await page.evaluate(() => window.__ns!.scene.show({ n: 5 }));
  expect(key).toBe("shadow-locks/5");
  const box = (await page.evaluate(() => window.__ns!.scene.box()))!;
  let panel = (await app.state()).box.world!;
  const target = () => ({ x: panel[0], y: panel[1], z: panel[2] });
  const where = [...box.spots.map((p, i) => ({ name: `spot${i + 1}`, p })), { name: "start", p: box.start }];
  let atStart = "";
  for (const { name, p } of where) {
    await page.evaluate((q) => window.__ns!.scene.setLantern(q), p);
    // As the seated player sees it (the emulator's whole view), then at headset pixel density on the panel.
    await app.capture(`comfort-box5-${name}`);
    atStart = await app.captureHeadset(`comfort-box5-${name}-headset`, target());
  }

  // One piece hidden, then glowing, the way the game does it: the frame changes each time.
  const piece = box.missing[0] === 0 ? 1 : 0;
  await page.evaluate((pc) => window.__ns!.scene.setScrap(0, pc, { visible: false }), piece);
  expect(await page.evaluate((pc) => window.__ns!.scene.scrap(0, pc), piece)).toEqual({ glow: 0, visible: false });
  const hidden = await app.captureHeadset("comfort-box5-hidden-piece-headset", target());
  expect(fs.readFileSync(hidden).equals(fs.readFileSync(atStart)), "hiding a piece changes the frame").toBe(false);
  await page.evaluate((pc) => window.__ns!.scene.setScrap(0, pc, { visible: true, glow: 1 }), piece);
  const glowing = await app.captureHeadset("comfort-box5-glowing-piece-headset", target());
  expect(fs.readFileSync(glowing).equals(fs.readFileSync(atStart)), "a glowing piece changes the frame").toBe(false);
  await page.evaluate((pc) => window.__ns!.scene.setScrap(0, pc, { glow: 0 }), piece);

  // The player turns a quarter left and recenters: the box, its lights and its reflections turn with it, so the
  // panel and scraps look as they did (the lap glow stays under the box).
  await page.evaluate(setHeadset, { position: { x: 0, y: 1.2, z: -1.38 }, lookAt: { x: -0.55, y: 0.92, z: -1.38 } });
  await app.step(2);
  expect(await page.evaluate(() => window.__ns!.recenter())).toBe(true);
  // The placement changes at once; the drawn box follows on the next frame's layout.
  await app.stepUntil(
    (ns) => {
      const st = ns.state();
      return Math.abs(st.boxPose.yaw - Math.PI / 2) < 0.01 && !!st.box.world && Math.abs(st.box.world[0] - (st.head![0] - 0.55)) < 1e-3;
    },
    { maxMs: 2_000, label: "box turned and moved with the head" },
  );
  panel = (await app.state()).box.world!;
  const turned = await app.captureHeadset("comfort-box5-yaw90-headset", target());
  // Rendering here is deterministic: with the reflections turned the right way the middle comes out the same.
  // (Turned the wrong way, the upper scraps lose the lap glow: mean 2.96, see the Task 9 fix report.)
  const d = await middleDiff(page, atStart, turned);
  const yawLine = `panel middle, yaw 90 against yaw 0: mean channel difference ${d.mean.toFixed(2)}, pixels changed ${(d.changed * 100).toFixed(2)}%`;
  console.log(yawLine);
  expect(d.mean, yawLine).toBeLessThan(0.5);
  expect(d.changed, yawLine).toBeLessThan(0.002);

  // Box 15 (three locks, 16 decoys): its draw calls, counted from what it draws and from the renderer.
  await page.evaluate(() => window.__ns!.scene.show({ n: 15 }));
  await app.step(2);
  const draws = await page.evaluate(() => window.__ns!.scene.draws());
  const views = await page.evaluate(() => {
    const xr = (window.__ns!.world as { renderer: { xr: { isPresenting: boolean; getCamera(): { cameras: unknown[] } } } }).renderer.xr;
    return xr.isPresenting ? xr.getCamera().cameras.length : 1;
  });
  const withBox = await app.perf();
  await page.evaluate(() => window.__ns!.scene.setVisible(false));
  await app.step(2);
  const without = await app.perf();
  await page.evaluate(() => window.__ns!.scene.setVisible(true));
  await app.step(1);
  await app.capture("comfort-box15");
  expect(draws.calls).toBeLessThanOrEqual(30);
  expect((withBox.calls - without.calls) / views).toBeLessThanOrEqual(30);
  expect(withBox.triangles).toBeLessThanOrEqual(100_000 * views);
  const line =
    `box 15: ${draws.calls} draw calls and ${Math.round(draws.triangles)} triangles per view by count (${draws.parts.join(", ")}); ` +
    `renderer, ${views} views: frame ${withBox.calls} calls / ${withBox.triangles} triangles with the box, ${without.calls} / ${without.triangles} without`;
  testInfo.annotations.push({ type: "draws", description: line + "\n" + yawLine });
  console.log(line);
});
