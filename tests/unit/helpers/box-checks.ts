// Independent checks of the generator's guarantees, shared by the generator and mirror tests. They rebuild the sample
// grid and the shadows from geom.ts alone, so a bug in the generator's own checks cannot hide here.
import { ENVELOPE } from "../../../src/core/envelope";
import { area, bbox, circlePts, elongation, inPoly, polyDist, proj, segDist } from "../../../src/core/geom";
import { boxParams, boxParamsV3, dailyParams, silhouetteCount } from "../../../src/core/params";
import { SILHOUETTES } from "../../../src/core/shapes";
import type { Box, BoxParams, Element, Piece, Ring, V2, V3 } from "../../../src/core/types";

/** The lit margin around an outline, as in the mock. */
export const BAND = 0.04;
export const COVER_MIN = 0.97;
export const FINGER_WITHOUT_MAX = 0.93;
export const SPILL_MAX = 0.02;
export const START_MAX = 0.5;

export interface Samples {
  inside: V2[];
  band: V2[];
}

/** Grid points inside a lock's outline, and in the band around it. */
export function samples(target: V2[][], step = 0.01): Samples {
  const [x0, y0, x1, y1] = bbox(target.flat());
  const inside: V2[] = [], band: V2[] = [];
  for (let x = x0 - BAND; x <= x1 + BAND; x += step) {
    for (let y = y0 - BAND; y <= y1 + BAND; y += step) {
      let d = Infinity;
      for (const p of target) {
        d = Math.min(d, polyDist([x, y], p));
        if (d === 0) break;
      }
      if (d === 0) inside.push([x, y]);
      else if (d <= BAND) band.push([x, y]);
    }
  }
  return { inside, band };
}

/** Every element's shadow on the panel from L; rings as 14-gons of their outer radius. */
export function shadows(elements: Element[], L: V3, skipMissing = false): V2[][] {
  const out: V2[][] = [];
  for (const e of elements) {
    if (skipMissing && e.kind === "piece" && e.missing) continue;
    if (e.kind === "ring") out.push(circlePts(e.c, e.nrm, e.rOut, 14).map((p) => proj(p, L)));
    else out.push(e.verts.map((p) => proj(p, L)));
  }
  return out;
}

/** The share of `pts` inside any of `polys`. */
export function covered(pts: V2[], polys: V2[][]): number {
  if (!pts.length) return 0;
  const boxes = polys.map(bbox);
  let n = 0;
  for (const pt of pts) {
    for (let i = 0; i < polys.length; i++) {
      const b = boxes[i]!;
      if (pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) continue;
      if (inPoly(pt, polys[i]!)) {
        n++;
        break;
      }
    }
  }
  return n / pts.length;
}

const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function paramsFor(box: Box): BoxParams {
  if (box.spec.kind === "box") return box.spec.gen === 3 ? boxParamsV3(box.spec.n) : boxParams(box.spec.n);
  if (box.spec.kind === "daily") return dailyParams();
  throw new Error("no params for a lesson");
}

/** How many silhouettes a box shows: two in a silhouettes box, else one once it hides an outline (one at most in version 3). */
export function silhouettesFor(box: Box): number {
  if (box.spec.kind === "box" && box.spec.gen !== 3) return silhouetteCount(box.spec.n);
  return paramsFor(box).hidden >= 1 ? 1 : 0;
}

export interface LockStat {
  box: string;
  lock: number;
  finger: boolean;
  /** Coverage from the spot without the missing piece (all pieces for a plain lock). */
  cov: number;
  /** Coverage from the spot with every piece. */
  covAll: number;
  spill: number;
  /** Share of the outline and its band covered from the spot by anything but the lock's own pieces. */
  foreign: number;
  atStart: number;
  /** A finger lock's missing piece's direction, recomputed from its outline; 0 for a plain lock. */
  fingerAngle: number;
}

/**
 * Solvable from each spot, a finger lock short exactly its piece, no spill, no other scrap on the lock, nothing solved
 * from the start.
 */
export function checkSolvable(box: Box, stats?: LockStat[]): string[] {
  const errs: string[] = [];
  const fromStart = shadows(box.elements, box.start);
  for (const l of box.locks) {
    const s = samples(l.target);
    const cov = covered(s.inside, shadows(box.elements, l.L, true));
    const all = shadows(box.elements, l.L);
    const covAll = covered(s.inside, all);
    const spill = covered(s.band, all);
    const others = shadows(box.elements.filter((e) => !(e.kind === "piece" && e.lock === l.i)), l.L);
    const foreign = covered([...s.inside, ...s.band], others);
    const atStart = covered(s.inside, fromStart);
    const fingerAngle = l.finger ? elongation(l.target[l.missing]!).angle : 0;
    stats?.push({ box: box.key, lock: l.i, finger: l.finger, cov, covAll, spill, foreign, atStart, fingerAngle });
    if (foreign > SPILL_MAX) errs.push(`lock ${l.i} other scraps cover ${foreign.toFixed(3)} of it`);
    if (l.finger) {
      if (cov > FINGER_WITHOUT_MAX) errs.push(`lock ${l.i} finger piece too small (${cov.toFixed(3)} without it)`);
      if (covAll < COVER_MIN) errs.push(`lock ${l.i} with its piece only ${covAll.toFixed(3)}`);
    } else if (cov < COVER_MIN) errs.push(`lock ${l.i} coverage ${cov.toFixed(3)}`);
    if (spill > SPILL_MAX) errs.push(`lock ${l.i} spill ${spill.toFixed(3)}`);
    if (atStart >= START_MAX) errs.push(`lock ${l.i} ${atStart.toFixed(3)} covered from the start`);
  }
  return errs;
}

/** Every spot inside the envelope, apart from the others and from the start. */
export function checkSpots(box: Box): string[] {
  const E = ENVELOPE, errs: string[] = [];
  const start: V3 = [box.mirrored ? -E.START[0] : E.START[0], E.START[1], E.START[2]];
  if (dist3(box.start, start) > 1e-12) errs.push(`start ${box.start.join("/")} is not the envelope's`);
  const amp = box.params.amp * E.LX_MAX;
  box.locks.forEach((l, i) => {
    const [x, y, z] = l.L;
    if (z < E.LZ[0] || z > E.LZ[1]) errs.push(`lock ${i} spot z ${z.toFixed(3)}`);
    if (Math.abs(x) > E.LX_MAX || Math.abs(x) > amp + 1e-12) errs.push(`lock ${i} spot x ${x.toFixed(3)}`);
    if (y < E.LY[0] || y > E.LY[1]) errs.push(`lock ${i} spot y ${y.toFixed(3)}`);
    if (dist3(l.L, box.start) < E.SPOT_MIN_SEP) errs.push(`lock ${i} spot ${dist3(l.L, box.start).toFixed(3)} from the start`);
    for (let j = 0; j < i; j++) {
      const d = dist3(l.L, box.locks[j]!.L);
      if (d < E.SPOT_MIN_SEP) errs.push(`spots ${j} and ${i} ${d.toFixed(3)} apart`);
    }
  });
  return errs;
}

/** How far a ring reaches from its centre along one axis: r * sqrt(1 - n_axis^2). */
const reach = (r: Ring, axis: 0 | 1 | 2) => r.rOut * Math.sqrt(Math.max(0, 1 - r.nrm[axis] ** 2));

/** Every scrap and ring inside the box: |x|, |y| <= IN_BOX_XY and z within PIECE_Z. */
export function checkInBox(box: Box): string[] {
  const E = ENVELOPE, errs: string[] = [];
  const ok = (p: V3, rx = 0, ry = 0, rz = 0) =>
    Math.abs(p[0]) + rx <= E.IN_BOX_XY && Math.abs(p[1]) + ry <= E.IN_BOX_XY && p[2] - rz >= E.PIECE_Z[0] && p[2] + rz <= E.PIECE_Z[1];
  box.elements.forEach((e, k) => {
    if (e.kind === "ring") {
      if (!ok(e.c, reach(e, 0), reach(e, 1), reach(e, 2))) errs.push(`ring ${k} at ${e.c.map((v) => v.toFixed(3)).join("/")}`);
    } else if (!e.verts.every((p) => ok(p))) errs.push(`${e.kind} ${k} outside the box`);
  });
  return errs;
}

/** Locks, finger locks, decoys, ringless and hidden locks as boxParams says, and every lock fully built. */
export function checkCounts(box: Box): string[] {
  const P = paramsFor(box), errs: string[] = [];
  const count = (f: (e: Element) => boolean) => box.elements.filter(f).length;
  if (box.locks.length !== P.locks) errs.push(`${box.locks.length} locks, want ${P.locks}`);
  const fingers = box.locks.filter((l) => l.finger).length;
  if (fingers !== P.fingerLocks) errs.push(`${fingers} finger locks, want ${P.fingerLocks}`);
  if (count((e) => e.kind === "decoy") !== P.decoys) errs.push(`${count((e) => e.kind === "decoy")} decoys, want ${P.decoys}`);
  const ringless = box.locks.filter((l) => !l.rings).length;
  if (ringless !== P.ringless) errs.push(`${ringless} ringless locks, want ${P.ringless}`);
  const hidden = box.locks.filter((l) => l.hidden).length;
  if (hidden !== P.hidden) errs.push(`${hidden} hidden locks, want ${P.hidden}`);
  for (const l of box.locks) {
    const pieces = box.elements.filter((e): e is Piece => e.kind === "piece" && e.lock === l.i);
    if (pieces.length !== l.target.length) errs.push(`lock ${l.i} has ${pieces.length} of ${l.target.length} pieces`);
    const missing = pieces.filter((e) => e.missing).map((e) => e.piece);
    if (l.finger ? missing.length !== 1 || missing[0] !== l.missing : missing.length !== 0 || l.missing !== -1) {
      errs.push(`lock ${l.i} missing piece ${l.missing} but ${missing.length} marked`);
    }
    if (l.finger) {
      const angle = elongation(l.target[l.missing]!).angle;
      if (!(Math.abs(l.fingerAngle - angle) < 1e-12)) errs.push(`lock ${l.i} fingerAngle ${l.fingerAngle} but its piece runs at ${angle}`);
    }
    const rings = count((e) => e.kind === "ring" && e.lock === l.i);
    if (l.rings ? rings !== 2 || !l.mark : rings !== 0 || l.mark !== null) errs.push(`lock ${l.i} rings ${l.rings} with ${rings} rings`);
  }
  return errs;
}

/**
 * The box's silhouettes, each on a hidden lock and no two the same: two in a silhouettes box, else one when the box
 * hides any outline.
 */
export function checkSilhouettes(box: Box): string[] {
  const errs: string[] = [];
  const sil = box.locks.filter((l) => SILHOUETTES.includes(l.shape));
  const want = silhouettesFor(box);
  if (sil.length !== want) errs.push(`${sil.length} silhouettes (${sil.map((l) => l.shape).join(", ")}), want ${want}`);
  if (new Set(sil.map((l) => l.shape)).size !== sil.length) errs.push(`the same silhouette twice: ${sil.map((l) => l.shape).join(", ")}`);
  for (const l of sil) if (!l.hidden) errs.push(`lock ${l.i} is a ${l.shape} with its outline shown`);
  return errs;
}

/** A finger lock's missing piece is at most this share of its shape: one finger's shadow has to fill it. */
export const FINGER_SHARE_MAX = 0.35;
/** A hidden lock's pieces hang at most this far from the panel, so silhouette details stay sharp. */
export const HIDDEN_Z_MAX = 0.45;

/** The share of its shape each finger lock's missing piece takes. */
export function missingShares(box: Box): number[] {
  return box.locks
    .filter((l) => l.finger)
    .map((l) => area(l.target[l.missing]!) / l.target.reduce((s, p) => s + area(p), 0));
}

/** Missing pieces a finger can fill, and hidden locks' pieces near the panel. */
export function checkFingerAndDepth(box: Box): string[] {
  const errs: string[] = [];
  box.locks.forEach((l) => {
    if (!l.finger) return;
    const share = area(l.target[l.missing]!) / l.target.reduce((s, p) => s + area(p), 0);
    if (share > FINGER_SHARE_MAX) errs.push(`lock ${l.i} (${l.shape}) misses a piece of share ${share.toFixed(3)}`);
  });
  for (const e of box.elements) {
    if (e.kind !== "piece" || !box.locks[e.lock]!.hidden) continue;
    const z = Math.max(...e.verts.map((p) => p[2]));
    if (z > HIDDEN_Z_MAX) errs.push(`hidden lock ${e.lock} piece ${e.piece} hangs at z ${z.toFixed(3)}`);
  }
  return errs;
}

/**
 * How far apart a lock's ring shadow centres (and the mark) may be. Perspective shifts each projected ellipse's
 * centre by about tan(tilt) * rho^2 / Lz, most for the biggest circle (rho 0.044); tilt is the angle between the
 * ray from the spot to the mark and the panel's normal. 20% headroom plus 2e-4 for sampling.
 */
export function ringConcentricBound(L: V3, mark: V2): number {
  const tanTilt = Math.hypot(L[0] - mark[0], L[1] - mark[1]) / L[2];
  return (1.2 * tanTilt * 0.044 ** 2) / L[2] + 2e-4;
}
/** From the spot, the deep ring's shadow sits in the shallow one's hole with this gap all round. */
export const RING_GAP = 0.008;
/**
 * Slack on the gap, for two effects far below anything visible (2e-5 box units is 0.005 mm at 24 cm):
 * - Perspective shifts the bigger ellipse's centre a little more. At small tilts, where the stretch doesn't make up
 *   for it, the deep ring sits up to (0.032^2 - 0.024^2)^2 / (0.016 * Lz^2) nearer one side of the hole: 9.5e-6 at
 *   Lz 1.15.
 * - Sampling the circles as 180-gons, up to about 5e-6.
 */
const RING_GAP_SLACK = 2e-5;

export interface RingStat {
  /** Largest distance between any two projected circle centres, or from one to the mark. */
  offset: number;
  /** That distance as a share of the lock's bound (ringConcentricBound). */
  offsetShare: number;
  /** Smallest distance from the deep ring's outer edge to the shallow ring's inner edge, on the panel. */
  gap: number;
}

/** Points of a ring's circle of radius r, cast on the panel from L. */
const castCircle = (r: Ring, radius: number, L: V3) => circlePts(r.c, r.nrm, radius, 180).map((p) => proj(p, L));
const centreOf = (pts: V2[]): V2 => {
  const [x0, y0, x1, y1] = bbox(pts);
  return [(x0 + x1) / 2, (y0 + y1) / 2];
};

/**
 * At each lock's spot its two ring shadows make a bullseye on the mark: all four circles (projected ellipses, as the
 * rings face the lantern, not the panel) share a centre, and the deep ring's outer edge stays inside the shallow
 * ring's hole with a clean gap all round.
 */
export function checkRingsNest(box: Box, stats?: RingStat[]): string[] {
  const errs: string[] = [];
  for (const l of box.locks) {
    if (!l.rings || !l.mark) continue;
    const rings = box.elements.filter((e): e is Ring => e.kind === "ring" && e.lock === l.i).sort((a, b) => a.c[2] - b.c[2]);
    if (rings.length !== 2) continue; // checkCounts reports it
    const [deep, shallow] = rings as [Ring, Ring];
    const deepOut = castCircle(deep, deep.rOut, l.L), shallowIn = castCircle(shallow, shallow.rIn, l.L);
    const centres = [l.mark, centreOf(deepOut), centreOf(castCircle(deep, deep.rIn, l.L)), centreOf(shallowIn),
      centreOf(castCircle(shallow, shallow.rOut, l.L))];
    let offset = 0;
    for (let i = 0; i < centres.length; i++) {
      for (let j = 0; j < i; j++) offset = Math.max(offset, Math.hypot(centres[i]![0] - centres[j]![0], centres[i]![1] - centres[j]![1]));
    }
    let gap = Infinity;
    for (const p of deepOut) {
      if (!inPoly(p, shallowIn)) gap = -Infinity;
      for (let i = 0; i < shallowIn.length; i++) gap = Math.min(gap, segDist(p, shallowIn[i]!, shallowIn[(i + 1) % shallowIn.length]!));
    }
    const bound = ringConcentricBound(l.L, l.mark);
    stats?.push({ offset, offsetShare: offset / bound, gap });
    if (offset > bound) errs.push(`lock ${l.i} ring shadows ${offset.toFixed(5)} off centre (bound ${bound.toFixed(5)})`);
    if (gap < RING_GAP - RING_GAP_SLACK) errs.push(`lock ${l.i} deep ring shadow gap ${gap.toFixed(7)} inside the shallow ring's hole`);
  }
  return errs;
}

/** From a ringed lock's spot, every shadow but its own two rings stays this far from its mark. */
export const MARK_SHADOW_CLEAR = 0.07;

/**
 * Nothing blots a bullseye: from each ringed lock's spot, every other shadow (pieces of any lock, decoys, other
 * locks' rings, as their true circles) stays MARK_SHADOW_CLEAR from the lock's mark. Pushes each lock's clearance.
 */
export function checkMarkClear(box: Box, clearance?: number[]): string[] {
  const errs: string[] = [];
  for (const l of box.locks) {
    if (!l.rings || !l.mark) continue;
    let min = Infinity;
    box.elements.forEach((e, k) => {
      if (e.kind === "ring" && e.lock === l.i) return;
      const poly = e.kind === "ring" ? castCircle(e, e.rOut, l.L) : e.verts.map((p) => proj(p, l.L));
      const d = polyDist(l.mark!, poly);
      min = Math.min(min, d);
      if (d < MARK_SHADOW_CLEAR) {
        const what = e.kind === "decoy" ? "a decoy" : `lock ${e.lock}'s ${e.kind}`;
        errs.push(`lock ${l.i}'s mark has ${what} (#${k}) ${d.toFixed(4)} from it`);
      }
    });
    clearance?.push(min);
  }
  return errs;
}

/** Every per-box guarantee at once. */
export function checkBox(box: Box, stats?: LockStat[]): string[] {
  return [
    ...checkSolvable(box, stats),
    ...checkSpots(box),
    ...checkInBox(box),
    ...checkCounts(box),
    ...checkSilhouettes(box),
    ...checkFingerAndDepth(box),
    ...checkRingsNest(box),
    ...checkMarkClear(box),
  ];
}

/** Which way each finger lock's missing piece runs, recomputed from its outline (not the box's own fingerAngle). */
export function fingerAngles(box: Box): number[] {
  return box.locks.filter((l) => l.finger).map((l) => elongation(l.target[l.missing]!).angle);
}

/** True when an angle (radians, from horizontal) is within 45 degrees of horizontal. */
export const nearHorizontal = (a: number) => Math.abs(Math.atan(Math.tan(a))) <= Math.PI / 4 + 1e-12;
