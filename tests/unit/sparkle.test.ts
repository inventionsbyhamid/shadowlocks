import { describe, expect, it } from "vitest";
import { type BufferAttribute, type PointsMaterial, ShaderLib, type WebGLProgramParametersWithUniforms } from "@iwsdk/core";
import { generateBox } from "../../src/core/generator";
import { inPoly } from "../../src/core/geom";
import type { Lock, V2 } from "../../src/core/types";
import { MIN_GAP_S } from "../../src/render/fx/flash-budget";
import { PER_LOCK, SPARKLE, Sparkle, SPARKLE_S, sharpTips } from "../../src/render/fx/sparkle";
import { outlineEdges } from "../../src/render/outline";

const DT = 1 / 72;
const box1 = generateBox({ kind: "box", n: 1 });
const box5 = generateBox({ kind: "box", n: 5 });
const G = SPARKLE.glints;

/** Every corner of a lock's outline with the angle between its two edges (radians), sharpest first, and convex or not. */
function corners(l: Lock): { p: V2; angle: number; convex: boolean }[] {
  const key = (p: V2) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const nbrs = new Map<string, { p: V2; to: V2[] }>();
  for (const [a, b] of outlineEdges(l.target)) {
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const e = nbrs.get(key(p)) ?? { p, to: [] };
      e.to.push(q);
      nbrs.set(key(p), e);
    }
  }
  return [...nbrs.values()]
    .filter((e) => e.to.length === 2)
    .map(({ p, to: [u, v] }) => {
      const a = Math.atan2(u![1] - p[1], u![0] - p[0]), b = Math.atan2(v![1] - p[1], v![0] - p[0]);
      const d = Math.abs(a - b) % (2 * Math.PI);
      // Convex when a step along the bisector, between its two edges, lands inside the shape.
      const bx = Math.cos(a) + Math.cos(b), by = Math.sin(a) + Math.sin(b), bl = Math.hypot(bx, by) || 1;
      const q: V2 = [p[0] + (bx / bl) * 1e-4, p[1] + (by / bl) * 1e-4];
      return { p, angle: Math.min(d, 2 * Math.PI - d), convex: l.target.some((poly) => inPoly(q, poly)) };
    })
    .sort((x, y) => x.angle - y.angle);
}

/** Run a burst on `lock` frame by frame: each point's brightness, size and position per frame. */
function run(s: Sparkle, lock: number, seconds: number) {
  const frames: { bright: number[]; size: number[]; y: number[]; visible: boolean }[] = [];
  const pos = s.points.geometry.getAttribute("position") as BufferAttribute;
  const size = s.points.geometry.getAttribute("aSize") as BufferAttribute;
  for (let t = 0; t < seconds; t += DT) {
    s.update(DT);
    const base = lock * PER_LOCK;
    frames.push({
      bright: Array.from(s.bright.subarray(base, base + PER_LOCK)),
      size: Array.from({ length: PER_LOCK }, (_, k) => size.getX(base + k)),
      y: Array.from({ length: PER_LOCK }, (_, k) => pos.getY(base + k)),
      visible: s.points.visible,
    });
  }
  return frames;
}

describe("an opened lock's sparkle", () => {
  it("puts its glints on the outline's sharpest tips, spread apart: the Moon's two horns among them", () => {
    const moon = box1.locks[0]!;
    expect(moon.shape).toBe("Moon");
    const tips = sharpTips(moon.target, G, SPARKLE.tipGap * moon.size);
    expect(tips.length).toBe(G);
    const all = corners(moon);
    // Each tip is a corner of the outline, and a convex one (just inside it along its bisector lies the shape).
    for (const t of tips) expect(all.some((c) => Math.hypot(c.p[0] - t[0], c.p[1] - t[1]) < 1e-9)).toBe(true);
    for (let i = 0; i < tips.length; i++) {
      for (let j = i + 1; j < tips.length; j++) {
        expect(Math.hypot(tips[i]![0] - tips[j]![0], tips[i]![1] - tips[j]![1])).toBeGreaterThanOrEqual(SPARKLE.tipGap * moon.size - 1e-9);
      }
    }
    // Every glint is on a convex corner, and the two sharpest convex corners (the horns) are the first two glints.
    for (const t of tips) expect(all.find((c) => Math.hypot(c.p[0] - t[0], c.p[1] - t[1]) < 1e-9)!.convex).toBe(true);
    const horns = all.filter((c) => c.convex).slice(0, 2).map((c) => c.p);
    for (const h of horns) expect(tips.slice(0, 2).some((t) => Math.hypot(t[0] - h[0], t[1] - h[1]) < 1e-9)).toBe(true);
  });

  it("glints flare one after another at most three a second, glitter rises and fades, and all of it is gone at the end", () => {
    const s = new Sparkle();
    s.setBox(box1);
    expect(s.points.visible).toBe(false);
    s.burst(0, 1, false);
    expect(s.running).toBe(true);
    const frames = run(s, 0, SPARKLE_S + 0.1);
    // Each glint flares to full once, in order, its peak at least MIN_GAP_S after the one before.
    const peaks = Array.from({ length: G }, (_, k) => frames.reduce((best, f, i) => (f.bright[k]! > frames[best]!.bright[k]! ? i : best), 0));
    for (let k = 0; k < G; k++) expect(frames[peaks[k]!]!.bright[k]!).toBeGreaterThan(0.9);
    for (let k = 1; k < G; k++) expect((peaks[k]! - peaks[k - 1]!) * DT).toBeGreaterThanOrEqual(MIN_GAP_S - DT);
    // Never two glints near their peak at once.
    for (const f of frames) expect(f.bright.slice(0, G).filter((b) => b > 0.6).length).toBeLessThanOrEqual(1);
    // Each spark rises while it shows (by most of the rise) and fades out.
    for (let k = G; k < PER_LOCK; k++) {
      const lit = frames.filter((f) => f.bright[k]! > 0);
      expect(lit.length).toBeGreaterThan(10);
      expect(lit.at(-1)!.y[k]! - lit[0]!.y[k]!).toBeGreaterThan(0.8 * SPARKLE.rise);
      for (let i = 1; i < lit.length; i++) expect(lit[i]!.y[k]!).toBeGreaterThanOrEqual(lit[i - 1]!.y[k]! - 1e-9);
    }
    expect(Math.max(...frames.flatMap((f) => f.bright.slice(G)))).toBeGreaterThan(0.5);
    // All of it gone, and nothing drawn.
    const last = frames.at(-1)!;
    expect(last.bright.every((b) => b === 0)).toBe(true);
    expect(last.visible).toBe(false);
    expect(s.running).toBe(false);
  });

  it("each spark twinkles no faster than three times a second", () => {
    const s = new Sparkle();
    s.setBox(box1);
    s.burst(0, 1, false);
    const frames = run(s, 0, SPARKLE_S + 0.1);
    for (let k = G; k < PER_LOCK; k++) {
      const b = frames.map((f) => f.bright[k]!);
      const on = b.filter((x) => x > 0).length * DT;
      let maxima = 0;
      for (let i = 1; i + 1 < b.length; i++) if (b[i]! > b[i - 1]! && b[i]! >= b[i + 1]! && b[i]! > 0.02) maxima++;
      expect(maxima).toBeLessThanOrEqual(Math.ceil(3 * on));
    }
  });

  it("reduced motion: no glitter, and the glints fade in place at one size", () => {
    const s = new Sparkle();
    s.setBox(box1);
    s.burst(0, 1, true);
    const frames = run(s, 0, SPARKLE_S + 0.1);
    expect(frames.every((f) => f.bright.slice(G).every((b) => b === 0))).toBe(true);
    for (let k = 0; k < G; k++) {
      const sizes = frames.filter((f) => f.bright[k]! > 0).map((f) => f.size[k]!);
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(1e-9);
    }
    expect(Math.max(...frames.flatMap((f) => f.bright.slice(0, G)))).toBeGreaterThan(0.9);
  });

  it("an opening the flash budget refused sparkles at its strength", () => {
    const s = new Sparkle();
    s.setBox(box1);
    s.burst(0, 0.5, false);
    const frames = run(s, 0, SPARKLE_S + 0.1);
    expect(Math.max(...frames.flatMap((f) => f.bright))).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(Math.max(...frames.flatMap((f) => f.bright))).toBeGreaterThan(0.4);
  });

  it("three locks in one draw, each lock's sparkle on its own shape; a new box clears it; buffers made once", () => {
    const s = new Sparkle();
    s.setBox(box5);
    const pos = s.points.geometry.getAttribute("position") as BufferAttribute;
    const arr = pos.array;
    for (const l of box5.locks) s.burst(l.i, 1, false);
    for (let i = 0; i < 20; i++) s.update(DT);
    expect(s.points.visible).toBe(true);
    for (const l of box5.locks) {
      for (let k = 0; k < PER_LOCK; k++) {
        const x = pos.getX(l.i * PER_LOCK + k), y = pos.getY(l.i * PER_LOCK + k);
        // Within the lock's reach (its size), plus the glitter's rise and drift.
        expect(Math.hypot(x - l.center[0], y - l.center[1])).toBeLessThan(l.size + SPARKLE.rise + SPARKLE.drift);
      }
    }
    expect(pos.array).toBe(arr);
    s.setBox(null);
    expect(s.running).toBe(false);
    expect(s.points.visible).toBe(false);
    expect(Array.from(s.bright).every((b) => b === 0)).toBe(true);
    // A lock that is not in the box does nothing.
    s.burst(2, 1, false);
    expect(s.running).toBe(false);
  });

  it("draws each point as a four-point star, sized per point, added as light", () => {
    const s = new Sparkle();
    const mat = s.points.material as PointsMaterial;
    expect(mat.vertexColors).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.toneMapped).toBe(false);
    const shader = { vertexShader: ShaderLib.points.vertexShader, fragmentShader: ShaderLib.points.fragmentShader, uniforms: {} };
    mat.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, undefined as never);
    expect(shader.vertexShader).toContain("attribute float aSize;");
    expect(shader.vertexShader).toContain("gl_PointSize = size * aSize;");
    expect(shader.fragmentShader).toContain("gl_PointCoord");
    expect(shader.fragmentShader).not.toContain("#include <map_particle_fragment>");
  });
});
