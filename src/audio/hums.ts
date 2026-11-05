// The warmth hums. A lock the lantern is close to hums its own chord tone an octave below its
// music-box note (one lock_hum loop pitched 0, +4 or +7 semitones), louder as its warmth rises; only
// the gazed lock hums. The fingertip hum stands in for vibration while a finger is in the beam.
// Hums run on the engine's own loops, so one-shots never steal them. warmth() and finger() are
// called every frame: they allocate nothing and touch the audio graph only when the level moved
// more than a small step.
import type { BoxSpec, Vec3 } from "../core/types";
import type { LoopHandle, LoopOptions } from "./engine";
import type { SfxId } from "./manifest";
import { humSemitones, KEY } from "./music-box";

/** Locks hum in lessons and boxes 1 to 5 (with Warmth on); from box 6 they are quiet by default. */
export const HUM_LAST_BOX = 5;
/** A hum's level moves only when its warmth changed more than this (or reached 0 or 1). */
export const HUM_STEP = 0.02;
/** Level moves glide over this long: no zipper noise. */
export const HUM_RAMP_MS = 40;
/** A hum fades out over this long when its lock opens or the finger leaves. */
export const HUM_FADE_MS = 150;
/** The fingertip hum's level: this much as the finger enters the beam... */
export const FINGER_HUM_BASE = 0.3;
/** ...plus this much times the finger's progress toward the panel. */
export const FINGER_HUM_SPAN = 0.7;
/**
 * The fingertip hum rises this many semitones over the 0.6 s hold. The pack's fingertip_hum is the
 * regenerated, unpitched breath (0% voiced), so the glide cannot clash with a lock's hum; 0 plays it
 * flat.
 */
export const FINGER_GLIDE_SEMITONES = 2;

const LOCKS = 3;
const PITCH_STEP = 0.05;
/** The fingertip hum follows the finger once it moved this far (m, summed over axes). */
const MOVE_M = 0.002;

/** Whether locks hum for this box: Warmth on, and a lesson or one of the first five boxes. */
export function humsOn(spec: BoxSpec | null, warmth: boolean): boolean {
  if (!warmth || !spec) return false;
  if (spec.kind === "lesson") return true;
  return spec.kind === "box" && spec.n <= HUM_LAST_BOX;
}

/** What the hums need of the audio engine. */
export interface LoopEngine {
  loop(id: SfxId, o?: LoopOptions): LoopHandle | null;
}

/** Where lock `lock` is in the world (written into `out`); false when there is no box. */
export type LockPlace = (lock: number, out: Vec3) => boolean;

const unit = (x: number): number => (x > 1 ? 1 : x > 0 ? x : 0);

export class Hums {
  private readonly loops: (LoopHandle | null)[] = [null, null, null];
  /** Each lock's options for its loop, made once: its pitch, and its place filled in when it starts. */
  private readonly lockOpts: LoopOptions[] = [];
  private readonly where: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  private readonly wanted = new Float64Array(LOCKS);
  private readonly sent = new Float64Array(LOCKS);
  private readonly done = new Uint8Array(LOCKS);
  private on = false;
  private hushed = false;
  private focused: number | null = null;

  private fingerLoop: LoopHandle | null = null;
  private readonly fingerOpts: LoopOptions = {};
  private readonly fingerAt: Vec3 = [0, 0, 0];
  private fingerGain = 0;
  private fingerPitch = 0;

  constructor(
    private readonly engine: LoopEngine,
    private readonly o: { lockAt?: LockPlace; key?: string } = {},
  ) {
    for (let i = 0; i < LOCKS; i++) this.lockOpts.push({ pitch: humSemitones(i, o.key ?? KEY) });
  }

  /** Locks may hum (this box's rule and the Warmth setting). */
  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    this.applyAll();
  }

  /** A menu is open: every lock hum goes quiet until it closes. */
  hush(on: boolean): void {
    this.hushed = on;
    this.applyAll();
  }

  /** Lock `lock`'s warmth, 0..1 (already smoothed by the session). Per frame. */
  warmth(lock: number, w: number): void {
    if (lock < 0 || lock >= LOCKS) return;
    this.wanted[lock] = w;
    this.apply(lock);
  }

  /** The gazed lock: only it hums (null: every warm lock may). */
  focus(lock: number | null): void {
    if (lock === this.focused) return;
    this.focused = lock;
    this.applyAll();
  }

  /** Lock `lock` opened: its hum fades out under its note and does not come back this box. */
  opened(lock: number): void {
    if (lock < 0 || lock >= LOCKS) return;
    this.done[lock] = 1;
    this.silence(lock, HUM_FADE_MS);
  }

  /** The level lock `lock`'s hum is heading for (0 when it is quiet). */
  level(lock: number): number {
    return this.sent[lock] ?? 0;
  }

  /**
   * The finger in the beam: `progress` toward the panel and `hold` through the 0.6 s hold (both 0..1),
   * at the index fingertip. null when the finger leaves (the hum fades out). Per frame.
   */
  finger(progress: number | null, hold = 0, at?: Vec3): void {
    if (progress === null || !Number.isFinite(progress)) {
      this.fingerLoop?.stop(HUM_FADE_MS);
      this.fingerLoop = null;
      return;
    }
    const g = FINGER_HUM_BASE + FINGER_HUM_SPAN * unit(progress);
    const pitch = FINGER_GLIDE_SEMITONES * unit(hold);
    const f = this.fingerLoop;
    if (!f) {
      const o = this.fingerOpts;
      if (at) copy(at, this.fingerAt);
      o.position = at ? this.fingerAt : undefined;
      o.pitch = pitch;
      const made = this.engine.loop("fingertip_hum", o);
      if (!made) return;
      made.setGain(g, HUM_RAMP_MS);
      this.fingerLoop = made;
      this.fingerGain = g;
      this.fingerPitch = pitch;
      return;
    }
    if (Math.abs(g - this.fingerGain) > HUM_STEP || (g === 1 && this.fingerGain !== 1)) {
      f.setGain(g, HUM_RAMP_MS);
      this.fingerGain = g;
    }
    if (Math.abs(pitch - this.fingerPitch) > PITCH_STEP) {
      f.setPitch(pitch, HUM_RAMP_MS);
      this.fingerPitch = pitch;
    }
    const p = this.fingerAt;
    if (at && Math.abs(at[0] - p[0]) + Math.abs(at[1] - p[1]) + Math.abs(at[2] - p[2]) > MOVE_M) {
      copy(at, p);
      f.setPosition(p);
    }
  }

  /** A new box, or play ended: every hum fades out and every lock may hum again. */
  reset(): void {
    for (let i = 0; i < LOCKS; i++) {
      this.wanted[i] = 0;
      this.done[i] = 0;
      this.silence(i, HUM_FADE_MS);
    }
    this.focused = null;
    this.fingerLoop?.stop(HUM_FADE_MS);
    this.fingerLoop = null;
  }

  private applyAll(): void {
    for (let i = 0; i < LOCKS; i++) this.apply(i);
  }

  private apply(lock: number): void {
    const live = this.on && !this.hushed && this.done[lock] === 0 && (this.focused === null || this.focused === lock);
    const want = live ? unit(this.wanted[lock]!) : 0;
    const sent = this.sent[lock]!;
    if (want === sent) return;
    if (want === 0) {
      this.silence(lock, HUM_RAMP_MS);
      return;
    }
    if (want !== 1 && Math.abs(want - sent) <= HUM_STEP) return;
    let loop = this.loops[lock];
    if (!loop) {
      const o = this.lockOpts[lock]!;
      const at = this.where[lock]!;
      o.position = this.o.lockAt?.(lock, at) ? at : undefined;
      loop = this.engine.loop("lock_hum", o);
      // Audio has not started yet (or effects are off): the next warmth tries again.
      if (!loop) return;
      this.loops[lock] = loop;
    }
    loop.setGain(want, HUM_RAMP_MS);
    this.sent[lock] = want;
  }

  private silence(lock: number, fadeMs: number): void {
    this.loops[lock]?.stop(fadeMs);
    this.loops[lock] = null;
    this.sent[lock] = 0;
  }
}

function copy(from: Vec3, to: Vec3): void {
  to[0] = from[0];
  to[1] = from[1];
  to[2] = from[2];
}
