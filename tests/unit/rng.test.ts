import { describe, expect, it } from "vitest";
import { mulberry32, seedFrom } from "../../src/core/rng";

describe("rng", () => {
  it("gives the same 5 values for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const va = Array.from({ length: 5 }, () => a());
    const vb = Array.from({ length: 5 }, () => b());
    expect(va).toEqual(vb);
  });

  it("returns values in [0, 1)", () => {
    const r = mulberry32(seedFrom("range"));
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("hashes different strings to different seeds", () => {
    expect(seedFrom("a")).not.toBe(seedFrom("b"));
  });
});
