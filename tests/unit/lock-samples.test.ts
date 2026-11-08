// lockSamples' fast path (a piece skipped when its grown bbox misses the point, squared distances in place of
// Math.hypot) must sort every grid point exactly as the plain version does: every box the generator builds, version 3's
// included, depends on these points. The plain version is kept here as the reference.
import { describe, expect, it } from "vitest";
import { bbox, polyDist, inPoly, rng32 } from "../../src/core/geom";
import { SHAPES } from "../../src/core/shapes";
import { BAND, lockSamples, type LockSamples, RUNTIME_STEP } from "../../src/core/solve";
import type { ShapeName, V2 } from "../../src/core/types";

/** lockSamples as it was before the fast path. */
function reference(target: V2[][], step: number, missing = -1): LockSamples {
  const [x0, y0, x1, y1] = bbox(target.flat());
  const inside: V2[] = [], band: V2[] = [], missingIdx: number[] = [];
  const gap = missing >= 0 ? target[missing] : undefined;
  for (let x = x0 - BAND; x <= x1 + BAND; x += step) {
    for (let y = y0 - BAND; y <= y1 + BAND; y += step) {
      const pt: V2 = [x, y];
      let d = Infinity;
      for (const p of target) {
        d = Math.min(d, polyDist(pt, p));
        if (d === 0) break;
      }
      if (d === 0) {
        if (gap && inPoly(pt, gap)) missingIdx.push(inside.length);
        inside.push(pt);
      } else if (d <= BAND) band.push(pt);
    }
  }
  return { inside, band, missingIdx, box: [x0 - BAND, y0 - BAND, x1 + BAND, y1 + BAND] };
}

describe("lockSamples", () => {
  it("sorts every point exactly as the plain polyDist version, for every shape, turn, size, grid and hand", () => {
    const rnd = rng32(20261108);
    let compared = 0;
    for (const name of Object.keys(SHAPES) as ShapeName[]) {
      for (let k = 0; k < 6; k++) {
        const size = [0.29, 0.34, 0.46][k % 3]!, rot = (rnd() - 0.5) * 0.8, c = Math.cos(rot), s = Math.sin(rot);
        const cx = (rnd() - 0.5) * 0.5, cy = (rnd() - 0.5) * 0.5, flip = k >= 3 ? -1 : 1;
        const target = SHAPES[name].map((poly) => {
          const placed = poly.map(([x, y]): V2 => [flip * (cx + (x * c - y * s) * size), cy + (x * s + y * c) * size]);
          return flip < 0 ? placed.reverse() : placed;
        });
        const missing = k % 2 ? Math.floor(rnd() * target.length) : -1;
        for (const step of [0.008, RUNTIME_STEP]) {
          expect(lockSamples(target, step, missing), `${name} #${k} step ${step}`).toEqual(reference(target, step, missing));
          compared++;
        }
      }
    }
    expect(compared).toBe(Object.keys(SHAPES).length * 12);
  });
});
