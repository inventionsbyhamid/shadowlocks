import { describe, expect, it } from "vitest";
import { area, bbox, elongation, inPoly, segDist } from "../../src/core/geom";
import { MOON_OUTLINE, SHAPES, SILHOUETTES } from "../../src/core/shapes";
import type { ShapeName, V2 } from "../../src/core/types";

const ALL: ShapeName[] = ["Key", "Star", "Moon", "Diamond", "Crown", "Arrow", "Hourglass", "Cat", "Bird", "Teapot"];
const EDGE = 1e-6;

/** Cross products of consecutive edges, one per vertex. */
function turns(poly: V2[]): number[] {
  const n = poly.length;
  return poly.map((b, i) => {
    const a = poly[(i + n - 1) % n]!;
    const c = poly[(i + 1) % n]!;
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
}

function edgeDist(pt: V2, poly: V2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(pt, poly[i]!, poly[(i + 1) % poly.length]!));
  return d;
}

/** Points of a 0.01 grid over the unit square around the origin. */
function grid(): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= 100; i++) for (let j = 0; j <= 100; j++) out.push([-0.5 + i * 0.01, -0.5 + j * 0.01]);
  return out;
}

/** True when segments ab and cd cross or touch. */
function segsMeet(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return segDist(a, c, d) < 1e-12 || segDist(b, c, d) < 1e-12 || segDist(c, a, b) < 1e-12 || segDist(d, a, b) < 1e-12;
}

function isSimple(poly: V2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!, c = poly[(i + 2) % n]!;
    // Neighbouring edges share only their common vertex.
    if (segDist(a, b, c) < 1e-12 || segDist(c, a, b) < 1e-12) return false;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsMeet(a, b, poly[j]!, poly[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

describe("shapes", () => {
  it("has all ten shapes", () => {
    expect(Object.keys(SHAPES).sort()).toEqual([...ALL].sort());
  });

  it.each(ALL)("%s: every piece is strictly convex", (name) => {
    for (const [j, piece] of SHAPES[name].entries()) {
      const t = turns(piece);
      const sameSign = t.every((v) => v > 1e-9) || t.every((v) => v < -1e-9);
      expect(sameSign, `${name} piece ${j}: ${t.map((v) => v.toExponential(2)).join(", ")}`).toBe(true);
    }
  });

  it.each(ALL)("%s: centred, with its largest side 1", (name) => {
    const [x0, y0, x1, y1] = bbox(SHAPES[name].flat());
    expect(Math.abs((x0 + x1) / 2)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs((y0 + y1) / 2)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(Math.max(x1 - x0, y1 - y0) - 1)).toBeLessThanOrEqual(1e-9);
  });

  it.each(ALL)("%s: no point is inside two pieces", (name) => {
    const pieces = SHAPES[name];
    const twice: string[] = [];
    for (const p of grid()) {
      const n = pieces.filter((poly) => inPoly(p, poly) && edgeDist(p, poly) > EDGE).length;
      if (n > 1) twice.push(`(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`);
    }
    expect(twice).toEqual([]);
  });

  it("lists the three silhouettes", () => {
    expect(SILHOUETTES).toEqual(["Cat", "Bird", "Teapot"]);
  });

  it.each(["Cat", "Bird", "Teapot"] as const)("%s: at least 5 pieces and a finger-like piece near horizontal", (name) => {
    const pieces = SHAPES[name];
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    const total = pieces.reduce((s, p) => s + area(p), 0);
    const finger = pieces.some((p) => area(p) / total >= 0.08 && Math.abs(elongation(p).angle) <= Math.PI / 4);
    expect(finger).toBe(true);
  });

  it("MOON_OUTLINE is a simple, non-convex polygon with the Moon's area", () => {
    expect(isSimple(MOON_OUTLINE)).toBe(true);
    const t = turns(MOON_OUTLINE);
    expect(t.some((v) => v > 0) && t.some((v) => v < 0)).toBe(true);
    const pieces = SHAPES.Moon.reduce((s, p) => s + area(p), 0);
    expect(Math.abs(area(MOON_OUTLINE) / pieces - 1)).toBeLessThanOrEqual(0.05);
  });

  it("MOON_OUTLINE covers the same points as the Moon's pieces", () => {
    const pieces = SHAPES.Moon;
    const differ: string[] = [];
    for (const p of grid()) {
      if (edgeDist(p, MOON_OUTLINE) <= EDGE || pieces.some((poly) => edgeDist(p, poly) <= EDGE)) continue;
      const inPieces = pieces.some((poly) => inPoly(p, poly));
      if (inPoly(p, MOON_OUTLINE) !== inPieces) differ.push(`(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`);
    }
    expect(differ).toEqual([]);
  });
});
