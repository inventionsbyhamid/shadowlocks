import type { V2, V3, Vec3 } from "../core/types";
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
}

/** A sound the game asked for: effect id (stings as `sting:<id>`, music as `music:<state>`), pitch, virtual ms. */
export interface NsSound {
  id: string;
  pitch?: number;
  at: number;
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

/** `window.__sl`: Shadow Locks' own test hooks, present only in builds made with VITE_TEST_HOOKS=1. */
export interface SlApi {
  /** The game's state for a video frame's fingerprint, or null while no box is in play. */
  frameState(): SlFrameState | null;
  /** The lantern now. */
  lantern(): SlLantern;
  /** Put the lantern at [x, y, z] (box units; never deeper than the box front, z 1). A hand holding it holds on. */
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
}

declare global {
  interface Window {
    __ns?: NsApi;
    __sl?: SlApi;
  }
}
