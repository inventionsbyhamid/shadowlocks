/* eslint-disable @typescript-eslint/no-explicit-any */
// Helpers for the finger specs: read the hands and the finger locks through window.__sl, lay an IWER hand's pointing
// index finger along a line in the box (box units), and record the finger lock frame by frame.
import type { Page } from "@playwright/test";
import type { SlFingerLock, SlHand, SlHands } from "../../../src/app/test-api";
import type { V2, V3, Vec3 } from "../../../src/core/types";
import { Hands } from "./hands";
import { add, dot, len, type P3, sub, unit } from "./lantern";
import type { XrApp } from "./xr-app";

export const hands = (page: Page): Promise<SlHands> => page.evaluate(() => window.__sl!.hands());

/**
 * The hand is in the box mouth as its shadows count it: an index finger joint at box z <= 1 (MOUTH_Z) within 0.6
 * (MOUTH_XY, src/render/hand-shadow.ts) of the box's middle across and up.
 */
export const indexInMouth = (h: SlHand): boolean =>
  h.index.some(([x, y, z]) => z <= 1 && Math.abs(x) <= 0.6 && Math.abs(y) <= 0.6);
export const fingerLocks = (page: Page): Promise<SlFingerLock[]> => page.evaluate(() => window.__sl!.fingerLocks());

export async function worldOf(page: Page, pts: P3[]): Promise<Vec3[]> {
  return page.evaluate((q) => window.__ns!.scene.toWorld(q), pts.map((p) => [p[0], p[1], p[2]] as V3));
}

const xyz = (p: P3) => ({ x: p[0], y: p[1], z: p[2] });
const cross = (a: P3, b: P3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** `v` turned by the smallest rotation that takes unit `from` onto unit `to` (Rodrigues). */
export function turn(v: P3, from: P3, to: P3): Vec3 {
  const axis = cross(from, to), s = len(axis), c = dot(from, to);
  if (s < 1e-9) return [v[0], v[1], v[2]];
  const k = unit(axis), kv = cross(k, v), kd = dot(k, v);
  return add(add(add([0, 0, 0], v, c), kv, s), k, kd * (1 - c));
}

/** The middle of a polygon's corners and the way it runs (its long axis, radians from horizontal). */
export function axisOf(poly: V2[]): { mid: V2; angle: number } {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p[0] / poly.length;
    y += p[1] / poly.length;
  }
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of poly) {
    const dx = p[0] - x, dy = p[1] - y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return { mid: [x, y], angle: 0.5 * Math.atan2(2 * sxy, sxx - syy) };
}

/** The point at depth z on the ray from the lantern L through panel point S. */
export const onRay = (L: P3, S: V2, z: number): Vec3 => {
  const k = (L[2] - z) / L[2];
  return [L[0] + (S[0] - L[0]) * k, L[1] + (S[1] - L[1]) * k, z];
};

/**
 * An IWER hand in IWER's `point` pose, placed by its index fingertip. `lay` turns and moves it until its index
 * finger's last two bones (intermediate joint to tip, read back through __sl.hands) run along a line in the box.
 */
export class Pointer extends Hands {
  /** The fingertip (world) and the wrist's directions IWER was last given. */
  tip: Vec3 = [0, 0, 0];
  private fingers: Vec3 = [0, 0, -1];
  private palm: Vec3 = [0, -1, 0];

  /** Put the fingertip at `tip` (world), the hand turned by its fingers' and palm's directions (world). */
  async point(tip: P3, fingers: P3 = this.fingers, palm: P3 = this.palm): Promise<void> {
    await this.usePose("point");
    this.tip = [tip[0], tip[1], tip[2]];
    this.fingers = [fingers[0], fingers[1], fingers[2]];
    this.palm = [palm[0], palm[1], palm[2]];
    await this.app.queue("set_transform", {
      device: this.device,
      anchor: "index-tip",
      position: xyz(tip),
      orientation: { fingers: xyz(fingers), palm: xyz(palm) },
    });
    await this.app.settle(10_000, 2);
  }

  /** The index finger's intermediate, distal and tip joints now, in box units. */
  async index(): Promise<[V3, V3, V3]> {
    const h = (await hands(this.app.page))[this.side];
    if (!h) throw new Error(`hand-${this.side} is not tracked`);
    return h.index;
  }

  /**
   * Lay the finger's last two bones along the line through `mid` in direction `dir` (box units, tip-ward), centred
   * on `mid`. Returns how far off it ended (box units): the chain's middle from `mid`, and its angle (radians).
   */
  async lay(mid: P3, dir: P3): Promise<{ off: number; angle: number }> {
    const page = this.app.page;
    const [mW, aheadW, inW] = await worldOf(page, [mid, add(mid, dir), add(mid, [0, 0, -1])]);
    const dW = unit(sub(aheadW!, mW!));
    // Fingers along the line, the palm toward the panel.
    let f = dW, p = unit(sub(inW!, mW!));
    p = unit(sub(p, add([0, 0, 0], f, dot(p, f))));
    let tip = add(mW!, dW, 0.023);
    for (let i = 0; i < 4; i++) {
      await this.point(tip, f, p);
      const [I, , T] = await this.index();
      const [iW, tW] = await worldOf(page, [I, T]);
      const e = unit(sub(tW!, iW!));
      f = turn(f, e, dW);
      p = turn(p, e, dW);
      // Turning swings the chain round the fingertip: aim its middle at the line's middle from there.
      tip = add(mW!, dW, len(sub(tW!, iW!)) / 2);
    }
    await this.point(tip, f, p);
    const [I, , T] = await this.index();
    const m: Vec3 = [(I[0] + T[0]) / 2, (I[1] + T[1]) / 2, (I[2] + T[2]) / 2];
    const e = unit(sub(T, I));
    return { off: len(sub(m, mid)), angle: Math.acos(Math.min(1, dot(e, unit(dir)))) };
  }

  /** Move the whole hand by `d` (world metres) at once, as laid. */
  async shift(d: P3): Promise<void> {
    await this.point(add(this.tip, d));
  }
}

/**
 * Step one frame and read the rendered panel's luma (0..255) at box points: projected with the first XR view's camera
 * into the canvas and read in the same task as the frame (as shadows.spec.ts's probe). For that frame only, what
 * hangs in the box (scraps, threads, rings, lantern) is hidden and the hand mask writes no depth, so the panel with
 * its shadows is what is read, even where a hand stands between it and the eye.
 */
export function panelLuma(page: Page, pts: V3[]): Promise<number[]> {
  return page.evaluate((pts) => {
    const w = window as any;
    const scene = w.__ns.world.scene, mask = scene.getObjectByName("Hand Mask");
    const depthWrite = mask.material.depthWrite;
    mask.material.depthWrite = false;
    w.__sl.showHanging(false);
    try {
      w.__vt.step(1000 / 72);
      const renderer = w.__ns.world.renderer, canvas = renderer.domElement as HTMLCanvasElement, xr = renderer.xr;
      const cam = xr.getCamera().cameras[0];
      const layer = xr.getBaseLayer?.();
      const W = canvas.width, H = canvas.height;
      const sx = W / (layer?.framebufferWidth ?? W), sy = H / (layer?.framebufferHeight ?? H);
      const c2: HTMLCanvasElement = (w.__lumaCanvas ||= document.createElement("canvas"));
      c2.width = W;
      c2.height = H;
      const g = c2.getContext("2d", { willReadFrequently: true })!;
      g.clearRect(0, 0, W, H);
      g.drawImage(canvas, 0, 0);
      const data = g.getImageData(0, 0, W, H).data;
      const world = w.__ns.scene.toWorld(pts) as [number, number, number][];
      const V = cam.matrixWorldInverse.elements as number[], P = cam.projectionMatrix.elements as number[], vp = cam.viewport;
      return world.map(([x, y, z]) => {
        const vx = V[0]! * x + V[4]! * y + V[8]! * z + V[12]!, vy = V[1]! * x + V[5]! * y + V[9]! * z + V[13]!;
        const vz = V[2]! * x + V[6]! * y + V[10]! * z + V[14]!;
        const cx = P[0]! * vx + P[4]! * vy + P[8]! * vz + P[12]!, cy = P[1]! * vx + P[5]! * vy + P[9]! * vz + P[13]!;
        const cw = P[3]! * vx + P[7]! * vy + P[11]! * vz + P[15]!;
        const px = Math.min(W - 1, Math.max(0, Math.floor((vp.x + ((cx / cw + 1) / 2) * vp.z) * sx)));
        const py = Math.min(H - 1, Math.max(0, Math.floor(H - (vp.y + ((cy / cw + 1) / 2) * vp.w) * sy)));
        const i = (py * W + px) * 4;
        return 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      });
    } finally {
      mask.material.depthWrite = depthWrite;
      w.__sl.showHanging(true);
    }
  }, pts);
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Points inside a convex polygon on the panel: its middle and the way out to each corner (`k` of the way). */
export function inside(poly: V2[], ks: number[] = [0, 0.35, 0.6]): V3[] {
  const { mid } = axisOf(poly);
  const out: V3[] = [];
  for (const k of ks) {
    if (k === 0) out.push([mid[0], mid[1], 0]);
    else for (const p of poly) out.push([mid[0] + (p[0] - mid[0]) * k, mid[1] + (p[1] - mid[1]) * k, 0]);
  }
  return out;
}

/** One frame of the finger lock and the hands, recorded after every step. */
export interface FingerFrame {
  t: number;
  state: string;
  progress: number;
  meets: boolean;
  gap: number;
  open: boolean;
  n: number;
  /** Outlines the right hand cast (0 when it is not tracked). */
  nRight: number;
  nFinger: number;
  fingerZ: number | null;
}

/** Record the box's first finger lock and the hands after every frame from now on. */
export async function startFingerTrail(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    if (!w.__fingerTrailOn) {
      const step = w.__vt.step.bind(w.__vt);
      w.__vt.step = (ms: number) => {
        const r = step(ms);
        if (w.__fingerTrail) {
          const l = w.__sl.fingerLocks()[0];
          const h = w.__sl.hands();
          w.__fingerTrail.push({
            t: w.__vt.now,
            state: l?.state ?? "none",
            progress: l?.progress ?? 0,
            meets: !!l?.meets,
            gap: l?.coverage.gap ?? 0,
            open: l?.state === "done",
            n: h.outlines.length,
            nRight: h.right?.outlines ?? 0,
            nFinger: h.finger.length,
            fingerZ: h.fingerZ,
          });
        }
        return r;
      };
      w.__fingerTrailOn = true;
    }
    w.__fingerTrail = [];
  });
}

export const takeFingerTrail = (page: Page): Promise<FingerFrame[]> =>
  page.evaluate(() => {
    const w = window as any;
    const s = w.__fingerTrail as FingerFrame[];
    w.__fingerTrail = null;
    return s;
  });

/**
 * Box 3 in play with the lantern on its finger lock's spot (the lock one piece short), and where a finger at depth
 * `z` must lie to fill the gap: the middle of the missing piece and the way it runs, on the rays from the spot.
 */
export async function atFingerLock(app: XrApp, page: Page, z: number) {
  await page.evaluate(() => window.__ns!.scene.show({ n: 3 }));
  await app.step(2);
  let [lock] = await fingerLocks(page);
  if (!lock) throw new Error("box 3 has no finger lock");
  await page.evaluate((L) => window.__sl!.placeLantern(L), lock.spot);
  await app.step(3);
  [lock] = await fingerLocks(page);
  const { mid, angle } = axisOf(lock!.piece);
  // The finger points to the player's left, so a right hand lies to the right of the gap.
  const sign = Math.cos(angle) >= 0 ? -1 : 1;
  const dir: Vec3 = [sign * Math.cos(angle), sign * Math.sin(angle), 0];
  return { lock: lock!, mid: onRay(lock!.spot, mid, z), dir };
}
