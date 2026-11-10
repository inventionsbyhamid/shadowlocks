// The lessons, step by step: what the coach line says, when the ghost hand shows and what it does, and when a step is
// done. Pure logic on explicit time: it reads the player through LessonInputs and writes one LessonFrame in place,
// which the lesson view turns into the ghost hand, the ghost lantern, the coach line, the cradle and the scraps'
// layout. Nothing here allocates per frame (an example's script is built once when it starts: lesson-scripts.ts).
//
// Lesson 1, "Catch the light": the box forms from light (2 s), "Pick up the lantern." (a ghost hand shows how after
// 4 s without input), lock I (the Moon) with its goal ("Move the lantern until the shadow fills the moon."), Example
// 1 then the player's arrow, Example 2 then the player's Key, and the box opening with its reward. Lesson 2, "Lend a
// hand": shadow puppets (5 s of a hand in the beam), Example 3 then the player's Crown, then "Pull the drawer to find
// these lessons again." until the drawer is pulled once.
//
// An example is staged so nobody can miss that it is one (its own "Watch. ..." line, the cradle, the twin, three
// beats, one click, the swing home, the player's turn). `replay` runs one example alone, on a fresh copy of its
// lesson's box, and never touches lesson or box progress.
//
// Every coach line is a copy key (COPY.lessons[key] is its words): the frame says which one shows (`key`) and why
// (`why`: a step's own line, an idle nudge, a win, or an example's), so a voice can say exactly what the chip shows.
import { type LessonId, type LessonPlan, lessonPlan } from "../core/lessons-data";
import type { TipId } from "../core/profile";
import type { Box, Lock, V3 } from "../core/types";
import { LESSON_STUCK_MS } from "../feel/constants";
import { StuckWatch } from "../feel/stuck-watch";
import { COPY } from "../ui/copy";
import {
  buildScript,
  buildTipScript,
  clamp01,
  EXAMPLES,
  type ExampleId,
  type GhostHandFrame,
  graspFingers,
  graspPalm,
  handAt,
  type HandKey,
  lampAt,
  LANTERN_GRIP_Y,
  type LessonLine,
  PUPPET_AT,
  PUPPET_FINGERS,
  PUPPET_PALM,
  puppetLoop,
  rampAt,
  reachLoop,
  SAID,
  type Script,
  type TipScript,
} from "./lesson-scripts";

export { EXAMPLES, PARK_MS, SAID, SWING_MS } from "./lesson-scripts";
export type { ExampleId, GhostHandFrame, HandAnchor, LessonLine, PoseName } from "./lesson-scripts";

/** Why the coach line shows: a step's own line (as it starts, or as the step's state changes), a nudge after a while
 * with no progress, a win (a lock or the box opened), or an example's line. */
export type LineWhy = "step" | "idle" | "win" | "example";

/** The box forms from light over this long when a lesson starts. */
export const FORM_MS = 2000;
/**
 * The ghost hand shows a step's move after this long without input; the reach for the lantern this long after
 * "Pick up the lantern." shows, whatever the hands do (a player reaching and failing to pinch needs it most).
 */
export const IDLE_GHOST_MS = 4000;
/**
 * A real hand this near the lantern's loop (box units, about 11 cm in a 24 cm box): the reaching ghost works this far
 * from it instead, so it shows the pinch beside the hand rather than inside it. Its move there eases over this long.
 */
export const GHOST_CLEAR = 0.45;
const GHOST_EASE_MS = 250;
/** Lesson 2's shadow puppets: this long with a hand in the beam... */
export const PUPPET_MS = 5000;
/** ...or this long in all, the ghost showing how. */
export const PUPPET_MAX_MS = 12000;
/** The Key's turn: "Your turn." stays this long before the rings' own line. */
export const YOUR_TURN_MS = 3000;
/**
 * A lesson lock opened: its win is named ("Lock open! ...") and the next example waits this long, so the gold, the
 * chord and the words land before the ghost takes the lantern.
 */
export const BEAT_MS = 1800;
/**
 * Help on a lesson lock for a player making no progress (its warmth never rising 0.1, the stuck watch's rule): each
 * nudge from its time on, by the example the step follows. Every lock says "Stuck? ..." at the lesson's stuck time,
 * as the hint lantern starts to glow (LESSON_STUCK_MS). The clocks start over with the step.
 */
export const NUDGES: Readonly<Record<ExampleId, readonly { readonly ms: number; readonly key: LessonLine }[]>> = {
  move: [
    { ms: 12000, key: "moveIdle" },
    { ms: 25000, key: "growShrink" },
    { ms: LESSON_STUCK_MS, key: "stuck" },
  ],
  "near-far": [
    { ms: 20000, key: "turnNearFarIdle" },
    { ms: LESSON_STUCK_MS, key: "stuck" },
  ],
  rings: [
    { ms: 20000, key: "turnRingsIdle" },
    { ms: LESSON_STUCK_MS, key: "stuck" },
  ],
  finger: [
    { ms: 15000, key: "fingerIdle" },
    { ms: LESSON_STUCK_MS, key: "stuck" },
  ],
};
/**
 * Lock I's last resort: this long without progress there, the "Move the light" example plays on the lock itself,
 * once a visit to the step (in place of its "Stuck?" line, which comes the next time round).
 */
export const HELP_MS = LESSON_STUCK_MS;
/** Once (a page load), after the lantern has been held this long without a break, the line that it can be let go... */
export const LET_GO_AFTER_MS = 15000;
/** ...shown this long. */
export const LET_GO_SHOW_MS = 6000;
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
  /** The lock's warmth as measured, 0..1 (before the Warmth setting and the focus): its rise is progress. */
  warmth(lock: number): number;
  /** A hand is in the beam, casting its shadow on the panel. */
  inBeam(): boolean;
  /** The box has opened and its reward is up, waiting to be lifted out. */
  rewardUp(): boolean;
  /** The box-open celebration is over and its reward has been taken (or there is none). */
  settled(): boolean;
  /** The drawer has been pulled open. */
  drawerPulled(): boolean;
  reducedMotion(): boolean;
  /** Where the player's lantern is, into `out`. */
  lantern(out: V3): V3;
  /** Where the real hand nearest the lantern pinches, into `out`; false with no hand in tracking. */
  hand(out: V3): boolean;
}

export interface DirectorDeps {
  inputs: LessonInputs;
  /** Lessons and the ghost come mirrored for a left-handed player. */
  leftHanded(): boolean;
  /** A lesson reached step n (save it: a reload resumes there). Also when a lesson starts. */
  onStep?(id: LessonId, n: number): void;
  /** Step n's idle clocks start: it began (the session's stuck watch starts over with it). */
  onRestart?(id: LessonId, n: number): void;
  /** A lesson is finished. */
  onDone?(id: LessonId): void;
  /** A replay starts (show `lesson`'s box afresh) or ends (put back what was there). */
  onReplay?(example: ExampleId, lesson: LessonId, start: boolean): void;
}

export interface LessonFrame {
  /** The coach line (English; the chip shows it in the language up), or none. */
  line: string | null;
  /** Its copy key (COPY.lessons[key] is `line`), and why it shows; both null with no line. */
  key: LessonLine | null;
  why: LineWhy | null;
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
    key: null,
    why: null,
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
  private loops: { reach: HandKey[]; puppet: HandKey[]; grasp: V3; palm: V3; side: number } | null = null;
  private script: Script | null = null;
  private scriptMs = 0;
  private replayEx: ExampleId | null = null;
  /** A tip's ghost demo playing (outside the lessons), and its clock. */
  private tipS: TipScript | null = null;
  private tipMs = 0;
  /** The hand the lesson started with, and the replay's: their boxes were mirrored for it, so it holds to the end. */
  private left = false;
  private replayLeft = false;
  /** The rings' line shown (lined up or not) and how long the other state has held. */
  private ringsLined = false;
  private ringsMs = 0;
  /** The step just ended on the player opening its lock (the next example then waits a beat, its win named). */
  private won = false;
  /** The beat before a demo step's example: how long it has run, or -1 for none. */
  private beatMs = -1;
  /** A lesson lock's progress (its warmth rising), as the session's stuck watch counts it; started over each step. */
  private readonly progress = new StuckWatch(LESSON_STUCK_MS);
  /** How long the lantern has been held without a break, and the let-go line's showing (-1: not showing). */
  private heldMs = 0;
  private letGoMs = -1;
  /** The let-go line has been said (once a page load). */
  private letGoSaid = false;
  /** Lock I's example has played this visit to its step; and the running example is that help (it ends back there). */
  private helped = false;
  private help = false;
  /** How long the intro's line has been up (its reaching ghost comes IDLE_GHOST_MS in). */
  private lineMs = 0;
  /** The reaching ghost's shift clear of a real hand (eased), and that hand's pinch point. */
  private readonly off: V3 = [0, 0, 0];
  private readonly real: V3 = [0, 0, 0];
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

  /** A tip's ghost demo is playing. */
  get tipping(): boolean {
    return this.tipS !== null;
  }

  /**
   * Play tip `tip`'s ghost demo (about 6 s) on `box`, the box in play: the ghost hand points or sweeps a ghost lantern
   * there, in interactive play (no cradle, no swing). False (and nothing happens) during a lesson, an example or
   * another demo, or for a tip with nothing to show on this box.
   */
  tipDemo(tip: TipId, box: Box, overLesson = false): boolean {
    // `overLesson`: a Lessons row's replay, asked for from the menu: a lesson in progress waits under it (its step's
    // clock runs on only once the demo is over, as under an example).
    if (this.script || this.tipS || (this.id && !this.finished && !overLesson)) return false;
    // The hand the box was mirrored for (a left-handed player's box), not the live setting.
    const s = buildTipScript(tip, box, box.mirrored);
    if (!s) return false;
    this.tipS = s;
    this.tipMs = 0;
    this.lastT = Number.NaN;
    this.runTip();
    return true;
  }

  /** Stop a tip's demo where it is (the player took the lantern, did what the tip says, or left the box). */
  stopTip(): void {
    if (!this.tipS) return;
    this.tipS = null;
    this.resetFrame();
  }

  /** Start lesson `id` at the start of step `fromStep` (a resumed lesson; a damaged step number starts it over). */
  start(id: LessonId, fromStep = 0): void {
    const steps = LESSON_STEPS[id];
    const from = Number.isInteger(fromStep) && fromStep >= 0 && fromStep < steps.length ? fromStep : 0;
    this.endReplay();
    this.tipS = null;
    this.id = id;
    this.finished = false;
    this.left = this.deps.leftHanded();
    this.plan = lessonPlan(id, this.left);
    this.formMs = 0;
    this.script = null;
    this.help = false;
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
    this.tipS = null;
    this.id = null;
    this.plan = null;
    this.script = null;
    this.help = false;
    this.resetFrame();
  }

  /**
   * Show one example alone on a fresh copy of its lesson's box; lesson and box progress stay as they are. False (and
   * nothing happens) while an example is already playing.
   */
  replay(example: ExampleId): boolean {
    if (this.script) return false;
    // "Show me" (or a Lessons row) takes over from a tip's demo.
    this.tipS = null;
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
    if (this.tipS) {
      this.tipMs += dt;
      this.runTip();
      return;
    }
    const f = this.frame;
    if (!this.id || this.finished) {
      this.show(null, null);
      this.idleGhost(dt, false, null);
      return;
    }
    this.formMs += dt;
    this.stepMs += dt;
    f.form = clamp01(this.formMs / FORM_MS);
    const s = LESSON_STEPS[this.id][this.n]!, inp = this.deps.inputs, formed = f.form >= 1;
    switch (s.kind) {
      case "intro": {
        // The reach for the lantern 4 s after the line, even with a hand near (kept clear of it), until it is held.
        const held = inp.held();
        if (formed) this.lineMs += dt;
        this.show(formed ? "pickUp" : null, "step");
        this.idleGhost(dt, !held && this.lineMs >= IDLE_GHOST_MS, "reach");
        if (held) this.advance();
        break;
      }
      case "move": {
        // Let go and idle, the ghost shows how to pick the lantern up again.
        const held = inp.held();
        this.idleMs = held || inp.active() ? 0 : this.idleMs + dt;
        this.idleGhost(dt, !held && this.idleMs >= IDLE_GHOST_MS, "reach");
        if (inp.isOpen(s.lock)) this.advance(true);
        else this.lockLine(s, dt, held);
        break;
      }
      case "turn":
        this.idleGhost(dt, false, null);
        if (inp.isOpen(s.lock)) this.advance(true);
        else this.lockLine(s, dt, inp.held());
        break;
      case "reward":
        // The box opening has its own moment; once its reward is up, the line says to take it.
        this.show(inp.rewardUp() ? "boxOpen" : null, "win");
        this.idleGhost(dt, false, null);
        if (inp.settled()) this.advance();
        break;
      case "puppets": {
        this.show(formed ? "puppets" : null, "step");
        const beam = inp.inBeam();
        if (beam) this.beamMs += dt;
        this.idleMs = beam ? 0 : this.idleMs + dt;
        this.idleGhost(dt, this.idleMs >= IDLE_GHOST_MS, "puppet");
        if (this.beamMs >= PUPPET_MS || this.stepMs >= PUPPET_MAX_MS) this.advance();
        break;
      }
      case "drawer":
        // Lesson 2's box opened: its reward's line while the reward is up, then the drawer's.
        if (inp.settled()) this.show("drawer", "step");
        else this.show(inp.rewardUp() ? "boxOpen" : null, "win");
        this.idleGhost(dt, false, null);
        if (inp.drawerPulled()) this.advance();
        break;
      case "demo":
        if (this.beatMs >= 0) {
          // The beat after a win: then the example, unless its lock was opened meanwhile (that win is named next).
          this.idleGhost(dt, false, null);
          if ((this.beatMs += dt) < BEAT_MS) break;
          this.beatMs = -1;
          if (inp.isOpen(s.lock)) this.advance(true);
          else this.startScript(s.example!);
          break;
        }
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

  /**
   * The line of a player's turn: the task the example showed ("Your turn. Make both pieces meet in the arrow."); the
   * Key's says "Your turn." first, then follows its rings (lined up or apart).
   */
  private turnLine(s: LessonStep, dt: number): LessonLine {
    if (s.example !== "rings") return SAID[s.example ?? "near-far"].turn;
    const a = this.deps.inputs.aligned(s.lock);
    if (a === this.ringsLined) this.ringsMs = 0;
    else if ((this.ringsMs += dt) >= LINE_HOLD_MS) {
      this.ringsLined = a;
      this.ringsMs = 0;
    }
    if (this.stepMs < YOUR_TURN_MS) return "yourTurn";
    return this.ringsLined ? "slide" : "lineUp";
  }

  /**
   * A lesson lock's line (lock I, or a turn): the step's own; a nudge once the player has made no progress for a
   * while (NUDGES); or, once, after the lantern has been held a long time, that it can be let go.
   */
  private lockLine(s: LessonStep, dt: number, held: boolean): void {
    const own = s.kind === "move" ? "goal" : this.turnLine(s, dt);
    this.progress.update(dt, this.deps.inputs.warmth(s.lock), false);
    this.heldMs = held ? this.heldMs + dt : 0;
    if (!this.letGoSaid && this.heldMs >= LET_GO_AFTER_MS) {
      this.letGoSaid = true;
      this.letGoMs = 0;
    }
    if (this.letGoMs >= 0) {
      if ((this.letGoMs += dt) < LET_GO_SHOW_MS) {
        this.show("letGo", "idle");
        return;
      }
      this.letGoMs = -1;
    }
    if (s.kind === "move" && !this.helped && this.progress.idleMs >= HELP_MS) {
      // Lock I's last resort: the ghost shows it on the lock itself, then the player tries again.
      this.helped = true;
      this.help = true;
      this.startScript("move");
      return;
    }
    const nudge = this.nudge(s.example ?? "move", this.progress.idleMs);
    if (nudge) this.show(nudge, "idle");
    else this.show(own, "step");
  }

  /** The nudge due after `idleMs` without progress on a lock taught by example `ex`, or null. */
  private nudge(ex: ExampleId, idleMs: number): LessonLine | null {
    const list = NUDGES[ex];
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i]!;
      if (idleMs < n.ms) continue;
      // The Key's nudge only while its rings are apart: lined up, its own line says what to do next.
      return n.key === "turnRingsIdle" && this.ringsLined ? null : n.key;
    }
    return null;
  }

  /** Put line `key` on the coach line (null: none), shown for reason `why`. Allocates nothing. */
  private show(key: LessonLine | null, why: LineWhy | null): void {
    const f = this.frame;
    f.key = key;
    f.why = key === null ? null : why;
    f.line = key === null ? null : COPY.lessons[key];
  }

  /** On to the next step; `won`: this one ended on the player opening its lock. */
  private advance(won = false): void {
    this.won = won;
    this.enter(this.n + 1);
  }

  /** The win just named: the first lesson lock open, else how many are. */
  private winLine(): LessonLine {
    const inp = this.deps.inputs, locks = this.plan!.box.locks.length;
    let open = 0;
    for (let i = 0; i < locks; i++) if (inp.isOpen(i)) open++;
    return open <= 1 ? "lockOpen" : "twoOpen";
  }

  /** Start example `ex` as the lesson's own (its end moves the lesson on). */
  private startScript(ex: ExampleId): void {
    this.script = buildScript(ex, this.plan!, this.left, false);
    this.scriptMs = 0;
    this.runScript(0);
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
    const won = this.won;
    this.won = false;
    this.n = n;
    this.stepMs = 0;
    this.beamMs = 0;
    this.ringsLined = false;
    this.ringsMs = 0;
    this.beatMs = -1;
    this.helped = false;
    this.restartClocks();
    if (n >= steps.length) {
      this.finished = true;
      this.show(null, null);
      this.deps.onDone?.(id);
      return;
    }
    this.deps.onStep?.(id, n);
    this.deps.onRestart?.(id, n);
    const s = steps[n]!, formed = this.frame.form >= 1;
    // The step's first line shows from this very frame (a demo's comes from its script).
    if (s.kind === "intro") this.show(formed ? "pickUp" : null, "step");
    else if (s.kind === "move") this.show("goal", "step");
    else if (s.kind === "turn") this.show(this.turnLine(s, 0), "step");
    else if (s.kind === "puppets") this.show(formed ? "puppets" : null, "step");
    else if (s.kind === "drawer") this.show(inp.settled() ? "drawer" : inp.rewardUp() ? "boxOpen" : null, inp.settled() ? "step" : "win");
    else if (s.kind === "reward") this.show(inp.rewardUp() ? "boxOpen" : null, "win");
    else this.show(null, null);
    if (s.kind === "demo" && s.example) {
      // Reached by opening a lock: the win named and a beat first. Resumed (a reload), the example starts at once.
      if (won) {
        this.beatMs = 0;
        this.show(this.winLine(), "win");
      } else this.startScript(s.example);
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
    let key: LessonLine | null = null;
    for (let i = 0; i < s.lines.length && s.lines[i]!.t <= t; i++) key = s.lines[i]!.key;
    this.show(key, "example");
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
    if (this.help) {
      // Lock I's help is over: the same step, its idle clocks (and the session's stuck watch) from 0 again.
      this.help = false;
      this.restartClocks();
      this.deps.onRestart?.(this.id!, this.n);
      this.show("goal", "step");
      return;
    }
    this.advance();
  }

  /** A step's idle clocks from 0: progress, the hold, the idle ghost's wait. */
  private restartClocks(): void {
    this.idleMs = 0;
    this.lineMs = 0;
    this.progress.reset();
    this.heldMs = 0;
    this.letGoMs = -1;
  }

  /** The tip demo at its clock into the frame; over at its end (nothing left showing). */
  private runTip(): void {
    const s = this.tipS!, f = this.frame, t = this.tipMs;
    if (t >= s.end) {
      this.tipS = null;
      this.resetFrame();
      return;
    }
    handAt(s.hand, t, f.hand, null);
    f.hand.anchor = s.anchor;
    copy3(s.fingers, f.hand.fingers);
    copy3(s.palm, f.hand.palm);
    f.hand.side = s.side;
    if (s.lamp.length) lampAt(s.lamp, t, f.lamp);
    else f.lamp.opacity = 0;
    f.ghostLight = t >= s.light[0] && t < s.light[1];
  }

  /** Everything an example or a tip demo shows, back to rest (no line, no ghost, no light). Keeps the frame's objects. */
  private resetFrame(): void {
    const f = this.frame;
    this.show(null, null);
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
   * Where the reaching ghost works (its loop is keyed around this, the lantern's light): the lantern, moved clear of
   * a real hand near its loop, so the ghost pinches GHOST_CLEAR from that hand's pinch, away from it (never into the
   * box: the shift never points deeper; a hand right at the loop sends the ghost up and out to the dominant side).
   * The shift eases (`snap`: at once). Into this.at; allocates nothing.
   */
  private reachBase(dt: number, snap: boolean, side: number): V3 {
    const inp = this.deps.inputs, at = inp.lantern(this.at), h = this.real, o = this.off;
    let tx = 0, ty = 0, tz = 0;
    if (inp.hand(h)) {
      // From the hand to the lantern's loop.
      const gx = at[0] - h[0], gy = at[1] + LANTERN_GRIP_Y - h[1], gz = at[2] - h[2];
      const d2 = gx * gx + gy * gy + gz * gz;
      if (d2 < GHOST_CLEAR * GHOST_CLEAR) {
        let ux = gx, uy = gy, uz = gz > 0 ? gz : 0;
        let l = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (l < 1e-6) {
          ux = side;
          uy = 1;
          uz = 0;
          l = Math.SQRT2;
        }
        ux /= l;
        uy /= l;
        uz /= l;
        // The shift along u that puts the ghost's pinch exactly GHOST_CLEAR from the hand's.
        const gu = gx * ux + gy * uy + gz * uz, k = -gu + Math.sqrt(gu * gu + GHOST_CLEAR * GHOST_CLEAR - d2);
        tx = ux * k;
        ty = uy * k;
        tz = uz * k;
      }
    }
    const e = snap ? 1 : 1 - Math.exp(-dt / GHOST_EASE_MS);
    o[0] += (tx - o[0]) * e;
    o[1] += (ty - o[1]) * e;
    o[2] += (tz - o[2]) * e;
    at[0] += o[0];
    at[1] += o[1];
    at[2] += o[2];
    return at;
  }

  /**
   * The idle ghost: fades in while `show` (playing `kind`'s loop), and out otherwise, still playing the loop it
   * showed until it is gone.
   */
  private idleGhost(dt: number, show: boolean, kind: "reach" | "puppet" | null): void {
    const f = this.frame, left = this.left, side = left ? -1 : 1;
    // Just coming in: the ghost takes its place clear of a real hand at once, rather than easing out of it.
    const appearing = this.ghost <= 0;
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
      this.loops = { reach: reachLoop(side), puppet: puppetLoop(side), grasp: graspFingers(side), palm: graspPalm(side), side };
    }
    const keys = k === "reach" ? this.loops.reach : this.loops.puppet;
    const period = keys[keys.length - 1]!.t;
    this.loopMs = (this.loopMs + dt) % period;
    f.hand.side = left ? "left" : "right";
    if (k === "reach") {
      handAt(keys, this.loopMs, f.hand, this.reachBase(dt, appearing, side));
      f.hand.anchor = "grasp";
      copy3(this.loops.grasp, f.hand.fingers);
      copy3(this.loops.palm, f.hand.palm);
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
