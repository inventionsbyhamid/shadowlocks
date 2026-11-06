// The two lessons, built by hand (the generator refuses lesson specs). Lesson 1, "Catch the light", is one box of
// three locks: a Moon from a single scrap (move the light, the shadow grows and slides), an arrow from two scraps at
// very different depths (near pieces swing more: Example 1) and a Key with sight rings (line up the rings, ride the
// line, slide to the click: Example 2). Lesson 2, "Lend a hand", is one Crown short of its middle prong, which runs
// near horizontal so a pointing finger fills it (Example 3); its lantern starts on the spot.
//
// Each example is staged on a twin of the player's lock: the same outline with its spot reflected across the box's
// middle (on the player's weak side) and its scraps hung again from there at the same depths. A ghost solves the twin,
// then the scraps swing into the player's layout. The boxes hold the player's layout; LESSON_TWINS holds the twins.
//
// Every piece of a lesson lock hangs flat at its own depth, so swinging between twin and player's layout moves each
// piece straight sideways (by the spot's move times depth / Lz): a near piece swings further than a far one.
// tests/unit/lessons-data.test.ts holds these boxes to the generator's guarantees.
import { ENVELOPE } from "./envelope";
import { RINGS } from "./generator";
import { elongation } from "./geom";
import { mirrorBox } from "./mirror";
import { MOON_OUTLINE, SHAPES } from "./shapes";
import type { Box, BoxParams, Element, Lock, Piece, Ring, ShapeName, V2, V3 } from "./types";

export type LessonId = "l1" | "l2";

/** A lesson lock and the scraps (and sight rings) that make it. */
export interface LessonLock {
  lock: Lock;
  elements: Element[];
}

const ARROW = SHAPES.Arrow;
/** Outlines only lessons use: the Moon as one scrap, and the Arrow in two (its shaft, then its head). */
const LESSON_PIECES: Record<"MoonOutline" | "ArrowInTwo", V2[][]> = {
  MoonOutline: [MOON_OUTLINE],
  // The Arrow's two shaft rectangles and two head triangles, each pair joined into one convex piece.
  ArrowInTwo: [
    [ARROW[0]![0]!, ARROW[1]![1]!, ARROW[1]![2]!, ARROW[0]![3]!],
    [ARROW[3]![1]!, ARROW[2]![1]!, ARROW[2]![2]!],
  ],
};
const LESSON_SHAPE_NAME: Record<keyof typeof LESSON_PIECES, ShapeName> = { MoonOutline: "Moon", ArrowInTwo: "Arrow" };

export type LessonShape = ShapeName | keyof typeof LESSON_PIECES;

export interface LessonLockOpts {
  /** The lock's index in its box (default 0). */
  i?: number;
  /** The outline's turn in radians (default 0). */
  rot?: number;
  /** Sight rings on the line from the spot through `mark`, the shallow one at depths[0], the deep one at depths[1]. */
  rings?: { mark: V2; depths: readonly [number, number] };
  /** The piece a finger fills (a finger lock), or none. */
  missing?: number;
}

const onRay = (L: V3, v: V2, z: number): V3 => {
  const k = (L[2] - z) / L[2];
  return [L[0] + (v[0] - L[0]) * k, L[1] + (v[1] - L[1]) * k, z];
};

const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A sight ring at depth z on the ray from L through `mark`, sized so its shadow from L has the given radii. */
function ringAt(lock: number, L: V3, mark: V2, z: number, out: number, inner: number): Ring {
  const c = onRay(L, mark, z), k = L[2] / (L[2] - z);
  return { kind: "ring", lock, c, nrm: unit([L[0] - c[0], L[1] - c[1], L[2] - c[2]]), rOut: out / k, rIn: inner / k };
}

/**
 * A lesson lock: `shape`'s outline at `center`, `size` across (turned by opts.rot), and its pieces hung flat on the
 * rays from the spot `L`, piece j at depth depths[j], so from L they cast the outline exactly. Throws a RangeError
 * when there is not one depth per piece, or a ring depth outside the generator's range for that ring.
 */
export function buildLessonLock(
  shape: LessonShape,
  center: V2,
  size: number,
  L: V3,
  depths: number[],
  opts: LessonLockOpts = {},
): LessonLock {
  const lessonShape = shape === "MoonOutline" || shape === "ArrowInTwo";
  const pieces = lessonShape ? LESSON_PIECES[shape] : SHAPES[shape];
  if (depths.length !== pieces.length) {
    throw new RangeError(`buildLessonLock: ${shape} has ${pieces.length} pieces, got ${depths.length} depths`);
  }
  const i = opts.i ?? 0, rot = opts.rot ?? 0, missing = opts.missing ?? -1, c = Math.cos(rot), s = Math.sin(rot);
  const target = pieces.map((poly) =>
    poly.map(([x, y]): V2 => [center[0] + (x * c - y * s) * size, center[1] + (x * s + y * c) * size]),
  );
  const rings = opts.rings;
  const lock: Lock = {
    i,
    shape: lessonShape ? LESSON_SHAPE_NAME[shape] : shape,
    center: [center[0], center[1]],
    size,
    rot,
    target,
    L: [L[0], L[1], L[2]],
    finger: missing >= 0,
    missing,
    fingerAngle: missing >= 0 ? elongation(target[missing]!).angle : 0,
    mark: rings ? [rings.mark[0], rings.mark[1]] : null,
    rings: rings !== undefined,
    hidden: false,
  };
  const elements: Element[] = target.map(
    (poly, j): Piece => ({ kind: "piece", lock: i, piece: j, verts: poly.map((v) => onRay(L, v, depths[j]!)), missing: j === missing }),
  );
  if (rings) {
    RINGS.forEach((r, j) => {
      const z = rings.depths[j]!;
      if (z < r.z[0] || z > r.z[1]) throw new RangeError(`buildLessonLock: ring ${j} at depth ${z}, outside [${r.z[0]}, ${r.z[1]}]`);
      elements.push(ringAt(i, L, rings.mark, z, r.out, r.in));
    });
  }
  return { lock, elements };
}

/**
 * The lock's twin for a staged example: the same outline and mark, its spot reflected across the vertical line
 * x = axisX (the box's middle by default), its scraps and rings hung again on rays from that spot at the same depths.
 * The twin meets at the reflected spot, and only there. Returns a new lock.
 */
export function mirrorLock(t: LessonLock, axisX = 0): LessonLock {
  const { lock } = t, L: V3 = [2 * axisX - lock.L[0], lock.L[1], lock.L[2]];
  const elements = t.elements.map((e): Element => {
    if (e.kind === "piece") return { ...e, verts: e.verts.map((p, k) => onRay(L, lock.target[e.piece]![k]!, p[2])) };
    if (e.kind === "ring" && lock.mark) {
      // The same shadow radii from the new spot as from the old one.
      const kOld = lock.L[2] / (lock.L[2] - e.c[2]);
      return ringAt(e.lock, L, lock.mark, e.c[2], e.rOut * kOld, e.rIn * kOld);
    }
    return { ...e };
  });
  return { lock: { ...lock, L }, elements };
}

/** Pieces first (lock by lock), then rings, as the generator orders a box's elements. */
function lessonBox(id: LessonId, locks: LessonLock[], start: V3, params: Omit<BoxParams, "tilt" | "amp">, story: [string, string]): Box {
  const all = locks.flatMap((l) => l.elements);
  return {
    key: "shadow-locks/lesson/" + id,
    spec: { kind: "lesson", id },
    params: { ...params, tilt: 0, amp: 1 },
    start: [start[0], start[1], start[2]],
    elements: [...all.filter((e) => e.kind === "piece"), ...all.filter((e) => e.kind === "ring")],
    locks: locks.map((l) => l.lock),
    owner: story[0],
    loot: story[1],
    mirrored: false,
  };
}

/** The Crown lies tipped toward the player's hand, so its middle prong runs 20 degrees off horizontal. */
const CROWN_ROT = (-70 * Math.PI) / 180;

/** Lesson 1, as the player solves it: right-handed (the start and the spots are on the right). */
const L1_LOCKS: LessonLock[] = [
  // Lock I: one scrap halfway back, so moving the lantern nearer or further grows and shrinks the Moon.
  buildLessonLock("MoonOutline", [-0.21, 0.19], 0.34, [-0.12, -0.32, 1.32], [0.5], { i: 0 }),
  // Lock II: the arrow points up; its shaft hangs near the lantern, its head near the panel.
  buildLessonLock("ArrowInTwo", [0.21, 0.19], 0.32, [0.16, -0.2, 1.6], [0.7, 0.2], { i: 1, rot: Math.PI / 2 }),
  // Lock III: a Key whose pieces step back from the panel toward its tip, its rings' mark to its right.
  buildLessonLock("Key", [0, -0.2], 0.36, [0.15, -0.45, 1.15], [0.3, 0.36, 0.45, 0.55, 0.62, 0.68], {
    i: 2,
    rings: { mark: [0.3, -0.27], depths: [0.6, 0.27] },
  }),
];

/** Lesson 2: the Crown's middle prong (piece 3) is the finger's. */
const L2_LOCK = buildLessonLock("Crown", [0, 0.04], 0.46, [0.2, -0.3, 1.35], [0.3, 0.34, 0.45, 0.6, 0.52], {
  i: 0,
  rot: CROWN_ROT,
  missing: 3,
});

export const LESSON_1: Box = lessonBox(
  "l1",
  L1_LOCKS,
  [ENVELOPE.START[0], ENVELOPE.START[1], ENVELOPE.START[2]],
  { locks: 3, fingerLocks: 0, decoys: 0, ringless: 2, hidden: 0 },
  ["the Lamplighter", "the second key"],
);

export const LESSON_2: Box = lessonBox("l2", [L2_LOCK], L2_LOCK.lock.L, { locks: 1, fingerLocks: 1, decoys: 0, ringless: 1, hidden: 0 }, [
  "the Puppeteer",
  "a silver thimble",
]);

/** Each lesson lock's twin for its example, by lock index (null: no example on that lock). */
export const LESSON_TWINS: Record<LessonId, (LessonLock | null)[]> = {
  l1: [null, mirrorLock(L1_LOCKS[1]!), mirrorLock(L1_LOCKS[2]!)],
  l2: [mirrorLock(L2_LOCK)],
};

/** A lesson's box and its twins, as one player sees them. */
export interface LessonPlan {
  box: Box;
  twins: (LessonLock | null)[];
}

const BOXES: Record<LessonId, Box> = { l1: LESSON_1, l2: LESSON_2 };
const plans = new Map<string, LessonPlan>();

/**
 * Lesson `id` for a right- or left-handed player: a left-handed player gets the box and its twins reflected left to
 * right (mirrorBox's rule). Made once each; callers must not change what they get.
 */
export function lessonPlan(id: LessonId, mirrored: boolean): LessonPlan {
  const key = id + (mirrored ? "/m" : "");
  let plan = plans.get(key);
  if (!plan) {
    if (!mirrored) plan = { box: BOXES[id], twins: LESSON_TWINS[id] };
    else {
      const box = mirrorBox(BOXES[id]);
      const twins = LESSON_TWINS[id].map((t) => {
        if (!t) return null;
        // A twin reflects as a one-lock box would.
        const m = mirrorBox({ ...BOXES[id], locks: [t.lock], elements: t.elements });
        return { lock: m.locks[0]!, elements: m.elements };
      });
      plan = { box, twins };
    }
    plans.set(key, plan);
  }
  return plan;
}
