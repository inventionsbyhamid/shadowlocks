import { describe, expect, it } from "vitest";
import { type BufferAttribute, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial, Vector3 } from "@iwsdk/core";
import { generateBox } from "../../src/core/generator";
import type { Box, Lock, V2, V3 } from "../../src/core/types";
import type { BoxScene } from "../../src/render/box-scene";
import { CRYSTAL_FILL_MS, CRYSTAL_MS, Crystals, crystallise } from "../../src/render/fx/crystallise";
import { MIN_GAP_S } from "../../src/render/fx/flash-budget";
import { penumbra } from "../../src/render/shadow-mesh";

const DT_S = 1 / 72;
const box3 = generateBox({ kind: "box", n: 3 });
const fingerLock = (b: Box = box3): Lock => b.locks.find((l) => l.finger)!;
const proj = (P: V3, L: V3): V2 => {
  const k = L[2] / (L[2] - P[2]);
  return [L[0] + (P[0] - L[0]) * k, L[1] + (P[1] - L[1]) * k];
};
const near = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

function setup(b: Box = box3) {
  const c = new Crystals(null);
  c.setBox(b);
  const lock = fingerLock(b);
  const slot = c.slots[lock.i]!;
  const fillMat = slot.fill.material as MeshBasicMaterial;
  const pieceMat = slot.piece.material as MeshStandardMaterial;
  /** One frame: what shows, and how bright. */
  const frame = () => {
    c.update(DT_S);
    return {
      fill: slot.fill.visible ? fillMat.opacity : 0,
      piece: slot.piece.visible,
      scale: slot.piece.scale.x,
      glow: slot.piece.visible ? pieceMat.emissiveIntensity : 0,
      glitter: slot.glitter.visible,
    };
  };
  return { c, lock, slot, frame };
}

/** Every vertex the piece mesh draws, in box units. */
function pieceVerts(mesh: Mesh): V3[] {
  const pos = mesh.geometry.getAttribute("position") as BufferAttribute;
  const n = mesh.geometry.drawRange.count;
  const v = new Vector3(), out: V3[] = [];
  mesh.updateMatrix();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

describe("crystallise", () => {
  it("forms the missing piece at the finger's depth on the rays from the spot, so it casts the missing outline", async () => {
    const { c, lock, slot, frame } = setup();
    let resolved = false;
    void c.form(lock, 0.45).then(() => (resolved = true));
    for (let t = 0; t < CRYSTAL_MS + 50; t += DT_S * 1000) frame();
    await Promise.resolve();
    expect(resolved).toBe(true);
    const p = c.piece(lock.i)!;
    expect(p.formed).toBe(true);
    expect(p.z).toBe(0.45);
    const outline = lock.target[lock.missing]!;
    expect(p.verts.length).toBe(outline.length);
    for (const v of p.verts) {
      expect(v[2]).toBeCloseTo(0.45, 9);
      expect(outline.some((o) => near(proj(v, lock.L), o))).toBe(true);
    }
    // Every corner it draws, front and back, lies on a ray from the spot through a corner of the outline.
    const drawn = pieceVerts(slot.piece);
    expect(drawn.length).toBeGreaterThan(0);
    for (const v of drawn) expect(outline.some((o) => near(proj(v, lock.L), o))).toBe(true);
    expect(drawn.some((v) => v[2] < 0.45 - 1e-4)).toBe(true);
  });

  it("gold fills the gap for 300 ms, then the piece forms; 700 ms in all", async () => {
    const { c, lock, slot, frame } = setup();
    let resolved = false;
    void c.form(lock, 0.5).then(() => (resolved = true));
    // The fill covers exactly the missing outline, just in front of the panel.
    const pos = slot.fill.geometry.getAttribute("position") as BufferAttribute;
    const outline = lock.target[lock.missing]!;
    for (let i = 0; i < outline.length; i++) {
      expect(near([pos.getX(i), pos.getY(i)], outline[i]!)).toBe(true);
      expect(pos.getZ(i)).toBeGreaterThan(0.002);
      expect(pos.getZ(i)).toBeLessThan(0.01);
    }
    const frames = [];
    let t = 0;
    for (; t < CRYSTAL_MS - 20; t += DT_S * 1000) frames.push({ t: t + DT_S * 1000, ...frame() });
    await Promise.resolve();
    expect(resolved).toBe(false);
    const fill = frames.filter((f) => f.t <= CRYSTAL_FILL_MS);
    const after = frames.filter((f) => f.t > CRYSTAL_FILL_MS + 1);
    // Rising to full over 300 ms, with no piece yet.
    for (let i = 1; i < fill.length; i++) expect(fill[i]!.fill).toBeGreaterThan(fill[i - 1]!.fill);
    expect(fill.at(-1)!.fill).toBeGreaterThan(0.95);
    expect(fill.every((f) => !f.piece)).toBe(true);
    // Then the piece, the fill handing its gold over to it.
    expect(after.every((f) => f.piece)).toBe(true);
    for (let i = 1; i < after.length; i++) expect(after[i]!.fill).toBeLessThanOrEqual(after[i - 1]!.fill);
    for (let t2 = 0; t2 < 60; t2 += DT_S * 1000) frame();
    await Promise.resolve();
    expect(resolved).toBe(true);
    expect(slot.fill.visible).toBe(false);
    expect(slot.piece.visible).toBe(true);
    expect(slot.piece.scale.x).toBe(1);
    expect(slot.glitter.visible).toBe(false);
  });

  it("is one flash, never two starts within a third of a second", () => {
    const { c, lock, frame } = setup();
    void c.form(lock, 0.5);
    const b: number[] = [];
    for (let t = 0; t < CRYSTAL_MS + 30; t += DT_S * 1000) {
      const f = frame();
      b.push(Math.max(f.fill, f.glow / 2));
    }
    // One rise and one fall: a single peak.
    const peak = b.indexOf(Math.max(...b));
    for (let i = 1; i <= peak; i++) expect(b[i]!).toBeGreaterThanOrEqual(b[i - 1]!);
    for (let i = peak + 1; i < b.length; i++) expect(b[i]!).toBeLessThanOrEqual(b[i - 1]! + 1e-9);
    expect(c.flashes).toBe(1);
    // Another crystallise at once (a second finger lock) does not flash again: it fills at half strength.
    const two = generateBox({ kind: "box", n: 10 });
    const locks = two.locks.filter((l) => l.finger);
    expect(locks.length).toBe(2);
    const d = new Crystals(null);
    d.setBox(two);
    void d.form(locks[0]!, 0.5);
    void d.form(locks[1]!, 0.5);
    let top0 = 0, top1 = 0;
    for (let t = 0; t < MIN_GAP_S * 1000; t += DT_S * 1000) {
      d.update(DT_S);
      top0 = Math.max(top0, (d.slots[locks[0]!.i]!.fill.material as MeshBasicMaterial).opacity);
      top1 = Math.max(top1, (d.slots[locks[1]!.i]!.fill.material as MeshBasicMaterial).opacity);
    }
    expect(d.flashes).toBe(1);
    expect(top1).toBeLessThan(0.6 * top0);
  });

  it("reduced motion: no glitter and no growth, still the fill and the piece", () => {
    for (const reducedMotion of [false, true]) {
      const { c, lock, frame } = setup();
      void c.form(lock, 0.5, { reducedMotion });
      const fs = [];
      for (let t = 0; t < CRYSTAL_MS + 30; t += DT_S * 1000) fs.push(frame());
      expect(Math.max(...fs.map((f) => f.fill))).toBeGreaterThan(0.95);
      expect(fs.at(-1)!.piece).toBe(true);
      const shown = fs.filter((f) => f.piece);
      if (reducedMotion) {
        expect(fs.some((f) => f.glitter)).toBe(false);
        expect(shown.every((f) => f.scale === 1)).toBe(true);
      } else {
        expect(fs.some((f) => f.glitter)).toBe(true);
        expect(shown[0]!.scale).toBeLessThan(1);
      }
    }
  });

  it("a new box clears the pieces and settles a crystallise still running", async () => {
    const { c, lock, slot, frame } = setup();
    let resolved = false;
    void c.form(lock, 0.5).then(() => (resolved = true));
    for (let i = 0; i < 15; i++) frame();
    c.setBox(generateBox({ kind: "box", n: 4 }));
    await Promise.resolve();
    expect(resolved).toBe(true);
    expect(c.piece(lock.i)).toBeNull();
    expect([slot.fill.visible, slot.piece.visible, slot.glitter.visible]).toEqual([false, false, false]);
  });

  it("place shows a formed piece at once (a box resumed with its pieces)", () => {
    const { c, lock, slot } = setup();
    c.place(lock, 0.4);
    expect(c.piece(lock.i)).toMatchObject({ z: 0.4, formed: true });
    expect([slot.fill.visible, slot.piece.visible, slot.glitter.visible]).toEqual([false, true, false]);
    expect(slot.piece.scale.x).toBe(1);
    expect(c.flashes).toBe(0);
  });

  it("the piece casts the missing outline from the spot, at its depth's softness, once it shows", () => {
    const { c, lock, frame } = setup();
    const out: V2[][] = [], soft = new Float32Array(4);
    expect(c.castShadows(lock.L, out, soft)).toBe(0);
    const v0 = c.version;
    void c.form(lock, 0.45);
    expect(c.version).toBeGreaterThan(v0);
    // No piece yet while the gold fills.
    for (let t = 0; t < CRYSTAL_FILL_MS - 20; t += DT_S * 1000) frame();
    expect(c.castShadows(lock.L, out, soft)).toBe(0);
    for (let t = 0; t < CRYSTAL_MS; t += DT_S * 1000) frame();
    const outline = lock.target[lock.missing]!;
    expect(c.castShadows(lock.L, out, soft)).toBe(1);
    expect(out[0]!.length).toBe(outline.length);
    for (const p of out[0]!) expect(outline.some((o) => near(p, o))).toBe(true);
    expect(soft[0]).toBeCloseTo(penumbra(0.45, lock.L[2]), 6);
    // From elsewhere it is the piece's own shadow, still a polygon of the same corners, the same array.
    const arr = out[0]!, L2: V3 = [lock.L[0] + 0.1, lock.L[1], lock.L[2] + 0.2];
    c.castShadows(L2, out, soft);
    expect(out[0]).toBe(arr);
    const p = c.piece(lock.i)!;
    p.verts.forEach((v, i) => expect(near(out[0]![i]!, proj(v, L2))).toBe(true));
    // A new box: nothing.
    c.setBox(null);
    expect(c.castShadows(lock.L, out, soft)).toBe(0);
  });

  it("crystallise(scene, lock, fingerZ) runs in the box scene's crystals", () => {
    const { c, lock } = setup();
    const run = crystallise({ crystals: c } as unknown as BoxScene, lock, 0.55);
    expect(run).toBeInstanceOf(Promise);
    expect(c.piece(lock.i)).toMatchObject({ z: 0.55, formed: false });
  });
});
