// The shadows on the panel, as rendered. Box 1 from its lock's spot: the shadows fill the etched
// outline as one solid shape, with no hairline of light along the edges where scraps meet, and the
// sight rings nest into a bullseye on their mark; from the start they do not fill it. Read from the
// rendered pixels at headset density (25 px per degree) with what hangs in the box hidden, so only
// the panel shows; close-ups of its sharpest corners. Box 15: every shadow in one draw call, a shadow
// update within 0.5 ms (p95 of means of 10) at 4x CPU throttle, the lantern moving adding at most
// about 0.3 ms to a frame, and a new box's etching spread over frames, no step over 8 ms. Shots for
// the look review go to test-results/shots/shadows-*.png.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { generateBox } from "../../src/core/generator";
import { circlePts, inPoly, proj, segDist } from "../../src/core/geom";
import { lockSamples, RING_SIDES } from "../../src/core/solve";
import type { Lock, Ring, V2, V3, Vec3 } from "../../src/core/types";
import { outlineEdges } from "../../src/render/outline";
import { expect, test } from "./helpers/test";
import { addRunNote, SHOTS_DIR, type XrApp } from "./helpers/xr-app";

/** Luma (0-255) of the panel lit, and in full shadow, with room to spare. */
const DARK = 70;
const LIT = 110;
/** Points this far (box units) from the outline keep clear of its etched lines. */
const CLEAR = 0.014;

interface Probe {
  /** Luma at each point, and the brightest and darkest within 1 px of it. */
  at: number[];
  max: number[];
  min: number[];
  /** Canvas pixel of each point. */
  px: [number, number][];
}

/**
 * Step one frame and read the rendered panel at box points: projected with the first XR view's camera
 * into the canvas, read from it in the same task as the frame (no preserveDrawingBuffer needed).
 */
function probe(page: Page, pts: V3[]): Promise<Probe> {
  return page.evaluate((pts) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__vt.step(1000 / 72);
    const renderer = w.__ns.world.renderer, canvas = renderer.domElement as HTMLCanvasElement, xr = renderer.xr;
    const cam = xr.getCamera().cameras[0];
    const layer = xr.getBaseLayer?.();
    const W = canvas.width, H = canvas.height;
    const sx = W / (layer?.framebufferWidth ?? W), sy = H / (layer?.framebufferHeight ?? H);
    const c2: HTMLCanvasElement = (w.__probeCanvas ||= document.createElement("canvas"));
    c2.width = W;
    c2.height = H;
    const g = c2.getContext("2d", { willReadFrequently: true })!;
    g.clearRect(0, 0, W, H);
    g.drawImage(canvas, 0, 0);
    const data = g.getImageData(0, 0, W, H).data;
    const lum = (x: number, y: number) => {
      const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4;
      return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    };
    const world = w.__ns.scene.toWorld(pts) as [number, number, number][];
    const V = cam.matrixWorldInverse.elements as number[], P = cam.projectionMatrix.elements as number[], vp = cam.viewport;
    const out = { at: [] as number[], max: [] as number[], min: [] as number[], px: [] as [number, number][] };
    for (const [x, y, z] of world) {
      const vx = V[0]! * x + V[4]! * y + V[8]! * z + V[12]!, vy = V[1]! * x + V[5]! * y + V[9]! * z + V[13]!;
      const vz = V[2]! * x + V[6]! * y + V[10]! * z + V[14]!;
      const cx = P[0]! * vx + P[4]! * vy + P[8]! * vz + P[12]!, cy = P[1]! * vx + P[5]! * vy + P[9]! * vz + P[13]!;
      const cw = P[3]! * vx + P[7]! * vy + P[11]! * vz + P[15]!;
      const px = Math.floor((vp.x + ((cx / cw + 1) / 2) * vp.z) * sx);
      const py = Math.floor(H - (vp.y + ((cy / cw + 1) / 2) * vp.w) * sy);
      let hi = 0, lo = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const l = lum(px + dx, py + dy);
          hi = Math.max(hi, l);
          lo = Math.min(lo, l);
        }
      }
      out.at.push(lum(px, py));
      out.max.push(hi);
      out.min.push(lo);
      out.px.push([px, py]);
    }
    return out;
  }, pts);
}

/**
 * Step one frame and save a close-up round each box point: `half` px either side, enlarged `zoom` times
 * pixel for pixel, as test-results/shots/<name>-<i>.png. Returns the files.
 */
async function crops(page: Page, name: string, pts: V3[], half = 36, zoom = 6): Promise<string[]> {
  const urls = await page.evaluate(
    ({ pts, half, zoom }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.__vt.step(1000 / 72);
      const renderer = w.__ns.world.renderer, canvas = renderer.domElement as HTMLCanvasElement, xr = renderer.xr;
      const cam = xr.getCamera().cameras[0];
      const layer = xr.getBaseLayer?.();
      const W = canvas.width, H = canvas.height;
      const sx = W / (layer?.framebufferWidth ?? W), sy = H / (layer?.framebufferHeight ?? H);
      const world = w.__ns.scene.toWorld(pts) as [number, number, number][];
      const V = cam.matrixWorldInverse.elements as number[], P = cam.projectionMatrix.elements as number[], vp = cam.viewport;
      const out: string[] = [];
      for (const [x, y, z] of world) {
        const vx = V[0]! * x + V[4]! * y + V[8]! * z + V[12]!, vy = V[1]! * x + V[5]! * y + V[9]! * z + V[13]!;
        const vz = V[2]! * x + V[6]! * y + V[10]! * z + V[14]!;
        const cx = P[0]! * vx + P[4]! * vy + P[8]! * vz + P[12]!, cy = P[1]! * vx + P[5]! * vy + P[9]! * vz + P[13]!;
        const cw = P[3]! * vx + P[7]! * vy + P[11]! * vz + P[15]!;
        const px = Math.floor((vp.x + ((cx / cw + 1) / 2) * vp.z) * sx);
        const py = Math.floor(H - (vp.y + ((cy / cw + 1) / 2) * vp.w) * sy);
        const c = document.createElement("canvas");
        c.width = c.height = 2 * half * zoom;
        const g = c.getContext("2d")!;
        g.imageSmoothingEnabled = false;
        g.fillStyle = "#000";
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(canvas, px - half, py - half, 2 * half, 2 * half, 0, 0, c.width, c.height);
        out.push(c.toDataURL("image/png"));
      }
      return out;
    },
    { pts, half, zoom },
  );
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  return urls.map((u, i) => {
    const file = path.join(SHOTS_DIR, `${name}-${i + 1}.png`);
    fs.writeFileSync(file, Buffer.from(u.split(",")[1] ?? "", "base64"));
    return file;
  });
}

/**
 * The outline's sharpest corners (a crescent's horn tips first) and its topmost point, in box units: where a
 * shadow's skirt would spike if its corners were mitred.
 */
function sharpPoints(l: Lock, count: number): V2[] {
  const edges = outlineEdges(l.target);
  const key = (p: V2) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const nbrs = new Map<string, { p: V2; to: V2[] }>();
  for (const [a, b] of edges) {
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const e = nbrs.get(key(p)) ?? { p, to: [] };
      e.to.push(q);
      nbrs.set(key(p), e);
    }
  }
  const angle = ({ p, to }: { p: V2; to: V2[] }) => {
    const [u, v] = to as [V2, V2];
    const a = Math.atan2(u[1] - p[1], u[0] - p[0]), b = Math.atan2(v[1] - p[1], v[0] - p[0]);
    const d = Math.abs(a - b) % (2 * Math.PI);
    return Math.min(d, 2 * Math.PI - d);
  };
  const corners = [...nbrs.values()].filter((e) => e.to.length === 2);
  const sharp = corners.sort((x, y) => angle(x) - angle(y)).slice(0, count).map((e) => e.p);
  const top = corners.reduce((a, b) => (b.p[1] > a.p[1] ? b : a)).p;
  return [...sharp, top];
}

/**
 * Narrow the emulated view to `ppd` pixels per degree (Quest 3 is about 25) and turn the head to look at
 * `target` (world metres), as app.captureHeadset does; run `fn`; put the view back.
 */
async function headsetView<T>(app: XrApp, target: Vec3, fn: () => Promise<T>, ppd = 25): Promise<T> {
  const saved = await app.page.evaluate(
    ({ target, ppd }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const d = w.IWER_DEVICE, canvas = w.__ns.world.renderer.domElement as HTMLCanvasElement;
      const was = { fovy: d.fovy as number, q: [d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w] };
      d.fovy = ((canvas.height / ppd) * Math.PI) / 180;
      const p = d.position, dx = target[0] - p.x, dy = target[1] - p.y, dz = target[2] - p.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      return was;
    },
    { target, ppd },
  );
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
 * Put the lantern at p (box units) by the test hook, then step a frame, so whatever drives the lantern's
 * view (a hand controller follows its own state each frame) has caught up and the shadows are cast.
 */
async function place(app: XrApp, p: V3): Promise<void> {
  await app.page.evaluate((q) => window.__sl!.placeLantern(q), p);
  await app.step(1);
}

const on = (p: V2): V3 => [p[0], p[1], 0];
const lerp = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const share = (xs: number[], f: (x: number) => boolean) => xs.filter(f).length / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
};
const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))]!;

/** Grid points inside the outline, clear of its etched lines. */
function deepInside(l: Lock): V2[] {
  const edges = outlineEdges(l.target);
  return lockSamples(l.target, 0.012).inside.filter((p) => edges.every(([a, b]) => segDist(p, a, b) >= CLEAR));
}

/** Points on edges two pieces share (where a seam would show), clear of the outline's etched lines. */
function seamPoints(l: Lock): V2[] {
  const edges = outlineEdges(l.target), out: V2[] = [];
  const inShape = (p: V2) => l.target.some((q) => inPoly(p, q));
  for (const poly of l.target) {
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!, b = poly[(k + 1) % poly.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len;
      for (let t = 0.1; t < 0.95; t += 0.1) {
        const p = lerp(a, b, t);
        if (!inShape([p[0] + nx * 1e-4, p[1] + ny * 1e-4]) || !inShape([p[0] - nx * 1e-4, p[1] - ny * 1e-4])) continue;
        if (edges.every(([e0, e1]) => segDist(p, e0, e1) >= CLEAR)) out.push(p);
      }
    }
  }
  return out;
}

test("box 1: from its spot the shadows fill the outline as one shape and the rings nest; from the start they do not", async ({ page, boot }, testInfo) => {
  const app = await boot({ mode: "visual" });
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const box = generateBox({ kind: "box", n: 1 });
  expect(await page.evaluate(() => window.__ns!.scene.show({ n: 1 }))).toBe(box.key);
  expect((await page.evaluate(() => window.__ns!.scene.box()))!.spots).toEqual(box.locks.map((l) => l.L));
  const lock = box.locks[0]!;
  const panel = (await app.state()).boxPose.position;

  // As the player sees it, scraps and all.
  for (const [name, L] of [["start", box.start], ["spot", lock.L]] as const) {
    await place(app, L);
    expect((await page.evaluate(() => window.__sl!.lantern())).pos).toEqual(L);
    await app.capture(`shadows-box1-${name}`);
    await app.captureHeadset(`shadows-box1-${name}-headset`, { x: panel[0], y: panel[1], z: panel[2] });
  }

  const inside = deepInside(lock), seams = seamPoints(lock);
  expect(inside.length).toBeGreaterThan(100);
  expect(seams.length).toBeGreaterThan(5);
  const rings = box.elements.filter((e): e is Ring => e.kind === "ring" && e.lock === lock.i).sort((a, b) => a.c[2] - b.c[2]);
  expect(rings).toHaveLength(2);
  const corners = (r: Ring, rad: number) => circlePts(r.c, r.nrm, rad, RING_SIDES).map((p) => proj(p, lock.L));
  const [deep, shallow] = rings as [Ring, Ring];
  const dO = corners(deep, deep.rOut), dI = corners(deep, deep.rIn), sO = corners(shallow, shallow.rOut), sI = corners(shallow, shallow.rIn);
  const mark = lock.mark!;
  const hole = dI.map((c) => lerp(mark, c, 0.65)), gap = dO.map((c, j) => lerp(c, sI[j]!, 0.5));
  const deepBody = dI.map((c, j) => lerp(c, dO[j]!, 0.75)), shallowBody = sI.map((c, j) => lerp(c, sO[j]!, 0.75));

  const lines: string[] = [];
  await page.evaluate(() => window.__sl!.showHanging(false));
  const [fromStart, fromSpot] = await headsetView(app, panel, async () => {
    await place(app, box.start);
    await app.capture("shadows-box1-start-panel-headset");
    const a = await probe(page, inside.map(on));
    await place(app, lock.L);
    await app.capture("shadows-box1-spot-panel-headset");
    const b = await probe(page, [...inside, ...seams, ...hole, ...gap, ...deepBody, ...shallowBody].map(on));
    // Close-ups (6x) of the shadow at the outline's two sharpest corners (the horn tips) and its top: no spikes.
    await crops(page, "shadows-box1-spot-tips-panel", sharpPoints(lock, 2).map(on));
    await page.evaluate(() => window.__sl!.showHanging(true));
    await crops(page, "shadows-box1-spot-tips", sharpPoints(lock, 2).map(on));
    await page.evaluate(() => window.__sl!.showHanging(false));
    return [a, b] as const;
  });
  await page.evaluate(() => window.__sl!.showHanging(true));

  // The pixels must be on the panel and spread over the lock (the probe projects correctly).
  const xs = fromSpot.px.slice(0, inside.length).map((p) => p[0]), ys = fromSpot.px.slice(0, inside.length).map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(100);

  const darkStart = share(fromStart.at, (l) => l < DARK), litStart = share(fromStart.at, (l) => l > LIT);
  const n = inside.length, m = seams.length, R = RING_SIDES;
  const spot = { inside: fromSpot.at.slice(0, n), seamMax: fromSpot.max.slice(n, n + m) };
  const k = n + m;
  const ring = {
    hole: fromSpot.at.slice(k, k + R),
    gap: fromSpot.max.slice(k + R, k + 2 * R),
    deep: fromSpot.min.slice(k + 2 * R, k + 3 * R),
    shallow: fromSpot.min.slice(k + 3 * R, k + 4 * R),
  };
  const darkSpot = share(spot.inside, (l) => l < DARK);
  lines.push(
    `box 1 ${lock.shape}: ${n} points inside the outline; from the start ${(darkStart * 100).toFixed(1)}% dark, ${(litStart * 100).toFixed(1)}% lit ` +
      `(median luma ${median(fromStart.at).toFixed(0)}); from the spot ${(darkSpot * 100).toFixed(1)}% dark (median ${median(spot.inside).toFixed(0)}, ` +
      `95th pct ${pct(spot.inside, 0.95).toFixed(0)}, max ${Math.max(...spot.inside).toFixed(0)})`,
    `seams: ${m} points on shared edges; brightest pixel within 1 px of each: median ${median(spot.seamMax).toFixed(0)}, max ${Math.max(...spot.seamMax).toFixed(0)}`,
    `bullseye (luma, ${R} directions): hole ${Math.min(...ring.hole).toFixed(0)}-${Math.max(...ring.hole).toFixed(0)}, ` +
      `gap brightest ${Math.min(...ring.gap).toFixed(0)}-${Math.max(...ring.gap).toFixed(0)}, ` +
      `deep ring darkest ${Math.min(...ring.deep).toFixed(0)}-${Math.max(...ring.deep).toFixed(0)}, ` +
      `shallow ring darkest ${Math.min(...ring.shallow).toFixed(0)}-${Math.max(...ring.shallow).toFixed(0)}`,
  );
  testInfo.annotations.push({ type: "shadows", description: lines.join("\n") });
  console.log(lines.join("\n"));
  for (const l of lines) addRunNote(l);

  // From the spot the outline is filled: every point dark, no light leaking along any seam.
  expect(darkSpot).toBe(1);
  expect(Math.max(...spot.seamMax)).toBeLessThan(DARK);
  // From the start it is not (the generator keeps the start under half covered).
  expect(darkStart).toBeLessThan(0.75);
  expect(litStart).toBeGreaterThan(0.2);
  // The bullseye: the hole lit, light through the gap, both rings dark.
  expect(Math.min(...ring.hole)).toBeGreaterThan(LIT);
  expect(median(ring.gap)).toBeGreaterThan(LIT);
  expect(median(ring.deep)).toBeLessThan(DARK);
  expect(median(ring.shallow)).toBeLessThan(DARK);
});

test("box 15 at 4x CPU throttle: one draw call for every shadow, an update within 0.5 ms p95, each etch step within 8 ms", async ({ page, boot }, testInfo) => {
  const app = await boot();
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const box = generateBox({ kind: "box", n: 15 });
  expect(await page.evaluate(() => window.__ns!.scene.show({ n: 15 }))).toBe(box.key);
  await app.step(2);
  const draws = await page.evaluate(() => window.__ns!.scene.draws());
  const stats = await page.evaluate(() => window.__sl!.shadowStats());
  expect(draws.parts.filter((p) => p === "Shadows")).toHaveLength(1);
  expect(draws.calls).toBeLessThanOrEqual(30);

  // A sweep through where the lantern goes (the spots' envelope), past every spot and the start.
  const path: V3[] = [];
  for (let i = 0; i < 1200; i++) {
    const t = i / 1200;
    path.push([0.45 * Math.sin(2 * Math.PI * 3 * t), -0.32 + 0.13 * Math.sin(2 * Math.PI * 5 * t + 1), 1.375 + 0.225 * Math.sin(2 * Math.PI * 7 * t + 2)]);
  }
  for (const l of box.locks) for (let i = 0; i < 20; i++) path.push([l.L[0] + 0.001 * i, l.L[1], l.L[2]]);
  // Warm up (JIT), measure unthrottled, then at 4x throttle.
  await page.evaluate((p) => window.__sl!.shadowTimes(p, 1), path);
  const single1 = await page.evaluate((p) => window.__sl!.shadowTimes(p, 1), path);
  const batched1 = await page.evaluate((p) => window.__sl!.shadowTimes(p, 10), path);
  // A control: plain arithmetic that takes as long as one shadow update unthrottled, timed the same way. At
  // 4x the throttler suspends the page in slices, so any short timing now and then swallows a pause; the
  // control shows how much of the single-update tail is that.
  const updateMs = batched1.reduce((a, b) => a + b, 0) / batched1.length;
  const spinN = await page.evaluate((ms) => {
    const now = performance.now.bind(performance);
    const w = window as unknown as { __vt?: { realNow(): number }; __spin?: (n: number) => number; __sink: number };
    const real = w.__vt ? w.__vt.realNow.bind(w.__vt) : now;
    w.__sink = 0;
    // The result goes to a global, so the loop cannot be optimised away.
    w.__spin = (n: number) => {
      let s = w.__sink * 1e-12;
      for (let i = 0; i < n; i++) s += Math.sqrt(i + s * 1e-9);
      w.__sink += s * 1e-12;
      return s;
    };
    let n = 1000;
    for (;;) {
      const t0 = real();
      for (let k = 0; k < 1000; k++) w.__spin(n);
      const per = (real() - t0) / 1000;
      if (per >= ms || n > 1e8) return Math.round((n * ms) / Math.max(per, 1e-6));
      n *= 2;
    }
  }, updateMs);
  const timeSpin = (count: number) =>
    page.evaluate(
      ({ n, count }) => {
        const w = window as unknown as { __vt?: { realNow(): number }; __spin: (n: number) => number };
        const real = w.__vt ? w.__vt.realNow.bind(w.__vt) : performance.now.bind(performance);
        const out: number[] = [];
        for (let i = 0; i < count; i++) {
          const t0 = real();
          w.__spin(n);
          out.push(real() - t0);
        }
        return out;
      },
      { n: spinN, count },
    );
  const control1 = await timeSpin(path.length);
  // Etching the panel for a new box, unthrottled (warm-up and reference).
  await page.evaluate(() => window.__sl!.etchTimes(2));
  const etch1 = await page.evaluate(() => window.__sl!.etchTimes(5));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let single: number[], batched: number[], control: number[];
  let etch: { total: number[]; worstStep: number[]; steps: number; upload: number[]; perStep: number[] };
  let frames: { still: number[]; moving: number[]; rise: number; avgRise: number; systems: string };
  try {
    single = await page.evaluate((p) => window.__sl!.shadowTimes(p, 1), path);
    batched = await page.evaluate((p) => window.__sl!.shadowTimes(p, 10), path);
    control = await timeSpin(path.length);
    etch = await page.evaluate(() => window.__sl!.etchTimes(10));
    // In the frame loop the box's own update casts when the lantern moved. Short timings under the throttler drift
    // from block to block, so still and moving frames take turns, one each, 480 frames, and each frame's shell
    // time is read on its own.
    const { still, moving } = await page.evaluate((p) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const out = { still: [] as number[], moving: [] as number[] };
      for (let i = 0; i < 480; i++) {
        const move = i % 2 === 1;
        if (move) w.__ns.scene.setLantern(p[(i * 3) % p.length]);
        w.__ns.resetPerf();
        w.__vt.step(1000 / 72);
        (move ? out.moving : out.still).push(w.__ns.perf().systems["shell"]?.maxMs ?? NaN);
      }
      return out;
    }, path);
    const avgOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    frames = {
      still: [pct(still, 0.5), pct(still, 0.95)],
      moving: [pct(moving, 0.5), pct(moving, 0.95)],
      rise: pct(moving, 0.95) - pct(still, 0.95),
      avgRise: avgOf(moving) - avgOf(still),
      systems: `${still.length} frames each`,
    };
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const p95 = pct(single, 0.95), p95b = pct(batched, 0.95), mean = avg(batched);
  // How the single timings fall, in the timer's 0.1 ms steps.
  const hist = new Map<string, number>();
  for (const t of single) {
    const k = t >= 1 ? ">=1" : (Math.round(t * 10) / 10).toFixed(1);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const histLine = [...hist.entries()].sort().map(([k, v]) => `${k}: ${v}`).join(", ");
  const line =
    `box 15: ${draws.calls} draw calls per view (${draws.parts.join(", ")}); shadow mesh ${stats.vertices} vertices, ` +
    `${stats.triangles} triangles; shadow update at 4x throttle over ${single.length} lantern positions: p95 ${p95.toFixed(3)} ms ` +
    `(timer steps 0.1 ms), max ${Math.max(...single).toFixed(3)} ms, spread ${histLine}; means of 10: avg ${mean.toFixed(4)} ms, ` +
    `p95 ${p95b.toFixed(4)} ms; unthrottled: singles p95 ${pct(single1, 0.95).toFixed(3)} ms, means of 10 avg ${avg(batched1).toFixed(4)} ms, ` +
    `p95 ${pct(batched1, 0.95).toFixed(4)} ms; control loop of the same length (unthrottled mean ${avg(control1).toFixed(4)} ms): ` +
    `at 4x singles p95 ${pct(control, 0.95).toFixed(3)} ms, mean ${avg(control).toFixed(4)} ms, ${(share(control, (t) => t >= 0.25) * 100).toFixed(1)}% at 0.25 ms or more ` +
    `(shadow update ${(share(single, (t) => t >= 0.25) * 100).toFixed(1)}%); ` +
    `shell system per frame, still and moving frames taking turns (${frames.systems}): median/p95 still ` +
    `${frames.still.map((v) => v.toFixed(1)).join("/")} ms, lantern moving ${frames.moving.map((v) => v.toFixed(1)).join("/")} ms; ` +
    `p95 rise ${frames.rise.toFixed(2)} ms (average rise ${frames.avgRise.toFixed(3)} ms)`;
  const etchLine =
    `panel etch for box 15 in ${etch.steps} steps, one a frame (drawing finished): slowest step median ${median(etch.worstStep).toFixed(2)} ms ` +
    `at 4x (${etch.worstStep.map((t) => t.toFixed(1)).join(", ")}), ${median(etch1.worstStep).toFixed(2)} ms unthrottled; all steps ` +
    `median ${median(etch.total).toFixed(2)} ms at 4x, ${median(etch1.total).toFixed(2)} ms unthrottled; texture upload (software GL ` +
    `here, not the headset's GPU) median ${median(etch.upload).toFixed(2)} ms at 4x, ${median(etch1.upload).toFixed(2)} ms unthrottled; ` +
    `each step at 4x (setBox first): ${etch.perStep.map((t) => t.toFixed(1)).join(", ")}; unthrottled: ${etch1.perStep.map((t) => t.toFixed(2)).join(", ")}`;
  testInfo.annotations.push({ type: "perf", description: `${line}\n${etchLine}` });
  console.log(`${line}\n${etchLine}`);
  addRunNote(line);
  addRunNote(etchLine);
  // The budget, on the cost of an update: p95 of means of 10 (single timings read the 0.1 ms timer and the
  // throttler's pauses as much as the work; their p95 is in the note above, beside the control's).
  expect(p95b).toBeLessThanOrEqual(0.5);
  expect(mean).toBeLessThanOrEqual(0.5);
  // In the frame: moving the lantern (casting every shadow) adds at most about 0.3 ms to the shell's p95. The timer
  // steps 0.1 ms and a frame that does more catches the throttler's pauses more often, so one step of slack: 0.4.
  expect(frames.rise).toBeLessThanOrEqual(0.4 + 1e-9);
  // A new box's etching goes a step a frame, and no step takes more than 8 ms at 4x.
  expect(median(etch.worstStep)).toBeLessThanOrEqual(8);
});

test("warmth eases in and never flickers, even when the game's warmth jumps every frame", async ({ page, boot }) => {
  const app = await boot();
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await page.evaluate(() => window.__ns!.scene.show({ n: 1 }));
  await app.step(1);
  const read = () => page.evaluate(() => window.__sl!.panelState().warmth[0]!);
  const seen: number[] = [];
  await page.evaluate(() => window.__sl!.setWarmth(0, 1));
  for (let i = 0; i < 40; i++) {
    await app.step(1);
    seen.push(await read());
  }
  // Rises smoothly: never down, never more than an eighth a frame (72 Hz), all the way up.
  for (let i = 1; i < seen.length; i++) {
    expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(seen[i]! - seen[i - 1]!).toBeLessThan(0.125);
  }
  expect(seen.at(-1)!).toBeGreaterThan(0.95);
  // A warmth that flips 0, 1, 0, 1 every frame comes out as a steady middle glow.
  const flip: number[] = [];
  for (let i = 0; i < 60; i++) {
    await page.evaluate((v) => window.__sl!.setWarmth(0, v), i % 2);
    await app.step(1);
    flip.push(await read());
  }
  const tail = flip.slice(30);
  expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.07);
  // Opening fills in over a moment and stays.
  await page.evaluate(() => window.__sl!.setOpen(0));
  const open: number[] = [];
  for (let i = 0; i < 40; i++) {
    await app.step(1);
    open.push(await page.evaluate(() => window.__sl!.panelState().open[0]!));
  }
  expect(open[0]!).toBeLessThan(0.1);
  expect(open.at(-1)!).toBe(1);
});

test("look shots: box 5 (a hidden silhouette, three locks) at each spot, warmth and an open lock, and box 15's upper locks", async ({ page, boot }) => {
  const app = await boot({ mode: "visual" });
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const panel = (await app.state()).boxPose.position;
  const target = { x: panel[0], y: panel[1], z: panel[2] };
  const box5 = generateBox({ kind: "box", n: 5 });
  await page.evaluate(() => window.__ns!.scene.show({ n: 5 }));
  for (const l of box5.locks) {
    await place(app, l.L);
    await app.captureHeadset(`shadows-box5-spot${l.i + 1}${l.hidden ? "-hidden" : ""}-headset`, target);
  }
  // Warm on a shown lock and on the hidden one, then both open.
  const shown = box5.locks.find((l) => !l.hidden)!, hidden = box5.locks.find((l) => l.hidden);
  await place(app, shown.L);
  await page.evaluate((i) => window.__sl!.setWarmth(i, 0.8), shown.i);
  if (hidden) await page.evaluate((i) => window.__sl!.setWarmth(i, 0.8), hidden.i);
  await app.step(40);
  await app.captureHeadset("shadows-box5-warm-headset", target);
  await page.evaluate((i) => window.__sl!.setOpen(i), shown.i);
  if (hidden) await page.evaluate((i) => window.__sl!.setOpen(i), hidden.i);
  await app.step(40);
  await app.captureHeadset("shadows-box5-open-headset", target);
  await app.capture("shadows-box5-open");
  // Box 15: its upper locks sit under the smoked glass lid from the seated eye.
  const box15 = generateBox({ kind: "box", n: 15 });
  await page.evaluate(() => window.__ns!.scene.show({ n: 15 }));
  const upper = box15.locks.reduce((a, b) => (b.center[1] > a.center[1] ? b : a));
  await place(app, upper.L);
  await app.captureHeadset("shadows-box15-upper-headset", target);
  await app.capture("shadows-box15-upper");
  await page.evaluate(() => window.__sl!.showHanging(false));
  await app.captureHeadset("shadows-box15-upper-panel-headset", target);
  // From the seated eye the smoked glass lid lies over the panel's upper part: how much does it lift
  // the shadows and the lit panel there? The same pixels with and without the glass.
  const setGlass = (v: boolean) =>
    page.evaluate((v) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.__ns!.world as any).scene.getObjectByName("Box Glass").visible = v;
    }, v);
  const band: V3[] = [];
  for (const y of [0.3, 0.34, 0.38, 0.42, 0.46]) for (let x = -0.44; x <= 0.441; x += 0.02) band.push([x, y, 0]);
  const [lid, bare] = await headsetView(app, panel, async () => {
    const a = await probe(page, band);
    await setGlass(false);
    const b = await probe(page, band);
    await setGlass(true);
    return [a, b] as const;
  });
  await page.evaluate(() => window.__sl!.showHanging(true));
  const dark = bare.at.map((l, i) => [l, lid.at[i]!] as const).filter(([l]) => l < DARK);
  const lit = bare.at.map((l, i) => [l, lid.at[i]!] as const).filter(([l]) => l > LIT);
  const lift = (xs: (readonly [number, number])[]) => xs.map(([b, a]) => a - b);
  const line =
    `lid over the upper panel (y 0.30-0.46, ${band.length} points, box 15 at its upper lock's spot): ` +
    `${dark.length} in shadow, luma ${median(dark.map(([b]) => b)).toFixed(0)} bare, ${median(dark.map(([, a]) => a)).toFixed(0)} under the lid ` +
    `(lift median ${median(lift(dark)).toFixed(1)}, max ${Math.max(...lift(dark)).toFixed(1)}); ${lit.length} lit, ` +
    `${median(lit.map(([b]) => b)).toFixed(0)} bare, ${median(lit.map(([, a]) => a)).toFixed(0)} under the lid`;
  console.log(line);
  addRunNote(line);
  expect(dark.length).toBeGreaterThan(5);
  // Shadows under the lid still read as shadows.
  expect(median(dark.map(([, a]) => a))).toBeLessThan(DARK);
});
