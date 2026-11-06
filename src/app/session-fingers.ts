// The box session's finger locks: the one place the hand system plugs into the game. It brings three things, all
// optional (without them a finger lock simply cannot be filled):
// - `fingers` (FingerSource): this frame's finger shadow on the panel (a hand's index finger, or a held controller's
//   fingertip-sized stand-in), a counter that moves only when that shadow changed, whether a hand that can cast it is
//   in tracking, whether controllers are in use, the fingertip, and the depth of the finger over a lock's gap (the hand
//   system's HandsInBox);
// - `makeFingerLoop` (FingerLoop): one hold per finger lock per box, FingerHold fed the solve rule with the finger
//   (the hand system's FingerLockLoop);
// - `crystals` (CrystalSink): the missing piece forming where the finger was, or put back at once for a resumed box
//   (render/fx/crystallise.ts and the box scene's Crystals).
// Per finger lock and frame: "one piece short" once its scraps are in place but not its piece, the hold fed this
// frame's coverage (nothing fills it away from its spot), the hold's progress on the bus, and on the frame it completes
// the piece forms; the session then opens the lock once the piece has formed (CRYSTAL_MS). The fingertip hum follows a
// finger in the beam, and stops whenever play does. While a finger lock is one piece short and controllers are in use,
// the coach line suggests setting one down (it comes and goes only after 300 ms, so it never flickers). Per frame it
// allocates nothing.
import type { GameSounds } from "../audio/cues";
import { type Coverage, isShort, type LockSamples } from "../core/solve";
import type { Box, Lock, V2, Vec3 } from "../core/types";
import type { FeedbackEvent } from "./bus";
import { COACH, CRYSTALLISE, MAX_LOCKS, reusedEvents, SHORT } from "./events";

/** A finger lock's piece forms over this long (fx/crystallise.ts); the lock opens when it has. */
export const CRYSTAL_MS = 700;
/** A finger hold's progress on the bus moves in steps of this (or to 0 or 1). */
const FINGER_EVENT_STEP = 0.1;
/** The coach line comes or goes only once that has held this long (no flicker at the edge of a lock's spot). */
export const COACH_HOLD_MS = 300;

/** The finger's shadow this frame, as the hand system casts it (panel, box units). */
export interface FingerSource {
  readonly finger: V2[][];
  readonly nFinger: number;
  /** Moves whenever the finger's shadow changed since the last frame (a still finger measures nothing). */
  readonly version: number;
  /** The fingers' depth (box z), NaN with no finger in the beam (the fingertip hum follows it). */
  readonly fingerZ: number;
  /** A hand that can cast the finger (one not holding the lantern) is in tracking. */
  readonly tracked: boolean;
  /** Controllers are in use (a finger lock then suggests setting one down). */
  readonly controllers: boolean;
  /** The depth of the finger whose shadow covers these gap points (box z): where the piece forms; NaN for none. */
  depthOver(gap: readonly V2[]): number;
  /** Where the casting fingertip is (world metres) into `out`; false with no finger in the beam. */
  tip(out: Vec3): boolean;
}

export type FingerLoopState = "idle" | "holding" | "done";

/** A finger lock's hold (the hand system's FingerLockLoop): FingerHold fed the solve rule with the finger. */
export interface FingerLoop {
  update(dtMs: number, coverage: Coverage, tracked: boolean): FingerLoopState;
  readonly state: FingerLoopState;
  readonly progress: number;
}

/** The finger lock's piece in the box: formed now (gold fill, then the piece), or put back at once (a resumed box). */
export interface CrystalSink {
  crystallise(lock: Lock, z: number): void;
  place(lock: Lock, z: number): void;
}

export interface FingerLocksDeps {
  fingers?: FingerSource;
  /** A finger lock's hold, one per finger lock per box (`onDone` runs once, when it completes). */
  makeFingerLoop?: (onDone: () => void) => FingerLoop;
  crystals?: CrystalSink;
  sound: Pick<GameSounds, "finger" | "crystallise">;
  emit: (e: FeedbackEvent) => void;
  /** The coach line's controller tip (on), or none (off). */
  coach?: (on: boolean) => void;
}

const NOOP = () => {};
const NO_POLYS: V2[][] = [];
/** A finger lock out of the lantern's range: nothing fills it. */
const ZERO: Readonly<Coverage> = Object.freeze({ cover: 0, spill: 0, spillAll: 0, gap: 0 });

/** The depth a piece hangs at in the generated box: where to form it when no finger depth is known. */
function pieceDepth(box: Box, lock: Lock): number {
  for (const e of box.elements) {
    if (e.kind === "piece" && e.lock === lock.i && e.piece === lock.missing) return e.verts.reduce((s, v) => s + v[2], 0) / e.verts.length;
  }
  return 0.5;
}

export class FingerLocks {
  private box: Box | null = null;
  private loops: (FingerLoop | null)[] = [];
  /** Each finger lock's gap: the sample points inside its missing piece (the finger over them forms the piece). */
  private gaps: V2[][] = [];
  private readonly short = new Uint8Array(MAX_LOCKS);
  /** The progress last sent on the bus, per lock. */
  private readonly sent = new Float64Array(MAX_LOCKS);
  private readonly events = reusedEvents().finger;
  /** The furthest hold this frame (the fingertip hum's glide). */
  private hold = 0;
  private fingerIn = false;
  private coachOn = false;
  /** How long the coach line has wanted to change. */
  private coachMs = 0;
  private readonly at: Vec3 = [0, 0, 0];

  constructor(private readonly d: FingerLocksDeps) {}

  /** This frame's finger shadow (none without the hand system): what the locks are measured with. */
  get polys(): V2[][] {
    return this.d.fingers ? this.d.fingers.finger : NO_POLYS;
  }

  get count(): number {
    return this.d.fingers ? this.d.fingers.nFinger : 0;
  }

  /** The finger shadow's change counter (0 without the hand system). */
  get version(): number {
    return this.d.fingers ? this.d.fingers.version : 0;
  }

  /** A finger lock's hold (null for a plain lock, or without the hand system). */
  loopOf(lock: number): FingerLoop | null {
    return this.loops[lock] ?? null;
  }

  /** A new box (`samples`: each lock's, as the session measures it): a hold for each finger lock; the hum and coach end. */
  setBox(box: Box, samples: readonly LockSamples[]): void {
    const make = this.d.makeFingerLoop;
    this.box = box;
    this.loops = box.locks.map((l) => (l.finger && make ? make(NOOP) : null));
    this.gaps = box.locks.map((l, i) => {
      const s = samples[i]!;
      return l.finger ? s.missingIdx.map((k) => s.inside[k]!) : [];
    });
    this.short.fill(0);
    this.sent.fill(0);
    this.quiet();
  }

  /** Play stopped (the box is opening, or another is coming): the fingertip hum and the coach line end. */
  quiet(): void {
    if (this.fingerIn) this.d.sound.finger(null);
    this.fingerIn = false;
    this.coachMs = 0;
    this.setCoach(false);
  }

  /** Before the locks, each frame. */
  begin(): void {
    this.hold = 0;
  }

  /**
   * One frame of finger lock `lock` with this frame's coverage (`near`: the lantern within warmth range of its spot).
   * Returns the depth its piece forms at on the frame its hold completes (the piece starts forming), else NaN.
   */
  update(lock: Lock, cov: Coverage, near: boolean, dt: number): number {
    const d = this.d, i = lock.i;
    const short = near && isShort(cov, true);
    if (short && !this.short[i]) d.emit(SHORT[i]!);
    this.short[i] = short ? 1 : 0;
    const loop = this.loops[i], f = d.fingers;
    if (!loop || !f) return Number.NaN;
    const state = loop.update(dt, near ? cov : ZERO, f.tracked);
    const p = loop.progress, sent = this.sent[i]!;
    if (p > this.hold) this.hold = p;
    if (p !== sent && (Math.abs(p - sent) >= FINGER_EVENT_STEP || p === 0 || p === 1)) {
      this.sent[i] = p;
      const e = this.events[i]!;
      e.progress = p;
      d.emit(e);
    }
    if (state !== "done") return Number.NaN;
    this.short[i] = 0;
    // At the depth of the hand whose finger fills the gap (with two hands in the mouth, not their mean).
    const over = f.depthOver(this.gaps[i]!);
    const z = Number.isFinite(over) ? over : pieceDepth(this.box!, lock);
    d.crystals?.crystallise(lock, z);
    d.emit(CRYSTALLISE[i]!);
    d.sound.crystallise(i);
    return z;
  }

  /** A formed piece put back at once (a resumed box). */
  place(lock: Lock, z: number): void {
    this.d.crystals?.place(lock, z);
  }

  /**
   * After the locks (`dt`: this frame's ms): the fingertip hum while a finger is in the beam (toward the panel, through
   * the hold, at the fingertip), off when it leaves; the coach line while a finger lock is one piece short and
   * controllers are in use, coming and going after COACH_HOLD_MS.
   */
  end(dt: number): void {
    const f = this.d.fingers;
    if (f && f.nFinger > 0) {
      this.d.sound.finger(1 - Math.min(1, Math.max(0, f.fingerZ)), this.hold, f.tip(this.at) ? this.at : undefined);
      this.fingerIn = true;
    } else if (this.fingerIn) {
      this.d.sound.finger(null);
      this.fingerIn = false;
    }
    let short = false;
    for (let i = 0; i < MAX_LOCKS; i++) if (this.short[i]) short = true;
    const want = short && !!f && f.controllers;
    if (want === this.coachOn) this.coachMs = 0;
    else if ((this.coachMs += dt) >= COACH_HOLD_MS - 1e-6) {
      this.coachMs = 0;
      this.setCoach(want);
    }
  }

  private setCoach(on: boolean): void {
    if (on === this.coachOn) return;
    this.coachOn = on;
    this.d.emit(COACH[on ? 1 : 0]);
    this.d.coach?.(on);
  }
}
