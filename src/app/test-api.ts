import type { Vec3 } from "../core/types";
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
   * The box in the scene (its stand-in until the box scene exists): whether the "Box" root entity
   * is there, its world centre, its edge in metres, and whether it is drawn.
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
}

declare global {
  interface Window {
    __ns?: NsApi;
  }
}
