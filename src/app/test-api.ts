import type { GameSounds } from "../audio/cues";
import type { BoxSnapshot } from "../core/profile";
import type { BoxSpec, V2, V3, Vec3 } from "../core/types";
import type { FeedbackEvent } from "./bus";
import type { Screen } from "./screens";

/** A pokeable button on the current screen: centre and facing direction in world space, size in metres. */
export interface NsButton {
  id: string;
  world: Vec3;
  normal: Vec3;
  size: [number, number];
}

export interface NsState {
  screen: Screen;
  buttons: NsButton[];
  xr: {
    presenting: boolean;
    sessionMode: "immersive-ar" | "immersive-vr" | null;
    blendMode: string | null;
    visibility: string;
  };
  /** The box placement: back panel centre and heading; source "default" until placed from the head. */
  boxPose: { position: Vec3; yaw: number; source: string };
  /**
   * The box in the scene: whether the "Box" root entity is there, its world origin (the back panel's
   * centre), its edge in metres, and whether it is drawn.
   */
  box: { exists: boolean; world: Vec3 | null; sizeM: number; visible: boolean };
  head: Vec3 | null;
  persistent: boolean;
  /** The storage notice while the headset UI has not shown it (ProfileStore.pendingNotice). */
  notice: string | null;
}

/** Last frame's draw calls and triangles; our systems' update time per frame (real ms). */
export interface NsPerf {
  calls: number;
  triangles: number;
  /** The most draw calls and triangles any one frame drew since resetPerf (the last frame included). */
  callsMax: number;
  trianglesMax: number;
  /** Last frame. Chromium's timer has 0.1 ms steps here, so prefer the average for small numbers. */
  frameMs: number;
  frameMsAvg: number;
  frameMsP95: number;
  frameMsMax: number;
  frames: number;
  /**
   * Per app system (by registered name) over the same frames: average, p95 and max ms per frame,
   * and the sum over all of them. A p95 sum across systems is above the whole frame's p95.
   */
  systems: Record<string, { avgMs: number; p95Ms: number; maxMs: number; sumMs: number }>;
}

/** Frame clock control: pause real frames, step one frame of `ms`, resume. */
export interface NsClock {
  readonly paused: boolean;
  pause(): void;
  /** Steps one frame; returns the virtual time after it. */
  step(ms?: number): number;
  resume(): void;
  now(): number;
}

/** The menus, for tests. */
export interface NsUi {
  /** A panel is moving, a number is counting, or a key's action is waiting. */
  busy(): boolean;
  /** Text an element of the current screen shows (count-ups included). */
  text(id: string): string | null;
  /** Settings as stored in the profile. */
  settings(): Record<string, number | boolean | string>;
  /** Change settings the way the settings screen does (clamped, saved, applied live). */
  setSettings(patch: Record<string, number | boolean | string>): void;
  /** Move to a screen directly (screenshots and timing; navigation tests poke). */
  go(screen: Screen): void;
  /** A key of the current screen: cap top above the plate (mm), clickable, lit (a toggle that is on). */
  key(id: string): { capZ: number; enabled: boolean; lit: boolean } | null;
  /** Keycaps on the panels shown now. */
  capCount(): number;
  /** Panel bodies (slabs) drawn last frame. */
  slabCount(): number;
  /** A box move waits for the finger to leave the current panel. */
  layoutHeld(): boolean;
  /** A panel as laid out: world centre and size (m). */
  panelBox(screen: Screen): { center: Vec3; width: number; height: number } | null;
  /** World position of a panel's root (its bottom centre). */
  panelPosition(screen: Screen): Vec3 | null;
  /**
   * The menu drawer: its pull state and progress (0..1), how far it is out (box units), how many
   * times a hand pulled it open, its handle's centre and the direction it slides out (world).
   */
  drawer(): {
    state: string;
    progress: number;
    out: number;
    opened: number;
    handle: Vec3;
    toward: Vec3;
    hand: string | null;
    /** Each hand's thumb to index tip (m), NaN when not tracked. */
    gaps: [number, number];
  };
  /** What the player may play: the edition, the paywall switch, the entitlement and whether billing can sell. */
  access(): { edition: string; paywall: boolean; ent: { kind: string; daysLeft?: number }; canBuy: boolean };
  /** Change the fake billing of a test build started with `?billing=` (what the next purchase answers). */
  billing(patch: { available?: boolean; owned?: boolean; buyResult?: "bought" | "cancelled" | "error" }): boolean;
  /** Pages a store link opened (window.open), newest last. */
  opened(): string[];
  /** Lesson and tip replays the menus asked for, oldest first, and whether the lessons ran them. */
  replays(): { kind: string; id: string; ran: boolean }[];
  /** What waits behind the menus: a box (its number), the Daily Box, a lesson, or null. */
  behind(): { kind: string; n?: number } | null;
  /** The box is held under a menu (its clock stopped). */
  held(): boolean;
  /** Change the profile (say `{ nextBox: 4 }`: box 3 solved), save it, and paint the menu shown again. */
  profile(patch: Record<string, unknown>): void;
}

/**
 * A sound the game asked for: effect id (stings as `sting:<id>`, music as `music:<state>`), pitch,
 * virtual ms, and how long after that it starts on the audio clock (layered sounds).
 */
export interface NsSound {
  id: string;
  pitch?: number;
  at: number;
  delayMs?: number;
}

/** Sound, for tests: what the game asked the audio engine to play (heard or not: no gesture in tests). */
export interface NsAudio {
  log(): NsSound[];
  clear(): void;
  /** The sound effects (with their captions) have loaded. */
  ready(): boolean;
  /** Sound can play: the engine was unlocked and its context runs. */
  running(): boolean;
  /** Voices playing now (effects started and not yet ended). */
  voices(): number;
  /** The music: state asked for, whether the bed plays, the low-pass it heads for and has now (Hz). */
  music(): { state: string; playing: boolean; cutoffHz: number; filterHz: number };
}

/** The box scene, for tests: which box it shows, where its points are, what it draws. */
export interface NsScene {
  /** Generate and show a box, numbered (`n`) or daily (`day`, YYYY-MM-DD), mirrored for a left hand. Returns its key. */
  show(spec: { n: number } | { day: string }, mirrored?: boolean): string;
  /** The box shown: key, lantern spots and start (box units), mirrored, and each lock's missing piece (-1 for none). */
  box(): { key: string; spots: V3[]; start: V3; mirrored: boolean; missing: number[] } | null;
  /** Box units to world metres, by the box root's world matrix (what is drawn). */
  toWorld(points: V3[]): Vec3[];
  /** The box root's world matrix now (column-major). */
  matrix(): number[];
  /** Set a lock piece's glow and visibility the way the game does (BoxScene.scrapMesh). */
  setScrap(lock: number, piece: number, o: { glow?: number; visible?: boolean }): void;
  /** A lock piece's glow and visibility as the shaders read them. */
  scrap(lock: number, piece: number): { glow: number; visible: boolean };
  /** Put the lantern (box units). */
  setLantern(p: V3): void;
  /** Where the lantern is (box units). */
  lantern(): V3;
  /** Draw calls and triangles the box adds per view, counted from what it draws, with the parts drawn. */
  draws(): { calls: number; triangles: number; parts: string[] };
  /** Show or hide the whole box. */
  setVisible(v: boolean): void;
}

/** `window.__ns`, present only in builds made with VITE_TEST_HOOKS=1. */
export interface NsApi {
  state(): NsState;
  perf(): NsPerf;
  /** The named app systems' update time per frame (real ms), summed per frame, oldest first, over perf()'s window. */
  perfFrames(systems: string[]): number[];
  resetPerf(): void;
  clock: NsClock;
  /** Bus events seen so far (newest last; at least the last 2000), optionally of one type. */
  events(type?: string): FeedbackEvent[];
  clearEvents(): void;
  /** Place the box again from the current head pose (false while the head is not tracked). */
  recenter(): boolean;
  /** The IWSDK World, for test-only checks. */
  world: unknown;
  ui: NsUi;
  /** Put an event on the app's bus. */
  emit(e: FeedbackEvent): void;
  audio: NsAudio;
  scene: NsScene;
}

/**
 * The game state a demo video frame's fingerprint reads (tests/video/lib/page-video.ts): small and
 * stable, so a frame-stepped render can tell that a resumed run replays the same game.
 */
export interface SlFrameState {
  /** The box in play (its generator key). */
  boxKey: string;
  /** The lantern's position, in box units. */
  lantern: [number, number, number];
  /** Indices of the open locks, ascending. */
  openLocks: number[];
  screen: string;
}

/** The lantern now: where it is (a copy, box units), whether a hand holds it and which, the feel's mode, its glow. */
export interface SlLantern {
  pos: V3;
  held: boolean;
  mode: "free" | "line" | "settled";
  holder: "left" | "right" | null;
  /** How bright the hands make it (0 with no hand within 30 cm, 1 within 6 cm or held). */
  glow: number;
}

/** A lock's ring line as the lantern feel sees it this frame (box units): mark on the panel, direction out to the spot. */
export interface SlRingLine {
  lock: number;
  mark: V3;
  dir: V3;
  aligned: boolean;
}

/** A feel event (lantern grab, release, line, settle, unsettle, dial tick), copied, with the frame time it came in. */
export interface SlFeelEvent {
  type: string;
  lock?: number;
  on?: boolean;
  cm?: number;
  at: number;
}

/** A lock of the box in play, as the session hook reports it (box units). */
export interface SlLock {
  i: number;
  center: [number, number];
  size: number;
  spot: V3;
  finger: boolean;
  rings: boolean;
  hidden: boolean;
}

/** The box session now (copies). */
export interface SlSessionState {
  /** idle, loading, playing, opening, reward, offered. */
  stage: string;
  key: string | null;
  spec: BoxSpec | null;
  locks: SlLock[];
  /** Open locks, ascending. */
  open: number[];
  /** Finger pieces formed: lock and depth. */
  crystals: { lock: number; z: number }[];
  /** Each lock's measured warmth (0..1). */
  warmth: number[];
  focus: number | null;
  stuck: boolean;
  hints: number;
  hintLevel: Record<number, number>;
  elapsedMs: number;
  /** The box's etching is on the panel and what hangs in it is shown. */
  revealed: boolean;
  /** The lifecycle's view: "playing" (saved) or "finished". */
  phase: string;
  /** Items in the collection, and the numbered box to play next. */
  collected: number;
  nextBox: number;
  /** The hint lantern glows; its choices are open. */
  hintGlow: boolean;
  hintChoices: boolean;
  /** The coach line shown (a key of COPY.game), or null. */
  coach: string | null;
  /** A practice box (`?box=N`): it never touches the player's progress. */
  practice: boolean;
}

/** A key on the box (the plate's Next, the hint lantern and its choices): world centre, facing, size (m), live. */
export interface SlKey {
  id: string;
  world: Vec3;
  normal: Vec3;
  size: [number, number];
  live: boolean;
}

/** The box session, for tests. */
export interface SlSession {
  /** Play a box now, as the menus will (the play screen; the lifecycle saves it). */
  play(spec: BoxSpec): void;
  /** Continue the saved numbered box (Shell.continueSaved); false when there is none to continue. */
  continue(): boolean;
  state(): SlSessionState | null;
  snapshot(): BoxSnapshot | null;
  /** Save now, as on hide (the lifecycle's forced flush). */
  save(): void;
  keys(): SlKey[];
  /** The reward: where it is (world), whether it can be taken now, whether a hand holds it; null with none shown. */
  reward(): { world: Vec3; up: boolean; held: boolean } | null;
  /** The hint lantern's "Hint" (the lock in focus); the level shown, or null. */
  hint(): number | null;
}

/** One tracked hand in the box this frame. */
export interface SlHand {
  /** Shadow outlines it cast this frame (0 while it holds the lantern or is out of the mouth). */
  outlines: number;
  /** Its nearest joint to the panel (box z). */
  minZ: number;
  /** Its index finger's intermediate, distal and tip joints (box units). */
  index: [V3, V3, V3];
}

/** The hands in the box this frame. */
export interface SlHands {
  /** Every casting bone's shadow outline (panel, box units), and the finger's (the index finger's last two bones). */
  outlines: V2[][];
  finger: V2[][];
  /** The finger's depth (box z), or null with no finger in the beam. */
  fingerZ: number | null;
  /** Capsules the depth mask draws (0 while it is off). */
  mask: number;
  /** Each hand, or null when it is not tracked. */
  left: SlHand | null;
  right: SlHand | null;
  /** A held controller's stand-in finger this frame: its hand and its ends (box units, front then back), or null. */
  standIn: { by: "left" | "right"; front: V3; back: V3 } | null;
  /** The finger shadow's change counter (it moves only when the shadow changed). */
  version: number;
}

/** A finger lock of the box shown, as its completion loop sees it this frame. */
export interface SlFingerLock {
  lock: number;
  /** Its lantern spot (box units). */
  spot: V3;
  /** The missing piece's outline on the panel. */
  piece: V2[];
  state: "idle" | "holding" | "done";
  /** 0..1 toward done. */
  progress: number;
  /** This frame's coverage, with the finger, and whether it meets the rule. */
  coverage: { cover: number; spill: number; spillAll: number; gap: number };
  meets: boolean;
  /**
   * Its crystallised piece: depth, front corners (box units), done forming, frame ms since it started, whether the
   * brass piece is drawn yet (from 300 ms); null before.
   */
  crystal: { z: number; verts: V3[]; formed: boolean; ms: number; shown: boolean } | null;
}

/** `window.__sl`: Shadow Locks' own test hooks, present only in builds made with VITE_TEST_HOOKS=1. */
export interface SlApi {
  /** The box session (play, state, saves, the box's keys and reward). */
  session: SlSession;
  /** The game's state for a video frame's fingerprint, or null while no box is in play. */
  frameState(): SlFrameState | null;
  /** The lantern now: a copy of where it is (`pos`, box units), held or not, by which hand, its mode and glow. */
  lantern(): SlLantern;
  /**
   * Put the lantern at [x, y, z] (box units; never deeper than the box front, z 1) through the lantern's controller,
   * and cast its shadows now. A hand holding it holds on.
   */
  placeLantern(p: V3): void;
  /**
   * The shadows of the box shown on the panel (box units), cast from the lantern where it is: core shadowPolys over
   * the scraps actually in the box (a finger lock's missing piece left out), rings and decoys.
   */
  shadows(): V2[][];
  /** The box's ring lines as the lantern feel sees them (built on the first frame after a box is shown). */
  ringLines(): SlRingLine[];
  /** Feel events since the last clear. */
  feelEvents(): SlFeelEvent[];
  clearFeelEvents(): void;
  /** The hands in the box this frame: their shadow outlines, the depth mask, each hand's joints that tests aim. */
  hands(): SlHands;
  /** The box's finger locks (made on the first frame after a box is shown). */
  fingerLocks(): SlFingerLock[];
  /** Start lock `lock`'s crystallise with the piece at depth `fingerZ`; frames carry it (see fingerLocks' crystal). */
  crystallise(lock: number, fingerZ: number): void;
  /** A lock's warmth (0..1, eased in by the panel) and opening (its gold fill), as the game sets them. */
  setWarmth(lock: number, w: number): void;
  setOpen(lock: number, open?: boolean): void;
  /** The panel's eased warmth and opening per lock, as its shader reads them. */
  panelState(): { warmth: number[]; open: number[] };
  /** Show or hide what hangs in the box (scraps, threads, rings, lantern), to read the panel behind it. */
  showHanging(v: boolean): void;
  /**
   * Real ms per shadow update (casting every shadow and writing the mesh) with the lantern moved along
   * `path` (box units), one point per update; with `batch` > 1, each entry is the mean of that many.
   */
  shadowTimes(path: V3[], batch?: number): number[];
  /** What the shadow mesh holds: vertices and triangles. */
  shadowStats(): { vertices: number; triangles: number };
  /**
   * The panel's etching for the box shown, `count` times: real ms in all and in its slowest step (each
   * step is one frame's work, its canvas drawing finished), the number of steps, ms to upload its two
   * textures, and each step's median ms (setBox first).
   */
  etchTimes(count: number): { total: number[]; worstStep: number[]; steps: number; upload: number[]; perStep: number[] };
  /** The box's sounds and haptics, as the box session calls them (lock opened, warmth, menus...). */
  sound: GameSounds;
  /** The caption texts up now. */
  captions(): string[];
}

declare global {
  interface Window {
    __ns?: NsApi;
    __sl?: SlApi;
  }
}
