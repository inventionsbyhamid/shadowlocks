import { describe, expect, it } from "vitest";
import { FINGER_MAX_SHARE, FINGER_MIN_SHARE, fingerPiece } from "../../src/core/generator";
import { area, bbox, elongation, inPoly, segDist } from "../../src/core/geom";
import { FIRST_SILHOUETTES, MOON_OUTLINE, SHAPES, SILHOUETTES } from "../../src/core/shapes";
import type { ShapeName, V2 } from "../../src/core/types";
import { outlineEdges } from "../../src/render/outline";

const CLASSICS: ShapeName[] = ["Key", "Star", "Moon", "Diamond", "Crown", "Arrow", "Hourglass"];
const ADDED: ShapeName[] = [
  "Anchor", "Sailboat", "Mushroom", "House", "Fish", "Whale", "Snail", "Owl", "Rabbit", "Candle", "Teacup", "Knight",
  "Cactus", "Tree",
];
const ALL: ShapeName[] = [...CLASSICS, "Cat", "Bird", "Teapot", ...ADDED];
const EDGE = 1e-6;
/** The scrap buffers' room: pieces a lock, corners a piece (src/render/scraps.ts). */
const MAX_PIECES = 16;
const MAX_CORNERS = 16;
/** The locks' places and sizes (generator.ts LAYOUTS) and how far an outline turns (ROT_MAX). */
const SLOTS: { c: V2; size: number }[] = [
  { c: [0, 0.05], size: 0.46 },
  { c: [-0.2, 0.13], size: 0.34 },
  { c: [0.21, -0.12], size: 0.34 },
  { c: [-0.24, 0.2], size: 0.29 },
  { c: [0.24, 0.18], size: 0.29 },
  { c: [0, -0.2], size: 0.29 },
];
const ROT_MAX = 0.5;

/** A convex polygon clipped to another (Sutherland-Hodgman); both counter-clockwise or both clockwise. */
function clip(subject: V2[], by: V2[]): V2[] {
  const sign = Math.sign(signedArea(by));
  let out = subject;
  for (let i = 0; i < by.length && out.length; i++) {
    const a = by[i]!, b = by[(i + 1) % by.length]!;
    const side = (p: V2) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const next: V2[] = [];
    out.forEach((p, k) => {
      const q = out[(k + 1) % out.length]!, sp = side(p), sq = side(q);
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    });
    out = next;
  }
  return out;
}

function signedArea(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Length along which edges of two pieces lie on one line and overlap. */
function sharedLength(A: V2[], B: V2[]): number {
  let len = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i]!, b = A[(i + 1) % A.length]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: V2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    for (let j = 0; j < B.length; j++) {
      const c = B[j]!, d = B[(j + 1) % B.length]!;
      const off = (p: V2) => Math.abs(u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0]));
      if (off(c) > 1e-9 || off(d) > 1e-9) continue;
      const t = (p: V2) => u[0] * (p[0] - a[0]) + u[1] * (p[1] - a[1]);
      len += Math.max(0, Math.min(l, Math.max(t(c), t(d))) - Math.max(0, Math.min(t(c), t(d))));
    }
  }
  return len;
}

/** The share of a piece's perimeter that is the shape's outline (not an edge it shares with another piece). */
function onOutline(pieces: V2[][], j: number): number {
  const piece = pieces[j]!;
  let perim = 0, out = 0;
  for (let k = 0; k < piece.length; k++) perim += Math.hypot(piece[(k + 1) % piece.length]![0] - piece[k]![0], piece[(k + 1) % piece.length]![1] - piece[k]![1]);
  for (const [a, b] of outlineEdges(pieces)) {
    const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (piece.some((p, k) => segDist(m, p, piece[(k + 1) % piece.length]!) < 1e-9)) out += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return out / perim;
}

const turn = (pieces: V2[][], rot: number): V2[][] => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return pieces.map((p) => p.map(([x, y]): V2 => [x * c - y * s, x * s + y * c]));
};

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
  it("has the seven classic shapes and every silhouette", () => {
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

  it("lists the first three silhouettes, then the added ones; every other shape is a classic", () => {
    expect(FIRST_SILHOUETTES).toEqual(["Cat", "Bird", "Teapot"]);
    expect(SILHOUETTES).toEqual(["Cat", "Bird", "Teapot", ...ADDED]);
    expect(ALL.filter((s) => !SILHOUETTES.includes(s))).toEqual(CLASSICS);
  });

  it.each(ALL)("%s: fits the scrap buffers (at most 16 pieces of at most 16 corners)", (name) => {
    expect(SHAPES[name].length).toBeLessThanOrEqual(MAX_PIECES);
    for (const p of SHAPES[name]) expect(p.length).toBeLessThanOrEqual(MAX_CORNERS);
  });

  it.each(SILHOUETTES)("%s: no two pieces overlap (exactly, by clipping)", (name) => {
    const pieces = SHAPES[name], overlaps: string[] = [];
    for (let i = 0; i < pieces.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = Math.abs(signedArea(clip(pieces[i]!, pieces[j]!)));
        if (a > 1e-9) overlaps.push(`${j} and ${i}: ${a.toExponential(2)}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it.each(SILHOUETTES)("%s: one piece, through shared edges, reaches every other", (name) => {
    const pieces = SHAPES[name], seen = new Set([0]), todo = [0];
    while (todo.length) {
      const i = todo.pop()!;
      pieces.forEach((p, j) => {
        if (!seen.has(j) && sharedLength(pieces[i]!, p) > 1e-6) {
          seen.add(j);
          todo.push(j);
        }
      });
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(pieces.map((_, j) => j));
  });

  it.each(["Cat", "Bird", "Teapot"] as const)("%s: at least 5 pieces and a finger-like piece near horizontal", (name) => {
    const pieces = SHAPES[name];
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    const total = pieces.reduce((s, p) => s + area(p), 0);
    const finger = pieces.some((p) => area(p) / total >= 0.08 && Math.abs(elongation(p).angle) <= Math.PI / 4);
    expect(finger).toBe(true);
  });

  // The added silhouettes meet a stricter rule than the first three (the teapot's spout rises at 34 degrees).
  it.each(ADDED)("%s: at least 5 pieces and a finger strip: 8-35% of it, near horizontal, on its outline", (name) => {
    const pieces = SHAPES[name];
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    const total = pieces.reduce((s, p) => s + area(p), 0), j = fingerPiece(pieces);
    expect(j, "a piece a finger can fill").toBeGreaterThanOrEqual(0);
    const share = area(pieces[j]!) / total;
    expect(share).toBeGreaterThanOrEqual(FINGER_MIN_SHARE);
    expect(share).toBeLessThanOrEqual(FINGER_MAX_SHARE);
    expect(Math.abs(elongation(pieces[j]!).angle), "within 20 degrees of horizontal").toBeLessThanOrEqual((20 * Math.PI) / 180);
    // On the edge: a third of its rim or more is the outline, so a finger can come to it from outside.
    expect(onOutline(pieces, j), "share of its edge on the outline").toBeGreaterThanOrEqual(1 / 3);
  });

  it.each(ADDED)("%s: turned either way as far as a lock turns, the same strip stays the finger piece, within 45 degrees", (name) => {
    const j = fingerPiece(SHAPES[name]);
    for (let rot = -ROT_MAX; rot <= ROT_MAX + 1e-9; rot += 0.05) {
      const pieces = turn(SHAPES[name], rot);
      expect(fingerPiece(pieces), `turned ${rot.toFixed(2)}`).toBe(j);
      expect(Math.abs(elongation(pieces[j]!).angle)).toBeLessThanOrEqual(Math.PI / 4);
    }
  });

  it.each(SILHOUETTES)("%s: at every lock's place and turn, the outline stays on the panel with its lit band", (name) => {
    for (const { c, size } of SLOTS) {
      for (const rot of [-ROT_MAX, 0, ROT_MAX]) {
        const [x0, y0, x1, y1] = bbox(turn(SHAPES[name], rot).flat().map(([x, y]): V2 => [c[0] + x * size, c[1] + y * size]));
        expect(Math.max(-x0, x1, -y0, y1)).toBeLessThanOrEqual(0.5 - 0.04);
      }
    }
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
