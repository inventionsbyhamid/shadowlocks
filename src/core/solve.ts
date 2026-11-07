// The solve rule: is a lock's outline filled by shadows, from (near) its secret spot? Ported from the Shadow Locks
// mock (spikes/shadow-locks-mock/shadowgen.js: lockSamples, shadowPolys, hits; shadow-template.html: checkLocks), with
// the mock's pixel masks replaced by exact tests of grid points against the shadow polygons.
//
// shadowPolys and measure run every frame on the headset, so they are exact, cheap and allocate nothing: shadowPolys
// writes into arrays the caller keeps (shadowBuffers sizes them once per box), and measure reuses scratch space of its
// own that only grows when a box casts more shadows than any before it. prepareLock and shadowBuffers run once per box.
import { bbox, circlePts, inPoly, projInto } from "./geom";
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
/**
 * The margin around an outline that must stay lit. The generator uses it too: a change alters generated boxes, so bump
 * GENERATOR_VERSION and the golden hashes.
 */
export const BAND = 0.04;
/**
 * A ring's shadow is a polygon of this many sides, on its outer radius. The generator uses it too: a change alters
 * generated boxes, so bump GENERATOR_VERSION and the golden hashes.
 */
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
 * built and judged the same way; a change alters generated boxes, so bump GENERATOR_VERSION and the golden hashes.
 */
export function lockSamples(target: V2[][], step: number, missing = -1): LockSamples {
  const [x0, y0, x1, y1] = bbox(target.flat());
  const inside: V2[] = [], band: V2[] = [], missingIdx: number[] = [];
  const gap = missing >= 0 ? target[missing] : undefined;
  // The same points sorted the same way as testing every piece with polyDist (0 inside, the nearest edge outside), only
  // faster: a piece whose bbox, grown by BAND and a hair, misses the point is further than BAND from it and is skipped;
  // squared distances replace Math.hypot except within a hair of BAND, where the exact distance decides.
  const reach = target.map((p) => {
    const [a, b, c, d] = bbox(p), r = BAND + REACH_SLACK;
    return [a - r, b - r, c + r, d + r] as const;
  });
  const near: number[] = [];
  for (let x = x0 - BAND; x <= x1 + BAND; x += step) {
    for (let y = y0 - BAND; y <= y1 + BAND; y += step) {
      near.length = 0;
      for (let k = 0; k < target.length; k++) {
        const r = reach[k]!;
        if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) near.push(k);
      }
      if (!near.length) continue;
      const pt: V2 = [x, y];
      const where = classify(pt, target, near);
      if (where === 0) {
        if (gap && inPoly(pt, gap)) missingIdx.push(inside.length);
        inside.push(pt);
      } else if (where === 1) band.push(pt);
    }
  }
  return { inside, band, missingIdx, box: [x0 - BAND, y0 - BAND, x1 + BAND, y1 + BAND] };
}

/** How far past BAND (box units) a piece's bbox is grown before a point outside it is skipped: far above rounding. */
const REACH_SLACK = 1e-9;
const BAND2_LO = BAND * BAND * (1 - 1e-9), BAND2_HI = BAND * BAND * (1 + 1e-9);

/**
 * Where pt falls against pieces `near` of target, exactly as the least polyDist over them would say: 0 inside one (or
 * on an edge), 1 within BAND outside, 2 further.
 */
function classify(pt: V2, target: V2[][], near: number[]): 0 | 1 | 2 {
  for (const k of near) if (inPoly(pt, target[k]!)) return 0;
  let within = false;
  for (const k of near) {
    const poly = target[k]!;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      let t = l2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2 : 0;
      t = clamp(t, 0, 1);
      const ex = pt[0] - a[0] - t * dx, ey = pt[1] - a[1] - t * dy, q = ex * ex + ey * ey;
      if (q === 0) return 0;
      if (within) continue;
      if (q < BAND2_LO) within = true;
      else if (q <= BAND2_HI && Math.hypot(ex, ey) <= BAND) within = true;
    }
  }
  return within ? 1 : 2;
}

/** A lock's sample points for the solve rule, made once per box: the runtime grid by default. */
export function prepareLock(lock: Lock, step = RUNTIME_STEP): LockSamples {
  return lockSamples(lock.target, step, lock.missing);
}

/**
 * Each ring's circle in the box, made once: it does not depend on the lantern. A box's elements stay where they are,
 * except while a lesson's example swings them (lesson-layout.ts moves them in place and always puts them back
 * exactly), so the circle cached here is the ring's place in the player's layout. The solve reads a copy made as the
 * box starts (ShadowCaster), never a swung ring.
 */
const ringPts = new WeakMap<Ring, V3[]>();
function ringPoly(r: Ring): V3[] {
  let pts = ringPts.get(r);
  if (!pts) {
    pts = circlePts(r.c, r.nrm, r.rOut, RING_SIDES);
    ringPts.set(r, pts);
  }
  return pts;
}

/**
 * An `out` for shadowPolys with every array it needs, and every ring's circle built, so even its first call makes
 * none. Once per box.
 */
export function shadowBuffers(elements: Element[], opts?: ShadowOpts): V2[][] {
  return elements
    .filter((e) => !(opts?.skipMissing && e.kind === "piece" && e.missing))
    .map((e) => Array.from({ length: e.kind === "ring" ? ringPoly(e).length : e.verts.length }, (): V2 => [0, 0]));
}

/**
 * Every element's shadow on the panel with the lantern at L, written into `out` (polygon k into out[k], its points
 * into out[k]'s own arrays); returns how many. Rings are RING_SIDES-gons of their outer radius. An `out` from
 * shadowBuffers, or one used before with the same elements and options, is reused without making any array; give
 * options as a constant (SKIP_MISSING), not a fresh object each frame.
 *
 * Precondition: L[2] exceeds every element's z (the lantern is in front of every scrap and ring). Otherwise the
 * projection flips or runs off to infinity and the polygons mean nothing. The generator casts the start's shadows
 * with it: a change alters generated boxes, so bump GENERATOR_VERSION and the golden hashes.
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
 * shadowPolys for a box measured every frame: the same polygons and numbers, written at a store site of its own into
 * arrays made as double arrays (the corners read from a Float64Array). On V8 a double array stays one, and a store
 * into it never allocates, as long as no array with generic elements meets the same code; through projInto's store,
 * which every caster shares, one such array is enough to have V8 generalise the rest, and then each coordinate stored
 * boxes a double (about 3.4 KB a call for a three-lock box). Boxes from the worker are rebuilt with plain arrays for
 * the same reason (box-client.ts). Made once per box.
 */
export class ShadowCaster {
  /** The polygons as shadowPolys lays them out (element order, its options), written by `cast`. */
  readonly polys: V2[][];
  /** Every corner's box position, flat (x, y, z). */
  private readonly src: Float64Array;

  constructor(elements: Element[], opts?: ShadowOpts) {
    const shapes: V3[][] = [];
    for (const e of elements) {
      if (opts?.skipMissing && e.kind === "piece" && e.missing) continue;
      shapes.push(e.kind === "ring" ? ringPoly(e) : e.verts);
    }
    this.src = new Float64Array(shapes.reduce((s, p) => s + p.length, 0) * 3);
    let k = 0;
    for (const pts of shapes) {
      for (const p of pts) {
        this.src[k++] = p[0];
        this.src[k++] = p[1];
        this.src[k++] = p[2];
      }
    }
    // NaN corners until the first cast: double arrays from the start.
    this.polys = shapes.map((pts) => pts.map((): V2 => [Number.NaN, Number.NaN]));
  }

  /** Cast every polygon with the lantern at L (same precondition and numbers as shadowPolys); returns how many. */
  cast(L: V3): number {
    const s = this.src, polys = this.polys, lx = L[0], ly = L[1], lz = L[2];
    let i = 0;
    for (let k = 0; k < polys.length; k++) {
      const poly = polys[k]!;
      for (let j = 0; j < poly.length; j++, i += 3) {
        const p = poly[j]!;
        const f = lz / (lz - s[i + 2]!);
        p[0] = lx + (s[i]! - lx) * f;
        p[1] = ly + (s[i + 1]! - ly) * f;
      }
    }
    return polys.length;
  }
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
 * `s.missingIdx` must be ascending, as lockSamples makes it. The generator's start check reads `cover`: a change to
 * it alters generated boxes, so bump GENERATOR_VERSION and the golden hashes.
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
