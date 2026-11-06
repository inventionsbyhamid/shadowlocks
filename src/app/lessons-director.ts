// The lessons, step by step: what the coach line says, when the ghost hand shows and what it does, and when a step is
// done. Pure logic on explicit time: it reads the player through LessonInputs and writes one LessonFrame in place,
// which the lesson view turns into the ghost hand, the ghost lantern, the coach line, the cradle and the scraps'
// layout. Nothing here allocates per frame (a script is built once when an example starts).
//
// Lesson 1, "Catch the light": the box forms from light (2 s), "Pick up the lantern." (a ghost hand shows how after
// 4 s without input), lock I (the Moon), Example 1 then the player's arrow, Example 2 then the player's Key, and the
// box opening with its reward. Lesson 2, "Lend a hand": shadow puppets (5 s of a hand in the beam), Example 3 then
// the player's Crown, then "Pull the drawer to find these lessons again." until the drawer is pulled once.
//
// An example is staged so nobody can miss that it is one: "Watch.", the player's lantern parks in its cradle, the
// scraps swing into the twin's layout, a ghost hand with a pale-blue ghost lantern (or a pointing finger) solves the
// twin in three beats with one click, the scraps swing back into the player's layout, the lantern lifts out of the
// cradle and the line says "Your turn." `replay` runs one example alone, on a fresh copy of its lesson's box, and
// never touches lesson or box progress.
import { type LessonId, type LessonPlan, lessonPlan } from "../core/lessons-data";
import type { Lock, V3 } from "../core/types";
import { COPY } from "../ui/copy";

export type ExampleId = "move" | "near-far" | "rings" | "finger";
/** The ghost hand's poses (src/lessons/poses.json). */
export type PoseName = "open" | "pinch" | "point" | "relaxed";
/** The point of the ghost hand placed at `at`: the pinch point, the index fingertip or the wrist. */
export type HandAnchor = "grasp" | "tip" | "wrist";

/** The box forms from light over this long when a lesson starts. */
export const FORM_MS = 2000;
/** The ghost hand shows a step's move after this long without input. */
export const IDLE_GHOST_MS = 4000;
/** Lesson 2's shadow puppets: this long with a hand in the beam... */
export const PUPPET_MS = 5000;
/** ...or this long in all, the ghost showing how. */
export const PUPPET_MAX_MS = 12000;
/** The scraps swing between the twin's layout and the player's over this long. */
export const SWING_MS = 1200;
/** The player's lantern flies into (and out of) its cradle over this long. */
export const PARK_MS = 600;
/** "Your turn." stays this long before the step's own line. */
export const YOUR_TURN_MS = 3000;
/** The rings' line changes only once the rings have stayed lined up (or apart) this long. */
export const LINE_HOLD_MS = 500;
/** The idle ghost fades in and out over these. */
export const GHOST_IN_MS = 400;
export const GHOST_OUT_MS = 300;
/** Longest frame step; a longer hitch counts as this. */
const MAX_DT_MS = 100;
/** A replay leaves "Your turn." up this long after its example. */
const REPLAY_TAIL_MS = 1500;

/** Where each example is staged: its lesson and the lock it solves a twin of. */
export const EXAMPLES: Readonly<Record<ExampleId, { readonly lesson: LessonId; readonly lock: number }>> = {
  move: { lesson: "l1", lock: 0 },
  "near-far": { lesson: "l1", lock: 1 },
  rings: { lesson: "l1", lock: 2 },
  finger: { lesson: "l2", lock: 0 },
};

/** The example that shows what a lock needs: a finger lock's, a ringed lock's, else near and far. */
export function exampleFor(lock: Lock): ExampleId {
  if (lock.finger) return "finger";
  return lock.rings ? "rings" : "near-far";
}

export type StepKind = "intro" | "move" | "demo" | "turn" | "reward" | "puppets" | "drawer";
export interface LessonStep {
  readonly kind: StepKind;
  /** The lock the step opens (move, turn) or stages (demo); -1 for none. */
  readonly lock: number;
  readonly example: ExampleId | null;
}

const step = (kind: StepKind, lock = -1, example: ExampleId | null = null): LessonStep => ({ kind, lock, example });

export const LESSON_STEPS: Readonly<Record<LessonId, readonly LessonStep[]>> = {
  l1: [
    step("intro"),
    step("move", 0, "move"),
    step("demo", 1, "near-far"),
    step("turn", 1, "near-far"),
    step("demo", 2, "rings"),
    step("turn", 2, "rings"),
    step("reward"),
  ],
  l2: [step("puppets"), step("demo", 0, "finger"), step("turn", 0, "finger"), step("drawer")],
};

/** The locks a lesson resumed at step `n` shows open: those the steps before it opened. */
export function openBefore(id: LessonId, n: number): number[] {
  const out: number[] = [];
  for (const s of LESSON_STEPS[id].slice(0, Math.max(0, n))) {
    if ((s.kind === "move" || s.kind === "turn") && !out.includes(s.lock)) out.push(s.lock);
  }
  return out;
}

/** What the director reads of the player each frame. Positions are in box units. */
export interface LessonInputs {
  /** A hand (or controller) holds the lantern. */
  held(): boolean;
  /** The player did something this frame: a hand near the lantern or in the box mouth, a pinch, the lantern moving. */
  active(): boolean;
  isOpen(lock: number): boolean;
  /** The lock's sight rings are lined up (the feel layer's RingAlign, with its hysteresis). */
  aligned(lock: number): boolean;
  /** A hand is in the beam, casting its shadow on the panel. */
  inBeam(): boolean;
  /** The box-open celebration is over and its reward has been taken (or there is none). */
  settled(): boolean;
  /** The drawer has been pulled open. */
  drawerPulled(): boolean;
  reducedMotion(): boolean;
  /** Where the player's lantern is, into `out`. */
  lantern(out: V3): V3;
}

export interface DirectorDeps {
  inputs: LessonInputs;
  /** Lessons and the ghost come mirrored for a left-handed player. */
  leftHanded(): boolean;
  /** A lesson reached step n (save it: a reload resumes there). Also when a lesson starts. */
  onStep?(id: LessonId, n: number): void;
  /** A lesson is finished. */
  onDone?(id: LessonId): void;
  /** A replay starts (show `lesson`'s box afresh) or ends (put back what was there). */
  onReplay?(example: ExampleId, lesson: LessonId, start: boolean): void;
}

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

export interface LessonFrame {
  /** The coach line, or none. */
  line: string | null;
  /** The box forming from light: 0 not yet, 1 formed. */
  form: number;
  hand: GhostHandFrame;
  /** The pale-blue ghost lantern. */
  lamp: { opacity: number; at: V3 };
  /** The ghost lantern lights the box (its shadows are cast from lamp.at), not the player's. */
  ghostLight: boolean;
  /** The player's lantern in its cradle: 0 where it was, 1 parked. */
  park: number;
  /** Where the lantern lifts to from the cradle (box units), or null: back where it was. */
  lift: V3 | null;
  /** Each lock's scraps: 0 in the twin's layout, 1 in the player's (past 1 while swinging home). */
  layout: Float64Array;
  /** A scrap glowing for an example (its lock and piece, -1 for none) and how much. */
  glowLock: number;
  glowPiece: number;
  glow: number;
  /** The twin lock lit as solved by the ghost (its lock, -1 for none), and how much. */
  solvedLock: number;
  solved: number;
  /** The ghost finger's hold on the twin's missing piece, 0 to 1 (it forms at 1). */
  fill: number;
  /** Counts the ghost's clicks (one per example): a change plays the click. */
  clicks: number;
  /** The lesson box a replay shows, or null. */
  box: LessonId | null;
}

const v3 = (): V3 => [0, 0, 0];

function newFrame(): LessonFrame {
  return {
    line: null,
    form: 1,
    hand: { opacity: 0, poseA: "relaxed", poseB: "relaxed", poseT: 0, anchor: "grasp", at: v3(), fingers: [0, 0, -1], palm: [0, -1, 0], side: "right" },
    lamp: { opacity: 0, at: v3() },
    ghostLight: false,
    park: 0,
    lift: null,
    layout: new Float64Array([1, 1, 1]),
    glowLock: -1,
    glowPiece: -1,
    glow: 0,
    solvedLock: -1,
    solved: 0,
    fill: 0,
    clicks: 0,
    box: null,
  };
}

// --- Timelines ------------------------------------------------------------------------------------------------

interface HandKey {
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
interface Script {
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
  lines: { t: number; line: string }[];
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

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
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
function rampAt(ramps: Ramp[], t: number, initial: number, reduced: boolean): number {
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
function handAt(keys: HandKey[], t: number, out: GhostHandFrame, base: V3 | null): void {
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

function lampAt(keys: LampKey[], t: number, out: { opacity: number; at: V3 }): void {
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

/** The ghost holds the lantern pinched from above, fingers into the box and toward its middle, palm down. */
const graspFingers = (side: number): V3 => unit([-0.3 * side, -0.2, -1]);
const PALM_DOWN: V3 = [0, -1, 0];
/** Where the ghost hand comes from and goes back to: out past the box mouth on the dominant side, nearer the eye. */
const handFrom = (p: V3, side: number): V3 => add(p, 0.2 * side, 0.08, 0.28);

/** A beat: the ghost lantern moves to `to` over `ms`, the line changing as it starts. */
interface Beat {
  to: V3;
  ms: number;
  line?: string;
}

/**
 * An example where the ghost carries a ghost lantern: "Watch.", park, the twin's layout (if any) and the lamp at A,
 * the hand picks it up, the beats, the click at the last beat's end, the release, the swing home, the lift.
 */
function lanternScript(
  base: ScriptBase,
  side: number,
  A: V3,
  beats: Beat[],
  twin: boolean,
  glow: { piece: number; beat: number } | null,
): Script {
  const C = COPY.lessons;
  const park0 = PARK_MS, show = park0 + 400, grab = show + 400;
  const from = handFrom(A, side);
  const hand: HandKey[] = [
    { t: show, at: from, pose: "open", op: 0 },
    { t: show + 400, at: from, pose: "open", op: 1 },
    { t: grab + 800, at: A, pose: "pinch", op: 1 },
  ];
  const lamp: LampKey[] = [
    { t: park0, at: A, op: 0 },
    { t: show, at: A, op: 1 },
    { t: grab + 800, at: A, op: 1 },
  ];
  const lines = [{ t: 0, line: C.watch as string }];
  let t = grab + 800;
  const starts: number[] = [];
  for (const b of beats) {
    starts.push(t);
    if (b.line) lines.push({ t, line: b.line });
    t += b.ms;
    hand.push({ t, at: b.to, pose: "pinch", op: 1 });
    lamp.push({ t, at: b.to, op: 1 });
  }
  const T = beats[beats.length - 1]!.to, click = t;
  // Hold, let go, and leave; the lamp stays lit while the scraps swing home under it.
  const swing0 = click + 1200, swing1 = swing0 + (twin ? SWING_MS : 0), lift0 = swing1;
  hand.push(
    { t: click + 800, at: T, pose: "pinch", op: 1 },
    { t: click + 1200, at: T, pose: "open", op: 1 },
    { t: click + 1700, at: handFrom(T, side), pose: "open", op: 0 },
  );
  lamp.push({ t: lift0, at: T, op: 1 }, { t: lift0 + 400, at: T, op: 0 });
  lines.push({ t: lift0, line: C.yourTurn });
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
    palm: PALM_DOWN,
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

/** Example 3: the ghost lantern settled on the twin's spot, a pointing ghost finger filling the missing prong. */
function fingerScript(base: ScriptBase, side: number, tw: Lock, own: Lock): Script {
  const C = COPY.lessons;
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
  // The fingertip is the end away from the dominant hand; the finger points from the other end to it.
  const [tip, back] = e1[0] * side < e2[0] * side ? [e1, e2] : [e2, e1];
  const fingers = unit([tip[0] - back[0], tip[1] - back[1], tip[2] - back[2]]);
  const near = add(tip, 0.12 * side, 0.05, 0.15), from = handFrom(near, side);
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
      { t: 0, line: C.watch },
      { t: beat1, line: C.finger },
      { t: lift0, line: C.yourTurn },
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

/** The ghost finger's hold before the piece forms (the finger lock's 0.6 s), and the forming itself. */
const FILL_MS = 600;
const CRYSTAL_MS = 700;

function buildScript(ex: ExampleId, plan: LessonPlan, left: boolean, replay: boolean): Script {
  const C = COPY.lessons;
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
        { to: add(T, 0.1 * side, 0.02, -0.16), ms: 3000, line: C.watchMove },
        { to: add(T, -0.1 * side, 0.04, 0.1), ms: 3000 },
        { to: T, ms: 2600 },
      ],
      false,
      null,
    );
  }
  if (ex === "rings" && twin && twin.lock.mark) {
    const M = twin.lock.mark, P = (k: number): V3 => [M[0] + k * (T[0] - M[0]), M[1] + k * (T[1] - M[1]), k * T[2]];
    return lanternScript(
      base,
      side,
      add(T, 0.14 * c, 0.1, 0.15),
      [
        { to: P(1.25), ms: 3000, line: C.lineUp },
        { to: P(0.9), ms: 3500, line: C.slide },
        { to: T, ms: 3000 },
      ],
      true,
      null,
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
      { to: add(T, -0.08 * c, -0.02, -0.08), ms: 2000, line: C.nearSwing },
      { to: B, ms: 2000 },
      { to: T, ms: 2600 },
    ],
    twin !== null,
    nearPiece >= 0 ? { piece: nearPiece, beat: 1 } : null,
  );
}

// --- Idle ghosts: loops keyed around a point that may move (the player's lantern) -------------------------------

const o3 = (x: number, y: number, z: number): V3 => [x, y, z];

/** Reach for the lantern, pinch it, let go, go back; around the lantern. */
function reachLoop(side: number): HandKey[] {
  const off = handFrom([0, 0, 0], side);
  return [
    { t: 0, at: off, pose: "open", op: 0 },
    { t: 200, at: off, pose: "open", op: 1 },
    { t: 1100, at: o3(0, 0, 0), pose: "open", op: 1 },
    { t: 1500, at: o3(0, 0, 0), pose: "pinch", op: 1 },
    { t: 2100, at: o3(0, 0, 0), pose: "pinch", op: 1 },
    { t: 2400, at: o3(0, 0, 0), pose: "open", op: 1 },
    { t: 3200, at: off, pose: "open", op: 0 },
    { t: 3800, at: off, pose: "open", op: 0 },
  ];
}

/** An open hand in the beam, palm to the panel, flexing and swaying: its shadow plays on the panel. */
function puppetLoop(side: number): HandKey[] {
  return [
    { t: 0, at: o3(0.04 * side, 0, 0), pose: "open", op: 1 },
    { t: 1200, at: o3(-0.02 * side, 0.02, 0), pose: "relaxed", op: 1 },
    { t: 2400, at: o3(0.04 * side, 0, 0), pose: "open", op: 1 },
  ];
}
/**
 * Where the puppet hand's wrist sits: low in the box mouth, in the beam, its fingers up and leaning a little toward
 * the panel, so a whole hand (about 0.8 box units at the default size) stays inside the box.
 */
const PUPPET_AT: V3 = [0.1, -0.38, 0.92];
const PUPPET_FINGERS: V3 = unit([0, 1, -0.15]);
const PUPPET_PALM: V3 = [0, 0, -1];

// --- The director ---------------------------------------------------------------------------------------------

export class LessonsDirector {
  readonly frame: LessonFrame = newFrame();
  private id: LessonId | null = null;
  private n = 0;
  private finished = false;
  private plan: LessonPlan | null = null;
  private lastT = Number.NaN;
  private formMs = 0;
  private stepMs = 0;
  private idleMs = 0;
  private beamMs = 0;
  /** The idle ghost's own fade (0..1) and its loop's clock. */
  private ghost = 0;
  private ghostKind: "reach" | "puppet" | null = null;
  private loopMs = 0;
  private loops: { reach: HandKey[]; puppet: HandKey[]; grasp: V3; side: number } | null = null;
  private script: Script | null = null;
  private scriptMs = 0;
  private replayEx: ExampleId | null = null;
  /** The rings' line shown (lined up or not) and how long the other state has held. */
  private ringsLined = false;
  private ringsMs = 0;
  private readonly at: V3 = [0, 0, 0];

  constructor(private readonly deps: DirectorDeps) {}

  /** The lesson's current step (its length once done). */
  get step(): number {
    return this.n;
  }

  get done(): boolean {
    return this.finished;
  }

  /** The lesson running, or null. */
  get lesson(): LessonId | null {
    return this.id;
  }

  /** The example a replay is showing, or null. */
  get replaying(): ExampleId | null {
    return this.replayEx;
  }

  /** Start lesson `id` at the start of step `fromStep` (a resumed lesson; a damaged step number starts it over). */
  start(id: LessonId, fromStep = 0): void {
    const steps = LESSON_STEPS[id];
    const from = Number.isInteger(fromStep) && fromStep >= 0 && fromStep < steps.length ? fromStep : 0;
    this.endReplay();
    this.id = id;
    this.finished = false;
    this.plan = lessonPlan(id, this.deps.leftHanded());
    this.formMs = 0;
    this.script = null;
    this.lastT = Number.NaN;
    this.ghost = 0;
    this.ghostKind = null;
    this.resetFrame();
    this.frame.form = 0;
    this.enter(from);
  }

  /** Leave the lesson (and any replay) without finishing it. */
  stop(): void {
    this.endReplay();
    this.id = null;
    this.plan = null;
    this.script = null;
    this.resetFrame();
  }

  /** A replay cut short: the view puts back what it showed before. */
  private endReplay(): void {
    const ex = this.replayEx;
    if (!ex) return;
    this.replayEx = null;
    this.script = null;
    this.deps.onReplay?.(ex, EXAMPLES[ex].lesson, false);
  }

  /**
   * Show one example alone on a fresh copy of its lesson's box; lesson and box progress stay as they are. False (and
   * nothing happens) while an example is already playing.
   */
  replay(example: ExampleId): boolean {
    if (this.script) return false;
    const { lesson } = EXAMPLES[example];
    const left = this.deps.leftHanded();
    this.script = buildScript(example, lessonPlan(lesson, left), left, true);
    this.scriptMs = 0;
    this.replayEx = example;
    this.frame.box = lesson;
    this.deps.onReplay?.(example, lesson, true);
    this.runScript(0);
    return true;
  }

  update(tMs: number): void {
    const dt = Number.isFinite(this.lastT) ? Math.min(Math.max(tMs - this.lastT, 0), MAX_DT_MS) : 0;
    this.lastT = tMs;
    if (this.script) {
      this.scriptMs += dt;
      this.runScript(dt);
      return;
    }
    const f = this.frame;
    if (!this.id || this.finished) {
      f.line = null;
      this.idleGhost(dt, false, null);
      return;
    }
    this.formMs += dt;
    this.stepMs += dt;
    f.form = clamp01(this.formMs / FORM_MS);
    const s = LESSON_STEPS[this.id][this.n]!, inp = this.deps.inputs, formed = f.form >= 1;
    switch (s.kind) {
      case "intro":
      case "move": {
        f.line = s.kind === "move" ? COPY.lessons.watchMove : formed ? COPY.lessons.pickUp : null;
        const held = inp.held();
        this.idleMs = held || inp.active() ? 0 : this.idleMs + dt;
        this.idleGhost(dt, !held && this.idleMs >= IDLE_GHOST_MS, "reach");
        if (s.kind === "intro" ? held : inp.isOpen(s.lock)) this.advance();
        break;
      }
      case "turn":
        f.line = this.turnLine(s, dt);
        this.idleGhost(dt, false, null);
        if (inp.isOpen(s.lock)) this.advance();
        break;
      case "reward":
        f.line = null;
        this.idleGhost(dt, false, null);
        if (inp.settled()) this.advance();
        break;
      case "puppets": {
        f.line = formed ? COPY.lessons.puppets : null;
        const beam = inp.inBeam();
        if (beam) this.beamMs += dt;
        this.idleMs = beam ? 0 : this.idleMs + dt;
        this.idleGhost(dt, this.idleMs >= IDLE_GHOST_MS, "puppet");
        if (this.beamMs >= PUPPET_MS || this.stepMs >= PUPPET_MAX_MS) this.advance();
        break;
      }
      case "drawer":
        f.line = inp.settled() ? COPY.lessons.drawer : null;
        this.idleGhost(dt, false, null);
        if (inp.drawerPulled()) this.advance();
        break;
      case "demo":
        // A demo step always has its script running; reaching here means it was skipped.
        this.advance();
        break;
    }
  }

  /** The line of a player's turn: "Your turn." first, then what the example taught. */
  private turnLine(s: LessonStep, dt: number): string {
    const C = COPY.lessons;
    if (s.example === "rings") {
      const a = this.deps.inputs.aligned(s.lock);
      if (a === this.ringsLined) this.ringsMs = 0;
      else if ((this.ringsMs += dt) >= LINE_HOLD_MS) {
        this.ringsLined = a;
        this.ringsMs = 0;
      }
    }
    if (this.stepMs < YOUR_TURN_MS) return C.yourTurn;
    if (s.example === "rings") return this.ringsLined ? C.slide : C.lineUp;
    return s.example === "finger" ? C.finger : C.nearSwing;
  }

  private advance(): void {
    this.enter(this.n + 1);
  }

  /** Go to step n, past any steps already done (a lock the player opened early), and start its example. */
  private enter(n: number): void {
    const id = this.id!, steps = LESSON_STEPS[id], inp = this.deps.inputs;
    while (n < steps.length) {
      const s = steps[n]!;
      const already = s.kind === "intro" ? inp.held() : s.kind === "move" || s.kind === "demo" || s.kind === "turn" ? inp.isOpen(s.lock) : false;
      if (!already) break;
      n++;
    }
    this.n = n;
    this.stepMs = 0;
    this.idleMs = 0;
    this.beamMs = 0;
    this.ringsLined = false;
    this.ringsMs = 0;
    if (n >= steps.length) {
      this.finished = true;
      this.frame.line = null;
      this.deps.onDone?.(id);
      return;
    }
    this.deps.onStep?.(id, n);
    const s = steps[n]!, C = COPY.lessons, formed = this.frame.form >= 1;
    // The step's first line shows from this very frame (a demo's comes from its script).
    if (s.kind === "intro") this.frame.line = formed ? C.pickUp : null;
    else if (s.kind === "move") this.frame.line = C.watchMove;
    else if (s.kind === "turn") this.frame.line = C.yourTurn;
    else if (s.kind === "puppets") this.frame.line = formed ? C.puppets : null;
    else if (s.kind === "drawer") this.frame.line = inp.settled() ? C.drawer : null;
    else this.frame.line = null;
    if (s.kind === "demo" && s.example) {
      this.script = buildScript(s.example, this.plan!, this.deps.leftHanded(), false);
      this.scriptMs = 0;
      this.runScript(0);
    }
  }

  /** The running example at scriptMs into the frame; ends it when done. */
  private runScript(dt: number): void {
    const s = this.script!, f = this.frame, t = this.scriptMs, reduced = this.deps.inputs.reducedMotion();
    const before = t - dt;
    if (before < s.clickT && t >= s.clickT) f.clicks++;
    if (t >= s.end) {
      this.endScript();
      return;
    }
    // The example owns the ghost hand; an idle ghost that was showing is simply replaced.
    this.ghost = 0;
    this.ghostKind = null;
    let line: string | null = null;
    for (let i = 0; i < s.lines.length && s.lines[i]!.t <= t; i++) line = s.lines[i]!.line;
    f.line = line;
    f.form = 1;
    handAt(s.hand, t, f.hand, null);
    f.hand.anchor = s.anchor;
    copy3(s.fingers, f.hand.fingers);
    copy3(s.palm, f.hand.palm);
    f.hand.side = this.deps.leftHanded() ? "left" : "right";
    lampAt(s.lamp, t, f.lamp);
    f.ghostLight = t >= s.light[0] && t < s.light[1];
    f.park = rampAt(s.park, t, 0, reduced);
    f.lift = s.lift;
    for (let k = 0; k < f.layout.length; k++) f.layout[k] = k === s.lock ? rampAt(s.layout, t, 1, reduced) : 1;
    f.glowLock = s.glowPiece >= 0 ? s.lock : -1;
    f.glowPiece = s.glowPiece;
    f.glow = rampAt(s.glow, t, 0, reduced);
    f.solvedLock = s.lock;
    f.solved = rampAt(s.solved, t, 0, reduced);
    f.fill = rampAt(s.fill, t, 0, reduced);
  }

  private endScript(): void {
    const s = this.script!;
    this.script = null;
    this.resetFrame();
    if (s.replay) {
      this.replayEx = null;
      this.deps.onReplay?.(s.ex, s.lesson, false);
      // Back to the lesson's step as it stood (its timers paused meanwhile).
      return;
    }
    this.advance();
  }

  /** Everything an example shows, back to rest. Keeps the frame's objects. */
  private resetFrame(): void {
    const f = this.frame;
    f.line = null;
    f.form = 1;
    f.hand.opacity = 0;
    f.lamp.opacity = 0;
    f.ghostLight = false;
    f.park = 0;
    f.lift = null;
    f.layout.fill(1);
    f.glowLock = -1;
    f.glowPiece = -1;
    f.glow = 0;
    f.solvedLock = -1;
    f.solved = 0;
    f.fill = 0;
    f.box = null;
  }

  /**
   * The idle ghost: fades in while `show` (playing `kind`'s loop), and out otherwise, still playing the loop it
   * showed until it is gone.
   */
  private idleGhost(dt: number, show: boolean, kind: "reach" | "puppet" | null): void {
    const f = this.frame, left = this.deps.leftHanded(), side = left ? -1 : 1;
    if (show && kind) {
      this.ghostKind = kind;
      this.ghost = Math.min(1, this.ghost + dt / GHOST_IN_MS);
    } else this.ghost = Math.max(0, this.ghost - dt / GHOST_OUT_MS);
    const k = this.ghostKind;
    if (this.ghost <= 0 || !k) {
      this.ghost = 0;
      this.ghostKind = null;
      this.loopMs = 0;
      f.hand.opacity = 0;
      return;
    }
    if (!this.loops || this.loops.side !== side) {
      this.loops = { reach: reachLoop(side), puppet: puppetLoop(side), grasp: graspFingers(side), side };
    }
    const keys = k === "reach" ? this.loops.reach : this.loops.puppet;
    const period = keys[keys.length - 1]!.t;
    this.loopMs = (this.loopMs + dt) % period;
    f.hand.side = left ? "left" : "right";
    if (k === "reach") {
      handAt(keys, this.loopMs, f.hand, this.deps.inputs.lantern(this.at));
      f.hand.anchor = "grasp";
      copy3(this.loops.grasp, f.hand.fingers);
      copy3(PALM_DOWN, f.hand.palm);
    } else {
      this.at[0] = PUPPET_AT[0] * side;
      this.at[1] = PUPPET_AT[1];
      this.at[2] = PUPPET_AT[2];
      handAt(keys, this.loopMs, f.hand, this.at);
      f.hand.anchor = "wrist";
      copy3(PUPPET_FINGERS, f.hand.fingers);
      copy3(PUPPET_PALM, f.hand.palm);
    }
    f.hand.opacity *= this.ghost;
  }
}

function copy3(a: Readonly<V3>, out: V3): void {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
}
