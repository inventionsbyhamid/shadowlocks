// What the box session needs of the app and what it drives, as small interfaces, so the unit tests run it with fakes:
// the box scene, the lantern, the box client, the profile, the settings, the sounds, the bus, the clock, the head's
// gaze, the hand system's finger locks (session-fingers.ts), and the view (everything the player sees of the session
// beyond the panel: celebrations, the plate, the hint lantern, the reward). Also the session's stages and the
// player's actions the view reports.
import type { GameSounds } from "../audio/cues";
import type { BoxClient } from "../core/box-client";
import type { Profile, Settings } from "../core/profile";
import type { Box, BoxSpec, V3, Vec3 } from "../core/types";
import type { FeelEvent } from "../feel/lantern-controller";
import type { FeedbackEvent } from "./bus";
import type { CoachLine, HintLevel } from "./events";
import type { CrystalSink, FingerLoop, FingerSource } from "./session-fingers";

/** What the player did this frame, as SessionView.update reports it. */
export const ACT_TAKE = 1;
export const ACT_NEXT = 2;
export const ACT_HINT = 4;
export const ACT_SHOW_ME = 8;

/**
 * idle: no box. loading: a box is being built (a resumed one keeps its save meanwhile). playing: the locks.
 * opening: every lock is open, the box opens and its reward rises. reward: the reward can be taken. offered: it was
 * taken, the next box waits on the plate.
 */
export type Stage = "idle" | "loading" | "playing" | "opening" | "reward" | "offered";

/** What the session needs of the box scene (BoxScene has it all). */
export interface SessionScene {
  readonly box: Box | null;
  setBox(box: Box | null): void;
  readonly panelArt: { setWarmth(lock: number, w: number): void; setOpen(lock: number, open?: boolean): void; readonly etched: boolean };
  readonly lantern: { setPos(p: V3): void; getPos(out: V3): V3 };
}

/** What the session needs of the lantern (the app's Lantern has it all). */
export interface SessionLantern {
  readonly grab: { readonly holder: "left" | "right" | null };
  /** At rest (LanternController.atRest): a lock's open dwell counts only then. */
  readonly atRest: boolean;
  readonly feel: { setOpen(lock: number, open: boolean): void; aligned(lock: number): boolean };
  onFeel(fn: (e: FeelEvent) => void): () => void;
}

export type SessionSound = Pick<
  GameSounds,
  "boxStart" | "warmth" | "focus" | "dialTick" | "settle" | "ring" | "finger" | "crystallise" | "lockOpened" | "boxOpened" | "hint" | "muteRelease"
>;

export interface SessionProfiles {
  readonly profile: Profile;
  save(): Promise<void>;
}

/** The head's gaze ray in box units this frame (origin and direction written in place); false when there is none. */
export interface HeadRay {
  read(frame: XRFrame | null, origin: V3, dir: V3): boolean;
}

/** What the player sees of the session beyond the panel: celebrations, the plate, the hint lantern, the reward. */
export interface SessionView {
  /**
   * A new box: the plate's number and latch lights (and "Practice" for a practice box), the last box's celebration put
   * away, its scraps held back until the panel is etched.
   */
  setBox(box: Box, spec: BoxSpec, practice?: boolean): void;
  /** The panel shows this box's etching: what hangs in the box appears. */
  reveal(): void;
  /** Lock `lock` opened, the `order`-th: its latch light, and (unless restored) its celebration. */
  lockOpened(lock: number, order: number, restored: boolean): void;
  focus(lock: number | null): void;
  /** The hint lantern glows (on) or not. */
  stuck(on: boolean): void;
  hint(lock: number, level: HintLevel): void;
  clearHint(lock: number): void;
  /** The box opens: gold sweep, walls, drawer, and the reward rising with its story line. */
  boxOpened(): void;
  rewardTaken(): void;
  /** The plate offers the next box (on), or not. */
  offerNext(on: boolean): void;
  /** Where the hint lantern is in the world (its sounds play there); false when unknown. */
  hintLanternAt(out: Vec3): boolean;
  /** The coach line's suggestion (a key of COPY.game), or none. */
  coach(line: CoachLine | null): void;
  /** Per frame: animations and the box's keys and reward. Returns what the player did (ACT_* bits). */
  update(dtMs: number, stage: Stage): number;
}

export interface BoxSessionDeps {
  scene: SessionScene;
  lantern: SessionLantern;
  boxes: Pick<BoxClient, "get" | "prefetch">;
  profiles: SessionProfiles;
  settings: { get(): Readonly<Settings> };
  sound: SessionSound;
  emit: (e: FeedbackEvent) => void;
  /** Wall-clock ms (Date.now): when a reward went into the collection. */
  wallNow: () => number;
  head?: HeadRay;
  /** The hand system's finger shadow; without it finger locks cannot be filled (session-fingers.ts). */
  fingers?: FingerSource;
  /** A finger lock's hold, one per finger lock per box (`onDone` runs once, when it completes). */
  makeFingerLoop?: (onDone: () => void) => FingerLoop;
  crystals?: CrystalSink;
  view?: SessionView;
  /** Something worth saving changed: the lifecycle saves within its debounce. */
  saveSoon?: (nowMs: number) => void;
  /** Endless boxes may be played now (the entitlement: false once a trial is over, or while it is pending). */
  canPlayBox?: () => boolean;
  /** The plate's Next asked for a box the entitlement does not allow (the app shows the trial screen). */
  boxRefused?: () => void;
}

const NOOP = () => {};

export const NULL_VIEW: SessionView = {
  setBox: NOOP,
  reveal: NOOP,
  lockOpened: NOOP,
  focus: NOOP,
  stuck: NOOP,
  hint: NOOP,
  clearHint: NOOP,
  boxOpened: NOOP,
  rewardTaken: NOOP,
  offerNext: NOOP,
  hintLanternAt: () => false,
  coach: NOOP,
  update: () => 0,
};
