// The lessons' staged examples as timelines, for the lessons director: keyed ghost hand and ghost lantern positions,
// ramps for the cradle, the scraps' layout, glows and the ghost finger's fill, the coach lines and the click, all
// timed from an example's start. A script is built once when its example starts; evaluating it at a time writes
// into the director's frame and allocates nothing. Also the idle ghost's loops (reach for the lantern, puppets).
//
// Every example is staged the same way: its own "Watch. ..." line, the player's lantern parks in its cradle, the
// scraps swing into the twin's layout (smoothly, no overshoot), the ghost appears and solves the twin in three beats
// ending in one click, lets go and leaves, the scraps swing home past their places and settle (no overshoot with
// reduced motion) while the ghost lantern still lights them, then the lantern lifts out of the cradle and the
// player's turn: in a lesson, the line that names the task ("Your turn. Make both pieces meet in the arrow."); in a
// replay, "Your turn." A line is its copy key (COPY.lessons[key] is the words).
import type { LessonId, LessonPlan } from "../core/lessons-data";
import type { TipId } from "../core/profile";
import type { Box, Lock, V3 } from "../core/types";
import type { COPY } from "../ui/copy";
import { tipLock } from "./tips";

type Lines = typeof COPY.lessons;
/** A coach line of the lessons by its copy key: COPY.lessons[key] is what the chip shows (and a voice would say). */
export type LessonLine = { [K in keyof Lines]: Lines[K] extends string ? K : never }[keyof Lines];

export type ExampleId = "move" | "near-far" | "rings" | "finger";
/**
 * The ghost hand's poses (src/lessons/poses.json, and render/ghost-hand.ts's "hold" and "ready": a lantern held by
 * its loop, and the hand open to take it, the other fingers tucked in both).
 */
export type PoseName = "open" | "pinch" | "point" | "relaxed" | "hold" | "ready";
/** The point of the ghost hand placed at `at`: the pinch point, the index fingertip or the wrist. */
export type HandAnchor = "grasp" | "tip" | "wrist";

/** The scraps swing between the twin's layout and the player's over this long. */
export const SWING_MS = 1200;
/** The player's lantern flies into (and out of) its cradle over this long. */
export const PARK_MS = 600;
/** A replay leaves "Your turn." up this long after its example. */
const REPLAY_TAIL_MS = 1500;
/** The ghost finger's hold before the piece forms (the finger lock's 0.6 s), and the forming itself. */
const FILL_MS = 600;
const CRYSTAL_MS = 700;

/** Where each example is staged: its lesson and the lock it solves a twin of. */
export const EXAMPLES: Readonly<Record<ExampleId, { readonly lesson: LessonId; readonly lock: number }>> = {
  move: { lesson: "l1", lock: 0 },
  "near-far": { lesson: "l1", lock: 1 },
  rings: { lesson: "l1", lock: 2 },
  finger: { lesson: "l2", lock: 0 },
};

export interface GhostHandFrame {
  /** 0 hidden to 1 shown. */
  opacity: number;
  /** The pose: poseA blended toward poseB by poseT. */
  poseA: PoseName;
  poseB: PoseName;
  poseT: number;
  anchor: HandAnchor;
  /** Where the anchor is (box units). */
  at: V3;
  /** Which way the fingers point (the index finger for "tip"), and which way the palm faces (box units, unit). */
  fingers: V3;
  palm: V3;
  /** The player's dominant hand. */
  side: "left" | "right";
}

// --- Timelines ------------------------------------------------------------------------------------------------

export interface HandKey {
  t: number;
  at: V3;
  pose: PoseName;
  op: number;
}
interface LampKey {
  t: number;
  at: V3;
  op: number;
}
type Ease = "jerk" | "smooth" | "swing" | "linear";
/** A value easing from `from` to `to` over [t0, t1]. A channel holds its last started ramp's value. */
interface Ramp {
  t0: number;
  t1: number;
  from: number;
  to: number;
  ease: Ease;
}

/** One example, timed from its start (ms). */
export interface Script {
  ex: ExampleId;
  lesson: LessonId;
  lock: number;
  replay: boolean;
  end: number;
  anchor: HandAnchor;
  fingers: V3;
  palm: V3;
  hand: HandKey[];
  lamp: LampKey[];
  /** The coach line from each time on, by copy key. */
  lines: { t: number; key: LessonLine }[];
  park: Ramp[];
  layout: Ramp[];
  glow: Ramp[];
  glowPiece: number;
  solved: Ramp[];
  fill: Ramp[];
  /** The ghost lantern lights the box over [t0, t1). */
  light: [number, number];
  clickT: number;
  lift: V3 | null;
}
/** What every script starts from: which example, where, and whether it is a replay. */
type ScriptBase = Pick<Script, "ex" | "lesson" | "lock" | "replay">;

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Minimum jerk: how a hand moves from rest to rest. */
const jerk = (u: number) => u * u * u * (10 + u * (-15 + 6 * u));
const smooth = (u: number) => u * u * (3 - 2 * u);
/** Out past the end and back (about 7%): scraps on threads swinging home. */
const SWING_C1 = 1.4;
const swing = (u: number) => {
  const v = u - 1;
  return 1 + (SWING_C1 + 1) * v * v * v + SWING_C1 * v * v;
};

function ease(e: Ease, u: number, reduced: boolean): number {
  if (e === "linear") return u;
  if (e === "smooth" || (e === "swing" && reduced)) return smooth(u);
  return e === "swing" ? swing(u) : jerk(u);
}

/** The channel's value at t: its initial value before any ramp, else the last ramp started by t. */
export function rampAt(ramps: Ramp[], t: number, initial: number, reduced: boolean): number {
  let v = initial;
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i]!;
    if (t < r.t0) break;
    const u = r.t1 > r.t0 ? clamp01((t - r.t0) / (r.t1 - r.t0)) : 1;
    v = r.from + (r.to - r.from) * ease(r.ease, u, reduced);
  }
  return v;
}

/** The keyed segment around t: index of the key at or before t (0 before the first). */
function segment(keys: { t: number }[], t: number): number {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1]!.t <= t) i++;
  return i;
}

function lerp3(a: V3, b: V3, u: number, out: V3): void {
  out[0] = a[0] + (b[0] - a[0]) * u;
  out[1] = a[1] + (b[1] - a[1]) * u;
  out[2] = a[2] + (b[2] - a[2]) * u;
}

/** Hand keys at t into the frame (`base` added to every key's position: loops keyed around a moving point). */
export function handAt(keys: HandKey[], t: number, out: GhostHandFrame, base: V3 | null): void {
  const i = segment(keys, t), a = keys[i]!, b = keys[Math.min(i + 1, keys.length - 1)]!;
  const u = b.t > a.t ? clamp01((t - a.t) / (b.t - a.t)) : 0;
  const e = jerk(u);
  lerp3(a.at, b.at, e, out.at);
  if (base) {
    out.at[0] += base[0];
    out.at[1] += base[1];
    out.at[2] += base[2];
  }
  out.poseA = a.pose;
  out.poseB = b.pose;
  out.poseT = e;
  out.opacity = a.op + (b.op - a.op) * u;
}

export function lampAt(keys: LampKey[], t: number, out: { opacity: number; at: V3 }): void {
  const i = segment(keys, t), a = keys[i]!, b = keys[Math.min(i + 1, keys.length - 1)]!;
  const u = b.t > a.t ? clamp01((t - a.t) / (b.t - a.t)) : 0;
  lerp3(a.at, b.at, jerk(u), out.at);
  out.opacity = a.op + (b.op - a.op) * u;
}

// --- Example scripts --------------------------------------------------------------------------------------------

const add = (a: V3, x: number, y: number, z: number): V3 => [a[0] + x, a[1] + y, a[2] + z];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** The point at depth z on the ray from L through panel point (x, y). */
const onRay = (L: V3, x: number, y: number, z: number): V3 => {
  const k = (L[2] - z) / L[2];
  return [L[0] + (x - L[0]) * k, L[1] + (y - L[1]) * k, z];
};

/**
 * Where the ghost holds a lantern, above its light (box units): the middle of its handle loop (the real lantern's and
 * the ghost lantern's, render/ghost-hand.ts GHOST_LANTERN_GRIP), pinched between thumb and index.
 */
export const LANTERN_GRIP_Y = 0.155;
/** The pinch point for a lantern whose light is at p. */
export const gripOf = (p: Readonly<V3>): V3 => [p[0], p[1] + LANTERN_GRIP_Y, p[2]];
/**
 * The ghost holds the lantern by its loop from the dominant side as a seated player would, the hand at the lantern's
 * height: fingers into the box, toward its middle and a little up; the palm toward the middle and turned 30 degrees
 * down (the thumb's side up, the back of the hand toward the eye). So the hand stays low, under the sight lines from
 * the eye to the panel (tests/unit/ghost-at-work.test.ts), and the eye sees the lantern hang from the pinch.
 */
export const graspFingers = (side: number): V3 => unit([-0.25 * side, 0.2, -1]);
export const graspPalm = (side: number): V3 => unit([-side, -Math.tan(Math.PI / 6), 0]);
export const PALM_DOWN: V3 = [0, -1, 0];
/**
 * Where the ghost hand comes from and goes back to: out past the box mouth on the dominant side, nearer the eye and a
 * little lower (under the sight lines to the panel).
 */
const handFrom = (p: V3, side: number): V3 => add(p, 0.22 * side, -0.04, 0.28);

/** A beat: the ghost lantern moves to `to` over `ms`, the line changing as it starts. */
interface Beat {
  to: V3;
  ms: number;
  key?: LessonLine;
}

/** What an example says first and last: its own opening, and the player's turn after it. */
interface Said {
  open: LessonLine;
  turn: LessonLine;
}

/** The player's turn after `said`'s example: in a replay, simply "Your turn." (the box it returns to is another). */
const turnOf = (base: ScriptBase, said: Said): LessonLine => (base.replay ? "yourTurn" : said.turn);

/**
 * An example where the ghost carries a ghost lantern: its opening line, park, the twin's layout (if any) and the lamp
 * at A, the hand picks it up, the beats, the click at the last beat's end, the release, the swing home, the lift.
 */
function lanternScript(
  base: ScriptBase,
  side: number,
  A: V3,
  beats: Beat[],
  twin: boolean,
  glow: { piece: number; beat: number } | null,
  said: Said,
): Script {
  const park0 = PARK_MS, show = park0 + 400, grab = show + 400;
  // The hand's keys are its pinch on the lantern's loop; the lamp's, its light.
  const from = handFrom(gripOf(A), side);
  const hand: HandKey[] = [
    { t: show, at: from, pose: "ready", op: 0 },
    { t: show + 400, at: from, pose: "ready", op: 1 },
    { t: grab + 800, at: gripOf(A), pose: "hold", op: 1 },
  ];
  const lamp: LampKey[] = [
    { t: park0, at: A, op: 0 },
    { t: show, at: A, op: 1 },
    { t: grab + 800, at: A, op: 1 },
  ];
  const lines: Script["lines"] = [{ t: 0, key: said.open }];
  let t = grab + 800;
  const starts: number[] = [];
  for (const b of beats) {
    starts.push(t);
    if (b.key) lines.push({ t, key: b.key });
    t += b.ms;
    hand.push({ t, at: gripOf(b.to), pose: "hold", op: 1 });
    lamp.push({ t, at: b.to, op: 1 });
  }
  const T = beats[beats.length - 1]!.to, click = t, held = gripOf(T);
  // Hold, let go, and leave; the lamp stays lit while the scraps swing home under it.
  const swing0 = click + 1200, swing1 = swing0 + (twin ? SWING_MS : 0), lift0 = swing1;
  hand.push(
    { t: click + 800, at: held, pose: "hold", op: 1 },
    { t: click + 1200, at: held, pose: "ready", op: 1 },
    { t: click + 1700, at: handFrom(held, side), pose: "ready", op: 0 },
  );
  lamp.push({ t: lift0, at: T, op: 1 }, { t: lift0 + 400, at: T, op: 0 });
  lines.push({ t: lift0, key: turnOf(base, said) });
  const end = lift0 + PARK_MS + (base.replay ? REPLAY_TAIL_MS : 0);
  const glowRamps: Ramp[] = glow
    ? [
        { t0: starts[glow.beat]!, t1: starts[glow.beat]! + 500, from: 0, to: 1, ease: "smooth" },
        { t0: starts[glow.beat + 2] ?? click, t1: (starts[glow.beat + 2] ?? click) + 500, from: 1, to: 0, ease: "smooth" },
      ]
    : [];
  return {
    ...base,
    end,
    anchor: "grasp",
    fingers: graspFingers(side),
    palm: graspPalm(side),
    hand,
    lamp,
    lines,
    park: [
      { t0: 0, t1: PARK_MS, from: 0, to: 1, ease: "jerk" },
      { t0: lift0, t1: lift0 + PARK_MS, from: 1, to: 0, ease: "jerk" },
    ],
    layout: twin
      ? [
          { t0: park0, t1: park0 + SWING_MS, from: 1, to: 0, ease: "smooth" },
          { t0: swing0, t1: swing1, from: 0, to: 1, ease: "swing" },
        ]
      : [],
    glow: glowRamps,
    glowPiece: glow ? glow.piece : -1,
    solved: [
      { t0: click, t1: click + 300, from: 0, to: 1, ease: "smooth" },
      { t0: swing0, t1: swing0 + 300, from: 1, to: 0, ease: "smooth" },
    ],
    fill: [],
    light: [park0, lift0],
    clickT: click,
    lift: null,
  };
}

/**
 * A human hand in the smallest box's units (an 18 cm box): fingertip to knuckles 9 cm, the palm 8 cm across. The
 * finger meets the box mouth this far from the middle at most (the glass sides are at 0.5).
 */
const KNUCKLES = 0.09 / 0.18, PALM_WIDTH = 0.08 / 0.18, MOUTH_X = 0.4;

/**
 * The ghost finger's direction for a tip at `tip` with the spot at `T`: `flat` (along the prong, level with the
 * panel) turned toward the ray from the spot through the tip, as little as it takes for the hand behind the finger to
 * be out of the box: its knuckles (and the palm's width either side of them) past the mouth, and the finger meeting
 * the mouth inside the glass. Both directions lie in the plane through the spot and the prong's axis, so the
 * finger's shadow still runs along the prong.
 */
function fingerInto(T: V3, tip: V3, flat: V3): V3 {
  const ray = unit([tip[0] - T[0], tip[1] - T[1], tip[2] - T[2]]);
  let f = flat;
  for (let k = 0; k <= 18; k++) {
    const a = (k / 18) * (Math.PI / 2) * 0.95, c = Math.cos(a), s = Math.sin(a);
    f = unit([flat[0] * c + ray[0] * s, flat[1] * c + ray[1] * s, flat[2] * c + ray[2] * s]);
    if (f[2] >= 0) continue;
    // The palm's width runs square to the finger, level: the part of it in depth is how sideways the finger points.
    const knuckles = tip[2] - f[2] * KNUCKLES, widthInDepth = (PALM_WIDTH * Math.abs(f[0])) / Math.hypot(f[0], f[2]);
    const atMouth = tip[0] - f[0] * ((1 - tip[2]) / -f[2]);
    if (knuckles - widthInDepth >= 1 && Math.abs(atMouth) <= MOUTH_X) return f;
  }
  return f;
}

/** Example 3: the ghost lantern settled on the twin's spot, a pointing ghost finger filling the missing prong. */
function fingerScript(base: ScriptBase, side: number, tw: Lock, own: Lock): Script {
  const T = tw.L, poly = tw.target[tw.missing]!;
  // The prong's middle and long axis on the panel, its ends 80% of the way out, lifted onto rays from the spot at the
  // finger's depth (inside the box mouth).
  let cx = 0, cy = 0;
  for (const p of poly) {
    cx += p[0] / poly.length;
    cy += p[1] / poly.length;
  }
  const dx = Math.cos(tw.fingerAngle), dy = Math.sin(tw.fingerAngle);
  let h = 0;
  for (const p of poly) h = Math.max(h, Math.abs((p[0] - cx) * dx + (p[1] - cy) * dy));
  h *= 0.8;
  const zf = 0.8, e1 = onRay(T, cx + dx * h, cy + dy * h, zf), e2 = onRay(T, cx - dx * h, cy - dy * h, zf);
  // The fingertip is the end away from the dominant hand; the finger points from the other end toward it, tilted
  // into the box (see fingerInto) so the hand behind it comes out through the mouth.
  const [tip, back] = e1[0] * side < e2[0] * side ? [e1, e2] : [e2, e1];
  const fingers = fingerInto(T, tip, unit([tip[0] - back[0], tip[1] - back[1], tip[2] - back[2]]));
  // In and out straight through the mouth (only depth changes, so no part of the hand nears a glass side).
  const near = add(tip, 0, 0.02, 0.18), from = add(tip, 0, 0.05, 0.42);
  const park0 = PARK_MS, in0 = park0 + SWING_MS, beat1 = in0 + 800, beat2 = beat1 + 2400, hold = beat2 + 3000;
  const click = hold + FILL_MS + CRYSTAL_MS, leave = hold + 2000, swing0 = leave + 600, lift0 = swing0 + SWING_MS;
  return {
    ...base,
    end: lift0 + PARK_MS + (base.replay ? REPLAY_TAIL_MS : 0),
    anchor: "tip",
    fingers,
    palm: PALM_DOWN,
    hand: [
      { t: in0, at: from, pose: "relaxed", op: 0 },
      { t: beat1, at: from, pose: "point", op: 1 },
      { t: beat2, at: near, pose: "point", op: 1 },
      { t: hold, at: tip, pose: "point", op: 1 },
      { t: leave, at: tip, pose: "point", op: 1 },
      { t: leave + 400, at: near, pose: "point", op: 1 },
      { t: swing0, at: from, pose: "relaxed", op: 0 },
    ],
    lamp: [
      { t: park0, at: T, op: 0 },
      { t: park0 + 400, at: T, op: 1 },
      { t: lift0, at: T, op: 1 },
      { t: lift0 + 400, at: T, op: 0 },
    ],
    lines: [
      { t: 0, key: "watchFinger" },
      { t: beat1, key: "finger" },
      { t: lift0, key: turnOf(base, SAID.finger) },
    ],
    park: [
      { t0: 0, t1: PARK_MS, from: 0, to: 1, ease: "jerk" },
      { t0: lift0, t1: lift0 + PARK_MS, from: 1, to: 0, ease: "jerk" },
    ],
    layout: [
      { t0: park0, t1: park0 + SWING_MS, from: 1, to: 0, ease: "smooth" },
      { t0: swing0, t1: lift0, from: 0, to: 1, ease: "swing" },
    ],
    glow: [],
    glowPiece: -1,
    solved: [
      { t0: click, t1: click + 300, from: 0, to: 1, ease: "smooth" },
      { t0: swing0, t1: swing0 + 300, from: 1, to: 0, ease: "smooth" },
    ],
    fill: [
      { t0: hold, t1: hold + FILL_MS, from: 0, to: 1, ease: "linear" },
      { t0: swing0, t1: swing0 + 300, from: 1, to: 0, ease: "smooth" },
    ],
    light: [park0, lift0],
    clickT: click,
    // "Your turn": the player's Crown, the lantern already settled on its spot.
    lift: [own.L[0], own.L[1], own.L[2]],
  };
}

/**
 * What each example says first and, in a lesson, as the player's turn begins. "Move the light" plays in a lesson only
 * as lock I's last resort (the lesson's help on the lock itself): its turn is lock I's goal again.
 */
export const SAID: Readonly<Record<ExampleId, Said>> = {
  move: { open: "watch", turn: "goal" },
  "near-far": { open: "watchNearFar", turn: "turnNearFar" },
  rings: { open: "watchRings", turn: "yourTurn" },
  finger: { open: "watchFinger", turn: "turnFinger" },
};

/** The script of example `ex` on `plan` (its lesson's box and twins, mirrored for a left-handed player). */
export function buildScript(ex: ExampleId, plan: LessonPlan, left: boolean, replay: boolean): Script {
  const { lesson, lock } = EXAMPLES[ex];
  const side = left ? -1 : 1;
  const own = plan.box.locks[lock]!, twin = plan.twins[lock];
  const base = { ex, lesson, lock, replay };
  if (ex === "finger" && twin) return fingerScript(base, side, twin.lock, own);
  const T = twin ? twin.lock.L : own.L;
  // Toward the box's middle from the spot (the twin sits on the weak side).
  const c = T[0] === 0 ? side : -Math.sign(T[0]);
  if (ex === "move") {
    const A = add(T, 0.28 * side, 0.08, 0.18);
    return lanternScript(
      base,
      side,
      A,
      [
        { to: add(T, 0.1 * side, 0.02, -0.16), ms: 3000, key: "watchMove" },
        { to: add(T, -0.1 * side, 0.04, 0.1), ms: 3000 },
        { to: T, ms: 2600 },
      ],
      false,
      null,
      SAID.move,
    );
  }
  if (ex === "rings" && twin && twin.lock.mark) {
    const M = twin.lock.mark, P = (k: number): V3 => [M[0] + k * (T[0] - M[0]), M[1] + k * (T[1] - M[1]), k * T[2]];
    return lanternScript(
      base,
      side,
      add(T, 0.14 * c, 0.1, 0.15),
      [
        { to: P(1.25), ms: 3000, key: "lineUp" },
        { to: P(0.9), ms: 3500, key: "slide" },
        { to: T, ms: 3000 },
      ],
      true,
      null,
      SAID.rings,
    );
  }
  // Near and far: move, then sway so the near scrap's shadow swings while the far one's holds, then the click.
  const els = twin ? twin.elements : [];
  let nearPiece = -1, nearZ = -Infinity;
  for (const e of els) if (e.kind === "piece" && e.verts[0]![2] > nearZ) [nearPiece, nearZ] = [e.piece, e.verts[0]![2]];
  const B = add(T, 0.16 * c, -0.02, -0.08);
  return lanternScript(
    base,
    side,
    add(T, 0.12 * c, -0.08, -0.22),
    [
      { to: B, ms: 3000 },
      { to: add(T, -0.08 * c, -0.02, -0.08), ms: 2000, key: "nearSwing" },
      { to: B, ms: 2000 },
      { to: T, ms: 2600 },
    ],
    twin !== null,
    nearPiece >= 0 ? { piece: nearPiece, beat: 1 } : null,
    SAID["near-far"],
  );
}

// --- Tip demos: about 6 s of ghost the first time a box brings in a mechanic, in interactive play ---------------
//
// No cradle and no swing: the player's lantern stays where it is. Decoys: the ghost finger points at two of them,
// straight in through the mouth (Ruling 124). A lock without rings, a hidden outline: the ghost carries its lantern
// in a sweep at least SWEEP_CLEAR from every lock's spot, the shadows cast from it, so they visibly slide and never
// form (the demo shows how to read them; it never shows the answer). Nothing flies or swings and the ghost only
// glides and fades, so a demo needs no reduced-motion variant.

/** A tip's ghost demo lasts this long. */
export const TIP_DEMO_MS = 6000;

/** A tip demo, timed from its start (ms). */
export interface TipScript {
  end: number;
  anchor: HandAnchor;
  fingers: V3;
  palm: V3;
  side: "left" | "right";
  hand: HandKey[];
  /** Empty: no ghost lantern. */
  lamp: LampKey[];
  /** The ghost lantern lights the box over [t0, t1). */
  light: [number, number];
}

const centroid = (v: V3[]): V3 => {
  let x = 0, y = 0, z = 0;
  for (const p of v) {
    x += p[0] / v.length;
    y += p[1] / v.length;
    z += p[2] / v.length;
  }
  return [x, y, z];
};

/** The finger for decoys: straight into the box, a little down. Its tip stops this far in front of a decoy. */
const DECOY_FINGERS = unit([0, -0.12, -1]);

function decoyTip(box: Box, side: "left" | "right"): TipScript | null {
  // The two decoys nearest the middle (the hand never goes near a glass side).
  const decoys: V3[] = [];
  for (const e of box.elements) if (e.kind === "decoy") decoys.push(centroid(e.verts));
  if (!decoys.length) return null;
  decoys.sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]));
  const f = DECOY_FINGERS;
  // Pointing at c from in front of it: the tip at least 0.3 nearer the mouth (and never deeper than 0.7), so the
  // knuckles are out through the mouth.
  const pointAt = (c: V3): V3 => {
    const d = (Math.max(0.7, c[2] + 0.3) - c[2]) / -f[2];
    return [c[0] - f[0] * d, c[1] - f[1] * d, c[2] - f[2] * d];
  };
  const a = pointAt(decoys[0]!), b = pointAt(decoys[1] ?? decoys[0]!);
  const out = (p: V3): V3 => [p[0], p[1] + 0.06, 1.45];
  return {
    end: TIP_DEMO_MS,
    anchor: "tip",
    fingers: f,
    palm: PALM_DOWN,
    side,
    hand: [
      { t: 0, at: out(a), pose: "point", op: 0 },
      { t: 600, at: out(a), pose: "point", op: 1 },
      { t: 1600, at: a, pose: "point", op: 1 },
      { t: 2600, at: a, pose: "point", op: 1 },
      { t: 3800, at: b, pose: "point", op: 1 },
      { t: 4800, at: b, pose: "point", op: 1 },
      { t: 5600, at: out(b), pose: "point", op: 1 },
      { t: TIP_DEMO_MS, at: out(b), pose: "point", op: 0 },
    ],
    lamp: [],
    light: [0, 0],
  };
}

/**
 * The ghost lantern keeps at least this far from every lock's spot (Ruling 123; past WARMTH_RANGE, 0.2), so the
 * shadows visibly slide and never form: the demo teaches reading them, never the answer. Planned with a margin.
 */
export const SWEEP_CLEAR = 0.3;
const SWEEP_MARGIN = 0.02;
/**
 * Where the sweep's middle may sit from the tip's lock's spot (x toward the dominant side), tried in order: above
 * it, above and nearer the eye, nearer the eye, below, then further out.
 */
const SWEEP_OFFSETS: readonly V3[] = [
  [0, 0.36, 0.05],
  [0, 0.28, 0.24],
  [0, 0.1, 0.38],
  [0, -0.36, 0.05],
  [0, 0.44, 0.2],
  [0, 0.3, 0.42],
  [0.38, 0.12, 0.12],
  [-0.38, 0.12, 0.12],
  [0, 0.55, 0.3],
  [0, 0.2, 0.6],
];

/** The distance from p to the segment ab. */
function segDist(p: Readonly<V3>, a: Readonly<V3>, b: Readonly<V3>): number {
  const ab0 = b[0] - a[0], ab1 = b[1] - a[1], ab2 = b[2] - a[2];
  const l2 = ab0 * ab0 + ab1 * ab1 + ab2 * ab2;
  const u = l2 > 0 ? clamp01(((p[0] - a[0]) * ab0 + (p[1] - a[1]) * ab1 + (p[2] - a[2]) * ab2) / l2) : 0;
  return Math.hypot(a[0] + ab0 * u - p[0], a[1] + ab1 * u - p[1], a[2] + ab2 * u - p[2]);
}

/**
 * The sweep stays at least this far out from the panel: well in front of the box mouth (1), so the hand holding the
 * ghost lantern (an open hand reaches about 0.3 below its pinch in the smallest box) never comes inside the glass.
 */
const SWEEP_MIN_Z = 1.4;
/** ...and in front of the box, never beside it (the fingers past the pinch then stay within the glass sides). */
const SWEEP_MAX_X = 0.3;

/**
 * The sweep's three points around `mid`: from the dominant side across, then up and nearer the eye; moved out to
 * SWEEP_MIN_Z if any is nearer the panel, and in to SWEEP_MAX_X if any is further to a side.
 */
function sweepPoints(mid: V3, s: number): [V3, V3, V3] {
  const pts: [V3, V3, V3] = [add(mid, 0.16 * s, 0, 0.04), add(mid, -0.16 * s, 0, -0.04), add(mid, 0, 0.04, 0.06)];
  const out = SWEEP_MIN_Z - Math.min(pts[0][2], pts[1][2], pts[2][2]);
  if (out > 0) for (const p of pts) p[2] += out;
  const hi = Math.max(pts[0][0], pts[1][0], pts[2][0]), lo = Math.min(pts[0][0], pts[1][0], pts[2][0]);
  const dx = hi > SWEEP_MAX_X ? SWEEP_MAX_X - hi : lo < -SWEEP_MAX_X ? -SWEEP_MAX_X - lo : 0;
  if (dx !== 0) for (const p of pts) p[0] += dx;
  return pts;
}

/** Where the ghost hand comes from and goes to around a sweep: up and well out in front, never through the mouth. */
const sweepFrom = (p: V3, s: number): V3 => add(p, 0.1 * s, 0.12, 0.45);

/** How near the sweep A to B to C comes to any of `spots`. */
function sweepClearance(pts: [V3, V3, V3], spots: readonly V3[]): number {
  let d = Infinity;
  for (const p of spots) d = Math.min(d, segDist(p, pts[0], pts[1]), segDist(p, pts[1], pts[2]));
  return d;
}

function sweepTip(box: Box, lock: number, side: "left" | "right"): TipScript {
  const s = side === "left" ? -1 : 1, L = box.locks[lock]!.L, spots = box.locks.map((l) => l.L);
  // The first offset whose whole path keeps clear of every spot.
  let pts: [V3, V3, V3] | null = null;
  for (const o of SWEEP_OFFSETS) {
    const p = sweepPoints(add(L, o[0] * s, o[1], o[2]), s);
    if (sweepClearance(p, spots) >= SWEEP_CLEAR + SWEEP_MARGIN) {
      pts = p;
      break;
    }
  }
  // None did (no box so far): above every spot by more than SWEEP_CLEAR, which holds by construction whatever the
  // box, as the z and x limits move the path only across, never down.
  if (!pts) {
    let top = -Infinity;
    for (const p of spots) top = Math.max(top, p[1]);
    pts = sweepPoints([L[0], top + SWEEP_CLEAR + 0.1, L[2]], s);
  }
  const [A, B, C] = pts;
  // The hand pinches the lantern's loop, above its light.
  const gA = gripOf(A), gB = gripOf(B), gC = gripOf(C);
  const from = sweepFrom(gA, s), away = sweepFrom(gC, s);
  return {
    end: TIP_DEMO_MS,
    anchor: "grasp",
    fingers: graspFingers(s),
    palm: graspPalm(s),
    side,
    hand: [
      { t: 0, at: from, pose: "ready", op: 0 },
      { t: 500, at: from, pose: "ready", op: 1 },
      { t: 1100, at: gA, pose: "hold", op: 1 },
      { t: 2700, at: gB, pose: "hold", op: 1 },
      { t: 4100, at: gC, pose: "hold", op: 1 },
      { t: 4600, at: gC, pose: "ready", op: 1 },
      { t: 5300, at: away, pose: "ready", op: 0 },
    ],
    lamp: [
      { t: 0, at: A, op: 0 },
      { t: 500, at: A, op: 1 },
      { t: 1100, at: A, op: 1 },
      { t: 2700, at: B, op: 1 },
      { t: 4100, at: C, op: 1 },
      { t: 5400, at: C, op: 1 },
      { t: TIP_DEMO_MS, at: C, op: 0 },
    ],
    light: [500, 5700],
  };
}

/** Tip `tip`'s demo on `box` (as the player sees it: mirrored already for a left-handed one), or null without one. */
export function buildTipScript(tip: TipId, box: Box, left: boolean): TipScript | null {
  const side = left ? "left" : "right";
  if (tip === "decoys") return decoyTip(box, side);
  if (tip === "drawer") return null;
  const lock = tipLock(tip, box);
  return lock >= 0 ? sweepTip(box, lock, side) : null;
}

// --- Idle ghosts: loops keyed around a point that may move (the player's lantern) -------------------------------

const o3 = (x: number, y: number, z: number): V3 => [x, y, z];

/** Reach for the lantern, pinch its loop, let go, go back; around the lantern's light. */
export function reachLoop(side: number): HandKey[] {
  const g = o3(0, LANTERN_GRIP_Y, 0), off = handFrom(g, side);
  return [
    { t: 0, at: off, pose: "ready", op: 0 },
    { t: 200, at: off, pose: "ready", op: 1 },
    { t: 1100, at: g, pose: "ready", op: 1 },
    { t: 1500, at: g, pose: "hold", op: 1 },
    { t: 2100, at: g, pose: "hold", op: 1 },
    { t: 2400, at: g, pose: "ready", op: 1 },
    { t: 3200, at: off, pose: "ready", op: 0 },
    { t: 3800, at: off, pose: "ready", op: 0 },
  ];
}

/** An open hand in the beam, palm to the panel, flexing and swaying: its shadow plays on the panel. */
export function puppetLoop(side: number): HandKey[] {
  return [
    { t: 0, at: o3(0.04 * side, 0, 0), pose: "open", op: 1 },
    { t: 1200, at: o3(-0.02 * side, 0.02, 0), pose: "relaxed", op: 1 },
    { t: 2400, at: o3(0.04 * side, 0, 0), pose: "open", op: 1 },
  ];
}
/**
 * Where the puppet hand's wrist sits: low in the box mouth, the hand entering through it with its fingers 45 degrees
 * up into the box, so a human-sized hand (19 cm) stays under the lid even in the smallest box (18 cm: its fingertips
 * end about 3 cm below the lid). Its palm faces the panel and the floor, square to the lantern's light, so its
 * shadow is a whole hand.
 */
export const PUPPET_AT: V3 = [0.1, -0.42, 0.95];
export const PUPPET_FINGERS: V3 = unit([0, 1, -1]);
export const PUPPET_PALM: V3 = unit([0, -1, -1]);
