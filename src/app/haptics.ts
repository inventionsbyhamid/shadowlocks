// Controller haptics (WebXR gamepad.hapticActuators[0].pulse): the grab tick, dial ticks, the rings'
// double tap, the settle snap, the lock-open thud and the box-open roll. Tracked hands have no
// actuator, so every pulse is then a silent no-op (the hands get their feedback from light and
// sound). Patterns with more than one pulse are stepped by update() on the frame clock, so a
// frame-stepped run pulses at the same frames every time (and a pattern pauses while the game is
// hidden, when that clock stops). Allocation free per frame. The game's sounds ask for patterns by
// name (GameSounds' HapticSink), so the audio code never imports this file.
import type { Hand, HapticName, HapticSink } from "../audio/cues";
import { clamp01 } from "../core/clamp";

export type { Hand };

/** One pulse of a pattern: `at` ms after the pattern starts, `intensity` 0..1, for `ms`. */
export interface HapticPulse {
  readonly at: number;
  readonly intensity: number;
  readonly ms: number;
}
export type HapticPattern = readonly HapticPulse[];

const one = (intensity: number, ms: number): HapticPattern => [{ at: 0, intensity, ms }];

/** Six pulses rising from 0.2 to 0.8 over 600 ms. */
const BOX_OPEN_PULSES = 6;
const boxOpen: HapticPattern = Array.from({ length: BOX_OPEN_PULSES }, (_, i) => ({
  at: (600 * i) / (BOX_OPEN_PULSES - 1),
  intensity: 0.2 + (0.6 * i) / (BOX_OPEN_PULSES - 1),
  ms: 40,
}));

/** The patterns (spec "Feedback: warmth, sound, haptics"; sound design 2.4 for when they land). */
export const HAPTICS = {
  grab: one(0.3, 20),
  tick: one(0.15, 10),
  ring: [
    { at: 0, intensity: 0.4, ms: 15 },
    { at: 80, intensity: 0.4, ms: 15 },
  ],
  settle: one(0.6, 30),
  lockOpen: one(1, 60),
  boxOpen,
} as const satisfies Record<HapticName, HapticPattern>;

/** The parts of an XR input source haptics read (WebXR types vary across browsers and TS versions). */
export interface HapticSource {
  readonly handedness: string;
  readonly gamepad?: {
    readonly hapticActuators?: ArrayLike<{ pulse?: (value: number, duration: number) => unknown } | undefined>;
  } | null;
}

/** The XR session's input sources, or none. */
export interface HapticSession {
  readonly inputSources: ArrayLike<HapticSource>;
}

const QUEUE = 32;
const ignore = (): void => {};

interface Pending {
  live: boolean;
  due: number;
  hand: Hand | "both";
  intensity: number;
  ms: number;
}

export class Haptics implements HapticSink {
  private readonly queue: Pending[] = Array.from({ length: QUEUE }, () => ({ live: false, due: 0, hand: "right" as const, intensity: 0, ms: 0 }));
  /** How many of the queue's pulses are live (none: a frame has nothing to look at). */
  private pending = 0;

  constructor(
    private readonly session: () => HapticSession | null | undefined,
    /** The frame clock (ms). */
    private readonly now: () => number,
  ) {}

  /** One pulse on `hand`'s controller now; nothing when that hand has no actuator. */
  pulse(hand: Hand, intensity: number, ms: number): void {
    const sources = this.session()?.inputSources;
    if (!sources) return;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      if (!s || s.handedness !== hand) continue;
      const act = s.gamepad?.hapticActuators?.[0];
      const fn = act?.pulse;
      if (typeof fn !== "function") continue;
      const v = clamp01(intensity);
      try {
        const r = fn.call(act, v, ms > 0 ? ms : 0);
        // A refused pulse (the device said no) is not worth an error.
        if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(ignore);
      } catch {
        // Same: a pulse is never worth breaking a frame.
      }
    }
  }

  /** Play `pattern` (or the one named) on one hand or both, starting `offsetMs` from now. */
  play(hand: Hand | "both", pattern: HapticPattern | HapticName, offsetMs = 0): void {
    const t = this.now();
    for (const p of typeof pattern === "string" ? HAPTICS[pattern] : pattern) {
      const at = offsetMs + p.at;
      if (at <= 0) this.fire(hand, p.intensity, p.ms);
      else this.later(t + at, hand, p.intensity, p.ms);
    }
  }

  /** Per frame: the pulses whose time has come. */
  update(): void {
    if (this.pending === 0) return;
    const t = this.now();
    for (let i = 0; i < QUEUE; i++) {
      const p = this.queue[i]!;
      if (!p.live || p.due > t) continue;
      p.live = false;
      this.pending--;
      this.fire(p.hand, p.intensity, p.ms);
    }
  }

  /** Drop the pulses still to come (play ended). */
  clear(): void {
    for (const p of this.queue) p.live = false;
    this.pending = 0;
  }

  private fire(hand: Hand | "both", intensity: number, ms: number): void {
    if (hand !== "right") this.pulse("left", intensity, ms);
    if (hand !== "left") this.pulse("right", intensity, ms);
  }

  private later(due: number, hand: Hand | "both", intensity: number, ms: number): void {
    const p = this.queue.find((x) => !x.live);
    // Full (never in play: a pattern is a few pulses): this one is dropped.
    if (!p) return;
    p.live = true;
    this.pending++;
    p.due = due;
    p.hand = hand;
    p.intensity = intensity;
    p.ms = ms;
  }
}
