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
// line put away; the drawer stays shut while an example shows; a progress reset lets the lesson or replay go. When
// another window's profile is taken meanwhile (the hosted link in two tabs, profile-store.ts) and that window moved the
// kept box's save on, the kept box is let go: the replay ends on Home, where Continue offers the stored box.
//
// Tips: the first time a box brings in a mechanic (decoys, a lock without rings, a hidden outline), its line shows
// on the coach line until the player has done what it says, with a ghost demo of about 6 s as it first shows (the
// finger pointing at decoys, or a ghost lantern swept near the lock's spot; lesson-scripts.ts).
//
// The voice guide (voice-guide.ts) hears the chip's line every frame as the chip shows it (the phone's or the
// controllers' wording), and the director's pacing asks it how long a line is said for (0 with it off).
import { createSystem, type World } from "@iwsdk/core";
import type { LessonId } from "../core/lessons-data";
import type { BoxSnapshot, Profile, TipId } from "../core/profile";
import type { BoxSpec } from "../core/types";
import { localLine } from "../i18n";
import type { BoxScene } from "../render/box-scene";
import type { BoxSession } from "./box-session";
import { on as onBus } from "./bus";
import { controllerLine } from "./controller-lines";
import type { Game } from "./game";
import type { HandsInBox } from "./hand-system";
import type { Lantern } from "./lantern-system";
import { phoneLine } from "./phone-lines";
import { lessonSnapshot } from "./lesson-boxes";
import { LessonView } from "./lesson-view";
import { EXAMPLES, type ExampleId, exampleFor, type LessonInputs, LessonsDirector } from "./lessons-director";
import type { MenuLessons } from "./menu-game";
import { type ProfileStore, slotMoved } from "./profile-store";
import { go, isMenuScreen } from "./screens";
import type { SettingsStore } from "./settings";
import { registerAppSystem } from "./systems";
import { TIP_FROM, TIP_LINES, tipDone, tipFor } from "./tips";
import { LineHold } from "../ui/coach-line";
import { CLICK_QUIET_MS } from "../audio/voice";
import type { VoiceGuide } from "./voice-guide";
import { chipPath, type Device, deviceKey, replayLines, stepLines } from "./voice-lines";
import { COPY } from "../ui/copy";
import type { CoachLine } from "./events";

/** No lesson lines to keep decoded. */
const NO_LINES: readonly string[] = [];

/** The lantern within this brightness of a hand counts as the player reaching for it (lantern-grab.ts: 30 cm). */
const NEAR_GLOW = 0.05;

export interface LessonsDeps {
  world: World;
  scene: BoxScene;
  profiles: ProfileStore;
  settings: SettingsStore;
  lantern: Lantern;
  hands: HandsInBox;
  sound: { game: { lessonStep(): void; settle(): void; crystallise(lock: number): void; coachLine(): void } };
  play: { game: Game; session: BoxSession; view: { readonly coachLine: CoachLine | null } };
  /** The player is in XR and can see it: lessons wait otherwise (the box forms as they enter; a hidden headset holds). */
  presenting(): boolean;
  /** A first launch may go into lesson 1 now (false: a field flag picked what plays, or a test keeps Home). */
  autoStart?: () => boolean;
  /**
   * Lesson 1 is done (for real): true when something else plays now in place of lesson 2 (a shared link's box, which
   * a new player gets after Lesson 1).
   */
  afterFirst?: () => boolean;
  /** What draws the lessons (tests pass their own; the real one needs a world and the box scene). */
  view?: LessonView;
  /** The session is a phone's: the coach chip says the lines about hands the phone's way (phone-lines.ts). */
  phone?: () => boolean;
  /** The voice guide: it says the chip's line (none: text only). */
  voice?: Pick<VoiceGuide, "update" | "ms" | "prepare" | "quiet">;
  /** The app is seen (not hidden: headset on, page shown); default `presenting`. */
  visible?: () => boolean;
  /** The player is in XR: on the 2D page (the landing, a shared link's page) the voice says nothing. Default true. */
  inXr?: () => boolean;
}

export class Lessons implements MenuLessons {
  readonly director: LessonsDirector;
  readonly view: LessonView;
  /** The lesson running is practice (`?lesson=`): its steps and its end change nothing about progress. */
  practice = false;
  /** The box in play when a replay started, put back when it ends. */
  private saved: Kept | null = null;
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
  /** The box whose tip demo has had its one chance to play (by key), and the tip it plays. */
  private tipDemoKey: string | null = null;
  private demoTip: TipId | null = null;
  /**
   * A Lessons row's tip replay: its demo on a fresh practice copy of the box that brings the tip in (shown once that
   * box is up), then what was in play put back.
   */
  private tipReplay: { tip: Exclude<TipId, "drawer">; saved: Kept | null; shown: boolean } | null = null;
  private lastT = Number.NaN;
  /** Made once: the frame passes them every frame. */
  private readonly onScreen: { lesson: LessonId | null; tip: boolean } = { lesson: null, tip: false };
  private readonly isOpen = (lock: number) => this.d.play.session.isOpen(lock);
  /** The session's suggestion, held through brief drops (a finger lock's coverage crossing its threshold). */
  private readonly hold = new LineHold();
  /** The suggestion last asked for, and the one held now (what the director is told), or null. */
  private askedKey: CoachLine = "controllerFinger";
  private suggested: CoachLine | null = null;
  /** For the voice outside a lesson (tips, the session's suggestion): the line last shown, its showings, the box. */
  private outLine: string | null = null;
  private outShows = 0;
  private outAgain = false;
  private outScope = 0;
  private outBox: unknown = null;
  private readonly outSeen: string[] = [];
  /**
   * The lesson part the voice's clips were last prepared for (the director's scope; -1: none, nothing held), and the
   * ghost's clicks.
   */
  private prepScope = -1;
  private clicks = 0;

  constructor(private readonly d: LessonsDeps) {
    const { lantern, hands, settings } = d;
    const session = d.play.session;
    onBus("screen", (e) => {
      this.menuUp = isMenuScreen(e.to);
    });
    // A hint taken from the hint lantern: the lesson's "Stuck?" line has done its work.
    onBus("hint", () => this.director.helpTaken());
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
      warmth: (lock) => session.warmth(lock),
      inBeam: () => hands.n > 0,
      rewardUp: () => session.stage === "reward",
      stuck: () => session.stuck,
      suggestion: () => this.suggested,
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
      hand: (out) => lantern.grab.nearestPinch(out),
    };
    this.director = new LessonsDirector({
      inputs,
      leftHanded: () => settings.get().handed === "left",
      onStep: (id, n) => this.stepped(id, n),
      // A step's idle clocks start: the hint lantern's glow counts its 40 s from there too.
      onRestart: () => session.restartStuck(),
      onDone: (id) => this.finished(id),
      onReplay: (ex, lesson, start) => this.replayed(ex, lesson, start),
      voiceMs: (k) => this.d.voice?.ms(deviceKey(chipPath(k), this.device())) ?? 0,
    });
    this.view = d.view ?? new LessonView({ world: d.world, scene: d.scene, lantern, sound: d.sound.game, reducedMotion: () => settings.get().reducedMotion });
    d.profiles.onAdopt((before) => this.forgetKept(before));
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
    return dir.replaying !== null || this.tipReplay !== null || (dir.lesson !== null && !dir.done && !this.drawerOpen);
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
    // Not during a tip replay: its practice box would be the one kept and put back, losing the real one.
    if (this.tipReplay) return false;
    return this.director.replay(example);
  }

  /** The menu drawer may be pulled: not while an example shows (the ghost has the lantern in its cradle). */
  get drawerAllowed(): boolean {
    return !this.director.showing && !this.tipReplay;
  }

  /**
   * A Lessons row's tip: its own ghost demo on a fresh practice copy of the box that brings it in (TIP_FROM), then
   * what was in play put back; nothing about progress changes. The drawer has no box: lesson 2's example teaches it.
   * False while an example or another tip replay shows.
   */
  replayTip(tip: TipId): boolean {
    if (tip === "drawer") return this.replay("finger");
    if (this.director.showing || this.tipReplay) return false;
    this.director.stopTip();
    this.tipReplay = { tip, saved: this.keepInPlay(), shown: false };
    this.d.play.game.play({ kind: "box", n: TIP_FROM[tip] }, null, true);
    return true;
  }

  /** Let the lesson or replay in the lap go (a progress reset): nothing is put back, nothing more is saved. */
  stop(): void {
    this.saved = null;
    this.tipReplay = null;
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
    // The player left the lesson (another box was started): the lesson stops where it is. Not for a replay's box.
    const lesson = dir.lesson;
    if (lesson && !dir.replaying && !this.tipReplay && !dir.done && session.stage !== "loading") {
      const s = session.spec;
      if (!s || s.kind !== "lesson" || s.id !== lesson) dir.stop();
    }
    if (this.tipReplay) this.stepTipReplay(session);
    // A tip replay holds any lesson where it is (its box is put back after).
    const on = this.tipReplay ? null : dir.replaying ? EXAMPLES[dir.replaying].lesson : dir.done ? null : dir.lesson;
    // The session's suggestion, held through brief drops (it exists while a controller or phone player is at a short
    // finger lock): in a lesson the director gives it the chip on lesson 2's turn only; out of the lessons, it shows.
    const asked = this.d.play.view.coachLine;
    if (asked) this.askedKey = asked;
    const held = this.hold.update(asked ? COPY.game[asked] : null, dt);
    this.suggested = held === null ? null : this.askedKey;
    // Under a menu the lesson waits, but for the pull that ends lesson 2. A tip's demo runs on the director's clock too.
    if ((on || dir.tipping) && this.d.presenting() && (!this.menuUp || this.drawerOpen)) dir.update(tMs);
    // One coach line: a lesson's (the director's, which may be the session's suggestion), else the session's
    // suggestion, else a tip; none under a menu (the lesson's ghost is put away there too).
    const shown = this.menuUp ? null : on;
    this.onScreen.lesson = shown;
    const line = this.menuUp ? null : shown ? dir.frame.line : this.tipReplay ? TIP_LINES[this.tipReplay.tip] : (held ?? this.tipLine(session));
    if (!shown) this.tipDemo(session);
    this.onScreen.tip = dir.tipping && !this.menuUp;
    // Lines come in English (the director, the tips, the session); the chip shows them in the language shown, on a
    // phone the phone's way, and with controllers in hand the controllers' way.
    const said = this.d.phone?.() ? phoneLine(line) : this.d.hands.controllers ? controllerLine(line) : line;
    this.view.update(dir.frame, this.onScreen, localLine(said), dt, tMs);
    if (this.d.voice) this.speak(said, shown !== null, on !== null, session);
  }

  /** The input in hand, as the chip words its lines. */
  private device(): Device {
    return this.d.phone?.() ? "phone" : this.d.hands.controllers ? "controllers" : "hands";
  }

  /**
   * The chip's line to the voice guide: the director's with its own showings and steps; a tip or the session's
   * suggestion outside a lesson said once a box. On a new lesson part (or replay), its clips are decoded (and the last
   * part's dropped); once no lesson runs (`running`: under a menu it still does), none are kept. The ghost's click is a
   * quiet moment. Allocates nothing per frame.
   */
  private speak(said: string | null, lesson: boolean, running: boolean, session: BoxSession): void {
    const voice = this.d.voice!, f = this.director.frame, dir = this.director;
    if (!running && this.prepScope !== -1) {
      this.prepScope = -1;
      voice.prepare(NO_LINES);
    }
    if (f.clicks !== this.clicks) {
      this.clicks = f.clicks;
      voice.quiet(CLICK_QUIET_MS);
    }
    const visible = this.d.visible?.() ?? this.d.presenting();
    if (this.d.inXr && !this.d.inXr()) said = null;
    if (lesson) {
      // A replay may run outside a lesson (from Home once the lessons are done).
      if (f.scope !== this.prepScope && (dir.replaying || dir.lesson)) {
        this.prepScope = f.scope;
        const device = this.device();
        if (dir.replaying) voice.prepare(replayLines(dir.replaying, device));
        else if (dir.lesson) voice.prepare(stepLines(dir.lesson, dir.step, device));
      }
      voice.update(said, f.why, f.again, f.shows, f.scope, visible);
      return;
    }
    if (session.box !== this.outBox) {
      this.outBox = session.box;
      this.outSeen.length = 0;
      this.outScope++;
    }
    if (said !== this.outLine) {
      this.outLine = said;
      this.outShows++;
      this.outAgain = said !== null && this.outSeen.includes(said);
      if (said !== null && !this.outAgain) this.outSeen.push(said);
    }
    voice.update(said, said === null ? null : "tip", this.outAgain, this.outShows, -1 - this.outScope, visible);
  }

  /**
   * A tip's ghost demo (about 6 s): once a box, tried as its tip first shows on the box it was worked out for, once
   * the box is shown, and skipped if the lantern is in hand then. It stops when the player takes the lantern, the tip
   * is done or another takes its place, a menu comes up or the box goes. A tip replay runs its own.
   */
  private tipDemo(session: BoxSession): void {
    if (this.tipReplay) return;
    const dir = this.director, box = session.box, held = this.d.lantern.grab.holder !== null;
    if (dir.tipping) {
      if (!this.tip || this.tip !== this.demoTip || held || this.menuUp || !box || box.key !== this.tipDemoKey) dir.stopTip();
      return;
    }
    if (!this.tip || !box || box.key !== this.tipKey || box.key === this.tipDemoKey) return;
    if (this.menuUp || !this.d.presenting() || !session.revealed) return;
    this.tipDemoKey = box.key;
    if (!held && dir.tipDemo(this.tip, box)) this.demoTip = this.tip;
  }

  /** A tip replay: its demo once the practice box is up and shown; at its end, what was in play put back. */
  private stepTipReplay(session: BoxSession): void {
    const tr = this.tipReplay!, dir = this.director;
    if (tr.shown) {
      // As in play, a hand taking the lantern stops the demo; the replay is then over.
      if (dir.tipping && this.d.lantern.grab.holder !== null) dir.stopTip();
      if (!dir.tipping) this.endTipReplay();
      return;
    }
    const box = session.box, n = TIP_FROM[tr.tip];
    if (!box || box.spec.kind !== "box" || box.spec.n !== n || !session.practice || session.stage !== "playing" || !session.revealed) return;
    if (this.menuUp || !this.d.presenting()) return;
    tr.shown = dir.tipDemo(tr.tip, box, true);
    // Nothing to show on that box (it lacks the mechanic): over at once.
    if (!tr.shown) this.endTipReplay();
  }

  private endTipReplay(): void {
    const saved = this.tipReplay?.saved ?? null;
    this.tipReplay = null;
    if (saved) this.d.play.game.play(saved.spec, saved.snap, saved.practice);
    else if (!this.dropping) go("home");
  }

  /**
   * Another window's profile was taken in place of this one's (profile-store.ts): the box a replay keeps to put back
   * was saved to the old one (`before`). When the other window moved that box's save on (played it on, solved it,
   * played another), the box is let go, so the replay's end puts nothing back over the newer save: it brings up Home,
   * where Continue offers the stored box (the shell does the same with a box in the lap). A practice box saves nowhere
   * and is kept; a kept lesson's step is the shell's to judge (in a replay the lap's save is the lessons').
   */
  private forgetKept(before: Profile): void {
    const after = this.d.profiles.profile;
    const stale = (k: Kept | null): boolean => k !== null && !k.practice && k.spec.kind !== "lesson" && slotMoved(before, after, k.spec.kind);
    if (stale(this.saved)) this.saved = null;
    if (this.tipReplay && stale(this.tipReplay.saved)) this.tipReplay.saved = null;
  }

  /**
   * What is in play, as it would be saved now, to put back after a replay; null when there is none or it is done with
   * (an opened box put back would open again).
   */
  private keepInPlay(): Kept | null {
    const session = this.d.play.session, s = session.stage;
    if (!session.box || !session.spec || s === "opening" || s === "reward" || s === "offered") return null;
    return { spec: { ...session.spec }, snap: session.snapshot(), practice: session.practice };
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
    // Lesson 1 leads into lesson 2 (unless a shared link's box comes in its place); lesson 2 ends on the menu it just
    // taught.
    if (id === "l1") {
      if (this.practice || !this.d.afterFirst?.()) this.start("l2", { practice: this.practice });
    } else go("home");
  }

  private replayed(_ex: ExampleId, lesson: LessonId, start: boolean): void {
    const { game, session } = this.d.play;
    if (start) {
      // What was in play (keepInPlay); the example's lesson box afresh meanwhile, as practice (nothing it does is
      // saved, solved or collected).
      this.saved = this.keepInPlay();
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

/** What was in play when a replay started, put back when it ends. */
interface Kept {
  spec: BoxSpec;
  snap: BoxSnapshot | null;
  practice: boolean;
}

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
