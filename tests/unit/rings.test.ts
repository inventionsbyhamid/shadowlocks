import { beforeAll, describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import { RING_OFF, RING_ON, RingAlign, ringOffset } from "../../src/core/rings";
import type { Box, Ring } from "../../src/core/types";

const boxes: Box[] = [];
beforeAll(() => {
  for (let n = 1; n <= 30; n++) boxes.push(generateBox({ kind: "box", n }));
}, 120_000);

const ringsOf = (box: Box, i: number) => box.elements.filter((e): e is Ring => e.kind === "ring" && e.lock === i);

describe("ringOffset", () => {
  it("is about 0 at every spot: both ring shadows sit on the mark", () => {
    let worst = 0, n = 0;
    for (const box of boxes) {
      for (const l of box.locks) {
        if (!l.rings) continue;
        n++;
        worst = Math.max(worst, ringOffset(l, ringsOf(box, l.i), l.L));
      }
    }
    console.log(`${n} ringed locks: offset at the spot max ${worst.toExponential(2)}`);
    expect(n).toBeGreaterThan(30);
    expect(worst).toBeLessThan(1e-9);
  });

  it("is the furthest ring shadow's distance from the mark: a sideways move of d shifts a ring at depth z by d z / (Lz - z)", () => {
    for (const box of boxes.slice(0, 10)) {
      for (const l of box.locks) {
        if (!l.rings) continue;
        const rings = ringsOf(box, l.i), [x, y, z] = l.L;
        const want = (d: number) => Math.max(...rings.map((r) => (Math.abs(d) * r.c[2]) / (z - r.c[2])));
        for (const d of [0.01, -0.03, 0.08]) {
          expect(ringOffset(l, rings, [x + d, y, z])).toBeCloseTo(want(d), 12);
          expect(ringOffset(l, rings, [x, y + d, z])).toBeCloseTo(want(d), 12);
        }
      }
    }
  });

  it("counts only the lock's own rings, and is Infinity for a lock without rings", () => {
    for (const box of boxes.slice(0, 10)) {
      const all = box.elements.filter((e): e is Ring => e.kind === "ring");
      for (const l of box.locks) {
        if (l.rings) expect(ringOffset(l, all, box.start)).toBe(ringOffset(l, ringsOf(box, l.i), box.start));
        else expect(ringOffset(l, all, l.L)).toBe(Infinity);
      }
    }
    expect(boxes.some((b) => b.locks.some((l) => !l.rings))).toBe(true);
  });
});

describe("RingAlign", () => {
  it("turns on at 0.03 or less and off above 0.045", () => {
    expect([RING_ON, RING_OFF]).toEqual([0.03, 0.045]);
    const a = new RingAlign();
    expect([0.05, 0.029, 0.04, 0.046].map((o) => a.update(o))).toEqual([false, true, true, false]);
  });

  it("holds its state between the two thresholds, and treats a missing offset as off", () => {
    const a = new RingAlign();
    expect([0.031, 0.03, 0.045, 0.0451, 0.031, 0.01].map((o) => a.update(o))).toEqual([false, true, true, false, false, true]);
    expect(a.update(Infinity)).toBe(false);
    expect(a.update(0.01)).toBe(true);
    expect(a.update(Number.NaN)).toBe(false);
  });
});
