import { describe, expect, it } from "vitest";
import { area, elongation, hash, inPoly, proj, rng32 } from "../../src/core/geom";
import type { V2 } from "../../src/core/types";

const SQUARE: V2[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe("geom", () => {
  it("projects a point onto the panel from the lantern", () => {
    expect(proj([0, 0, 0.5], [0, 0, 1])).toEqual([0, 0]);
    expect(proj([0.1, 0, 0.5], [0, 0, 1])).toEqual([0.2, 0]);
  });

  it("tells inside from outside a polygon", () => {
    expect(inPoly([0.5, 0.5], SQUARE)).toBe(true);
    expect(inPoly([1.5, 0.5], SQUARE)).toBe(false);
  });

  it("measures the unit square's area as 1", () => {
    expect(area(SQUARE)).toBe(1);
  });

  it("gives the same 5 values twice for one seed, all in [0, 1)", () => {
    const a = rng32(hash("a"));
    const b = rng32(hash("a"));
    const va = Array.from({ length: 5 }, () => a());
    const vb = Array.from({ length: 5 }, () => b());
    expect(va).toEqual(vb);
    for (const v of va) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("finds a 4x1 rectangle's elongation: ratio 4, angle 0", () => {
    const e = elongation([
      [0, 0],
      [4, 0],
      [4, 1],
      [0, 1],
    ]);
    expect(Math.abs(e.ratio - 4)).toBeLessThanOrEqual(1e-6);
    expect(e.angle).toBe(0);
  });
});
