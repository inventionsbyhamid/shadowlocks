import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../src/core/types";
import { ONE_EURO } from "../../src/input/constants";
import { OneEuroFilter, OneEuroVec3 } from "../../src/input/one-euro";

const DT = 1000 / 72;

/** Deterministic noise in [-1, 1]. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

describe("OneEuroFilter", () => {
  it("uses the tuned parameters", () => {
    expect(ONE_EURO).toEqual({ minCutoff: 1.2, beta: 0.8, dCutoff: 1.0 });
  });

  it("passes the first sample through", () => {
    const f = new OneEuroFilter();
    expect(f.filter(42, 0)).toBe(42);
  });

  it("smooths the jitter of a hand held still (millimetres)", () => {
    const f = new OneEuroFilter();
    const rnd = noise(7);
    const ins: number[] = [];
    const outs: number[] = [];
    for (let i = 0; i < 4 * 72; i++) {
      const x = 100 + rnd(); // +-1 mm around 100 mm
      const y = f.filter(x, i * DT);
      if (i >= 72) {
        ins.push(x);
        outs.push(y);
      }
    }
    expect(std(outs)).toBeLessThan(std(ins) * 0.6);
    expect(Math.abs(mean(outs) - 100)).toBeLessThan(0.3);
  });

  it("follows a 100 mm step within three frames", () => {
    const f = new OneEuroFilter();
    let t = 0;
    for (let i = 0; i < 20; i++, t += DT) f.filter(0, t);
    let y = 0;
    for (let i = 0; i < 3; i++, t += DT) y = f.filter(100, t);
    expect(y).toBeGreaterThan(99.5);
  });

  it("keeps up with a hand moving at 200 mm/s (lag under 1 mm)", () => {
    const f = new OneEuroFilter();
    let x = 0;
    let y = 0;
    for (let i = 0; i < 36; i++) {
      x = 200 * ((i * DT) / 1000);
      y = f.filter(x, i * DT);
    }
    expect(x - y).toBeGreaterThanOrEqual(0);
    expect(x - y).toBeLessThan(1);
  });

  it("keeps its value on a repeated or earlier timestamp, and starts over after reset", () => {
    const f = new OneEuroFilter();
    f.filter(0, 0);
    const y = f.filter(10, DT);
    expect(f.filter(50, DT)).toBe(y);
    expect(f.filter(50, 0)).toBe(y);
    f.reset();
    expect(f.filter(7, 100)).toBe(7);
  });
});

describe("OneEuroVec3", () => {
  it("filters metres as millimetres: a step of 10 cm lands within 0.5 mm in three frames", () => {
    const f = new OneEuroVec3();
    const out: Vec3 = [0, 0, 0];
    const p: Vec3 = [0.1, 0.2, -0.3];
    f.reset(p, 0);
    let t = 0;
    for (let i = 0; i < 10; i++, t += DT) f.filter(p, t, out);
    const q: Vec3 = [0.2, 0.2, -0.3];
    let r: Vec3 = out;
    for (let i = 0; i < 3; i++, t += DT) r = f.filter(q, t, out);
    expect(r).toBe(out); // writes into the given array
    expect(Math.abs(out[0] - 0.2)).toBeLessThan(0.0005);
    expect(out[1]).toBeCloseTo(0.2, 6);
    expect(out[2]).toBeCloseTo(-0.3, 6);
  });

  it("reset jumps straight to the given position", () => {
    const f = new OneEuroVec3();
    const out: Vec3 = [0, 0, 0];
    f.reset([1, 1, 1], 0);
    f.filter([1, 1, 1], DT, out);
    f.reset([0, 0, 0], 2 * DT);
    f.filter([0, 0, 0], 3 * DT, out);
    expect(out).toEqual([0, 0, 0]);
  });
});
