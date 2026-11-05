// The solve rule: is a lock's outline filled by shadows, from (near) its secret spot? Ported from the Shadow Locks
// mock (spikes/shadow-locks-mock/shadowgen.js: lockSamples, shadowPolys, hits; shadow-template.html: checkLocks), with
// the mock's pixel masks replaced by exact tests of grid points against the shadow polygons.
//
// shadowPolys and measure run every frame on the headset, so they are exact, cheap and allocate nothing: shadowPolys
// writes into arrays the caller keeps (shadowBuffers sizes them once per box), and measure reuses scratch space of its
// own that only grows when a box casts more shadows than any before it. prepareLock and shadowBuffers run once per box.
import { bbox, circlePts, inPoly, polyDist, projInto } from "./geom";
import type { Element, Lock, Ring, V2, V3 } from "./types";

/**
 * A lock opens when its outline is at least COVER_MIN covered by scraps, at most SPILL_MAX of the lit band around it
 * is darkened by scraps and SPILL_ALL_MAX by scraps and the finger together (a fingertip is a blunter tool, so its
 * spill is judged loosely), and, for a finger lock, at least GAP_MIN of the missing piece is filled.
 */
export const RULE = { COVER_MIN: 0.92, SPILL_MAX: 0.25, SPILL_ALL_MAX: 0.55, GAP_MIN: 0.78 } as const;
/** Warmth (the "getting closer" glow and hum) is 0 further than this from the spot. */
export const WARMTH_RANGE = 0.2;
/** The sample grid's spacing at runtime: about 3.8 mm at the default 24 cm box. */
export const RUNTIME_STEP = 0.016;
/** The margin around an outline that must stay lit. */
export const BAND = 0.04;
/** A ring's shadow is a polygon of this many sides, on its outer radius. */
export const RING_SIDES = 14;
/** shadowPolys options for the scraps actually in the box: a finger lock's missing piece is not there. */
export const SKIP_MISSING: { readonly skipMissing: true } = { skipMissing: true };

export interface LockSamples {
  /** Grid points inside the outline. */
  inside: V2[];
  /** Grid points outside the outline, within BAND of it: they must stay lit. */
  band: V2[];
  /** Indices into `inside` of the points in the missing piece, ascending; empty unless a finger lock. */
  missingIdx: number[];
  /** [minX, minY, maxX, maxY] holding every point. */
  box: [number, number, number, number];
}

export interface Coverage {
  /** Share of the outline, the missing piece aside, darkened by scraps. */
  cover: number;
  /** Share of the band darkened by scraps. */
  spill: number;
  /** Share of the band darkened by scraps or the finger. */
  spillAll: number;
  /** Share of the missing piece darkened by scraps or the finger; 1 when there is no missing piece. */
  gap: number;
}

export interface ShadowOpts {
  /** Leave out pieces marked missing. */
  skipMissing?: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Grid points `step` apart over an outline: those inside it, those in the BAND around it, and which of the inside
 * points fall in piece `missing` (-1 for none). The generator samples with it too (on a finer grid), so boxes are
 * built and judged the same way.
 */
export function lockSamples(target: V2[][], step: number, missing = -1): LockSamples {
  const [x0, y0, x1, y1] = bbox(target.flat());
  const inside: V2[] = [], band: V2[] = [], missingIdx: number[] = [];
  const gap = missing >= 0 ? target[missing] : undefined;
  for (let x = x0 - BAND; x <= x1 + BAND; x += step) {
    for (let y = y0 - BAND; y <= y1 + BAND; y += step) {
      const pt: V2 = [x, y];
      let d = Infinity;
      for (const p of target) {
        d = Math.min(d, polyDist(pt, p));
        if (d === 0) break;
      }
      if (d === 0) {
        if (gap && inPoly(pt, gap)) missingIdx.push(inside.length);
        inside.push(pt);
      } else if (d <= BAND) band.push(pt);
    }
  }
  return { inside, band, missingIdx, box: [x0 - BAND, y0 - BAND, x1 + BAND, y1 + BAND] };
}

/** A lock's sample points for the solve rule, made once per box: the runtime grid by default. */
export function prepareLock(lock: Lock, step = RUNTIME_STEP): LockSamples {
  return lockSamples(lock.target, step, lock.missing);
}

/** Each ring's circle in the box, made once: it does not depend on the lantern. Elements never change. */
const ringPts = new WeakMap<Ring, V3[]>();
function ringPoly(r: Ring): V3[] {
  let pts = ringPts.get(r);
  if (!pts) {
    pts = circlePts(r.c, r.nrm, r.rOut, RING_SIDES);
    ringPts.set(r, pts);
  }
  return pts;
}

/** An `out` for shadowPolys with every array it needs, so even its first call makes none. Once per box. */
export function shadowBuffers(elements: Element[], opts?: ShadowOpts): V2[][] {
  return elements
    .filter((e) => !(opts?.skipMissing && e.kind === "piece" && e.missing))
    .map((e) => Array.from({ length: e.kind === "ring" ? RING_SIDES : e.verts.length }, (): V2 => [0, 0]));
}

/**
 * Every element's shadow on the panel with the lantern at L, written into `out` (polygon k into out[k], its points
 * into out[k]'s own arrays); returns how many. Rings are RING_SIDES-gons of their outer radius. An `out` from
 * shadowBuffers, or one used before with the same elements and options, is reused without making any array; give
 * options as a constant (SKIP_MISSING), not a fresh object each frame.
 */
export function shadowPolys(elements: Element[], L: V3, out: V2[][], opts?: ShadowOpts): number {
  const skip = opts?.skipMissing === true;
  let n = 0;
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]!;
    if (skip && e.kind === "piece" && e.missing) continue;
    const src = e.kind === "ring" ? ringPoly(e) : e.verts;
    let poly = out[n];
    if (!poly) out[n] = poly = [];
    if (poly.length > src.length) poly.length = src.length;
    for (let j = 0; j < src.length; j++) {
      let p = poly[j];
      if (!p) poly[j] = p = [0, 0];
      projInto(src[j]!, L, p);
    }
    n++;
  }
  return n;
}

/**
 * Scratch for measure: the indices and bboxes (4 numbers each) of the polygons that reach the lock. Grown, never
 * shrunk, so a frame allocates only when a box casts more shadows than any before.
 */
let scrapIdx = new Int32Array(64), scrapBox = new Float64Array(256);
let fingerIdx = new Int32Array(8), fingerBox = new Float64Array(32);

/** Of polys[0..n), those whose bbox meets `box`: their indices into idx and bboxes into bb. Returns how many. */
function cull(polys: V2[][], n: number, box: LockSamples["box"], idx: Int32Array, bb: Float64Array): number {
  let m = 0;
  for (let k = 0; k < n; k++) {
    const poly = polys[k]!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j]!, x = p[0], y = p[1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    // Inclusive, like hit's test. A polygon with no finite corner keeps an empty bbox and never counts.
    if (!(x1 >= box[0] && x0 <= box[2] && y1 >= box[1] && y0 <= box[3])) continue;
    idx[m] = k;
    bb[4 * m] = x0;
    bb[4 * m + 1] = y0;
    bb[4 * m + 2] = x1;
    bb[4 * m + 3] = y1;
    m++;
  }
  return m;
}

/** True when pt is in one of the m culled polygons. The bbox test is inclusive, so it never changes inPoly's answer. */
function hit(pt: V2, polys: V2[][], idx: Int32Array, bb: Float64Array, m: number): boolean {
  const x = pt[0], y = pt[1];
  for (let k = 0; k < m; k++) {
    const o = 4 * k;
    if (x < bb[o]! || y < bb[o + 1]! || x > bb[o + 2]! || y > bb[o + 3]!) continue;
    if (inPoly(pt, polys[idx[k]!]!)) return true;
  }
  return false;
}

/**
 * How well the shadows fill a lock: `scraps[0..nScraps)` (every element's shadow but missing pieces) and
 * `finger[0..nFinger)` (the fingertip's), against the lock's samples. Writes into `out` and returns it.
 */
export function measure(s: LockSamples, scraps: V2[][], nScraps: number, finger: V2[][], nFinger: number, out: Coverage): Coverage {
  if (nScraps > scrapIdx.length) {
    scrapIdx = new Int32Array(nScraps * 2);
    scrapBox = new Float64Array(nScraps * 8);
  }
  if (nFinger > fingerIdx.length) {
    fingerIdx = new Int32Array(nFinger * 2);
    fingerBox = new Float64Array(nFinger * 8);
  }
  const ms = cull(scraps, nScraps, s.box, scrapIdx, scrapBox), mf = cull(finger, nFinger, s.box, fingerIdx, fingerBox);
  const inside = s.inside, band = s.band, miss = s.missingIdx;

  let covered = 0, filled = 0, m = 0, next = miss.length ? miss[0]! : -1;
  for (let i = 0; i < inside.length; i++) {
    const pt = inside[i]!;
    if (i === next) {
      if (hit(pt, scraps, scrapIdx, scrapBox, ms) || hit(pt, finger, fingerIdx, fingerBox, mf)) filled++;
      next = ++m < miss.length ? miss[m]! : -1;
    } else if (hit(pt, scraps, scrapIdx, scrapBox, ms)) covered++;
  }
  let spill = 0, spillAll = 0;
  for (let i = 0; i < band.length; i++) {
    const pt = band[i]!;
    if (hit(pt, scraps, scrapIdx, scrapBox, ms)) {
      spill++;
      spillAll++;
    } else if (hit(pt, finger, fingerIdx, fingerBox, mf)) spillAll++;
  }

  const rest = inside.length - miss.length;
  out.cover = rest > 0 ? covered / rest : 0;
  out.spill = band.length ? spill / band.length : 0;
  out.spillAll = band.length ? spillAll / band.length : 0;
  out.gap = miss.length ? filled / miss.length : 1;
  return out;
}

/** The lock opens: all four RULE checks, the gap only for a finger lock. */
export function meets(c: Coverage, finger: boolean): boolean {
  return (
    c.cover >= RULE.COVER_MIN &&
    c.spill <= RULE.SPILL_MAX &&
    c.spillAll <= RULE.SPILL_ALL_MAX &&
    (!finger || c.gap >= RULE.GAP_MIN)
  );
}

/** A finger lock whose scraps are in place (cover and spill met) but whose missing piece is not yet filled. */
export function isShort(c: Coverage, finger: boolean): boolean {
  return finger && c.cover >= RULE.COVER_MIN && c.spill <= RULE.SPILL_MAX && c.gap < RULE.GAP_MIN;
}

/**
 * How close the lantern is to solving the lock, 0..1: rises with cover from 0.4, falls with total spill, and is 0
 * further than WARMTH_RANGE from the spot. Unsmoothed: the render layer eases it.
 */
export function warmth(c: Coverage, distToSpot: number): number {
  if (distToSpot > WARMTH_RANGE) return 0;
  return clamp((c.cover - 0.4) / 0.52, 0, 1) * clamp(1 - c.spillAll / 0.55, 0, 1);
}
