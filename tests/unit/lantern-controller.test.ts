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
  it("spring follows without overshoot, trailing a moving hand by 80 ms (2 / omega)", () => {
    // A 10 cm step: the lantern chases it from the frame before the one that sees it (each frame chases the
    // position it is given over the whole frame). At 80 ms of chase a critically damped spring at omega 25 is at
    // 59.4%; the last 90 Hz frame inside 80 ms (77.8 ms) is at 57.9%.
    const r = new Rig([0, 0, 0.6], ctxOf());
    r.grab();
    r.hold(200);
    expect(r.c.pos).toEqual([0, 0, 0.6]);
    const step = u(10);
    r.hand = [step, 0, 0.6];
    const chaseFrom = r.t; // = (the first frame that sees the hand 10 cm away) - dt
    let by80 = -1;
    let furthest = -Infinity;
    while (r.t < chaseFrom + 1000) {
      r.frame(true);
      if (r.t - chaseFrom <= 80) by80 = r.c.pos[0] / step;
      furthest = Math.max(furthest, r.c.pos[0]);
    }
    expect(by80).toBeGreaterThanOrEqual(0.57);
    expect(furthest).toBeLessThanOrEqual(step);
    expect(r.c.pos[0]).toBeCloseTo(step, 9);

    // A hand moving steadily at 10 cm/s: the lantern trails it by 2 / omega = 80 ms, 0.8 cm (less half a frame,
    // since each frame chases where the hand is at its end).
    const m = new Rig([0, 0, 0.6], ctxOf());
    m.grab();
    for (let k = 1; k <= 90; k++) {
      m.hand = [u((10 * k * m.dt) / 1000), 0, 0.6];
      m.frame(true);
    }
    const lagCm = (m.hand[0] - m.c.pos[0]) * CM;
    expect(Math.abs(lagCm - 10 * (2 / SPRING_OMEGA - m.dt / 2000))).toBeLessThan(0.01);
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

  it("a deliberate rest just outside the radius, then a fast sweep through, never settles", () => {
    const spot: Spot = { lock: 0, L: [0.05, -0.1, 0.55], open: false };
    for (const restCm of [2.45, 2.6, 2.8, 3.0]) {
      for (const cmps of [15, 20, 30]) {
        const r = new Rig(add(spot.L, [u(-restCm), 0, 0]), ctxOf([spot]));
        r.grab();
        r.hold(300); // deliberate, the settle radius (2.4 cm) only just ahead
        r.moveTo(add(spot.L, [u(8), 0, 0]), cmps);
        r.hold(300);
        expect(r.modes.has("settled"), `rest ${restCm} cm, sweep ${cmps} cm/s`).toBe(false);
      }
    }
  });

  it("a deliberate rest beside a ring line, then a fast flick across it, never locks", () => {
    for (const restCm of [2.45, 2.6, 2.8, 3.0]) {
      for (const cmps of [15, 20, 30]) {
        const { line, along, side, start } = ringLine();
        line.aligned = false;
        const r = new Rig(add(start, side, u(restCm)), ctxOf([], [line]));
        // Aligned while the lantern is near the line, with hysteresis like the ring check: a wide band, as when
        // the rings hang close to the panel.
        r.watch = () => {
          const d = sub(r.c.pos, start);
          const off = Math.hypot(...sub(d, add([0, 0, 0], along, dot(d, along)))) * CM;
          line.aligned = line.aligned ? off <= 3.45 : off <= 2.3;
        };
        r.grab();
        r.hold(300);
        r.moveTo(add(start, side, u(-8)), cmps);
        r.hold(300);
        expect(r.of("line"), `rest ${restCm} cm, flick ${cmps} cm/s`).toEqual([]);
      }
    }
  });

  it("release drift into the radius does not settle", () => {
    const spot: Spot = { lock: 0, L: [0.05, -0.1, 0.55], open: false };
    for (const restCm of [2.45, 2.6, 2.8]) {
      const r = new Rig(add(spot.L, [u(restCm), 0, 0]), ctxOf([spot]));
      r.grab();
      r.hold(300); // deliberate, just outside the radius
      const rest: V3 = [...r.c.pos];
      r.moveBy([u(-1.2), 0, 0], 12); // the pinch opening drags the point 1.2 cm toward the spot in 100 ms
      r.release();
      expect(r.of("settle"), `rest ${restCm} cm`).toEqual([]);
      expect(dist(r.c.pos, rest) * CM).toBeLessThan(0.2);
    }
  });

  it("place ends an assist with line off or unsettle", () => {
    const spot: Spot = { lock: 0, L: [0.05, -0.1, 0.55], open: false };
    const s = new Rig(add(spot.L, [u(1), 0, 0]), ctxOf([spot]));
    s.grab();
    s.hold(500);
    expect(s.c.mode).toBe("settled");
    const there = add(spot.L, [0, u(5), 0]);
    s.c.place(there);
    s.hold(300); // still held: it holds on from where the hand is, with no jump back and no ticks
    expect(s.c.mode).toBe("free");
    expect(s.c.held).toBe(true);
    expect(s.c.pos).toEqual(there);
    expect(s.events.filter((e) => e.type !== "tick")).toEqual([
      { type: "grab" },
      { type: "settle", lock: 0 },
      { type: "unsettle", lock: 0 },
    ]);
    expect(s.of("tick").every((e) => e.cm <= 1)).toBe(true); // only the ticks of settling in

    const { line, start } = ringLine();
    const l = new Rig(start, ctxOf([], [line]));
    l.grab();
    l.hold(300);
    expect(l.c.mode).toBe("line");
    l.c.place(add(start, [u(5), 0, 0]));
    l.frame(true);
    expect(l.c.mode).toBe("free");
    expect(l.of("line")).toEqual([
      { type: "line", lock: 1, on: true },
      { type: "line", lock: 1, on: false },
    ]);
  });

  it("a NaN joint is treated like lost tracking", () => {
    const r = new Rig([0, -0.1, 0.6], ctxOf());
    r.grab();
    r.moveBy([u(2), 0, 0], 6);
    const kept: V3 = [...r.c.pos];
    const back: V3 = [...r.hand];
    for (let i = 0; i < 20; i++) {
      r.hand = i % 3 === 0 ? [Number.NaN, -0.1, 0.6] : [back[0], Number.POSITIVE_INFINITY, 0.6];
      r.frame(i % 2 === 0);
      expect(r.c.pos).toEqual(kept);
    }
    expect(r.c.held).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(["grab"]);
    r.hand = kept;
    r.release();
    expect(r.c.pos).toEqual(kept);

    const idle = new Rig([0, -0.1, 0.6], ctxOf());
    idle.hand = [Number.NaN, -0.1, 0.6];
    idle.grab();
    expect(idle.c.held).toBe(false);
    expect(idle.events).toEqual([]);
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
