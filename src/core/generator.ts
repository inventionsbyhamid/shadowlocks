// The box generator: endless boxes from a seed, the same box for the same spec everywhere. Ported from the Shadow
// Locks mock (spikes/shadow-locks-mock/shadowgen.js, generate and tryBuild), with the lantern spots inside the seated
// comfort envelope (envelope.ts), the difficulty curve of params.ts, at most one silhouette per box (on a hidden
// lock), sight rings whose shadows make a bullseye at the spot, and finger pieces that run near horizontal.
//
// What every box guarantees (tests/unit/generator.test.ts): from its spot, each lock's scraps tile its outline and
// leave the band around it lit; a finger lock is short exactly its missing piece; no other scrap or ring falls on a
// lock from its spot; the start solves nothing; every spot is inside the envelope and apart from the others.
import { ENVELOPE } from "./envelope";
import { area, bbox, circlePts, elongation, hash, inPoly, polyDist, proj, rng32 } from "./geom";
import { boxParams, dailyParams } from "./params";
import { SHAPES, SILHOUETTES } from "./shapes";
import { LOOT, OWNERS } from "./story";
import type { Box, BoxParams, BoxSpec, Element, Lock, Ring, ShapeName, V2, V3 } from "./types";

const E = ENVELOPE;
/** The margin around an outline that must stay lit. */
const BAND = 0.04;
/** Spacing of the grid points that check where shadows land while a box is built. */
const STEP = 0.008;
/** Whole-box attempts before giving up, and tries per spot, piece and decoy within one attempt. */
const ATTEMPTS = 300;
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
 * the shallow ring's hole with a 0.008 gap: a bullseye on the mark.
 */
const RINGS: { z: [number, number]; out: number; in: number }[] = [
  { z: [0.5, 0.7], out: 0.044, in: 0.032 }, // shallow: nearer the lantern
  { z: [0.18, 0.35], out: 0.024, in: 0.014 }, // deep: nearer the panel
];
const RING_SIDES = 14;
/**
 * The rings' etched mark: this many lock sizes from the lock's centre in one of eight directions, at least
 * MARK_CLEAR from every outline and band point, and within MARK_MAX of the panel centre.
 */
const MARK_DIST = 0.74;
const MARK_CLEAR = 0.065;
const MARK_MAX = 0.42;
const MARK_DIRS: V2[] = [[0, -1], [0, 1], [-1, 0], [1, 0], [0.71, -0.71], [-0.71, -0.71], [0.71, 0.71], [-0.71, 0.71]];
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

interface Samples {
  inside: V2[];
  band: V2[];
  box: [number, number, number, number];
}
interface Draft extends Lock {
  samples: Samples;
}

/** Points that must be dark (inside the outline) or stay lit (the band around it), for checking where shadows land. */
function lockSamples(target: V2[][], step: number): Samples {
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
  return { inside, band, box: [x0 - BAND, y0 - BAND, x1 + BAND, y1 + BAND] };
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

/** True when these points, seen from any lock's spot but `skipLock`'s, cast a shadow on that lock's outline or band. */
function intrudes(verts: V3[], skipLock: number, locks: Draft[]): boolean {
  for (const o of locks) {
    if (o.i === skipLock) continue;
    const poly = verts.map((p) => proj(p, o.L)), [a, b, c, d] = bbox(poly), bx = o.samples.box;
    if (c < bx[0] || a > bx[2] || d < bx[1] || b > bx[3]) continue;
    for (const s of o.samples.inside) if (inPoly(s, poly)) return true;
    for (const s of o.samples.band) if (inPoly(s, poly)) return true;
  }
  return false;
}

function shadowPolys(elements: Element[], L: V3): V2[][] {
  return elements.map((e) =>
    e.kind === "ring" ? circlePts(e.c, e.nrm, e.rOut, RING_SIDES).map((p) => proj(p, L)) : e.verts.map((p) => proj(p, L)),
  );
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

type Reason = "spot" | "finger" | "piece" | "ring" | "decoy" | "start";

export interface BoxBuild {
  box: Box;
  /** Whole-box attempts it took, the successful one included. */
  attempts: number;
  /** Failed attempts by the step that failed. */
  failures: Partial<Record<Reason, number>>;
}

/** Builds a box and says how hard it was: generateBox plus the attempt count and why attempts failed. */
export function buildBox(spec: BoxSpec): BoxBuild {
  const key = seedKey(spec);
  const P: BoxParams = spec.kind === "box" ? boxParams(spec.n) : dailyParams();
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
   * One silhouette at most, and only on a hidden lock (`silLock`, or -1 for none): it is the box's "it's a cat!"
   * moment. Every other lock, hidden or not, is a different classic shape.
   */
  function pickShapes(n: number, silLock: number): ShapeName[] {
    const classics = shuffle(CLASSICS.slice());
    return Array.from({ length: n }, (_, i) => (i === silLock ? pick(SILHOUETTES) : classics[i]!));
  }

  function tryBuild(): Box | Reason {
    const lay = LAYOUTS[P.locks], ids = lay.map((_, i) => i);
    const hiddenOrder = shuffle(ids.slice()).slice(0, P.hidden), hidden = new Set(hiddenOrder);
    const shapes = pickShapes(P.locks, hiddenOrder[0] ?? -1);
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
      });
    }

    // Finger locks from a shuffle: locks whose finger piece runs within 45 degrees of horizontal first (a rotated
    // teapot's spout can tip past it), and never a lock with no piece a finger could fill.
    const candidates = shuffle(locks.slice())
      .map((l) => {
        const j = fingerPiece(l.target);
        return { l, j, angle: j < 0 ? 0 : elongation(l.target[j]!).angle };
      })
      .filter((c) => c.j >= 0)
      .sort((a, b) => Number(Math.abs(a.angle) > Math.PI / 4) - Number(Math.abs(b.angle) > Math.PI / 4));
    if (candidates.length < P.fingerLocks) return "finger";
    for (const { l, j, angle } of candidates.slice(0, P.fingerLocks)) {
      l.finger = true;
      l.missing = j;
      l.fingerAngle = angle;
    }
    // Finger locks keep their rings while a plain lock can go without.
    const ringOrder = shuffle(locks.slice()).sort((a, b) => Number(a.finger) - Number(b.finger));
    for (const l of ringOrder.slice(0, P.ringless)) l.rings = false;

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
        const rings = RINGS.map(({ z: [z0, z1], out, in: inner }): Ring => {
          // A ring at depth z casts its shadow k = Lz / (Lz - z) times its size.
          const c = onRay(l.L, m, R(z0, z1)), k = l.L[2] / (l.L[2] - c[2]);
          const nrm = unit([l.L[0] - c[0], l.L[1] - c[1], l.L[2] - c[2]]);
          return { kind: "ring", lock: l.i, c, nrm, rOut: out / k, rIn: inner / k };
        });
        if (!rings.every(ringInBox)) continue;
        if (rings.some((r) => intrudes(circlePts(r.c, r.nrm, r.rOut, RING_SIDES), -1, locks))) continue;
        l.mark = m;
        elements.push(...rings);
        done = true;
        break;
      }
      if (!done) return "ring";
    }

    for (let n = 0; n < P.decoys; n++) {
      let placed = false;
      for (let t = 0; t < DECOY_TRIES && !placed; t++) {
        const c: V3 = [R(-DECOY_XY, DECOY_XY), R(-DECOY_XY, DECOY_XY), R(PZ0, PZ1)], s = R(DECOY_R[0], DECOY_R[1]);
        const a0 = R(0, Math.PI * 2);
        const verts = [0, 1, 2].map((k): V3 => {
          const a = a0 + k * 2.1 + R(-0.4, 0.4);
          return [c[0] + Math.cos(a) * s, c[1] + Math.sin(a) * s, clamp(c[2] + R(-DECOY_WOBBLE, DECOY_WOBBLE), PZ0, PZ1)];
        });
        if (verts.every(inBox) && !intrudes(verts, -1, locks)) {
          elements.push({ kind: "decoy", verts });
          placed = true;
        }
      }
      if (!placed) return "decoy";
    }

    // The start must not already half solve anything.
    const fromStart = shadowPolys(elements, start);
    for (const l of locks) {
      const lit = l.samples.inside.filter((s) => fromStart.some((p) => inPoly(s, p))).length;
      if (lit / l.samples.inside.length >= START_COVER_MAX) return "start";
    }

    return {
      key,
      spec: { ...spec },
      params: { ...P },
      start,
      elements,
      locks: locks.map(({ samples: _samples, ...l }): Lock => l),
      owner: pick(OWNERS),
      loot: pick(LOOT),
      mirrored: false,
    };
  }

  const failures: Partial<Record<Reason, number>> = {};
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
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
