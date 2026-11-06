// The lessons in the app: the director (lessons-director.ts) on the real box session, lantern and hands, and what it
// shows (lesson-view.ts), run as the "lessons" system right after the game (priority -2.7), so the twin's glow and
// the ghost's shadows land before the box draws the frame.
//
// A lesson plays its own box in the box session (lesson-boxes.ts serves it); the session never saves a lesson, and
// lesson progress lives in Profile.lessons: the step a reload resumes at, and each lesson's done flag. Lesson 1
// leads into lesson 2, and lesson 2 ends on the menu ("Pull the drawer..."). A first launch with lesson 1 not done
// goes straight into it. `?lesson=l1|l2` plays a lesson as practice: nothing about progress changes.
//
// A replay ("Show me" on the hint lantern, or the Lessons menu) shows one example on a fresh copy of its lesson's
// box and then puts back the box that was in play, from a snapshot taken as it started: nothing is saved meanwhile,
// so neither lesson nor box progress changes. The director runs only while the player is in XR.
//
// Tips: the first time a box brings in a mechanic (decoys, a lock without rings, a hidden outline), its line shows
// on the coach line until the player has done what it says.
import { createSystem, type World } from "@iwsdk/core";
import type { LessonId } from "../core/lessons-data";
import type { BoxSnapshot, TipId } from "../core/profile";
import type { Box, BoxSpec } from "../core/types";
import { handJoints } from "../input/grab-system";
import type { HandJoints } from "../input/hand-joints";
import type { BoxScene } from "../render/box-scene";
import type { BoxSession } from "./box-session";
import type { Game } from "./game";
import type { HandsInBox } from "./hand-system";
import type { Lantern } from "./lantern-system";
import { lessonSnapshot } from "./lesson-boxes";
import { LessonView } from "./lesson-view";
import { EXAMPLES, type ExampleId, exampleFor, type LessonInputs, LessonsDirector } from "./lessons-director";
import type { ProfileStore } from "./profile-store";
import { go } from "./screens";
import type { SettingsStore } from "./settings";
import { registerAppSystem } from "./systems";
import { TIP_LINES, tipDone, tipFor } from "./tips";

/** The menu drawer as lesson 2 reads it (the menus' DrawerPull: `update(joints, tMs)` returns its state). */
export type DrawerState = "closed" | "opening" | "open";
export interface LessonDrawer {
  update(joints: HandJoints, tMs: number): DrawerState;
}

/** A drawer that opens only when told (until the menus' drawer is in): `pull()` opens it. */
export class DrawerStub implements LessonDrawer {
  state: DrawerState = "closed";
  update(): DrawerState {
    return this.state;
  }
  pull(): void {
    this.state = "open";
  }
}

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
  play: { game: Game; session: BoxSession };
  /** The player is in XR: lessons wait outside it (the box forms as they enter). */
  presenting(): boolean;
  drawer?: LessonDrawer;
}

export class Lessons {
  readonly director: LessonsDirector;
  readonly view: LessonView;
  readonly drawer: LessonDrawer;
  /** The lesson running is practice (`?lesson=`): its steps and its end change nothing about progress. */
  practice = false;
  /** The box in play when a replay started, put back when it ends. */
  private saved: { spec: BoxSpec; snap: BoxSnapshot | null } | null = null;
  private drawerOpen = false;
  private starting = false;
  private tip: TipId | null = null;
  private tipBox: Box | null = null;
  private lastT = Number.NaN;
  /** Made once: the frame passes them every frame. */
  private readonly onScreen: { lesson: LessonId | null } = { lesson: null };
  private readonly isOpen = (lock: number) => this.d.play.session.isOpen(lock);

  constructor(private readonly d: LessonsDeps) {
    const { lantern, hands, settings } = d;
    const session = d.play.session;
    this.drawer = d.drawer ?? new DrawerStub();
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
    this.view = new LessonView({ world: d.world, scene: d.scene, lantern, sound: d.sound.game, reducedMotion: () => settings.get().reducedMotion });
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
    this.d.play.game.play({ kind: "lesson", id }, lessonSnapshot(id, this.director.step, left));
  }

  /**
   * The first launch's lesson: lesson 1 until it is done (resumed at its saved step), then lesson 2 for a player who
   * has not played a box yet. False when neither is due.
   */
  firstLaunch(): boolean {
    const p = this.d.profiles.profile, l = p.lessons;
    const at = (id: LessonId) => (l.step?.id === id ? l.step.index : 0);
    if (!l.l1) this.start("l1", { step: at("l1") });
    else if (!l.l2 && (p.nextBox === 1 || l.step?.id === "l2")) this.start("l2", { step: at("l2") });
    else return false;
    return true;
  }

  /** Show one example alone (the Lessons menu, "Show me"); false while one is already showing. */
  replay(example: ExampleId): boolean {
    return this.director.replay(example);
  }

  update(tMs: number): void {
    const dt = Number.isFinite(this.lastT) ? Math.min(Math.max(tMs - this.lastT, 0), 100) : 0;
    this.lastT = tMs;
    const dir = this.director, session = this.d.play.session;
    // The player left the lesson (another box was started): the lesson stops where it is.
    const lesson = dir.lesson;
    if (lesson && !dir.replaying && !dir.done) {
      const s = session.saving;
      if (!s || s.kind !== "lesson" || s.id !== lesson) dir.stop();
    }
    const on = dir.replaying ? EXAMPLES[dir.replaying].lesson : dir.done ? null : dir.lesson;
    if (on && this.d.presenting()) {
      if (dir.lesson === "l2" && dir.step === LESSON_DRAWER_STEP && !dir.replaying && this.drawer.update(handJoints, tMs) === "open") this.drawerOpen = true;
      dir.update(tMs);
    }
    this.onScreen.lesson = on;
    this.view.update(dir.frame, this.onScreen, on ? dir.frame.line : this.tipLine(session), dt, tMs);
  }

  /** The tip for the box in play: shown the first time its mechanic matters, until the player has done it. */
  private tipLine(session: BoxSession): string | null {
    const box = session.box;
    if (!box || box.spec.kind === "lesson" || session.stage !== "playing") return null;
    if (box !== this.tipBox) {
      this.tipBox = box;
      const p = this.d.profiles.profile;
      this.tip = tipFor(box, p.tipsSeen);
      if (this.tip) {
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
      // What was in play, as it would be saved now; the example's lesson box afresh meanwhile.
      this.saved = session.box && session.spec ? { spec: { ...session.spec }, snap: session.snapshot() } : null;
      game.play({ kind: "lesson", id: lesson });
      return;
    }
    const saved = this.saved;
    this.saved = null;
    if (saved) game.play(saved.spec, saved.snap);
    else go("home");
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
