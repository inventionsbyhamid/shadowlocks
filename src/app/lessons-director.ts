// The lessons, step by step: what the coach line says, when the ghost hand shows and what it does, and when a step is
// done. Pure logic on explicit time: it reads the player through LessonInputs and writes one LessonFrame in place,
// which the lesson view turns into the ghost hand, the ghost lantern, the coach line, the cradle and the scraps'
// layout. Nothing here allocates per frame (an example's script is built once when it starts: lesson-scripts.ts).
//
// Lesson 1, "Catch the light": the box forms from light (2 s), "Pick up the lantern." (a ghost hand shows how after
// 4 s without input), lock I (the Moon), Example 1 then the player's arrow, Example 2 then the player's Key, and the
// box opening with its reward. Lesson 2, "Lend a hand": shadow puppets (5 s of a hand in the beam), Example 3 then
// the player's Crown, then "Pull the drawer to find these lessons again." until the drawer is pulled once.
//
// An example is staged so nobody can miss that it is one ("Watch.", the cradle, the twin, three beats, one click,
// the swing home, "Your turn."). `replay` runs one example alone, on a fresh copy of its lesson's box, and never
// touches lesson or box progress.
import { type LessonId, type LessonPlan, lessonPlan } from "../core/lessons-data";
import type { Lock, V3 } from "../core/types";
import { COPY } from "../ui/copy";
import {
  buildScript,
  clamp01,
  EXAMPLES,
  type ExampleId,
  type GhostHandFrame,
  graspFingers,
  handAt,
  type HandKey,
  lampAt,
  PALM_DOWN,
  PUPPET_AT,
  PUPPET_FINGERS,
  PUPPET_PALM,
  puppetLoop,
  rampAt,
  reachLoop,
  type Script,
} from "./lesson-scripts";

export { EXAMPLES, PARK_MS, SWING_MS } from "./lesson-scripts";
export type { ExampleId, GhostHandFrame, HandAnchor, PoseName } from "./lesson-scripts";

/** The box forms from light over this long when a lesson starts. */
export const FORM_MS = 2000;
/** The ghost hand shows a step's move after this long without input. */
export const IDLE_GHOST_MS = 4000;
/** Lesson 2's shadow puppets: this long with a hand in the beam... */
export const PUPPET_MS = 5000;
/** ...or this long in all, the ghost showing how. */
export const PUPPET_MAX_MS = 12000;
/** "Your turn." stays this long before the step's own line. */
export const YOUR_TURN_MS = 3000;
/** The rings' line changes only once the rings have stayed lined up (or apart) this long. */
export const LINE_HOLD_MS = 500;
/** The idle ghost fades in and out over these. */
export const GHOST_IN_MS = 400;
export const GHOST_OUT_MS = 300;
/** Longest frame step; a longer hitch counts as this. */
const MAX_DT_MS = 100;

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

function copy3(a: Readonly<V3>, out: V3): void {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
}

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
  /** The idle ghost's own fade (0..1), the loop it plays and that loop's clock. */
  private ghost = 0;
  private ghostKind: "reach" | "puppet" | null = null;
  private loopMs = 0;
  private loops: { reach: HandKey[]; puppet: HandKey[]; grasp: V3; side: number } | null = null;
  private script: Script | null = null;
  private scriptMs = 0;
  private replayEx: ExampleId | null = null;
  /** The hand the lesson started with, and the replay's: their boxes were mirrored for it, so it holds to the end. */
  private left = false;
  private replayLeft = false;
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

  /** An example is showing (a lesson's own or a replay): the ghost has the lantern, so the drawer stays shut. */
  get showing(): boolean {
    return this.script !== null;
  }

  /** Start lesson `id` at the start of step `fromStep` (a resumed lesson; a damaged step number starts it over). */
  start(id: LessonId, fromStep = 0): void {
    const steps = LESSON_STEPS[id];
    const from = Number.isInteger(fromStep) && fromStep >= 0 && fromStep < steps.length ? fromStep : 0;
    this.endReplay();
    this.id = id;
    this.finished = false;
    this.left = this.deps.leftHanded();
    this.plan = lessonPlan(id, this.left);
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

  /**
   * Show one example alone on a fresh copy of its lesson's box; lesson and box progress stay as they are. False (and
   * nothing happens) while an example is already playing.
   */
  replay(example: ExampleId): boolean {
    if (this.script) return false;
    const { lesson } = EXAMPLES[example];
    const left = (this.replayLeft = this.deps.leftHanded());
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

  /** A replay cut short: the view puts back what it showed before. */
  private endReplay(): void {
    const ex = this.replayEx;
    if (!ex) return;
    this.replayEx = null;
    this.script = null;
    this.deps.onReplay?.(ex, EXAMPLES[ex].lesson, false);
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
      this.script = buildScript(s.example, this.plan!, this.left, false);
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
    f.hand.side = (this.replayEx ? this.replayLeft : this.left) ? "left" : "right";
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
    const f = this.frame, left = this.left, side = left ? -1 : 1;
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
