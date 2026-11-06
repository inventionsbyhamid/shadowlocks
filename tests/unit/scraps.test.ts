import { describe, expect, it } from "vitest";
import { type Material, ShaderLib } from "@iwsdk/core";
import { generateBox } from "../../src/core/generator";
import { inPoly, proj } from "../../src/core/geom";
import { LESSON_1 } from "../../src/core/lessons-data";
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
  Scraps,
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

  it("fills a scrap that is not convex (lesson 1's Moon) by its own outline, never across its hollow", () => {
    const out = buffers();
    writeScraps(LESSON_1, out);
    const moon = LESSON_1.elements[0]!;
    if (moon.kind !== "piece" || moon.lock !== 0) throw new Error("lesson 1 starts with its Moon");
    const L = LESSON_1.locks[0]!.L, outline = LESSON_1.locks[0]!.target[0]!, k = moon.verts.length;
    // Its front and back faces, k - 2 triangles each: every triangle's middle, seen from the spot, is in the Moon.
    for (let t = 0; t < (k - 2) * 6; t += 3) {
      const a = v3(out.position, t), b = v3(out.position, t + 1), c = v3(out.position, t + 2);
      const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      expect(inPoly(proj(mid, L), outline), `triangle ${t / 3}`).toBe(true);
    }
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

describe("Scraps (no renderer)", () => {
  const glowOf = (s: Scraps, slot: number) => s.slots[slot * 2]!;
  const shownOf = (s: Scraps, slot: number) => s.slots[slot * 2 + 1]!;
  /** Box 3 is the first with a finger lock. */
  const fingerBox = boxes[2]!;
  const fingerLock = fingerBox.locks.find((l) => l.finger)!;

  it("writes a piece's glow and visibility into its own slot, and nothing else", () => {
    const s = new Scraps(null);
    s.setBox(boxes[14]!);
    const before = Float32Array.from(s.slots);
    const h = s.handle(1, 2), slot = slotOf(1, 2);
    h.setGlow(0.7);
    expect(glowOf(s, slot)).toBeCloseTo(0.7, 6);
    h.setVisible(false);
    expect(shownOf(s, slot)).toBe(0);
    h.setVisible(true);
    expect(shownOf(s, slot)).toBe(1);
    for (let i = 0; i < s.slots.length; i++) if (i !== slot * 2) expect(s.slots[i]).toBe(before[i]);
    // One handle per piece: the same object every call.
    expect(s.handle(1, 2)).toBe(h);
  });

  it("starts a finger lock's missing piece hidden and every other piece shown, with no glow", () => {
    const s = new Scraps(null);
    s.setBox(fingerBox);
    expect(fingerLock.missing).toBeGreaterThanOrEqual(0);
    for (const e of fingerBox.elements) {
      if (e.kind !== "piece") continue;
      const slot = slotOf(e.lock, e.piece);
      expect(shownOf(s, slot), `lock ${e.lock} piece ${e.piece}`).toBe(e.missing ? 0 : 1);
      expect(glowOf(s, slot)).toBe(0);
    }
    expect(shownOf(s, slotOf(fingerLock.i, fingerLock.missing))).toBe(0);
  });

  it("lights only one lock's sight rings (a hint), and a new box puts them out", () => {
    const s = new Scraps(null);
    const b = boxes[4]!;
    s.setBox(b);
    const rings = b.elements.filter((e) => e.kind === "ring");
    const ringed = b.locks.find((l) => l.rings)!;
    s.setRingGlow(ringed.i, 0.9);
    rings.forEach((r, k) => expect(s.ringGlowOf(k), `ring ${k}`).toBeCloseTo(r.lock === ringed.i ? 0.9 : 0, 6));
    expect(rings.filter((r) => r.lock === ringed.i)).toHaveLength(2);
    s.setBox(boxes[1]!);
    for (let k = 0; k < s.rings.count; k++) expect(s.ringGlowOf(k)).toBe(0);
  });

  it("resets every slot for a new box (and for none)", () => {
    const s = new Scraps(null);
    s.setBox(fingerBox);
    s.handle(fingerLock.i, fingerLock.missing).setVisible(true);
    s.handle(0, 0).setGlow(1);
    s.handle(0, 1).setVisible(false);
    s.setBox(boxes[0]!);
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
      expect(glowOf(s, slot)).toBe(0);
      expect(shownOf(s, slot)).toBe(1);
    }
    s.handle(0, 0).setGlow(1);
    s.setBox(null);
    expect(glowOf(s, slotOf(0, 0))).toBe(0);
    expect(s.mesh.geometry.drawRange.count).toBe(0);
    expect(s.rings.count).toBe(0);
  });

  it("patches three's standard and basic shaders where it means to (a three update that moves a chunk fails here)", () => {
    const s = new Scraps(null);
    const patch = (m: Material, lib: { vertexShader: string; fragmentShader: string }) => {
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, { value: unknown }> };
      m.onBeforeCompile(shader as never, null as never);
      return shader;
    };
    // The scrap mesh (a standard material): hidden pieces collapse, glow adds to the emissive light; no discard.
    const scrap = patch(s.mesh.material as Material, ShaderLib.standard);
    expect(scrap.vertexShader).toContain("vec2 slotState = uSlots[int(aSlot + 0.5)];");
    expect(scrap.vertexShader).toContain("if (slotState.y < 0.5) transformed = vec3(0.0);");
    expect(scrap.vertexShader).toContain("#include <begin_vertex>");
    expect(scrap.fragmentShader).toContain("totalEmissiveRadiance += uGlowColor * vGlow;");
    expect(scrap.fragmentShader).not.toContain("if (vShow < 0.5) discard;");
    expect(scrap.uniforms.uSlots!.value).toBe(s.slots);
    // The threads (a basic line material): the same collapse, glow tints the colour, and a hidden thread is discarded.
    const thread = patch(s.threads.material as Material, ShaderLib.basic);
    expect(thread.vertexShader).toContain("if (slotState.y < 0.5) transformed = vec3(0.0);");
    expect(thread.fragmentShader).toContain("diffuseColor.rgb += uGlowColor * vGlow;");
    expect(thread.fragmentShader).toContain("if (vShow < 0.5) discard;");
    expect(thread.uniforms.uSlots!.value).toBe(s.slots);
    // The rings: each instance's torus sized from its own radii.
    const ring = patch(s.rings.material as Material, ShaderLib.standard);
    expect(ring.vertexShader).toContain("vec3 transformed = vec3((aRadii.x + aRadii.y * aTorus.z) * aTorus.xy, aRadii.y * aTorus.w);");
    expect(ring.vertexShader).not.toContain("#include <begin_vertex>");
    // ...and its glow (a hint) added to the emissive light.
    expect(ring.vertexShader).toContain("vRingGlow = aGlow;");
    expect(ring.fragmentShader).toContain("totalEmissiveRadiance += uGlowColor * vRingGlow;");
  });
});
