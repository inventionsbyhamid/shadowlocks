// The box generator: endless boxes from a seed, the same box for the same spec everywhere. Ported from the Shadow
// Locks mock (spikes/shadow-locks-mock/shadowgen.js, generate and tryBuild), with the lantern spots inside the seated
// comfort envelope (envelope.ts), the difficulty curve and box kinds of params.ts, silhouettes only on hidden locks
// (one a box, two in a silhouettes box, dealt by silhouette-deck.ts), sight rings whose shadows make a bullseye at the
// spot, and finger pieces that run near horizontal.
//
// What every box guarantees (tests/unit/generator.test.ts): from its spot, each lock's scraps tile its outline and
// leave the band around it lit; a finger lock is short exactly its missing piece; no other scrap or ring falls on a
// lock or near its ring mark from its spot; the start solves nothing; every spot is inside the envelope and apart from
// the others.
import { ENVELOPE } from "./envelope";
import { frameMs, renderCorners } from "./frame-cost";
import { area, bbox, circlePts, elongation, hash, inPoly, polyDist, proj, rng32, segDist } from "./geom";
import { boxParams, boxParamsV3, dailyParams, KINDS_FROM } from "./params";
import { mirrorLock } from "./mirror";
import { isDayKey } from "./profile";
import { FIRST_SILHOUETTES, SHAPES, SILHOUETTES } from "./shapes";
import { boxSilhouettes } from "./silhouette-deck";
import {
  BAND,
  type Coverage,
  FINGER_RADIUS_CM,
  type LockSamples,
  lockSamples,
  measure,
  RING_SIDES,
  RULE,
  RUNTIME_STEP,
  shadowPolys,
  SKIP_MISSING,
  warmth,
  WARMTH_RANGE,
} from "./solve";
import { LOOT, OWNERS } from "./story";
import type { Box, BoxParams, BoxSpec, Element, Lock, Ring, ShapeName, V2, V3 } from "./types";

/**
 * The generator's version. Bump it with any change that alters a box for some spec (RNG call order, a constant, a
 * shape, a check), and update the golden hashes in tests/unit/generator.test.ts. Saves store it with each box, so a
 * box saved under another version can be told apart, and rebuilt as it was if that version is still buildable.
 */
export const GENERATOR_VERSION = 4;
/**
 * The versions buildBox can still build. Version 3 (before the box kinds and the added silhouettes) is kept so a box
 * saved mid-play under it resumes as the same box: its spec carries `gen: 3`.
 */
export const BUILDABLE_VERSIONS: readonly number[] = [3, 4];

/** The generator version a spec asks for: its own `gen` for a box saved under an older one, else this one. */
export function genOf(spec: BoxSpec): number {
  return spec.kind !== "lesson" && spec.gen !== undefined ? spec.gen : GENERATOR_VERSION;
}

/**
 * The spec to rebuild a saved box from: `spec` itself, or, for a save of this box made under an older version this
 * generator can still build, the spec of that version's box. Any other save is played afresh (box-session.ts).
 */
export function specForSave(spec: BoxSpec, save: { key: string; gen?: number } | null | undefined): BoxSpec {
  if (spec.kind === "lesson" || !save || save.gen === undefined || save.gen === GENERATOR_VERSION) return spec;
  if (!BUILDABLE_VERSIONS.includes(save.gen) || save.key !== seedKey(spec)) return spec;
  return { ...spec, gen: save.gen };
}

const E = ENVELOPE;
/** Spacing of the grid points for the start check and the ring marks' clearance. */
const STEP = 0.008;
/** Whole-box attempts before giving up, and tries per spot, piece and decoy within one attempt. */
const ATTEMPTS = 300;
/** Attempts that keep a box's own classic shapes before drawing them afresh (from box 10, version 4). */
const FIXED_CLASSIC_TRIES = 3;
const SPOT_TRIES = 80;
const PIECE_TRIES = 50;
const DECOY_TRIES = 40;
/** Where the locks sit on the panel, by lock count: centre and size (the outline's largest side). */
const LAYOUTS: Record<1 | 2 | 3, { c: V2; size: number }[]> = {
  1: [{ c: [0, 0.05], size: 0.46 }],
  2: [
    { c: [-0.2, 0.13], size: 0.34 },
    { c: [0.21, -0.12], size: 0.34 },
  ],
  3: [
    { c: [-0.24, 0.2], size: 0.29 },
    { c: [0.24, 0.18], size: 0.29 },
    { c: [0, -0.2], size: 0.29 },
  ],
};
/** A lock's outline turns by up to this much either way, in radians. */
const ROT_MAX = 0.5;
/**
 * A lock's two sight rings: a depth range, and the outer and inner radius of the ring's shadow on the panel when
 * the lantern is at the spot. Each ring is sized for its depth, so from the spot the deep ring's shadow sits inside
 * the shallow ring's hole with a 0.008 gap: a bullseye on the mark. The lessons hang theirs by the same sizes.
 */
export const RINGS: readonly { z: readonly [number, number]; out: number; in: number }[] = [
  { z: [0.5, 0.7], out: 0.044, in: 0.032 }, // shallow: nearer the lantern
  { z: [0.18, 0.35], out: 0.024, in: 0.014 }, // deep: nearer the panel
];
/**
 * The rings' etched mark: this many lock sizes from the lock's centre in one of eight directions, at least
 * MARK_CLEAR from every outline and band point, and within MARK_MAX of the panel centre.
 */
const MARK_DIST = 0.74;
const MARK_CLEAR = 0.065;
const MARK_MAX = 0.42;
const MARK_DIRS: V2[] = [[0, -1], [0, 1], [-1, 0], [1, 0], [0.71, -0.71], [-0.71, -0.71], [0.71, 0.71], [-0.71, 0.71]];
/**
 * From a ringed lock's spot, every shadow but that lock's own two rings (pieces of any lock, decoys, other locks'
 * rings) stays this far from its mark, so nothing blots the bullseye when the player needs it.
 */
const MARK_SHADOW_CLEAR = 0.07;
/** Grows a ring's RING_SIDES-gon to hold its true circle (an inscribed polygon falls short by up to 2.5%). */
const RING_CIRCUMSCRIBE = 1 / Math.cos(Math.PI / RING_SIDES);
/**
 * A finger piece is between these shares of its shape: big enough to matter, small enough for one finger's shadow
 * to fill. One within 45 degrees of horizontal scores FINGER_FLAT_BONUS more.
 */
export const FINGER_MIN_SHARE = 0.08;
export const FINGER_MAX_SHARE = 0.35;
const FINGER_FLAT_BONUS = 1;
/**
 * A hidden lock's pieces hang no further from the panel than this, so their shadows stay sharp (penumbra about
 * 0.012 or less) and small silhouette details read: the bird's beak, the hole in the teapot's handle.
 */
export const HIDDEN_PIECE_Z_MAX = 0.45;
/** Decoys: centres within DECOY_XY of the panel centre, a size range, and how far each corner's depth wobbles. */
const DECOY_XY = 0.42;
const DECOY_R: [number, number] = [0.05, 0.12];
const DECOY_WOBBLE = 0.06;
/**
 * From the start, no lock may be this much covered. The promise is under half; the margin keeps it on any sample
 * grid (the solve rule's, a mirrored box's), not just the one used here.
 */
const START_COVER_MAX = 0.45;
/**
 * From box 10 and in the Daily Box (version 4), a box casts at most this many shadow corners (frame-cost.ts): its frame
 * in play then costs at most 10% more than box 15's, the box the frame budgets are timed on (192 corners, about 1.12 ms
 * at 4x by the model; a tenth of that is about 160 corners more). generator.test.ts holds the cap to that.
 */
export const FRAME_CORNER_CAP = 350;
/** A box from 10 may place up to this share fewer decoys to stay within FRAME_CORNER_CAP; the Daily Box none (box 7's). */
export const DECOY_TRIM_MAX = 0.5;
/** Corners of a decoy's shadow: a triangle. */
const DECOY_CORNERS = 3;

/** `items` shuffled by their own seed (Fisher-Yates on mulberry32), a new array. */
function seededOrder<T>(items: readonly T[], seed: string): T[] {
  const rnd = rng32(hash(seed)), a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** The shapes that are not silhouettes. */
const CLASSICS = (Object.keys(SHAPES) as ShapeName[]).filter((s) => !SILHOUETTES.includes(s));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** The point at depth z on the ray from the lantern L through panel point v. */
const onRay = (L: V3, v: V2, z: number): V3 => {
  const k = (L[2] - z) / L[2];
  return [L[0] + (v[0] - L[0]) * k, L[1] + (v[1] - L[1]) * k, z];
};

interface Draft extends Lock {
  /** Grid points for the start check and the ring mark's clearance (the solve rule's, on the STEP grid). */
  samples: LockSamples;
  /** Each outline piece's bbox grown by BAND: a shadow outside it cannot come within BAND of that piece. */
  reach: [number, number, number, number][];
}

const inBox = (p: V3) =>
  Math.abs(p[0]) <= E.IN_BOX_XY && Math.abs(p[1]) <= E.IN_BOX_XY && p[2] >= E.PIECE_Z[0] && p[2] <= E.PIECE_Z[1];

/** The whole ring inside the box: a circle reaches r * sqrt(1 - n_axis^2) from its centre along each axis. */
function ringInBox(r: Ring): boolean {
  const reach = (axis: 0 | 1 | 2) => r.rOut * Math.sqrt(Math.max(0, 1 - r.nrm[axis] ** 2));
  return (
    Math.abs(r.c[0]) + reach(0) <= E.IN_BOX_XY &&
    Math.abs(r.c[1]) + reach(1) <= E.IN_BOX_XY &&
    r.c[2] - reach(2) >= E.PIECE_Z[0] &&
    r.c[2] + reach(2) <= E.PIECE_Z[1]
  );
}

/** Distance between segments ab and cd: 0 when they cross. */
function segSegDist(a: V2, b: V2, c: V2, d: V2): number {
  const o = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}

/** True when polygons A and B overlap or come within `gap` of each other (exact, no sampling). */
function within(A: V2[], B: V2[], gap: number): boolean {
  // No edges within the gap and neither holds the other's first corner: then they are apart.
  if (inPoly(A[0]!, B) || inPoly(B[0]!, A)) return true;
  for (let i = 0; i < A.length; i++) {
    const a = A[i]!, b = A[(i + 1) % A.length]!;
    for (let j = 0; j < B.length; j++) if (segSegDist(a, b, B[j]!, B[(j + 1) % B.length]!) <= gap) return true;
  }
  return false;
}

/**
 * True when these points, seen from any lock's spot but `skipLock`'s, cast a shadow that touches that lock's outline
 * or comes within BAND of it.
 */
function intrudes(verts: V3[], skipLock: number, locks: Draft[]): boolean {
  for (const o of locks) {
    if (o.i === skipLock) continue;
    const poly = verts.map((p) => proj(p, o.L)), [a, b, c, d] = bbox(poly), bx = o.samples.box;
    if (c < bx[0] || a > bx[2] || d < bx[1] || b > bx[3]) continue;
    for (let k = 0; k < o.target.length; k++) {
      const r = o.reach[k]!;
      if (c < r[0] || a > r[2] || d < r[1] || b > r[3]) continue;
      if (within(poly, o.target[k]!, BAND)) return true;
    }
  }
  return false;
}

/** The shadow an element casts on the panel from L; a ring as a polygon around its whole circle. */
function castFrom(e: Element, L: V3): V2[] {
  if (e.kind === "ring") return circlePts(e.c, e.nrm, e.rOut * RING_CIRCUMSCRIBE, RING_SIDES).map((p) => proj(p, L));
  return e.verts.map((p) => proj(p, L));
}

/** True when this element, seen from a ringed lock's spot (any lock but `skipLock`), comes near that lock's mark. */
function blotsMark(e: Element, skipLock: number, locks: Draft[]): boolean {
  return locks.some((o) => o.i !== skipLock && o.mark !== null && polyDist(o.mark, castFrom(e, o.L)) < MARK_SHADOW_CLEAR);
}

/**
 * The piece a finger lock leaves out: the most finger-like one (long, big enough to matter, small enough for a
 * finger), preferring one that runs within 45 degrees of horizontal so the finger never has to point down. -1 when
 * no piece fits.
 */
export function fingerPiece(target: V2[][]): number {
  const total = target.reduce((s, p) => s + area(p), 0);
  let best = -1, bestScore = -Infinity;
  target.forEach((p, j) => {
    const share = area(p) / total;
    if (share < FINGER_MIN_SHARE || share > FINGER_MAX_SHARE) return;
    const e = elongation(p);
    const score = e.ratio + 4 * share + (Math.abs(e.angle) <= Math.PI / 4 ? FINGER_FLAT_BONUS : 0);
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  });
  return best;
}

/** The seed key of a box: `shadow-locks/<n>` or `shadow-locks/daily/<day>`. */
export function seedKey(spec: BoxSpec): string {
  if (spec.kind === "box") return "shadow-locks/" + spec.n;
  if (spec.kind === "daily") return "shadow-locks/daily/" + spec.day;
  throw new Error("Lessons are built by hand, not generated: " + spec.id);
}

/** The spec a seed key names (seedKey's inverse), or null for anything else (a lesson, a damaged save). */
export function specOfKey(key: string): BoxSpec | null {
  const box = /^shadow-locks\/([1-9]\d{0,8})$/.exec(key);
  if (box) return { kind: "box", n: Number(box[1]) };
  const daily = /^shadow-locks\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(key);
  return daily && isDayKey(daily[1]) ? { kind: "daily", day: daily[1]! } : null;
}

type Reason = "spot" | "finger" | "piece" | "ring" | "decoy" | "start" | "warmth" | "cost";

/** Points on the way in to a spot where warmth must stay below the spot's own: 0.2 out, nine of them. */
const WARM_SAMPLES = 9;

/**
 * A finger laid along a finger lock's gap, as a player (and the e2e specs) lay one: the index finger's last two bones
 * (FINGER.chainCm long, capsules of radius FINGER_RADIUS_CM: the solve rule counts only those, as
 * src/render/hand-shadow.ts casts them) straight along the gap's long axis, their middle on the ray from the spot
 * through the gap's middle, FINGER.z from the panel, in the default 24 cm box. Its shadow must fill the gap within the
 * rule with FINGER.margin of spill to spare: the same finger measured in the browser came within 0.03 of a model of it
 * (tests/unit/helpers/finger-model.ts).
 */
const FINGER = { z: 0.5, chainCm: 4.6, boxCm: 24, margin: 0.03 } as const;
/** Corners on each end of the finger's shadow outline. */
const FINGER_END_CORNERS = 8;

/** The laid finger's shadow from the lock's spot: a capsule outline, drawn round the true one (never inside it). */
function fingerShadow(l: Lock): V2[] {
  const gap = l.target[l.missing]!, L = l.L;
  let mx = 0, my = 0;
  for (const p of gap) {
    mx += p[0] / gap.length;
    my += p[1] / gap.length;
  }
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of gap) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(angle), uy = Math.sin(angle);
  const z = FINGER.z, k0 = (L[2] - z) / L[2], k = L[2] / (L[2] - z), half = FINGER.chainCm / 2 / FINGER.boxCm;
  const cx = L[0] + (mx - L[0]) * k0, cy = L[1] + (my - L[1]) * k0;
  const end = (s: number): V2 => [L[0] + (cx + ux * s - L[0]) * k, L[1] + (cy + uy * s - L[1]) * k];
  const a = end(-half), b = end(half), step = Math.PI / (FINGER_END_CORNERS - 1);
  const r = ((FINGER_RADIUS_CM / FINGER.boxCm) * k) / Math.cos(step / 2), t = Math.atan2(uy, ux), out: V2[] = [];
  for (let i = 0; i < FINGER_END_CORNERS; i++) out.push([b[0] + r * Math.cos(t - Math.PI / 2 + i * step), b[1] + r * Math.sin(t - Math.PI / 2 + i * step)]);
  for (let i = 0; i < FINGER_END_CORNERS; i++) out.push([a[0] + r * Math.cos(t + Math.PI / 2 + i * step), a[1] + r * Math.sin(t + Math.PI / 2 + i * step)]);
  return out;
}

/**
 * A finger's spill read on the generator's fine grid can sit this much under the play grid's reading (the play grid
 * samples a small lock's band coarsely); below SPILL_ALL_MAX - FINGER.margin - FINGER_SCREEN there it needs no
 * second look.
 */
const FINGER_SCREEN = 0.07;

/**
 * True when a finger laid in the gap of `l`'s piece `j` fills it within the solve rule, FINGER.margin to spare: the gap
 * covered at least GAP_MIN, and no more than SPILL_ALL_MAX less the margin of the lit band darkened (from the spot the
 * lock's own scraps darken none of it, so the finger is all that does). Judged on the play grid (the samples kept in
 * `known` for the warmth check), unless the fine grid the generator already has puts it well clear (FINGER_SCREEN).
 */
function fingerFits(l: Lock, j: number, fine: LockSamples, known: Map<number, LockSamples>, bothHands: boolean): boolean {
  const finger = fingerShadow({ ...l, missing: j }), gap = l.target[j]!, limit = RULE.SPILL_ALL_MAX - FINGER.margin;
  let inGap = 0, filled = 0, dark = 0;
  for (const p of fine.inside) {
    if (!inPoly(p, gap)) continue;
    inGap++;
    if (inPoly(p, finger)) filled++;
  }
  for (const p of fine.band) if (inPoly(p, finger)) dark++;
  if (inGap > 0 && filled === inGap && dark / fine.band.length <= limit - FINGER_SCREEN) return true;
  const cov: Coverage = { cover: 0, spill: 0, spillAll: 0, gap: 0 };
  const fits = (f: V2[], s: LockSamples) => {
    measure(s, [], 0, [f], 1, cov);
    return cov.gap >= RULE.GAP_MIN && cov.spillAll <= limit;
  };
  const s = lockSamples(l.target, RUNTIME_STEP, j);
  if (!fits(finger, s)) return false;
  // A left-handed player's box is the mirror, sampled on a grid of its own (mirror.ts): the finger must fit there too.
  if (bothHands) {
    const m = mirrorLock({ ...l, missing: j });
    if (!fits(fingerShadow(m), lockSamples(m.target, RUNTIME_STEP, j))) return false;
  }
  known.set(l.i, s);
  return true;
}

/**
 * True when each lock is strictly warmest at its spot along the line in from WARMTH_RANGE toward the start, sampled as
 * the game measures (its runtime grid, the scraps in the box, no finger): so warmth leads all the way to the spot and
 * never saturates a few millimetres short of it. tests/unit/solve.test.ts checks the same samples. `known` holds runtime
 * samples already made (a finger lock's, by fingerFits).
 */
function warmestAtSpots(locks: Lock[], elements: Element[], start: V3, known: Map<number, LockSamples>): boolean {
  const polys: V2[][] = [], cov: Coverage = { cover: 0, spill: 0, spillAll: 0, gap: 0 };
  for (const l of locks) {
    const s = known.get(l.i) ?? lockSamples(l.target, RUNTIME_STEP, l.missing);
    const dir = unit([start[0] - l.L[0], start[1] - l.L[1], start[2] - l.L[2]]);
    const at = (d: number) => {
      const L: V3 = [l.L[0] + dir[0] * d, l.L[1] + dir[1] * d, l.L[2] + dir[2] * d];
      return warmth(measure(s, polys, shadowPolys(elements, L, polys, SKIP_MISSING), [], 0, cov), d);
    };
    const peak = at(0);
    for (let k = 0; k < WARM_SAMPLES; k++) if (!(at(WARMTH_RANGE * (1 - k / WARM_SAMPLES)) < peak)) return false;
  }
  return true;
}

/** A box's frame in play by the frame cost model (frame-cost.ts): its mean JS at 4x (ms) and its shadow corners. */
export function boxFrame(box: Pick<Box, "elements">): { ms: number; corners: number } {
  return { ms: frameMs(box.elements), corners: renderCorners(box.elements) };
}

export interface BoxBuild {
  box: Box;
  /** Whole-box attempts it took, the successful one included. */
  attempts: number;
  /** Failed attempts by the step that failed. */
  failures: Partial<Record<Reason, number>>;
}

/**
 * Builds a box and says how hard it was: generateBox plus the attempt count and why attempts failed. `cornerCap` is
 * FRAME_CORNER_CAP; a test passes a lower one to see a box place fewer decoys and be redrawn.
 */
export function buildBox(spec: BoxSpec, cornerCap = FRAME_CORNER_CAP): BoxBuild {
  const key = seedKey(spec), gen = genOf(spec);
  if (!BUILDABLE_VERSIONS.includes(gen)) throw new Error(`The generator cannot build version ${gen} boxes: ${key}`);
  const v3 = gen === 3;
  const P: BoxParams = spec.kind === "box" ? (v3 ? boxParamsV3(spec.n) : boxParams(spec.n)) : dailyParams();
  // The silhouettes the box's hidden locks take, in order (version 3 drew one from the first three as it built).
  const silNames = v3 ? null : boxSilhouettes(spec);
  const silCount = v3 ? Math.min(P.hidden, 1) : silNames!.length;
  // From box 10 and in the Daily Box (version 4), a box's classic shapes are drawn once, by a seed of their own, and
  // kept for its first FIXED_CLASSIC_TRIES attempts, which retry only the geometry: so a shape that is harder to place
  // (the wide Crown) is not drawn much less often. Its classic locks take them in order. Later attempts draw them
  // afresh each time, as boxes up to 9 always do, so a set that will not fit never holds a box up.
  const fixedClassics = v3 || (spec.kind === "box" && spec.n < KINDS_FROM) ? null : seededOrder(CLASSICS, key + "/classics");
  // The frame cost cap, and how many of its decoys a box may leave out for it (FRAME_CORNER_CAP).
  const capped = !v3 && (spec.kind === "daily" || (spec.kind === "box" && spec.n >= KINDS_FROM));
  const fewestDecoys = P.decoys - (spec.kind === "box" ? Math.floor(P.decoys * DECOY_TRIM_MAX) : 0);
  // From box 5 (version 4), a finger lock fits a laid finger for either hand (boxes 1 to 4 stay version 3's byte for byte).
  const bothHands = !v3 && !(spec.kind === "box" && spec.n <= 4);
  let attemptNow = 0;
  const rng = rng32(hash(key));
  const R = (a: number, b: number) => a + (b - a) * rng();
  const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)]!;
  const shuffle = <T>(a: T[]): T[] => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]!;
      a[i] = a[j]!;
      a[j] = t;
    }
    return a;
  };
  const start: V3 = [E.START[0], E.START[1], E.START[2]];
  const ax = P.amp * E.LX_MAX;
  const [PZ0, PZ1] = E.PIECE_Z;

  /**
   * Silhouettes only on hidden locks (`silLocks`, in the order they take the box's silhouettes): each is the box's
   * "it's a cat!" moment. Every other lock, hidden or not, is a different classic shape. Each silhouette lock draws
   * from the first three as version 3 did, so the draws after it stay in step (boxes 5 to 9 differ from version 3
   * only in the silhouette); from version 4 the dealt silhouette takes its place.
   */
  function pickShapes(n: number, silLocks: number[]): ShapeName[] {
    const classics = shuffle(CLASSICS.slice());
    const fixed = fixedClassics && attemptNow <= FIXED_CLASSIC_TRIES ? fixedClassics : null;
    let next = 0;
    return Array.from({ length: n }, (_, i) => {
      const k = silLocks.indexOf(i);
      if (k < 0) return fixed ? fixed[next++]! : classics[i]!;
      const drawn = pick(FIRST_SILHOUETTES);
      return silNames ? silNames[k]! : drawn;
    });
  }

  function tryBuild(): Box | Reason {
    const lay = LAYOUTS[P.locks], ids = lay.map((_, i) => i), runtime = new Map<number, LockSamples>();
    const hiddenOrder = shuffle(ids.slice()).slice(0, P.hidden), hidden = new Set(hiddenOrder);
    const shapes = pickShapes(P.locks, hiddenOrder.slice(0, silCount));
    const locks: Draft[] = [];
    for (let i = 0; i < P.locks; i++) {
      const { c: center, size } = lay[i]!, rot = R(-ROT_MAX, ROT_MAX), c = Math.cos(rot), s = Math.sin(rot);
      const target = SHAPES[shapes[i]!].map((poly) =>
        poly.map(([x, y]): V2 => [center[0] + (x * c - y * s) * size, center[1] + (x * s + y * c) * size]),
      );
      let L: V3 | null = null;
      for (let t = 0; t < SPOT_TRIES && !L; t++) {
        const cand: V3 = [R(-ax, ax), R(E.LY[0], E.LY[1]), R(E.LZ[0], E.LZ[1])];
        if (dist3(cand, start) < E.SPOT_MIN_SEP || locks.some((o) => dist3(o.L, cand) < E.SPOT_MIN_SEP)) continue;
        L = cand;
      }
      if (!L) return "spot";
      locks.push({
        i,
        shape: shapes[i]!,
        center: [center[0], center[1]],
        size,
        rot,
        target,
        L,
        finger: false,
        missing: -1,
        fingerAngle: 0,
        mark: null,
        rings: true,
        hidden: hidden.has(i),
        samples: lockSamples(target, STEP),
        reach: target.map((p) => {
          const [x0, y0, x1, y1] = bbox(p);
          return [x0 - BAND, y0 - BAND, x1 + BAND, y1 + BAND];
        }),
      });
    }

    // Finger locks from a shuffle: locks whose finger piece runs within 45 degrees of horizontal first (a rotated
    // teapot's spout can tip past it), and never a lock with no piece a finger could fill.
    const sorted = shuffle(locks.slice())
      .map((l) => {
        const j = fingerPiece(l.target);
        return { l, j, angle: j < 0 ? 0 : elongation(l.target[j]!).angle };
      })
      .filter((c) => c.j >= 0)
      .sort((a, b) => Number(Math.abs(a.angle) > Math.PI / 4) - Number(Math.abs(b.angle) > Math.PI / 4));
    // From version 4, only a lock a laid finger can fill becomes a finger lock (tried in order, as many as needed);
    // the samples it was judged by are kept for the warmth check.
    const candidates = v3 ? sorted.slice(0, P.fingerLocks) : [];
    for (let k = 0; !v3 && k < sorted.length && candidates.length < P.fingerLocks; k++) {
      const c = sorted[k]!;
      if (fingerFits(c.l, c.j, c.l.samples, runtime, bothHands)) candidates.push(c);
    }
    if (candidates.length < P.fingerLocks) return "finger";
    for (const { l, j, angle } of candidates) {
      l.finger = true;
      l.missing = j;
      l.fingerAngle = angle;
    }
    // Finger locks keep their rings while a plain lock can go without.
    const ringOrder = shuffle(locks.slice()).sort((a, b) => Number(a.finger) - Number(b.finger));
    for (const l of ringOrder.slice(0, P.ringless)) l.rings = false;

    // The frame cost cap (from box 10 and in the Daily Box): the shadow corners of the scraps and rings are known before
    // any is placed, so a box that cannot fit the cap with its fewest decoys is turned down here, and one that
    // fits places as many decoys as the cap leaves room for, up to its kind's.
    let decoys = P.decoys;
    if (capped) {
      let corners = 0;
      // A ringed lock places every one of RINGS (or the attempt fails), and each ring casts two circles.
      const ringCorners = RINGS.length * 2 * RING_SIDES;
      for (const l of locks) corners += l.target.reduce((n, p) => n + p.length, 0) + (l.rings ? ringCorners : 0);
      decoys = Math.min(P.decoys, Math.floor((cornerCap - corners) / DECOY_CORNERS));
      if (decoys < fewestDecoys) return "cost";
    }

    const elements: Element[] = [];
    for (const l of locks) {
      const zMax = l.hidden ? Math.min(PZ1, HIDDEN_PIECE_Z_MAX) : PZ1;
      for (let j = 0; j < l.target.length; j++) {
        let placed: V3[] | null = null;
        for (let t = 0; t < PIECE_TRIES && !placed; t++) {
          const zc = R(PZ0, zMax);
          const verts = l.target[j]!.map((v) => onRay(l.L, v, clamp(zc + R(-P.tilt, P.tilt), PZ0, zMax)));
          if (verts.every(inBox) && !intrudes(verts, l.i, locks)) placed = verts;
        }
        if (!placed) return "piece";
        elements.push({ kind: "piece", lock: l.i, piece: j, verts: placed, missing: j === l.missing });
      }
    }

    for (const l of locks) {
      if (!l.rings) continue;
      let done = false;
      for (const d of shuffle(MARK_DIRS.slice())) {
        const m: V2 = [l.center[0] + d[0] * l.size * MARK_DIST, l.center[1] + d[1] * l.size * MARK_DIST];
        if (Math.abs(m[0]) > MARK_MAX || Math.abs(m[1]) > MARK_MAX) continue;
        const near = (s: V2) => Math.hypot(s[0] - m[0], s[1] - m[1]) < MARK_CLEAR;
        if (locks.some((o) => o.samples.inside.some(near) || o.samples.band.some(near))) continue;
        // Every shadow placed so far (all pieces, earlier locks' rings) stays clear of this mark from this spot.
        if (elements.some((e) => polyDist(m, castFrom(e, l.L)) < MARK_SHADOW_CLEAR)) continue;
        const rings = RINGS.map(({ z: [z0, z1], out, in: inner }): Ring => {
          // A ring at depth z casts its shadow k = Lz / (Lz - z) times its size.
          const c = onRay(l.L, m, R(z0, z1)), k = l.L[2] / (l.L[2] - c[2]);
          const nrm = unit([l.L[0] - c[0], l.L[1] - c[1], l.L[2] - c[2]]);
          return { kind: "ring", lock: l.i, c, nrm, rOut: out / k, rIn: inner / k };
        });
        if (!rings.every(ringInBox)) continue;
        if (rings.some((r) => intrudes(circlePts(r.c, r.nrm, r.rOut, RING_SIDES), -1, locks))) continue;
        // ...and these rings stay clear of the marks already set, seen from those locks' spots.
        if (rings.some((r) => blotsMark(r, l.i, locks))) continue;
        l.mark = m;
        elements.push(...rings);
        done = true;
        break;
      }
      if (!done) return "ring";
    }

    for (let n = 0; n < decoys; n++) {
      let placed = false;
      for (let t = 0; t < DECOY_TRIES && !placed; t++) {
        const c: V3 = [R(-DECOY_XY, DECOY_XY), R(-DECOY_XY, DECOY_XY), R(PZ0, PZ1)], s = R(DECOY_R[0], DECOY_R[1]);
        const a0 = R(0, Math.PI * 2);
        const verts = [0, 1, 2].map((k): V3 => {
          const a = a0 + k * 2.1 + R(-0.4, 0.4);
          return [c[0] + Math.cos(a) * s, c[1] + Math.sin(a) * s, clamp(c[2] + R(-DECOY_WOBBLE, DECOY_WOBBLE), PZ0, PZ1)];
        });
        const decoy: Element = { kind: "decoy", verts };
        if (verts.every(inBox) && !intrudes(verts, -1, locks) && !blotsMark(decoy, -1, locks)) {
          elements.push(decoy);
          placed = true;
        }
      }
      if (!placed) return "decoy";
    }

    // The start must not already half solve anything: the solve rule's coverage, missing pieces counted too.
    const fromStart: V2[][] = [], n = shadowPolys(elements, start, fromStart);
    const cov: Coverage = { cover: 0, spill: 0, spillAll: 0, gap: 1 };
    for (const l of locks) if (measure(l.samples, fromStart, n, [], 0, cov).cover >= START_COVER_MAX) return "start";
    // From version 4, warmth must lead all the way to each spot (version 3's boxes never failed this).
    if (!v3 && !warmestAtSpots(locks, elements, start, runtime)) return "warmth";

    return {
      key,
      spec: { ...spec },
      params: { ...P },
      start,
      elements,
      locks: locks.map(({ samples: _samples, reach: _reach, ...l }): Lock => l),
      owner: pick(OWNERS),
      loot: pick(LOOT),
      mirrored: false,
    };
  }

  const failures: Partial<Record<Reason, number>> = {};
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    attemptNow = attempt;
    const r = tryBuild();
    if (typeof r !== "string") return { box: r, attempts: attempt, failures };
    failures[r] = (failures[r] ?? 0) + 1;
  }
  throw new Error("The generator gave up on " + key);
}

/** The box for a spec: `box` n or the `daily` box of a day. Lessons are hand-built elsewhere and throw here. */
export function generateBox(spec: BoxSpec): Box {
  return buildBox(spec).box;
}
