import { CustomBlending, DoubleSide, MinEquation } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import { area, circlePts, inPoly, polyDist, proj, segDist } from "../../src/core/geom";
import { mirrorBox } from "../../src/core/mirror";
import { MOON_OUTLINE, SHAPES } from "../../src/core/shapes";
import { lockSamples, RING_SIDES } from "../../src/core/solve";
import type { Box, Decoy, Lock, Piece, Ring, V2, V3 } from "../../src/core/types";
import { outlineEdges } from "../../src/render/outline";
import { panelMaterials, panelUniforms } from "../../src/render/panel";
import {
  BoxShadows,
  LANTERN_RADIUS,
  MAX_CASTER_CORNERS,
  MAX_CASTERS,
  MAX_EXTRAS,
  PENUMBRA_MAX,
  penumbra,
  ShadowMesh,
  type ShadowShape,
  SOFT_MIN,
  triangulate,
} from "../../src/render/shadow-mesh";

const boxes: Box[] = [];
for (let n = 1; n <= 30; n++) boxes.push(generateBox({ kind: "box", n }));
const all = [...boxes, ...boxes.map(mirrorBox)];

const square = (cx: number, cy: number, h: number): V2[] => [
  [cx - h, cy - h],
  [cx + h, cy - h],
  [cx + h, cy + h],
  [cx - h, cy + h],
];
const signed = (p: V2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!, r = p[(i + 1) % p.length]!;
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a / 2;
};

/**
 * What the GPU draws at (x, y): the largest coverage of any triangle there, alpha interpolated across it (the
 * panel's MIN blending keeps the darkest shadow, so overlaps never add up). Triangles of one slot, or all.
 */
function coverage(sm: ShadowMesh, x: number, y: number, slot?: number): number {
  const P = sm.positions, A = sm.alphas, I = sm.indices;
  const s = slot === undefined ? null : sm.slot(slot);
  const i0 = s ? s.i0 : 0, i1 = s ? s.i0 + s.iCount : sm.indexCount;
  let best = 0;
  for (let t = i0; t < i1; t += 3) {
    const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
    const ax = P[a * 3]!, ay = P[a * 3 + 1]!, bx = P[b * 3]!, by = P[b * 3 + 1]!, cx = P[c * 3]!, cy = P[c * 3 + 1]!;
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-14) continue;
    const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    const wc = 1 - wa - wb;
    if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
    best = Math.max(best, wa * A[a]! + wb * A[b]! + wc * A[c]!);
  }
  return best;
}

/** Whether two edges of the polygon that do not share a corner cross. */
function crossesItself(p: V2[]): boolean {
  const n = p.length;
  const side = (a: V2, b: V2, c: V2) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = p[i]!, b = p[(i + 1) % n]!, c = p[j]!, d = p[(j + 1) % n]!;
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** Distance from p to the line through a and b. */
const lineDist = (p: V2, a: V2, b: V2) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.hypot(dx, dy);
};

describe("penumbra", () => {
  it("uses the picked look's crisp lantern radius", () => {
    expect(LANTERN_RADIUS).toBe(0.016);
    expect(PENUMBRA_MAX).toBe(0.03);
  });

  it("is LANTERN_RADIUS * Pz / (Lz - Pz), capped: a scrap near the panel is crisp, near the lantern soft", () => {
    expect(penumbra(0.1, 1.3)).toBeLessThan(penumbra(0.7, 1.3));
    expect(penumbra(0.1, 1.3)).toBeCloseTo((0.016 * 0.1) / 1.2, 12);
    expect(penumbra(0.7, 1.3)).toBeCloseTo((0.016 * 0.7) / 0.6, 12);
    expect(penumbra(0.75, 1.0)).toBe(PENUMBRA_MAX);
    // The lantern at or behind a scrap (never in play): the cap, not Infinity.
    expect(penumbra(0.8, 0.8)).toBe(PENUMBRA_MAX);
    expect(penumbra(0.8, 0.5)).toBe(PENUMBRA_MAX);
  });
});

describe("ShadowMesh", () => {
  const three = [square(-0.2, 0, 0.05), square(0, 0, 0.05), square(0.2, 0, 0.05)];
  const soft = new Float32Array([0.01, 0.01, 0.01]);

  it("draws 3 squares with 48 vertices and 162 indices: 2 interior triangles, and per corner a 2-triangle cap and a 2-triangle strip", () => {
    const sm = new ShadowMesh(8, 8);
    sm.update(three, 3, soft);
    expect(sm.vertexCount).toBe(48);
    expect(sm.indexCount).toBe(162);
    expect(sm.mesh.geometry.drawRange.count).toBe(162);
    for (let i = 0; i < 3; i++) {
      const s = sm.slot(i);
      expect(s).toEqual({ v0: i * 16, vCount: 16, i0: i * 54, iCount: 54 });
      for (let j = 0; j < 4; j++) expect(sm.alphas[s.v0 + j]).toBe(1);
      for (let j = 4; j < 16; j++) expect(sm.alphas[s.v0 + j]).toBe(0);
    }
    // One draw call: one mesh, one material, drawn on both sides (polygons wind either way).
    expect(Array.isArray(sm.mesh.material)).toBe(false);
    expect((sm.mesh.material as { side: number }).side).toBe(DoubleSide);
  });

  it("keeps its buffers across 100 updates (nothing is reallocated)", () => {
    const sm = new ShadowMesh(8, 8);
    const g = sm.mesh.geometry;
    const pos = g.getAttribute("position"), alpha = g.getAttribute("aAlpha"), index = g.getIndex()!;
    const arrays = [pos.array, alpha.array, index.array];
    for (let k = 0; k < 100; k++) {
      const d = k * 0.001;
      const moved = three.map((p) => p.map(([x, y]): V2 => [x + d, y - d]));
      soft.fill(0.002 + d * 0.1);
      sm.update(moved, 3, soft);
    }
    expect(g.getAttribute("position")).toBe(pos);
    expect(g.getAttribute("aAlpha")).toBe(alpha);
    expect(g.getIndex()).toBe(index);
    expect([pos.array, alpha.array, index.array]).toEqual(arrays);
    expect(pos.array).toBe(arrays[0]);
    expect(alpha.array).toBe(arrays[1]);
    expect(index.array).toBe(arrays[2]);
    expect(sm.positions).toBe(pos.array);
  });

  it("puts the skirt `soft` outside each edge and rounds each convex corner at `soft`, whichever way the polygon winds", () => {
    const ccw = square(0, 0, 0.1);
    const cw = [...ccw].reverse();
    const diamond = SHAPES.Diamond.map((p) => p.map(([x, y]): V2 => [x * 0.3, y * 0.3]));
    const mirrored = diamond.map((p) => p.map(([x, y]): V2 => [-x, y]));
    const star = SHAPES.Star.map((p) => p.map(([x, y]): V2 => [x * 0.4, y * 0.4]));
    const polys = [ccw, cw, ...diamond, ...mirrored, ...star];
    // Diamond's pieces wind clockwise and mirroring flips them: both windings are here.
    expect(polys.some((p) => signed(p) < 0)).toBe(true);
    expect(polys.some((p) => signed(p) > 0)).toBe(true);
    const s = 0.0137;
    const sm = new ShadowMesh(polys.length, 8);
    sm.update(polys, polys.length, new Float32Array(polys.length).fill(s));
    const at3 = (v: number): V2 => [sm.positions[v * 3]!, sm.positions[v * 3 + 1]!];
    polys.forEach((poly, i) => {
      const { v0 } = sm.slot(i), c = poly.length;
      for (let j = 0; j < c; j++) {
        const prev = poly[(j + c - 1) % c]!, at = poly[j]!, next = poly[(j + 1) % c]!;
        // The corner itself, then its three skirt points: along the edge in, round the corner, along the edge out.
        const [x, y] = at3(v0 + j);
        expect(x).toBeCloseTo(at[0], 6);
        expect(y).toBeCloseTo(at[1], 6);
        const sIn = at3(v0 + c + 3 * j), sMid = at3(v0 + c + 3 * j + 1), sOut = at3(v0 + c + 3 * j + 2);
        expect(lineDist(sIn, prev, at)).toBeCloseTo(s, 6);
        expect(lineDist(sOut, at, next)).toBeCloseTo(s, 6);
        for (const sk of [sIn, sMid, sOut]) {
          // These pieces are all convex: every skirt point is exactly `soft` from its corner, outside.
          expect(Math.hypot(sk[0] - at[0], sk[1] - at[1])).toBeCloseTo(s, 6);
          expect(inPoly(sk, poly)).toBe(false);
        }
      }
    });
  });

  it("never spills past its penumbra: nothing beyond 1.05 x soft from a polygon, even at sharp points", () => {
    // Sharp shapes: the lesson Moon's horns, a star's points, a 10-degree sliver, the crown's prongs; then every scrap
    // and decoy of boxes 1-30 as cast from the start and from each spot.
    const shapes: V2[][] = [
      MOON_OUTLINE.map(([x, y]): V2 => [x * 0.4, y * 0.4]),
      ...SHAPES.Star.map((p) => p.map(([x, y]): V2 => [x * 0.4, y * 0.4])),
      ...SHAPES.Crown.map((p) => p.map(([x, y]): V2 => [-x * 0.4, y * 0.4])),
      [[0, 0], [0.3, 0.0264], [0.3, -0.0264]],
    ];
    const sets: V2[][][] = [shapes];
    for (const b of boxes) {
      const flat = b.elements.filter((e) => e.kind !== "ring") as { verts: [number, number, number][] }[];
      for (const L of [b.start, b.locks[0]!.L]) sets.push(flat.map((e) => e.verts.map((v) => proj(v, L))));
    }
    // A tilted plate's corners can fold over when cast from far off its spot (its fan of triangles is still its exact
    // shadow); "beyond the polygon" means nothing for an outline that crosses itself, so those are counted, not measured.
    let folded = 0;
    let checked = 0, near = 0;
    const misses: string[] = [], halfway: string[] = [];
    for (const s of [SOFT_MIN, 0.0137, PENUMBRA_MAX]) {
      for (const [n, polys] of sets.entries()) {
        const sm = new ShadowMesh(polys.length, MAX_CASTER_CORNERS);
        // The sharp shapes as triangulated once; the boxes' scraps as fans, the way BoxShadows lays out convex pieces.
        sm.setShapes(polys.map((p): ShadowShape => ({ count: p.length, tris: n === 0 ? triangulate(p) : null, ring: false })), polys.length);
        sm.update(polys, polys.length, new Float32Array(polys.length).fill(s));
        polys.forEach((poly, i) => {
          // A fan is a convex scrap's exact shadow; a scrap cast so far off its spot that its corners fold (cross, or
          // turn the outline concave) is counted, not measured.
          if (n > 0 && (crossesItself(poly) || triangulate(poly) !== null)) {
            if (s === SOFT_MIN) folded++;
            return;
          }
          for (const v of poly) {
            for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
              for (const r of [1.06, 1.3, 2]) {
                const p: V2 = [v[0] + r * s * Math.cos(a), v[1] + r * s * Math.sin(a)];
                if (polyDist(p, poly) <= 1.05 * s) continue;
                checked++;
                const c = coverage(sm, p[0], p[1], i);
                if (c > 0) misses.push(`soft ${s} polygon ${i} (${poly.length} corners) at ${p.map((t) => t.toFixed(4))}: ${c.toFixed(3)}`);
              }
            }
          }
          // And the skirt is there: halfway across it, beside each edge's middle, about half a shadow.
          for (let k = 0; k < poly.length; k++) {
            const a = poly[k]!, b = poly[(k + 1) % poly.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (len < 4 * s) continue;
            const o = Math.sign(signed(poly)), nx = (o * (b[1] - a[1])) / len, ny = (-o * (b[0] - a[0])) / len;
            const p: V2 = [(a[0] + b[0]) / 2 + nx * 0.5 * s, (a[1] + b[1]) / 2 + ny * 0.5 * s];
            if (polys.some((q, j) => j !== i && inPoly(p, q))) continue;
            near++;
            const c = coverage(sm, p[0], p[1], i);
            if (Math.abs(c - 0.5) > 0.005) halfway.push(`soft ${s} polygon ${i} edge ${k}: ${c.toFixed(3)}`);
          }
        });
      }
    }
    console.log(`spill: ${checked} points beyond 1.05 x soft checked, ${near} edge middles; ${folded} of the cast scraps fold over (skipped)`);
    expect(checked).toBeGreaterThan(100_000);
    expect(near).toBeGreaterThan(1_000);
    expect(misses.slice(0, 10), `${misses.length} of ${checked} points beyond the penumbra in shadow`).toEqual([]);
    expect(halfway.slice(0, 10), `${halfway.length} of ${near} edge middles not half shadow halfway across the skirt`).toEqual([]);
  });

  it("fills a concave polygon (the lesson Moon) from triangles worked out once, and a convex one as a fan", () => {
    expect(triangulate(square(0, 0, 0.1))).toBeNull();
    expect(triangulate([...square(0, 0, 0.1)].reverse())).toBeNull();
    const moon = MOON_OUTLINE.map(([x, y]): V2 => [x * 0.4, y * 0.4]);
    for (const poly of [moon, [...moon].reverse(), moon.map(([x, y]): V2 => [-x, y])]) {
      const tris = triangulate(poly)!;
      expect(tris).not.toBeNull();
      expect(tris.length).toBe((poly.length - 2) * 3);
      let sum = 0;
      for (let t = 0; t < tris.length; t += 3) {
        const a = poly[tris[t]!]!, b = poly[tris[t + 1]!]!, c = poly[tris[t + 2]!]!;
        sum += area([a, b, c]);
        expect(inPoly([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3], poly)).toBe(true);
      }
      expect(sum).toBeCloseTo(area(poly), 9);
      // At the crispest and the softest skirt: inside the crescent full shadow; in its bite (inside the hull, outside
      // the shape) light, once past the skirt.
      for (const s of [SOFT_MIN, PENUMBRA_MAX]) {
        const sm = new ShadowMesh(1, MAX_CASTER_CORNERS);
        const shape: ShadowShape = { count: poly.length, tris, ring: false };
        sm.setShapes([shape], 1);
        sm.update([poly], 1, new Float32Array([s]));
        let inside = 0, lit = 0;
        for (let x = -0.2; x <= 0.2; x += 0.01) {
          for (let y = -0.2; y <= 0.2; y += 0.01) {
            let d = Infinity;
            for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist([x, y], poly[i]!, poly[(i + 1) % poly.length]!));
            const c = coverage(sm, x, y);
            if (inPoly([x, y], poly)) {
              if (d < 2 * SOFT_MIN) continue;
              expect(c).toBeCloseTo(1, 6);
              inside++;
            } else {
              if (d <= 1.05 * s) continue;
              expect(c).toBe(0);
              lit++;
            }
          }
        }
        expect(inside).toBeGreaterThan(50);
        expect(lit).toBeGreaterThan(s === SOFT_MIN ? 50 : 20);
      }
    }
  });

  it("draws a ring's shadow as an annulus: the hole stays lit right up to its edge", () => {
    const outer = circlePts([0.1, 0.05, 0.3], [0, 0, 1], 0.04, RING_SIDES).map(([x, y]): V2 => [x, y]);
    const inner = circlePts([0.1, 0.05, 0.3], [0, 0, 1], 0.028, RING_SIDES).map(([x, y]): V2 => [x, y]);
    for (const s of [SOFT_MIN, 0.02]) {
      const sm = new ShadowMesh(1, MAX_CASTER_CORNERS);
      sm.setShapes([{ count: 2 * RING_SIDES, tris: null, ring: true }], 1);
      sm.update([[...outer, ...inner]], 1, new Float32Array([s]));
      expect(sm.vertexCount).toBe(4 * RING_SIDES);
      expect(sm.indexCount).toBe(18 * RING_SIDES);
      for (let a = 0; a < 6.28; a += 0.3) {
        const at = (r: number) => coverage(sm, 0.1 + r * Math.cos(a), 0.05 + r * Math.sin(a));
        expect(at(0)).toBe(0);
        expect(at(0.02)).toBe(0);
        expect(at(0.027)).toBe(0);
        // The body is solid at least on its outer half, whatever the softness.
        expect(at(0.036)).toBeCloseTo(1, 6);
        expect(at(0.038)).toBeCloseTo(1, 6);
        // Outside, the skirt fades to nothing `soft` away.
        expect(at(0.04 + s + 0.002)).toBe(0);
      }
    }
  });
});

describe("BoxShadows", () => {
  const allShown = () => true;

  it("fits every caster of boxes 1-30 and their mirrors", () => {
    const sh = new BoxShadows();
    for (const b of all) {
      expect(b.elements.length).toBeLessThanOrEqual(MAX_CASTERS);
      for (const e of b.elements) if (e.kind !== "ring") expect(e.verts.length).toBeLessThanOrEqual(MAX_CASTER_CORNERS);
      sh.setBox(b);
      sh.cast(b.start);
      expect(sh.mesh.indexCount).toBeGreaterThan(0);
    }
  });

  it("from each lock's spot, the shadow fills its whole outline as one shape: no seams, T-junctions included", () => {
    const sh = new BoxShadows(allShown);
    let points = 0;
    const misses: string[] = [];
    for (const b of all) {
      sh.setBox(b);
      for (const l of b.locks) {
        sh.cast(l.L);
        for (const p of lockSamples(l.target, 0.008).inside) {
          points++;
          const c = coverage(sh.mesh, p[0], p[1]);
          if (c < 0.999) misses.push(`${b.key}${b.mirrored ? " mirrored" : ""} lock ${l.i} (${l.shape}) at ${p.map((v) => v.toFixed(3))}: ${c}`);
        }
      }
    }
    expect(points).toBeGreaterThan(20_000);
    expect(misses.slice(0, 10), `${misses.length} uncovered points`).toEqual([]);
  });

  it("covers every edge two scraps share from both sides with each scrap's own skirt, so a rasterised crack never shows", () => {
    const sh = new BoxShadows(allShown);
    let checked = 0;
    const misses: string[] = [];
    // Key, Crown, Arrow and the Teapot's handle meet in T-junctions; Diamond winds clockwise.
    const wanted = new Set(["Key", "Crown", "Arrow", "Teapot", "Diamond", "Star"]);
    for (const b of all) {
      sh.setBox(b);
      for (const l of b.locks) {
        if (!wanted.has(l.shape)) continue;
        sh.cast(l.L);
        l.target.forEach((poly, j) => {
          const slot = slotOfPiece(sh, b, l, j);
          const o = Math.sign(signed(poly));
          for (let k = 0; k < poly.length; k++) {
            const a = poly[k]!, c = poly[(k + 1) % poly.length]!;
            const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
            const nx = (o * (c[1] - a[1])) / len, ny = (-o * (c[0] - a[0])) / len;
            for (const t of [0.1, 0.5, 0.9]) {
              // Just across the edge (0.06 px at the headset), outside this piece: inside a neighbour (a shared edge)?
              const p: V2 = [a[0] + (c[0] - a[0]) * t + nx * 1e-4, a[1] + (c[1] - a[1]) * t + ny * 1e-4];
              if (!l.target.some((q, i) => i !== j && inPoly(p, q))) continue;
              checked++;
              const cov = coverage(sh.mesh, p[0], p[1], slot);
              if (cov < 0.9) misses.push(`${b.key} lock ${l.i} ${l.shape} piece ${j} edge ${k}: ${cov.toFixed(3)}`);
            }
          }
        });
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(misses.slice(0, 10), `${misses.length} edges`).toEqual([]);
  });

  it("casts no shadow for a hidden scrap (a finger lock's missing piece), and one once it shows", () => {
    const b = boxes.find((x) => x.locks.some((l) => l.finger))!;
    const l = b.locks.find((x) => x.finger)!;
    const gap = l.target[l.missing]!;
    const mid: V2 = [gap.reduce((s, v) => s + v[0], 0) / gap.length, gap.reduce((s, v) => s + v[1], 0) / gap.length];
    let show = false;
    const sh = new BoxShadows((p) => !p.missing || show);
    sh.setBox(b);
    sh.cast(l.L);
    expect(coverage(sh.mesh, mid[0], mid[1])).toBe(0);
    show = true;
    expect(sh.refresh(l.L)).toBe(true);
    expect(coverage(sh.mesh, mid[0], mid[1])).toBeCloseTo(1, 6);
    // Nothing moved and nothing changed: no work.
    expect(sh.refresh(l.L)).toBe(false);
  });

  it("nests the sight rings' shadows into a bullseye on the mark from the spot: hole and gap lit, both rings dark", () => {
    const sh = new BoxShadows();
    let locks = 0;
    const crossed: string[] = [];
    for (const b of all) {
      sh.setBox(b);
      for (const l of b.locks) {
        if (!l.mark) continue;
        locks++;
        sh.cast(l.L);
        // Seen from the spot a ring is a circle; on the panel, met at a slant, it is an ellipse. Check along each of
        // its corners: the hole, the deep ring, the gap, the shallow ring.
        const rings = b.elements.filter((e): e is Ring => e.kind === "ring" && e.lock === l.i).sort((p, q) => p.c[2] - q.c[2]);
        expect(rings).toHaveLength(2);
        const corners = (r: Ring, rad: number) => circlePts(r.c, r.nrm, rad, RING_SIDES).map((p) => proj(p, l.L));
        const [deep, shallow] = rings as [Ring, Ring];
        const dO = corners(deep, deep.rOut), dI = corners(deep, deep.rIn), sO = corners(shallow, shallow.rOut), sI = corners(shallow, shallow.rIn);
        // The rings' own shadows here; no other shadow may cross the mark from the spot (checked below).
        const slots = rings.map((r) => sh.slotOf(r));
        const at = (p: V2) => Math.max(...slots.map((s) => coverage(sh.mesh, p[0], p[1], s)));
        if (coverage(sh.mesh, l.mark[0], l.mark[1]) > 0) crossed.push(`${b.key}${b.mirrored ? " mirrored" : ""} lock ${l.i}`);
        const lerp = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        expect(at(l.mark)).toBe(0);
        for (let j = 0; j < RING_SIDES; j++) {
          expect(at(lerp(l.mark, dI[j]!, 0.9))).toBe(0);
          expect(at(lerp(dI[j]!, dO[j]!, 0.75))).toBeCloseTo(1, 6);
          expect(at(lerp(sI[j]!, sO[j]!, 0.75))).toBeCloseTo(1, 6);
          // Between the rings the light comes through.
          let gap = 1;
          for (let t = 0; t <= 1; t += 0.05) gap = Math.min(gap, at(lerp(dO[j]!, sI[j]!, t)));
          expect(gap).toBeLessThan(0.02);
        }
      }
    }
    expect(locks).toBeGreaterThan(50);
    // Nothing else darkens the bullseye at the moment the rings line up (boxes 1-30 and their mirrors).
    expect(crossed, `${crossed.length} of ${locks} ringed locks have another shadow on the mark`).toEqual([]);
  });

  /**
   * A small box of its own: one lock whose single scrap is the concave lesson Moon, its sight ring, and a decoy,
   * all cast from L.
   */
  function moonBox(L: V3) {
    const onRay = (v: V2, z: number): V3 => {
      const k = (L[2] - z) / L[2];
      return [L[0] + (v[0] - L[0]) * k, L[1] + (v[1] - L[1]) * k, z];
    };
    const moon = MOON_OUTLINE.map(([x, y]): V2 => [x * 0.4 - 0.1, y * 0.4]);
    const mark: V2 = [0.3, 0.32];
    const c = onRay(mark, 0.4), k = L[2] / (L[2] - c[2]);
    const d = [L[0] - c[0], L[1] - c[1], L[2] - c[2]], dl = Math.hypot(d[0]!, d[1]!, d[2]!);
    const ring: Ring = { kind: "ring", lock: 0, c, nrm: [d[0]! / dl, d[1]! / dl, d[2]! / dl], rOut: 0.044 / k, rIn: 0.032 / k };
    const piece: Piece = { kind: "piece", lock: 0, piece: 0, verts: moon.map((v) => onRay(v, 0.3)), missing: false };
    const decoy: Decoy = { kind: "decoy", verts: [[-0.35, -0.35, 0.4], [-0.25, -0.35, 0.4], [-0.3, -0.27, 0.4]] };
    const box = { elements: [piece, ring, decoy], locks: [{ i: 0, target: [moon], mark }] } as unknown as Box;
    return { box, moon, mark, piece, ring };
  }

  /** A regular n-gon of radius r round (x, y): a stand-in for a hand bone's shadow. */
  const ngon = (x: number, y: number, r: number, n: number): V2[] =>
    Array.from({ length: n }, (_, i): V2 => [x + r * Math.cos((2 * Math.PI * i) / n), y + r * Math.sin((2 * Math.PI * i) / n)]);

  it("adds and drops extra shadows (a hand's bones) after the box's without touching its slots: ring holes and concave shapes stay", () => {
    const L: V3 = [0.1, -0.3, 1.3];
    const { box, moon, mark, piece, ring } = moonBox(L);
    const sh = new BoxShadows();
    sh.setBox(box);
    sh.cast(L);
    const sm = sh.mesh;
    expect(sh.boxSlots).toBe(3);
    const last = sm.slot(2), vEnd = last.v0 + last.vCount, iEnd = last.i0 + last.iCount;
    expect(sm.indexCount).toBe(iEnd);
    const snap = () => ({ idx: Array.from(sm.indices.slice(0, iEnd)), alpha: Array.from(sm.alphas.slice(0, vEnd)), pos: Array.from(sm.positions.slice(0, vEnd * 3)) });
    const before = snap();
    const moonSlot = sh.slotOf(piece), ringSlot = sh.slotOf(ring);
    // A point in the Moon's bite: the centre of its inner arc (its last corners lie on that circle), inside the outer
    // circle but well outside the shape. And a point inside the crescent: the middle of its largest triangle.
    const [p1, p2, p3] = moon.slice(-5, -2) as [V2, V2, V2];
    const dd = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
    const sq = (p: V2) => p[0] * p[0] + p[1] * p[1];
    const bite: V2 = [
      (sq(p1) * (p2[1] - p3[1]) + sq(p2) * (p3[1] - p1[1]) + sq(p3) * (p1[1] - p2[1])) / dd,
      (sq(p1) * (p3[0] - p2[0]) + sq(p2) * (p1[0] - p3[0]) + sq(p3) * (p2[0] - p1[0])) / dd,
    ];
    expect(inPoly(bite, moon)).toBe(false);
    expect(polyDist(bite, moon)).toBeGreaterThan(0.05);
    const tris = triangulate(moon)!;
    let solid: V2 = [0, 0], best = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = moon[tris[t]!]!, b = moon[tris[t + 1]!]!, c = moon[tris[t + 2]!]!, ar = area([a, b, c]);
      if (ar > best) [best, solid] = [ar, [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]];
    }
    expect(inPoly(solid, moon)).toBe(true);
    const intact = () => {
      expect(coverage(sm, mark[0], mark[1], ringSlot)).toBe(0);
      expect(coverage(sm, bite[0], bite[1], moonSlot)).toBe(0);
      expect(coverage(sm, solid[0], solid[1], moonSlot)).toBeCloseTo(1, 6);
      expect(snap()).toEqual(before);
    };
    intact();

    const bones = [ngon(0.3, -0.2, 0.03, 8), ngon(0.2, -0.25, 0.02, 8), ngon(-0.3, 0.3, 0.025, 12)];
    const bonesSoft = new Float32Array([0.004, 0.004, 0.01]);
    sh.cast(L, bones, 3, bonesSoft);
    intact();
    expect(sm.indexCount).toBeGreaterThan(iEnd);
    for (let e = 0; e < 3; e++) expect(coverage(sm, bones[e]![0]![0] - 0.01, bones[e]![0]![1], 3 + e)).toBeCloseTo(1, 6);
    // A different set: one bone with another corner count.
    const one = [ngon(0.25, -0.2, 0.03, 6)];
    sh.cast(L, one, 1, bonesSoft);
    intact();
    expect(coverage(sm, 0.25, -0.2)).toBeCloseTo(1, 6);
    expect(coverage(sm, -0.3, 0.3)).toBe(0);
    // None: back to the box alone, which refresh also does after a cast with extras.
    sh.cast(L, bones, 3, bonesSoft);
    expect(sh.refresh(L)).toBe(true);
    intact();
    expect(sm.indexCount).toBe(iEnd);
    expect(coverage(sm, 0.3, -0.2)).toBe(0);
    expect(sh.refresh(L)).toBe(false);
  });

  it("has room for the largest box plus MAX_EXTRAS bones of up to MAX_CASTER_CORNERS corners", () => {
    const sh = new BoxShadows(allShown);
    const big = all.reduce((a, b) => (b.elements.length > a.elements.length ? b : a));
    sh.setBox(big);
    const bones = Array.from({ length: MAX_EXTRAS }, (_, i) => ngon(-0.4 + (i % 8) * 0.1, -0.4 + Math.floor(i / 8) * 0.1, 0.02, MAX_CASTER_CORNERS));
    sh.cast(big.start, bones, MAX_EXTRAS, new Float32Array(MAX_EXTRAS).fill(PENUMBRA_MAX));
    expect(coverage(sh.mesh, -0.4, -0.4)).toBeCloseTo(1, 6);
    expect(() => sh.cast(big.start, bones, MAX_EXTRAS + 1)).toThrow();
  });
});

/** Which mesh slot holds lock l's piece j (every element casts, in box order). */
function slotOfPiece(sh: BoxShadows, b: Box, l: Lock, j: number): number {
  const k = sh.slotOf(b.elements.find((e) => e.kind === "piece" && e.lock === l.i && e.piece === j)!);
  expect(k).toBeGreaterThanOrEqual(0);
  return k;
}

describe("outlineEdges", () => {
  it("keeps only the outline's own edges: shared edges and T-junction overlaps between pieces drop out", () => {
    const sq = [square(0, 0, 0.1)];
    expect(outlineEdges(sq)).toHaveLength(4);
    // Two squares side by side: 8 edges, the shared one (both ways) goes, 6 remain.
    const two = [square(-0.1, 0, 0.1), square(0.1, 0, 0.1)];
    expect(outlineEdges(two)).toHaveLength(6);
    // A T-junction: one tall square beside two short ones; the tall one's inner edge is split at the junction.
    const t: V2[][] = [
      [[-0.2, -0.1], [0, -0.1], [0, 0.1], [-0.2, 0.1]],
      [[0, -0.1], [0.1, -0.1], [0.1, 0], [0, 0]],
      [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]],
    ];
    const edges = outlineEdges(t);
    const total = edges.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
    expect(total).toBeCloseTo(0.3 * 2 + 0.2 * 2, 9);
    for (const [a, b] of edges) expect(a[0] === 0 && b[0] === 0).toBe(false);
  });

  it("outlines every lock of boxes 1-30 and their mirrors with a closed boundary as long as its perimeter", () => {
    for (const b of all) {
      for (const l of b.locks) {
        const edges = outlineEdges(l.target);
        expect(edges.length).toBeGreaterThan(2);
        // Every outline point ends one edge and starts another (a closed loop, either way round).
        const key = (p: V2) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
        const deg = new Map<string, number>();
        for (const [a, c] of edges) for (const p of [a, c]) deg.set(key(p), (deg.get(key(p)) ?? 0) + 1);
        for (const [, d] of deg) expect(d % 2).toBe(0);
      }
    }
  });
});

describe("panel materials", () => {
  it("share one set of uniforms; shadows darken with MIN blending, so overlaps never darken twice", () => {
    const u = panelUniforms();
    const { panel, shadow } = panelMaterials(u);
    for (const k of ["uLantern", "uWarmth", "uLockCenter", "uOpen"]) {
      expect(panel.uniforms[k]).toBe(u[k as keyof typeof u]);
      expect(shadow.uniforms[k]).toBe(u[k as keyof typeof u]);
    }
    expect((u.uWarmth.value as Float32Array).length).toBe(3);
    expect((u.uOpen.value as Float32Array).length).toBe(3);
    expect(shadow.blending).toBe(CustomBlending);
    expect(shadow.blendEquation).toBe(MinEquation);
    expect(shadow.depthWrite).toBe(false);
    expect(shadow.side).toBe(DoubleSide);
    expect(shadow.defines?.SHADOW).toBeDefined();
    // The panel is drawn first and writes no depth: the shadows lie on it, exactly in its plane.
    expect(panel.depthWrite).toBe(false);
    expect(panel.defines?.SHADOW).toBeUndefined();
  });
});

