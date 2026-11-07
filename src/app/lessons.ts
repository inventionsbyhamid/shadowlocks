// The lessons in the app: the director (lessons-director.ts) on the real box session, lantern and hands, and what it
// shows (lesson-view.ts), run as the "lessons" system right after the game (priority -2.7), so the twin's glow and
// the ghost's shadows land before the box draws the frame.
//
// A lesson plays its own box in the box session (lesson-boxes.ts serves it); the session never saves a lesson, and
// lesson progress lives in Profile.lessons: the step a reload resumes at, and each lesson's done flag. Lesson 1
// leads into lesson 2, and lesson 2 ends on the menu: "Pull the drawer...", and the pull brings up Home. A first
// launch with lesson 1 not done goes straight into it (the shell asks, through the menus' MenuLessons); a later
// launch opens on Home. `?lesson=l1|l2` plays a lesson as practice: nothing about progress changes.
//
// A replay ("Show me" on the hint lantern, or a row of the Lessons menu) shows one example on a fresh copy of its
// lesson's box and then puts back the box that was in play, from a snapshot taken as it started: that box's clock
// cannot run meanwhile (it is not in the lap), and nothing is saved (a lesson box has no save), so neither lesson nor
// box progress changes. The director runs only while the player is in XR. Under a menu a lesson waits, its ghost and
// line put away; the drawer stays shut while an example shows; a progress reset lets the lesson or replay go.
//
// Tips: the first time a box brings in a mechanic (decoys, a lock without rings, a hidden outline), its line shows
// on the coach line until the player has done what it says.
import { createSystem, type World } from "@iwsdk/core";
import type { LessonId } from "../core/lessons-data";
import type { BoxSnapshot, TipId } from "../core/profile";
import type { BoxSpec } from "../core/types";
import type { BoxScene } from "../render/box-scene";
import type { BoxSession } from "./box-session";
import { on as onBus } from "./bus";
import type { Game } from "./game";
import type { HandsInBox } from "./hand-system";
import type { Lantern } from "./lantern-system";
import { lessonSnapshot } from "./lesson-boxes";
import { LessonView } from "./lesson-view";
import { EXAMPLES, type ExampleId, exampleFor, type LessonInputs, LessonsDirector } from "./lessons-director";
import type { MenuLessons } from "./menu-game";
import type { ProfileStore } from "./profile-store";
import { go, isMenuScreen } from "./screens";
import type { SettingsStore } from "./settings";
import { registerAppSystem } from "./systems";
import { TIP_LINES, tipDone, tipFor } from "./tips";
import { LineHold } from "../ui/coach-line";
import { COPY } from "../ui/copy";
import type { CoachLine } from "./events";

/** The lantern within this brightness of a hand counts as the player reaching for it (lantern-grab.ts: 30 cm). */
const NEAR_GLOW = 0.05;

export interface LessonsDeps {
  world: World;
  scene: BoxScene;
  profiles: ProfileStore;
  settings: SettingsStore;
  lantern: Lantern;
  hands: HandsInBox;
  sound: { game: { lessonStep(): void; settle(): void; crystallise(lock: number): void } };
  play: { game: Game; session: BoxSession; view: { readonly coachLine: CoachLine | null } };
  /** The player is in XR and can see it: lessons wait otherwise (the box forms as they enter; a hidden headset holds). */
  presenting(): boolean;
  /** A first launch may go into lesson 1 now (false: a field flag picked what plays, or a test keeps Home). */
  autoStart?: () => boolean;
  /** What draws the lessons (tests pass their own; the real one needs a world and the box scene). */
  view?: LessonView;
}

export class Lessons implements MenuLessons {
  readonly director: LessonsDirector;
  readonly view: LessonView;
  /** The lesson running is practice (`?lesson=`): its steps and its end change nothing about progress. */
  practice = false;
  /** The box in play when a replay started, put back when it ends. */
  private saved: { spec: BoxSpec; snap: BoxSnapshot | null; practice: boolean } | null = null;
  /** Lesson 2's drawer was pulled at its last step. */
  private drawerOpen = false;
  /** A menu is up over the box (the drawer is out). */
  private menuUp = false;
  /** Letting the lesson or replay go (a progress reset): a replay's end puts nothing back. */
  private dropping = false;
  private starting = false;
  private tip: TipId | null = null;
  /** The box the tip was worked out for, by key: the same box put back after "Show me" keeps its tip. */
  private tipKey: string | null = null;
  private lastT = Number.NaN;
  /** Made once: the frame passes them every frame. */
  private readonly onScreen: { lesson: LessonId | null } = { lesson: null };
  private readonly isOpen = (lock: number) => this.d.play.session.isOpen(lock);
  /** The session's suggestion, held through brief drops (a finger lock's coverage crossing its threshold). */
  private readonly hold = new LineHold();

  constructor(private readonly d: LessonsDeps) {
    const { lantern, hands, settings } = d;
    const session = d.play.session;
    onBus("screen", (e) => {
      this.menuUp = isMenuScreen(e.to);
    });
    // Lesson 2's last step: "Pull the drawer to find these lessons again."
    onBus("drawer", () => {
      const dir = this.director;
      if (dir.lesson === "l2" && dir.step === LESSON_DRAWER_STEP && !dir.done && !dir.replaying) this.drawerOpen = true;
    });
    const inputs: LessonInputs = {
      held: () => lantern.grab.holder !== null,
      active: () => lantern.grab.holder !== null || lantern.grab.brightness > NEAR_GLOW || hands.n > 0,
      isOpen: (lock) => session.isOpen(lock),
      aligned: (lock) => lantern.feel.aligned(lock),
      inBeam: () => hands.n > 0,
      settled: () => session.stage === "offered",
      drawerPulled: () => this.drawerOpen,
      reducedMotion: () => settings.get().reducedMotion,
      lantern: (out) => {
        const p = lantern.ctrl.pos;
        out[0] = p[0];
        out[1] = p[1];
        out[2] = p[2];
        return out;
      },
    };
    this.director = new LessonsDirector({
      inputs,
      leftHanded: () => settings.get().handed === "left",
      onStep: (id, n) => this.stepped(id, n),
      onDone: (id) => this.finished(id),
      onReplay: (ex, lesson, start) => this.replayed(ex, lesson, start),
    });
    this.view = d.view ?? new LessonView({ world: d.world, scene: d.scene, lantern, sound: d.sound.game, reducedMotion: () => settings.get().reducedMotion });
  }

  /**
   * Play lesson `id` from the start of step `step` (its box afresh at step 0, else with the locks of the steps
   * before it open). Practice changes nothing about progress.
   */
  start(id: LessonId, o: { step?: number; practice?: boolean } = {}): void {
    const step = o.step ?? 0;
    this.practice = !!o.practice;
    this.drawerOpen = false;
    this.tip = null;
    const left = this.d.settings.get().handed === "left";
    this.starting = true;
    this.director.start(id, step);
    this.starting = false;
    // Practice (`?lesson=`) plays the box as the session's practice too: never saved, solved or collected.
    this.d.play.game.play({ kind: "lesson", id }, lessonSnapshot(id, this.director.step, left), this.practice);
  }

  /**
   * The first launch's lesson: lesson 1 until it is done, resumed at its saved step (a later launch opens on Home).
   * False when it is done, or when this launch may not start it.
   */
  firstLaunch(): boolean {
    const l = this.d.profiles.profile.lessons;
    if (l.l1 || !(this.d.autoStart?.() ?? true)) return false;
    this.start("l1", { step: l.step?.id === "l1" ? l.step.index : 0 });
    return true;
  }

  /** A lesson or a replay is in the lap (the menus show "Your lesson" behind them). Lesson 2 ends with its pull. */
  get running(): boolean {
    const dir = this.director;
    return dir.replaying !== null || (dir.lesson !== null && !dir.done && !this.drawerOpen);
  }

  /**
   * A lesson left half done waits to go on (a later launch opens on Home, where Continue reads "Your lesson"): its
   * step is saved and it is not done, and it is not in the lap now. Not lesson 2 the moment its drawer is pulled: Home
   * comes up in that frame, before the lesson has finished and let go of its step.
   */
  get waiting(): boolean {
    const l = this.d.profiles.profile.lessons, s = l.step;
    return !this.running && !this.drawerOpen && s !== null && !l[s.id];
  }

  /** Go on with the lesson left half done, at the start of its saved step (Continue); false when none waits. */
  resume(): boolean {
    const s = this.d.profiles.profile.lessons.step;
    if (!this.waiting || !s) return false;
    this.start(s.id, { step: s.index });
    return true;
  }

  /** The menus' first launch (the shell asks while lesson 1 is not done). */
  startFirst(): boolean {
    return this.firstLaunch();
  }

  /** Show one example alone (a Lessons menu row, "Show me"); false while one is already showing. */
  replay(example: ExampleId): boolean {
    return this.director.replay(example);
  }

  /** The menu drawer may be pulled: not while an example shows (the ghost has the lantern in its cradle). */
  get drawerAllowed(): boolean {
    return !this.director.showing;
  }

  /** Let the lesson or replay in the lap go (a progress reset): nothing is put back, nothing more is saved. */
  stop(): void {
    this.saved = null;
    this.dropping = true;
    this.director.stop();
    this.dropping = false;
    this.practice = false;
    this.drawerOpen = false;
  }

  update(tMs: number): void {
    const dt = Number.isFinite(this.lastT) ? Math.min(Math.max(tMs - this.lastT, 0), 100) : 0;
    this.lastT = tMs;
    const dir = this.director, session = this.d.play.session;
    // The player left the lesson (another box was started): the lesson stops where it is.
    const lesson = dir.lesson;
    if (lesson && !dir.replaying && !dir.done && session.stage !== "loading") {
      const s = session.spec;
      if (!s || s.kind !== "lesson" || s.id !== lesson) dir.stop();
    }
    const on = dir.replaying ? EXAMPLES[dir.replaying].lesson : dir.done ? null : dir.lesson;
    // Under a menu the lesson waits, but for the pull that ends lesson 2.
    if (on && this.d.presenting() && (!this.menuUp || this.drawerOpen)) dir.update(tMs);
    // One coach line: a lesson's, else the session's suggestion (held through brief drops), else a tip; none under a
    // menu (the lesson's ghost is put away there too).
    const asked = this.d.play.view.coachLine;
    const held = this.hold.update(asked ? COPY.game[asked] : null, dt);
    const shown = this.menuUp ? null : on;
    this.onScreen.lesson = shown;
    // A lesson's own line first; when it has none (and no example is showing), the session's suggestion, so the
    // controller line is never lost under a lesson.
    const line = this.menuUp ? null : shown ? (dir.frame.line ?? (dir.showing ? null : held)) : (held ?? this.tipLine(session));
    this.view.update(dir.frame, this.onScreen, line, dt, tMs);
  }

  /**
   * The tip for the box in play: shown the first time its mechanic matters, until the player has done it. A practice
   * box shows it but never counts it seen.
   */
  private tipLine(session: BoxSession): string | null {
    const box = session.box;
    if (!box || box.spec.kind === "lesson" || session.stage !== "playing") return null;
    if (box.key !== this.tipKey) {
      this.tipKey = box.key;
      const p = this.d.profiles.profile;
      this.tip = tipFor(box, p.tipsSeen);
      if (this.tip && !session.practice) {
        p.tipsSeen.push(this.tip);
        void this.d.profiles.save();
      }
    }
    if (!this.tip) return null;
    if (tipDone(this.tip, box, this.isOpen)) {
      this.tip = null;
      return null;
    }
    return TIP_LINES[this.tip];
  }

  private stepped(id: LessonId, n: number): void {
    if (!this.starting) this.d.sound.game.lessonStep();
    if (this.practice) return;
    const p = this.d.profiles.profile;
    p.lessons = { ...p.lessons, step: { id, index: n } };
    void this.d.profiles.save();
  }

  private finished(id: LessonId): void {
    if (!this.practice) {
      const p = this.d.profiles.profile;
      p.lessons = { ...p.lessons, [id]: true, step: null };
      void this.d.profiles.save();
    }
    // Lesson 1 leads into lesson 2; lesson 2 ends on the menu it just taught.
    if (id === "l1") this.start("l2", { practice: this.practice });
    else go("home");
  }

  private replayed(_ex: ExampleId, lesson: LessonId, start: boolean): void {
    const { game, session } = this.d.play;
    if (start) {
      // What was in play, as it would be saved now, unless it is done with (opened: put back, it would open again);
      // the example's lesson box afresh meanwhile, as practice (nothing it does is saved, solved or collected).
      const s = session.stage, over = s === "opening" || s === "reward" || s === "offered";
      this.saved = session.box && session.spec && !over ? { spec: { ...session.spec }, snap: session.snapshot(), practice: session.practice } : null;
      game.play({ kind: "lesson", id: lesson }, null, true);
      return;
    }
    const saved = this.saved;
    this.saved = null;
    if (saved) game.play(saved.spec, saved.snap, saved.practice);
    else if (!this.dropping) go("home");
  }
}

/** Lesson 2's last step: the drawer. */
const LESSON_DRAWER_STEP = 3;

let current: Lessons | null = null;

/** The lessons' frame (timed in the per-frame budget as "lessons"). */
export class LessonsSystem extends createSystem({}) {
  update(): void {
    current?.update(performance.now());
  }
}

/**
 * The lessons: registers LessonsSystem (priority -2.7, "lessons", right after the game) and offers "Show me" on the
 * hint lantern. Call once, after attachGame.
 */
export function attachLessons(d: LessonsDeps): Lessons {
  const lessons = new Lessons(d);
  current = lessons;
  d.play.session.showMe = (lock) => {
    lessons.replay(exampleFor(lock));
  };
  registerAppSystem(d.world, LessonsSystem, { priority: -2.7, name: "lessons" });
  return lessons;
}
