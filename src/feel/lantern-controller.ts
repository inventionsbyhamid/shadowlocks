import {
  ASSIST_DWELL_MS,
  DIAL_TICKS_CM,
  GRAB_RADIUS_CM,
  LINE_BREAK_CM,
  LINE_SIDEWAYS_GAIN,
  MAX_STEP_MS,
  RELEASE_LOOKBACK_MS,
  SETTLE_EASE_MS,
  SETTLE_RADIUS,
  SETTLE_RELEASE_MULT,
  SPEED_FILTER_MS,
  SPEED_GATE_CMPS,
  SPEED_GATE_MS,
  SPRING_OMEGA,
  TICK_REARM_CM,
} from "./constants";
import type { V3 } from "../core/types";

/** One frame of the holding hand, in box units. */
export interface LanternInput {
  tMs: number;
  pinching: boolean;
  /** The pinch point; null while the hand is out of tracking (then nothing changes). */
  pinchPos: V3 | null;
}

/** Where the lantern opens a lock. */
export interface Spot {
  lock: number;
  L: V3;
  open: boolean;
}

/** A lock's ring line, through `mark` along `dir` (any length); `aligned` while the ring shadows nest on the mark. */
export interface RingLine {
  lock: number;
  mark: V3;
  dir: V3;
  aligned: boolean;
}

export interface LanternCtx {
  spots: Spot[];
  lines: RingLine[];
  cmPerUnit: number;
  /**
   * When given, the held lantern never goes below this z (box units): the hand's target, the line-carried target and
   * the lantern itself are held at it (the game passes LANTERN_MIN_Z, the box's open front). `place` does not clamp.
   */
  minZ?: number;
}

/**
 * What the lantern did, for sound, haptics and visuals. `line` on and off always pair up (a release or `place`
 * ends a line lock with an off). `unsettle` means a settle ended unconfirmed: the hand pulled free, or `place`
 * moved the lantern. A release while settled confirms the settle and sends only `release`.
 *
 * POOLED: the event objects `drain` hands out are reused by the controller. Read them before its next `update`
 * or `place`, and copy any you keep or pass on (a queue, a deferred bus, a log).
 */
export type FeelEvent =
  | { type: "grab" }
  | { type: "release" }
  | { type: "line"; lock: number; on: boolean }
  | { type: "settle"; lock: number }
  | { type: "unsettle"; lock: number }
  | { type: "tick"; lock: number; cm: number };

export type LanternMode = "free" | "line" | "settled";

/** Events kept between drains; more than a frame can make (at most about ten). */
const EVENT_CAP = 32;
/** Release lookback samples, one per held frame: 150 ms of frames at up to ~400 Hz. */
const HIST_CAP = 64;
/** Float slack for timers that add up frame times (54 frames of 1000/90 ms are 600 ms give or take 1e-13). */
const EPS_MS = 1e-6;

/** A pooled event: one shape for every type; the fields a type does not use are undefined. */
interface EventSlot {
  type: FeelEvent["type"];
  lock?: number;
  on?: boolean;
  cm?: number;
}

function zero(a: V3): void {
  a[0] = 0;
  a[1] = 0;
  a[2] = 0;
}

function copy(to: V3, from: Readonly<V3>): void {
  to[0] = from[0];
  to[1] = from[1];
  to[2] = from[2];
}

function len(a: Readonly<V3>): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

function dist(a: Readonly<V3>, b: Readonly<V3>): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return Math.sqrt(x * x + y * y + z * z);
}

/** Distance from `p` to the line through `a` along the unit vector `d`. */
function offLine(p: Readonly<V3>, a: Readonly<V3>, d: Readonly<V3>): number {
  const x = p[0] - a[0];
  const y = p[1] - a[1];
  const z = p[2] - a[2];
  const t = x * d[0] + y * d[1] + z * d[2];
  const sx = x - t * d[0];
  const sy = y - t * d[1];
  const sz = z - t * d[2];
  return Math.sqrt(sx * sx + sy * sy + sz * sz);
}

function isOpen(spots: Spot[], lock: number): boolean {
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]!;
    if (s.lock === lock && s.open) return true;
  }
  return false;
}

/**
 * Moves a critically damped spring (x, v) toward `target` over `dtS` seconds, with the target held for the step.
 * This is the closed-form solution, not an integrator: stable for any step, and the same path at any frame rate.
 */
function spring(x: V3, v: V3, target: Readonly<V3>, dtS: number): void {
  if (!(dtS > 0)) return;
  const w = SPRING_OMEGA;
  const decay = Math.exp(-w * dtS);
  for (let i = 0; i < 3; i++) {
    const e = x[i]! - target[i]!;
    const c = v[i]! + w * e;
    x[i] = target[i]! + (e + c * dtS) * decay;
    v[i] = (v[i]! - w * c * dtS) * decay;
  }
}

/**
 * The held lantern's feel, driven only by time and hand positions (no scene, no allocation per frame).
 *
 * While pinched it follows the hand on a critically damped spring, keeping the offset it was grabbed at. Speeds
 * and distances are measured on the "smoothed hand": the hand target on that same spring with no assist. The
 * assists (ring line lock, settle onto a spot) engage only once the hand is deliberate (its smoothed velocity,
 * low-passed as a vector, has stayed under SPEED_GATE_CMPS for SPEED_GATE_MS) and its target has held for
 * ASSIST_DWELL_MS (inside the settle radius of the same spot, or the same line the nearest aligned one), which
 * outlasts the gate's lag at the start of a fast move. On release the lantern goes back to where it was
 * RELEASE_LOOKBACK_MS before the pinch opened (or exactly onto the spot when settled) and floats.
 */
export class LanternController {
  /** Where the lantern is, in box units; updated in place. */
  readonly pos: V3;

  private isHeld = false;
  private wasPinching = false;
  private lastT = Number.NaN;
  /** `place` while held: hold on from wherever the hand is next. */
  private regrip = false;

  /** Lantern spring velocity (units/s). */
  private readonly vel: V3 = [0, 0, 0];
  /** Lantern minus pinch point at the grab, so the lantern never jumps to the fingers. */
  private readonly grip: V3 = [0, 0, 0];
  /** This frame's hand target: pinch point plus grip. */
  private readonly raw: V3 = [0, 0, 0];
  /** The smoothed hand: `raw` on the lantern's spring with no assist. */
  private readonly hand: V3 = [0, 0, 0];
  private readonly handVel: V3 = [0, 0, 0];
  /** `handVel` low-passed as a vector over SPEED_FILTER_MS: what the speed gate reads. */
  private readonly gateVel: V3 = [0, 0, 0];
  /** How long the gate speed has stayed under SPEED_GATE_CMPS. */
  private slowMs = 0;
  /** Dwell: the lock whose line has been the nearest aligned one, and for how long. */
  private lineCand: number | null = null;
  private lineCandMs = 0;
  /** Dwell: the spot whose settle radius the smoothed hand has stayed inside, and for how long. */
  private insideLock: number | null = null;
  private insideMs = 0;

  private lineOn = false;
  private lineLock = 0;
  /** Unit direction of the ridden line. */
  private readonly lineDir: V3 = [0, 0, 1];
  /** The smoothed hand when the line lock engaged; the ridden line runs through it. */
  private readonly lineAnchor: V3 = [0, 0, 0];

  private isSettled = false;
  private settleLock = 0;
  private readonly settleSpot: V3 = [0, 0, 0];
  private readonly easeFrom: V3 = [0, 0, 0];
  private easeMs = 0;

  /** Ring of [t, x, y, z] lantern samples while held, for the release lookback. */
  private readonly hist = new Float64Array(HIST_CAP * 4);
  private histNext = 0;
  private histLen = 0;

  /** The spot the dial ticks count toward, and which thresholds may still tick. */
  private tickLock: number | null = null;
  private ticksStale = true;
  private readonly armed: boolean[] = DIAL_TICKS_CM.map(() => false);

  private readonly slots: EventSlot[] = [];
  private nEvents = 0;

  /** Scratch: the smoothed hand as the assists see it, and the spring's target. */
  private readonly ctrl: V3 = [0, 0, 0];
  private readonly target: V3 = [0, 0, 0];

  constructor(start: V3) {
    this.pos = [start[0], start[1], start[2]];
    for (let i = 0; i < EVENT_CAP; i++) this.slots.push({ type: "grab", lock: undefined, on: undefined, cm: undefined });
  }

  get held(): boolean {
    return this.isHeld;
  }

  get mode(): LanternMode {
    return this.isSettled ? "settled" : this.lineOn ? "line" : "free";
  }

  /** The lock of the active assist (settle first, then line), or null when free. */
  get lock(): number | null {
    return this.isSettled ? this.settleLock : this.lineOn ? this.lineLock : null;
  }

  /** A pinch at `p` would grab the lantern. */
  canGrab(p: V3, cmPerUnit: number): boolean {
    return dist(p, this.pos) * cmPerUnit <= GRAB_RADIUS_CM;
  }

  update(inp: LanternInput, ctx: LanternCtx): void {
    let dtMs = inp.tMs - this.lastT;
    if (dtMs < 0) this.histLen = 0; // the clock went back: old lookback samples no longer line up
    dtMs = dtMs > 0 ? Math.min(dtMs, MAX_STEP_MS) : 0;
    this.lastT = inp.tMs;

    const p = inp.pinchPos;
    if (p === null || !(Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]))) {
      // Out of tracking (or a NaN joint): nothing changes. A held lantern stays held and stands still where it is
      // (its springs come to rest), and the lookback notes that it stood still.
      if (this.isHeld) {
        zero(this.vel);
        zero(this.handVel);
        this.record(inp.tMs);
      }
      return;
    }

    if (!this.isHeld) {
      if (inp.pinching && !this.wasPinching && this.canGrab(p, ctx.cmPerUnit)) this.grab(p, inp.tMs);
    } else if (!inp.pinching) {
      this.release(inp.tMs);
    } else {
      this.follow(p, dtMs, inp.tMs, ctx);
    }
    this.wasPinching = inp.pinching;
    this.updateTicks(ctx);
  }

  /** Puts the lantern at `p` (restoring a box, test hooks): ends any assist (line off, unsettle), no ticks. */
  place(p: V3): void {
    copy(this.pos, p);
    zero(this.vel);
    this.endLine();
    if (this.isSettled) {
      this.isSettled = false;
      this.emit("unsettle", this.settleLock);
    }
    this.resetDwell();
    this.histLen = 0;
    this.ticksStale = true;
    if (this.isHeld) this.regrip = true;
  }

  /**
   * Hands the events since the last drain to `out` (from index 0) and returns how many. The event objects are
   * pooled: read them before the next `update` or `place`, and copy any you keep.
   */
  drain(out: FeelEvent[]): number {
    const n = this.nEvents;
    for (let i = 0; i < n; i++) out[i] = this.slots[i]! as FeelEvent;
    this.nEvents = 0;
    return n;
  }

  private grab(p: V3, tMs: number): void {
    this.isHeld = true;
    this.takeGrip(p);
    this.record(tMs);
    this.emit("grab");
  }

  /** Hold the lantern from `p` as it stands: no jump, springs at rest, the speed gate and lookback start over. */
  private takeGrip(p: V3): void {
    for (let i = 0; i < 3; i++) {
      this.grip[i] = this.pos[i]! - p[i]!;
      this.hand[i] = this.pos[i]!;
    }
    zero(this.vel);
    zero(this.handVel);
    zero(this.gateVel);
    this.slowMs = 0;
    this.resetDwell();
    this.histLen = 0;
  }

  private resetDwell(): void {
    this.lineCand = null;
    this.lineCandMs = 0;
    this.insideLock = null;
    this.insideMs = 0;
  }

  private release(tMs: number): void {
    if (this.isSettled) copy(this.pos, this.settleSpot);
    else this.lookBack(tMs - RELEASE_LOOKBACK_MS);
    zero(this.vel);
    this.isSettled = false;
    this.resetDwell();
    this.endLine();
    this.isHeld = false;
    this.emit("release");
  }

  /** A held frame with the pinch at `p`. */
  private follow(p: V3, dtMs: number, tMs: number, ctx: LanternCtx): void {
    if (this.regrip) {
      this.regrip = false;
      this.takeGrip(p);
    }
    const cm = ctx.cmPerUnit;
    const dtS = dtMs / 1000;
    const minZ = ctx.minZ ?? -Infinity;
    for (let i = 0; i < 3; i++) this.raw[i] = p[i]! + this.grip[i]!;
    if (this.raw[2] < minZ) this.raw[2] = minZ;

    // The smoothed hand, and the speed gate on its velocity.
    spring(this.hand, this.handVel, this.raw, dtS);
    const k = 1 - Math.exp(-dtMs / SPEED_FILTER_MS);
    for (let i = 0; i < 3; i++) this.gateVel[i] = this.gateVel[i]! + k * (this.handVel[i]! - this.gateVel[i]!);
    this.slowMs = len(this.gateVel) * cm < SPEED_GATE_CMPS ? this.slowMs + dtMs : 0;
    const deliberate = this.slowMs >= SPEED_GATE_MS - EPS_MS;

    // Ring line: breaks when the hand pulls far enough off it; engages when deliberate on the line that has been
    // the nearest aligned one for the dwell.
    if (this.lineOn) {
      if (offLine(this.hand, this.lineAnchor, this.lineDir) * cm >= LINE_BREAK_CM) {
        this.endLine();
        this.slowMs = 0; // earn the gate again before anything catches the lantern
      }
    } else {
      const i = this.nearestLine(ctx);
      const lock = i < 0 ? null : ctx.lines[i]!.lock;
      this.lineCandMs = lock !== null && lock === this.lineCand ? this.lineCandMs + dtMs : 0;
      this.lineCand = lock;
      if (i >= 0 && deliberate && !this.isSettled && this.lineCandMs >= ASSIST_DWELL_MS - EPS_MS) {
        this.startLine(ctx.lines[i]!);
      }
    }

    // Settle, measured on the smoothed hand as the line lock carries it; engages when deliberate after the hand
    // has stayed inside the same spot's radius for the dwell.
    this.onLine(this.hand, this.ctrl);
    if (this.isSettled) {
      if (dist(this.ctrl, this.settleSpot) > SETTLE_RADIUS * SETTLE_RELEASE_MULT) {
        this.isSettled = false;
        this.emit("unsettle", this.settleLock);
      }
    } else {
      const i = this.nearestSpot(ctx.spots);
      const lock = i < 0 ? null : ctx.spots[i]!.lock;
      this.insideMs = lock !== null && lock === this.insideLock ? this.insideMs + dtMs : 0;
      this.insideLock = lock;
      if (i >= 0 && deliberate && this.insideMs >= ASSIST_DWELL_MS - EPS_MS) this.startSettle(ctx.spots[i]!);
    }

    if (this.isSettled) {
      this.easeMs += dtMs;
      if (this.easeMs >= SETTLE_EASE_MS) {
        copy(this.pos, this.settleSpot);
      } else {
        const s = this.easeMs / SETTLE_EASE_MS;
        const e = s * s * (3 - 2 * s);
        for (let i = 0; i < 3; i++) this.pos[i] = this.easeFrom[i]! + (this.settleSpot[i]! - this.easeFrom[i]!) * e;
      }
      zero(this.vel);
    } else {
      this.onLine(this.raw, this.target);
      if (this.target[2] < minZ) this.target[2] = minZ;
      spring(this.pos, this.vel, this.target, dtS);
      // A spring still moving inward can pass a target held at minZ: hold the lantern there too.
      if (this.pos[2] < minZ) {
        this.pos[2] = minZ;
        if (this.vel[2] < 0) this.vel[2] = 0;
      }
    }
    this.record(tMs);
  }

  /** `src` as the line lock carries it: along the line in full, across it scaled down. Plain copy when free. */
  private onLine(src: Readonly<V3>, out: V3): void {
    if (!this.lineOn) {
      copy(out, src);
      return;
    }
    const a = this.lineAnchor;
    const d = this.lineDir;
    const x = src[0] - a[0];
    const y = src[1] - a[1];
    const z = src[2] - a[2];
    const t = x * d[0] + y * d[1] + z * d[2];
    const g = LINE_SIDEWAYS_GAIN;
    out[0] = a[0] + t * d[0] + g * (x - t * d[0]);
    out[1] = a[1] + t * d[1] + g * (y - t * d[1]);
    out[2] = a[2] + t * d[2] + g * (z - t * d[2]);
  }

  /** Index of the aligned line (of a lock not yet open) nearest the smoothed hand, or -1. Only while no line is on. */
  private nearestLine(ctx: LanternCtx): number {
    const lines = ctx.lines;
    let best = -1;
    let bestOff = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const n = len(line.dir);
      if (!line.aligned || !(n > 0) || isOpen(ctx.spots, line.lock)) continue;
      for (let j = 0; j < 3; j++) this.lineDir[j] = line.dir[j]! / n; // scratch until a line engages
      const off = offLine(this.hand, line.mark, this.lineDir);
      if (off < bestOff) {
        bestOff = off;
        best = i;
      }
    }
    return best;
  }

  private startLine(line: RingLine): void {
    const n = len(line.dir);
    for (let j = 0; j < 3; j++) this.lineDir[j] = line.dir[j]! / n;
    copy(this.lineAnchor, this.hand);
    this.lineOn = true;
    this.lineLock = line.lock;
    this.lineCand = null;
    this.lineCandMs = 0;
    this.emit("line", line.lock, true);
  }

  private endLine(): void {
    if (!this.lineOn) return;
    this.lineOn = false;
    this.emit("line", this.lineLock, false);
  }

  /** Index of the nearest unopened spot within SETTLE_RADIUS of the smoothed hand (as carried), or -1. */
  private nearestSpot(spots: Spot[]): number {
    let best = -1;
    let bestD = SETTLE_RADIUS;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      if (s.open) continue;
      const d = dist(this.ctrl, s.L);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private startSettle(spot: Spot): void {
    this.isSettled = true;
    this.settleLock = spot.lock;
    copy(this.settleSpot, spot.L);
    copy(this.easeFrom, this.pos);
    this.easeMs = 0;
    this.insideLock = null;
    this.insideMs = 0;
    this.emit("settle", spot.lock);
  }

  private record(tMs: number): void {
    const o = this.histNext * 4;
    this.hist[o] = tMs;
    this.hist[o + 1] = this.pos[0];
    this.hist[o + 2] = this.pos[1];
    this.hist[o + 3] = this.pos[2];
    this.histNext = (this.histNext + 1) % HIST_CAP;
    if (this.histLen < HIST_CAP) this.histLen++;
  }

  /** Put the lantern where it was at time `t`: straight between samples, or the oldest if held for less. */
  private lookBack(t: number): void {
    const h = this.hist;
    let newer = -1;
    for (let k = 1; k <= this.histLen; k++) {
      const o = ((this.histNext - k + HIST_CAP) % HIST_CAP) * 4;
      const ti = h[o]!;
      if (ti <= t) {
        if (newer < 0) {
          for (let i = 0; i < 3; i++) this.pos[i] = h[o + 1 + i]!;
        } else {
          const f = (t - ti) / (h[newer]! - ti);
          for (let i = 0; i < 3; i++) this.pos[i] = h[o + 1 + i]! + (h[newer + 1 + i]! - h[o + 1 + i]!) * f;
        }
        return;
      }
      newer = o;
    }
    if (newer >= 0) for (let i = 0; i < 3; i++) this.pos[i] = h[newer + 1 + i]!;
  }

  /** One dial tick per DIAL_TICKS_CM threshold crossed toward the nearest unopened spot, re-armed past it. */
  private updateTicks(ctx: LanternCtx): void {
    const spots = ctx.spots;
    let lock: number | null = null;
    let d = Infinity;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      if (s.open) continue;
      const di = dist(this.pos, s.L);
      if (di < d) {
        d = di;
        lock = s.lock;
      }
    }
    if (lock === null) {
      this.tickLock = null;
      return;
    }
    const dCm = d * ctx.cmPerUnit;
    // A new nearest spot (or a placed lantern) starts from where the lantern is: no ticks for the switch.
    const fresh = this.ticksStale || lock !== this.tickLock;
    this.ticksStale = false;
    this.tickLock = lock;
    for (let i = 0; i < DIAL_TICKS_CM.length; i++) {
      const at = DIAL_TICKS_CM[i]!;
      if (fresh) {
        this.armed[i] = dCm > at;
      } else if (this.armed[i]) {
        if (dCm <= at) {
          this.armed[i] = false;
          this.emit("tick", lock, undefined, at);
        }
      } else if (dCm > at + TICK_REARM_CM) {
        this.armed[i] = true;
      }
    }
  }

  private emit(type: FeelEvent["type"], lock?: number, on?: boolean, cm?: number): void {
    if (this.nEvents >= EVENT_CAP) return; // nobody is draining
    const s = this.slots[this.nEvents++]!;
    s.type = type;
    s.lock = lock;
    s.on = on;
    s.cm = cm;
  }
}
