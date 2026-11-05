import { describe, expect, it } from "vitest";
import { SETTLE_RADIUS, SPRING_OMEGA } from "../../src/feel/constants";
import {
  LanternController,
  type FeelEvent,
  type LanternCtx,
  type RingLine,
  type Spot,
} from "../../src/feel/lantern-controller";
import type { V3 } from "../../src/feel/types";

/** Centimetres per box unit (a 24 cm box). */
const CM = 24;
const u = (cm: number): number => cm / CM;

const add = (a: Readonly<V3>, b: Readonly<V3>, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Readonly<V3>, b: Readonly<V3>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Readonly<V3>, b: Readonly<V3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: Readonly<V3>, b: Readonly<V3>): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const norm = (a: Readonly<V3>): V3 => add([0, 0, 0], a, 1 / Math.hypot(a[0], a[1], a[2]));
const cross = (a: Readonly<V3>, b: Readonly<V3>): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Deterministic noise in [-1, 1]. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}

const ctxOf = (spots: Spot[] = [], lines: RingLine[] = []): LanternCtx => ({ spots, lines, cmPerUnit: CM });

/**
 * Drives one controller frame by frame (90 Hz unless told otherwise) with a scripted hand, keeping every
 * event (copied) and every mode it went through.
 */
class Rig {
  readonly c: LanternController;
  readonly dt: number;
  t = 0;
  hand: V3;
  readonly events: FeelEvent[] = [];
  readonly modes = new Set<string>();
  /** The scripted hand at each frame (before jitter). */
  readonly log: { t: number; hand: V3 }[] = [];
  /** Called after every frame. */
  watch: (() => void) | null = null;
  private readonly out: FeelEvent[] = [];
  private readonly rnd: () => number;
  private readonly jitter: number;

  constructor(
    start: V3,
    readonly ctx: LanternCtx,
    opts: { hz?: number; jitterMm?: number; seed?: number } = {},
  ) {
    this.c = new LanternController([...start]);
    this.hand = [...start];
    this.dt = 1000 / (opts.hz ?? 90);
    this.jitter = u((opts.jitterMm ?? 0) / 10);
    this.rnd = noise(opts.seed ?? 1);
  }

  /** One frame: the hand pinching (or not) where it is, or out of tracking. */
  frame(pinching: boolean, tracked = true): void {
    this.t += this.dt;
    const j = this.jitter;
    const h = this.hand;
    const p: V3 | null = tracked ? [h[0] + j * this.rnd(), h[1] + j * this.rnd(), h[2] + j * this.rnd()] : null;
    this.log.push({ t: this.t, hand: [...h] });
    this.c.update({ tMs: this.t, pinching, pinchPos: p }, this.ctx);
    const n = this.c.drain(this.out);
    for (let i = 0; i < n; i++) this.events.push({ ...this.out[i]! });
    this.modes.add(this.c.mode);
    this.watch?.();
  }

  /** Pinch where the hand is (the pinch starts on the second frame). */
  grab(): void {
    this.frame(false);
    this.frame(true);
  }

  hold(ms: number): void {
    for (let i = Math.round(ms / this.dt); i > 0; i--) this.frame(true);
  }

  /** Move the pinching hand in a straight line to `to` at `cmps`. */
  moveTo(to: V3, cmps: number): void {
    const from: V3 = [...this.hand];
    const n = Math.max(1, Math.ceil((dist(from, to) * CM) / cmps / (this.dt / 1000)));
    for (let i = 1; i <= n; i++) {
      this.hand = add(from, sub(to, from), i / n);
      this.frame(true);
    }
  }

  moveBy(d: V3, cmps: number): void {
    this.moveTo(add(this.hand, d), cmps);
  }

  /** Open the pinch where the hand is. */
  release(): void {
    this.frame(false);
  }

  /** Where the scripted hand was at time `t` (straight between frames). */
  handAt(t: number): V3 {
    const i = this.log.findIndex((e) => e.t >= t);
    const b = this.log[i]!;
    const a = this.log[i - 1]!;
    return add(a.hand, sub(b.hand, a.hand), (t - a.t) / (b.t - a.t));
  }

  of<T extends FeelEvent["type"]>(type: T): Extract<FeelEvent, { type: T }>[] {
    return this.events.filter((e): e is Extract<FeelEvent, { type: T }> => e.type === type);
  }
}

/** A ring line that is not along any axis, a lantern on it, and a direction square to it. */
function ringLine() {
  const mark: V3 = [0.05, 0.02, 0];
  const dir: V3 = [0.3, -0.2, 1];
  const along = norm(dir);
  const side = norm(cross(along, [0, 1, 0]));
  const line: RingLine = { lock: 1, mark, dir, aligned: true };
  return { line, along, side, start: add(mark, along, 0.6) };
}

describe("LanternController", () => {
  it("spring follows without overshoot", () => {
    const r = new Rig([0, 0, 0.6], ctxOf());
    r.grab();
    r.hold(200);
    expect(r.c.pos).toEqual([0, 0, 0.6]);
    const step = u(10);
    r.hand = [step, 0, 0.6];
    const seen = r.t + r.dt; // the first frame that sees the hand 10 cm away
    let at80 = -1;
    let furthest = -Infinity;
    while (r.t < seen + 1000) {
      r.frame(true);
      if (r.t - seen <= 80) at80 = r.c.pos[0] / step;
      furthest = Math.max(furthest, r.c.pos[0]);
    }
    expect(at80).toBeGreaterThanOrEqual(0.6);
    expect(furthest).toBeLessThanOrEqual(step);
    expect(r.c.pos[0]).toBeCloseTo(step, 9);
  });

  it("spring is the same at 72, 90 and 120 Hz", () => {
    const t = 1 / 6; // a whole number of frames at each rate
    const exact = 1 - (1 + SPRING_OMEGA * t) * Math.exp(-SPRING_OMEGA * t);
    for (const hz of [72, 90, 120]) {
      const r = new Rig([0, 0, 0.6], ctxOf(), { hz });
      r.grab();
      r.hold(100);
      r.hand = [u(10), 0, 0.6];
      for (let i = 0; i < hz / 6; i++) {
        r.frame(true);
        expect(r.c.pos[0]).toBeLessThanOrEqual(u(10));
      }
      expect(r.c.pos[0] / u(10)).toBeCloseTo(exact, 9);
    }
  });

  it("release drift is undone", () => {
    const r = new Rig([0, -0.1, 0.6], ctxOf());
    r.grab();
    r.moveBy([u(4), 0, u(-2)], 3);
    r.hold(200);
    r.moveBy([u(0.7), u(-0.9), u(0.3)], 12); // the pinch opening drags the point 1.2 cm in 100 ms
    r.release();
    const before = r.handAt(r.t - 150);
    expect(dist(r.hand, before) * CM).toBeGreaterThan(1.1);
    expect(dist(r.c.pos, before) * CM).toBeLessThan(0.2);
    expect(r.c.held).toBe(false);
    expect(r.events.map((e) => e.type)).toEqual(["grab", "release"]);
  });

  it("fast sweep never settles", () => {
    const spot: Spot = { lock: 0, L: [0.05, -0.1, 0.55], open: false };
    const r = new Rig(add(spot.L, [u(-4), 0, 0]), ctxOf([spot]));
    let closest = Infinity;
    r.watch = () => (closest = Math.min(closest, dist(r.c.pos, spot.L)));
    r.grab();
    r.hold(300); // deliberate, 4 cm from the spot
    r.moveTo(add(spot.L, [u(10), 0, 0]), 20);
    r.moveTo(add(spot.L, [u(-10), 0, 0]), 20);
    r.hold(300);
    expect(closest * CM).toBeLessThan(0.3); // it really went through the spot
    expect(r.modes.has("settled")).toBe(false);
    expect(r.of("settle")).toEqual([]);
  });

  it("slow approach settles exactly", () => {
    const spot: Spot = { lock: 2, L: [0.1234, -0.0567, 0.6789], open: false };
    const r = new Rig(add(spot.L, [u(6), u(-3), u(2)]), ctxOf([spot]));
    let settledAt = -1;
    r.watch = () => {
      if (settledAt < 0 && r.c.mode === "settled") settledAt = dist(r.hand, spot.L) * CM;
    };
    r.grab();
    r.moveTo(spot.L, 2);
    r.hold(300);
    expect(settledAt).toBeGreaterThan(1.5);
    expect(settledAt).toBeLessThanOrEqual(SETTLE_RADIUS * CM);
    expect(r.c.mode).toBe("settled");
    expect(r.c.lock).toBe(2);
    expect(r.c.pos).toEqual(spot.L);
    r.moveBy([u(0.8), u(0.9), 0], 12); // the opening drift
    r.release();
    expect(r.c.pos).toEqual(spot.L);
    expect(r.c.held).toBe(false);
    expect(r.c.mode).toBe("free");
    expect(r.events.filter((e) => e.type !== "tick")).toEqual([
      { type: "grab" },
      { type: "settle", lock: 2 },
      { type: "release" },
    ]);
  });

  it("line lock damps sideways motion", () => {
    const { line, along, side, start } = ringLine();
    const r = new Rig(start, ctxOf([], [line]));
    r.grab();
    r.hold(300);
    expect(r.c.mode).toBe("line");
    expect(r.c.lock).toBe(1);
    expect(r.of("line")).toEqual([{ type: "line", lock: 1, on: true }]);
    const p0: V3 = [...r.c.pos];
    r.moveBy(add([0, 0, 0], side, u(1)), 2);
    r.hold(400);
    const d1 = sub(r.c.pos, p0);
    expect(dot(d1, side) * CM).toBeCloseTo(0.2, 3);
    expect(dot(d1, along) * CM).toBeCloseTo(0, 3);
    r.moveBy(add([0, 0, 0], along, u(1)), 2); // along the line it rides at full speed
    r.hold(400);
    const d2 = sub(r.c.pos, p0);
    expect(dot(d2, along) * CM).toBeCloseTo(1, 3);
    expect(dot(d2, side) * CM).toBeCloseTo(0.2, 3);
    expect(r.c.mode).toBe("line");
  });

  it("line lock breaks at 4 cm", () => {
    const { line, side, start } = ringLine();
    const r = new Rig(start, ctxOf([], [line]));
    r.grab();
    r.hold(300);
    expect(r.c.mode).toBe("line");
    r.moveTo(add(start, side, u(3.9)), 2);
    r.hold(400);
    expect(r.c.mode).toBe("line");
    expect(dist(r.c.pos, start) * CM).toBeCloseTo(0.78, 3);
    r.moveTo(add(start, side, u(4.1)), 2);
    r.hold(100);
    expect(r.c.mode).toBe("free");
    expect(r.c.lock).toBeNull();
    expect(r.of("line")).toEqual([
      { type: "line", lock: 1, on: true },
      { type: "line", lock: 1, on: false },
    ]);
    line.aligned = false; // the lantern has left the line
    r.hold(500);
    expect(dist(r.c.pos, r.hand) * CM).toBeLessThan(0.01); // free again: back with the hand
  });

  it("ticks 4 3 2 1 once each", () => {
    const spot: Spot = { lock: 0, L: [-0.05, -0.12, 0.5], open: false };
    const at = (cm: number): V3 => add(spot.L, [u(cm), 0, 0]);
    const r = new Rig(at(6), ctxOf([spot]));
    const ticks = () => r.of("tick").map((e) => e.cm);
    r.grab();
    r.moveTo(at(3.7), 10);
    r.hold(300);
    r.moveTo(at(4.3), 10); // back out, but not 0.5 cm past 4 cm: not re-armed
    r.hold(300);
    r.moveTo(at(0), 10);
    r.hold(500);
    expect(ticks()).toEqual([4, 3, 2, 1]);
    expect(r.of("tick").every((e) => e.lock === 0)).toBe(true);
    r.moveTo(at(4.7), 10); // past 4.5 cm: every threshold re-arms
    r.hold(500);
    r.moveTo(at(3.8), 10);
    r.hold(300);
    expect(ticks()).toEqual([4, 3, 2, 1, 4]);
  });

  it("tracking lost keeps the lantern", () => {
    const r = new Rig([0, -0.1, 0.6], ctxOf());
    r.grab();
    r.moveBy([u(3), 0, 0], 6); // still moving when tracking drops
    const kept: V3 = [...r.c.pos];
    const seen = r.events.length;
    for (let i = 0; i < 45; i++) {
      r.frame(i % 2 === 0, false);
      expect(r.c.pos).toEqual(kept);
    }
    expect(r.c.held).toBe(true);
    expect(r.c.mode).toBe("free");
    expect(r.events.length).toBe(seen);
    r.hand = [...kept]; // back in view, letting go where the lantern stands
    r.release();
    expect(r.c.pos).toEqual(kept);
    expect(r.events.map((e) => e.type)).toEqual(["grab", "release"]);
  });

  it("3 mm of hand jitter neither blocks nor fakes the speed gate", () => {
    const spot: Spot = { lock: 0, L: [0, -0.1, 0.5], open: false };
    // A still hand 1.5 cm from the spot, shaking up to 3 mm on each axis every frame: it settles.
    const still = new Rig(add(spot.L, [u(1.5), 0, 0]), ctxOf([spot]), { jitterMm: 3, seed: 3 });
    still.grab();
    still.hold(1000);
    expect(still.c.mode).toBe("settled");
    still.release();
    expect(still.c.pos).toEqual(spot.L);
    // Sweeps at 15 to 30 cm/s back and forth through the spot, with the same jitter: never.
    const sweep = new Rig(add(spot.L, [u(-8), 0, 0]), ctxOf([spot]), { jitterMm: 3, seed: 4 });
    sweep.grab();
    for (const cmps of [15, 20, 30, 15, 25]) {
      sweep.moveTo(add(spot.L, [u(8), u(0.5), 0]), cmps);
      sweep.moveTo(add(spot.L, [u(-8), u(-0.5), 0]), cmps);
    }
    expect(sweep.modes.has("settled")).toBe(false);
  });
});
