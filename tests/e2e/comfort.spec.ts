// The comfort spike (the airplane-seat test): with the box placed from a seated head (eyes 1.20 m
// high), every lantern spot the generator makes, and the start, must be reachable without raising the
// arm or reaching far: at sternum height or lower, near the chest, clear of the face, and off the line
// of sight to the panel so the lantern never sits in front of what the player reads. Checked in world
// space with the app's own placement, at the default box size and at both ends of the size setting.
import type { Page } from "@playwright/test";
import type { V3, Vec3 } from "../../src/core/types";
import { expect, test } from "./helpers/test";

/** The comfort envelope's rules (global constraints, metres and degrees). */
const RULE = { belowEyesMin: 0.25, chestMax: 0.6, eyesMin: 0.15, offSightMinDeg: 12 };
/** Where the chest is for a seated player: 30 cm below the eyes and 10 cm in front of them. */
const CHEST = { below: 0.3, forward: 0.1 };
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
      const out: { key: string; mirrored: boolean; spots: [number, number, number][]; start: [number, number, number] }[] = [];
      for (const spec of specs) {
        for (const mirrored of [false, true]) {
          sc.show(spec, mirrored);
          out.push(sc.box()!);
        }
      }
      sc.show({ n: 5 });
      return out;
    },
    { specs: [...BOXES, ...DAYS] as ({ n: number } | { day: string })[] },
  );
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const angleDeg = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b)))) * 180) / Math.PI;

interface Worst {
  belowEyes: number;
  chest: number;
  eyes: number;
  offSight: number;
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
    const panel = s.boxPose.position;
    const yaw = s.boxPose.yaw;
    const chest: Vec3 = [eye[0] - Math.sin(yaw) * CHEST.forward, eye[1] - CHEST.below, eye[2] - Math.cos(yaw) * CHEST.forward];
    const sight = sub(panel, eye);
    const points = boxes.flatMap((b) => [...b.spots, b.start]);
    const world = await page.evaluate((pts) => window.__ns!.scene.toWorld(pts), points);
    const worst: Worst = { belowEyes: Infinity, chest: 0, eyes: Infinity, offSight: Infinity };
    let k = 0;
    for (const b of boxes) {
      const names = [...b.spots.map((_, i) => `spot ${i + 1}`), "start"];
      for (const name of names) {
        const p = world[k++]!;
        const r = { belowEyes: eye[1] - p[1], chest: len(sub(p, chest)), eyes: len(sub(p, eye)), offSight: angleDeg(sub(p, eye), sight) };
        worst.belowEyes = Math.min(worst.belowEyes, r.belowEyes);
        worst.chest = Math.max(worst.chest, r.chest);
        worst.eyes = Math.min(worst.eyes, r.eyes);
        worst.offSight = Math.min(worst.offSight, r.offSight);
        const tag = `${cm} cm ${b.key}${b.mirrored ? " mirrored" : ""} ${name}`;
        if (r.belowEyes < RULE.belowEyesMin) failures.push(`${tag}: only ${(r.belowEyes * 100).toFixed(1)} cm below the eyes`);
        if (r.chest > RULE.chestMax) failures.push(`${tag}: ${(r.chest * 100).toFixed(1)} cm from the chest`);
        if (r.eyes < RULE.eyesMin) failures.push(`${tag}: ${(r.eyes * 100).toFixed(1)} cm from the eyes`);
        if (r.offSight < RULE.offSightMinDeg) failures.push(`${tag}: ${r.offSight.toFixed(1)} deg off the line of sight`);
      }
    }
    lines.push(
      `${cm} cm: ${points.length} points; nearest to the eyes' height ${(worst.belowEyes * 100).toFixed(1)} cm below; ` +
        `furthest from the chest ${(worst.chest * 100).toFixed(1)} cm; nearest the eyes ${(worst.eyes * 100).toFixed(1)} cm; ` +
        `least off the sight line ${worst.offSight.toFixed(1)} deg`,
    );
  }
  testInfo.annotations.push({ type: "comfort", description: lines.join("\n") });
  console.log(lines.join("\n"));
  expect(failures.slice(0, 20), `${failures.length} comfort failures`).toEqual([]);
});

test("comfort shots: box 5 from the seated eye with the lantern at each spot, and box 15's draw calls", async ({ page, boot }, testInfo) => {
  const app = await boot({ mode: "visual" });
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const key = await page.evaluate(() => window.__ns!.scene.show({ n: 5 }));
  expect(key).toBe("shadow-locks/5");
  const box = (await page.evaluate(() => window.__ns!.scene.box()))!;
  const s = await app.state();
  const panel = s.boxPose.position;
  const where = [...box.spots.map((p, i) => ({ name: `spot${i + 1}`, p })), { name: "start", p: box.start }];
  for (const { name, p } of where) {
    await page.evaluate((q) => window.__ns!.scene.setLantern(q), p);
    // As the seated player sees it (the emulator's whole view), then at headset pixel density on the panel.
    await app.capture(`comfort-box5-${name}`);
    await app.captureHeadset(`comfort-box5-${name}-headset`, { x: panel[0], y: panel[1], z: panel[2] });
  }

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
  testInfo.annotations.push({ type: "draws", description: line });
  console.log(line);
});
