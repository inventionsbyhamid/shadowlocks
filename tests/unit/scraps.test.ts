import { describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import { proj } from "../../src/core/geom";
import { mirrorBox } from "../../src/core/mirror";
import type { Box, V3 } from "../../src/core/types";
import {
  MAX_SCRAP_VERTS,
  MAX_SLOTS,
  MAX_THREAD_VERTS,
  RING_TUBE_SEGMENTS,
  ringRadii,
  SCRAP_GAP,
  SCRAP_THICKNESS,
  slotOf,
  THREAD_TOP_Y,
  writeScraps,
  writeThreads,
} from "../../src/render/scraps";

const boxes: Box[] = [];
for (let n = 1; n <= 30; n++) boxes.push(generateBox({ kind: "box", n }));
const all = [...boxes, ...boxes.map(mirrorBox)];

const buffers = () => ({
  position: new Float32Array(MAX_SCRAP_VERTS * 3),
  normal: new Float32Array(MAX_SCRAP_VERTS * 3),
  slot: new Float32Array(MAX_SCRAP_VERTS),
});
const v3 = (a: Float32Array, i: number): V3 => [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe("slots", () => {
  it("gives every lock piece its own slot below MAX_SLOTS, and decoys slot 0", () => {
    const seen = new Set<number>();
    for (let l = 0; l < 3; l++) for (let p = 0; p < 16; p++) {
      const s = slotOf(l, p);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(MAX_SLOTS);
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
    for (const b of all) for (const e of b.elements) if (e.kind === "piece") expect(e.piece).toBeLessThan(16);
  });
});

describe("writeScraps", () => {
  it("fits boxes 1..30 (and mirrored) in the buffers, three vertices a triangle", () => {
    const out = buffers();
    for (const b of all) {
      const n = writeScraps(b, out);
      expect(n % 3).toBe(0);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(MAX_SCRAP_VERTS);
    }
  });

  it("winds every triangle the way its normal points, and the sides and pins outward, whatever the outline's winding (Diamond is clockwise, mirroring flips all)", () => {
    const out = buffers();
    let checked = 0;
    const mean = (from: number, count: number): V3 => {
      const m: V3 = [0, 0, 0];
      for (let i = from; i < from + count; i++) {
        const p = v3(out.position, i);
        m[0] += p[0] / count;
        m[1] += p[1] / count;
        m[2] += p[2] / count;
      }
      return m;
    };
    const face = (t: number, mid: V3 | null) => {
      const a = v3(out.position, t), c = v3(out.position, t + 1), d = v3(out.position, t + 2);
      const g = cross(sub(c, a), sub(d, a));
      const area = Math.hypot(...g);
      if (area < 1e-12) return;
      expect(dot(g, v3(out.normal, t)) / area).toBeGreaterThan(0.9);
      if (mid) expect(dot(g, sub([(a[0] + c[0] + d[0]) / 3, (a[1] + c[1] + d[1]) / 3, (a[2] + c[2] + d[2]) / 3], mid))).toBeGreaterThan(0);
      checked++;
    };
    for (const b of all) {
      writeScraps(b, out);
      let at = 0;
      for (const e of b.elements) {
        if (e.kind !== "ring") {
          // Front and back fans (their facing is checked below), then the side walls, outward from the scrap's middle.
          const k = e.verts.length, fans = (k - 2) * 6, solid = fans + k * 6, mid = mean(at, solid);
          for (let t = at; t < at + fans; t += 3) face(t, null);
          for (let t = at + fans; t < at + solid; t += 3) face(t, mid);
          at += solid;
        }
        const pin = mean(at, 24);
        for (let t = at; t < at + 24; t += 3) face(t, pin);
        at += 24;
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("faces each piece's front toward its lantern spot and gives it a thickness away from it", () => {
    const out = buffers();
    for (const b of all.slice(0, 30)) {
      writeScraps(b, out);
      let at = 0;
      for (const e of b.elements) {
        if (e.kind === "ring") {
          at += 24;
          continue;
        }
        const k = e.verts.length;
        // A piece's front faces its lock's spot; a decoy's faces the open front (+z).
        const toward = (p: V3): V3 => (e.kind === "piece" ? sub(b.locks[e.lock]!.L, p) : [0, 0, 1]);
        for (let t = at; t < at + (k - 2) * 3; t += 3) expect(dot(v3(out.normal, t), toward(v3(out.position, t)))).toBeGreaterThan(0);
        for (let t = at + (k - 2) * 3; t < at + (k - 2) * 6; t += 3) expect(dot(v3(out.normal, t), toward(v3(out.position, t)))).toBeLessThan(0);
        at += (k - 2) * 6 + k * 6 + 24;
      }
    }
    expect(SCRAP_THICKNESS).toBeGreaterThan(0);
  });

  it("tags each vertex with its element's slot", () => {
    const out = buffers();
    const b = boxes[14]!;
    const n = writeScraps(b, out);
    const slots = new Set<number>();
    for (let i = 0; i < n; i++) slots.add(out.slot[i]!);
    const want = new Set<number>([0]);
    for (const e of b.elements) if (e.kind === "piece") want.add(slotOf(e.lock, e.piece));
    expect([...slots].sort((x, y) => x - y)).toEqual([...want].sort((x, y) => x - y));
  });

  it("insets each front face inside its outline (the full gap but at sharp corners), so pieces that meet edge to edge never share a face", () => {
    const out = buffers();
    const insides: number[] = [];
    for (const b of all) {
      writeScraps(b, out);
      // Walk the elements in order the way writeScraps does: the front fan comes first per element.
      let at = 0;
      for (const e of b.elements) {
        if (e.kind === "ring") {
          at += 24; // the thread pin only
          continue;
        }
        const k = e.verts.length;
        // A piece is checked as seen from its spot, against its lock's own outline piece; a decoy straight on.
        const L = e.kind === "piece" ? b.locks[e.lock]!.L : null;
        const seen = (p: V3): [number, number] => (L ? proj(p, L) : [p[0], p[1]]);
        const front: [number, number][] = [];
        for (let i = 0; i < (k - 2) * 3; i++) front.push(seen(v3(out.position, at + i)));
        const P = e.kind === "piece" ? b.locks[e.lock]!.target[e.piece]! : e.verts.map((v): [number, number] => [v[0], v[1]]);
        const sgn = Math.sign(P.reduce((s, p, i) => {
          const q = P[(i + 1) % P.length]!;
          return s + p[0] * q[1] - q[0] * p[1];
        }, 0));
        for (const f of front) {
          let least = Infinity;
          for (let i = 0; i < P.length; i++) {
            const p = P[i]!, q = P[(i + 1) % P.length]!;
            const ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey);
            least = Math.min(least, (sgn * (ex * (f[1] - p[1]) - ey * (f[0] - p[0]))) / l);
          }
          // Strictly inside: two neighbours can never share a face.
          expect(least).toBeGreaterThan(SCRAP_GAP * 0.1);
          insides.push(least);
        }
        at += (k - 2) * 6 + k * 6 + 24;
      }
    }
    // Nearly every corner gets the whole gap; only sharp corners of small pieces get less.
    const full = insides.filter((d) => d >= SCRAP_GAP * 0.99).length / insides.length;
    expect(full).toBeGreaterThan(0.9);
  });
});

describe("writeThreads", () => {
  it("hangs one thread per drawn element from its top to under the box lid", () => {
    const pos = new Float32Array(MAX_THREAD_VERTS * 3), slot = new Float32Array(MAX_THREAD_VERTS);
    for (const b of all) {
      const n = writeThreads(b, { position: pos, slot });
      expect(n).toBe(b.elements.length * 2);
      for (let i = 0; i < n; i += 2) {
        const top = v3(pos, i + 1), low = v3(pos, i);
        expect(top[1]).toBeCloseTo(THREAD_TOP_Y, 6);
        expect(top[0]).toBeCloseTo(low[0], 6);
        expect(top[2]).toBeCloseTo(low[2], 6);
        expect(low[1]).toBeLessThan(THREAD_TOP_Y);
      }
    }
  });
});

describe("ringRadii", () => {
  it("draws a ring as a torus between its inner and outer radius", () => {
    const [R, r] = ringRadii({ kind: "ring", lock: 0, c: [0, 0, 0.5], nrm: [0, 0, 1], rOut: 0.032, rIn: 0.017 });
    expect(R + r).toBeCloseTo(0.032, 9);
    expect(R - r).toBeCloseTo(0.017, 9);
    expect(RING_TUBE_SEGMENTS).toBeGreaterThanOrEqual(6);
  });
});
