// The shadow update redoes only what changed, and writes exactly what a full cast writes. A recorded sequence (a
// lantern sweep, a hand entering, resting and leaving the beam, a finger's outline changing alone, the lantern on
// 0 and -0, below its clamp, a piece showing, a lesson's swing, a box change, the heaviest box, a left-handed box,
// a restored GPU context, direct casts) is played through BASE's BoxShadows and ShadowMesh (frozen in
// helpers/legacy-shadows) and the current ones side by side: after every step every output array is the same, byte
// for byte. Then the dirty keys: every input change rebuilds what it must, and nothing else.
import type { BufferAttribute } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import { mirrorBox } from "../../src/core/mirror";
import type { Box, Piece, Ring, V2, V3 } from "../../src/core/types";
import { BoxShadows, MAX_EXTRAS } from "../../src/render/box-shadows";
import { heaviestBox } from "../e2e/helpers/heavy-box";
import { BoxShadows as OldShadows } from "./helpers/legacy-shadows/box-shadows";

type Mesh = BoxShadows["mesh"] | OldShadows["mesh"];

const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

/** Every output the mesh hands the GPU, and what decides what is drawn. */
function same(a: Mesh, b: Mesh, at: string): void {
  expect(bytes(a.positions).equals(bytes(b.positions)), `${at}: positions`).toBe(true);
  expect(bytes(a.alphas).equals(bytes(b.alphas)), `${at}: alphas`).toBe(true);
  expect(bytes(a.indices).equals(bytes(b.indices)), `${at}: indices`).toBe(true);
  expect(a.vertexCount, `${at}: vertices`).toBe(b.vertexCount);
  expect(a.indexCount, `${at}: indices drawn`).toBe(b.indexCount);
  const ra = a.mesh.geometry.drawRange, rb = b.mesh.geometry.drawRange;
  expect([ra.start, ra.count], `${at}: draw range`).toEqual([rb.start, rb.count]);
  expect(a.mesh.visible, `${at}: visible`).toBe(b.mesh.visible);
  // The position upload: the same range, asked for at the same moments.
  const ua = a.mesh.geometry.getAttribute("position") as BufferAttribute, ub = b.mesh.geometry.getAttribute("position") as BufferAttribute;
  expect([ua.version, ua.updateRanges[0]?.count], `${at}: position upload`).toEqual([ub.version, ub.updateRanges[0]?.count]);
}

/** A hand's 18 bones as capsule outlines (`corners` each) round a point, turned by `turn`: a stand-in for hand-shadow's. */
function hand(x: number, y: number, turn: number, corners = 10, bones = 18): V2[][] {
  return Array.from({ length: bones }, (_, b) => {
    const cx = x + 0.025 * (b % 5) * Math.cos(turn), cy = y + 0.03 * Math.floor(b / 5) + 0.025 * (b % 5) * Math.sin(turn);
    const r = 0.008 + 0.001 * (b % 3);
    return Array.from({ length: corners }, (_, i): V2 => {
      const a = (2 * Math.PI * i) / corners + turn;
      return [cx + r * Math.cos(a) * (i < corners / 2 ? 1.6 : 1), cy + r * Math.sin(a)];
    });
  });
}

const softOf = (n: number, k: number) => Float32Array.from({ length: n }, (_, i) => 0.003 + 0.0005 * ((i + k) % 7));

/** Old and new side by side: every step goes to both, then everything they hand the GPU is compared. */
class Pair {
  show = new Set<Piece>();
  readonly old: OldShadows;
  readonly now: BoxShadows;
  private step = 0;

  constructor() {
    const shown = (p: Piece) => !p.missing || this.show.has(p);
    this.old = new OldShadows(shown);
    this.now = new BoxShadows(shown);
  }

  setBox(b: Box | null): void {
    this.old.setBox(b);
    this.now.setBox(b);
    this.check("setBox");
  }

  refresh(L: V3, extra?: V2[][], n = 0, soft?: Float32Array, changed = false): void {
    const a = this.old.refresh(L, extra, n, soft, changed), b = this.now.refresh(L, extra, n, soft, changed);
    expect(b, `step ${this.step}: refresh's answer`).toBe(a);
    this.check("refresh");
  }

  cast(L: V3, extra?: V2[][], n = 0, soft?: Float32Array): void {
    this.old.cast(L, extra, n, soft);
    this.now.cast(L, extra, n, soft);
    this.check("cast");
  }

  moved(): void {
    this.old.moved();
    this.now.moved();
  }

  check(what: string): void {
    const at = `step ${this.step++} (${what})`;
    same(this.now.mesh, this.old.mesh, at);
    expect(this.now.boxSlots, `${at}: box slots`).toBe(this.old.boxSlots);
  }
}

/** The lantern along a path from a to b in `n` steps. */
const path = (a: Readonly<V3>, b: Readonly<V3>, n: number): V3[] =>
  Array.from({ length: n + 1 }, (_, i): V3 => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n]);

/** The sequence for one box: sweeps, a hand in and out of the beam, rests, a finger alone, 0 and -0, the clamp. */
function play(p: Pair, box: Box): void {
  p.setBox(box);
  const L0 = box.start, L1 = box.locks[0]!.L, L2 = box.locks[box.locks.length - 1]!.L;
  // A sweep with no hand: the box alone.
  for (const L of path(L0, L1, 12)) p.refresh(L);
  // Resting: nothing to do (both say so).
  p.refresh(L1);
  // A hand enters, bone by bone, moving.
  for (let i = 1; i <= 18; i += 3) p.refresh(L1, hand(0.1 + i * 0.005, -0.1, i * 0.05), i, softOf(i, i), true);
  // The hand still in the beam, the lantern resting: the box keeps its slots, the hand too.
  const still = hand(0.2, -0.1, 0.3);
  for (let i = 0; i < 4; i++) p.refresh(L1, still, 18, softOf(18, 0), true);
  // Only the finger (the last outline) moves, then only one bone's softness.
  const finger = hand(0.2, -0.1, 0.3);
  for (let i = 0; i < 3; i++) {
    finger[17] = finger[17]!.map(([x, y]): V2 => [x + 0.002 * (i + 1), y]);
    p.refresh(L1, finger, 18, softOf(18, 0), true);
  }
  const soft = softOf(18, 0);
  soft[4] = 0.009;
  p.refresh(L1, finger, 18, soft, true);
  // The lantern sweeps with the hand held still in the beam.
  for (const L of path(L1, L2, 8)) p.refresh(L, still, 18, softOf(18, 0), true);
  // Other bone shapes (another corner count): laid out again.
  p.refresh(L2, hand(0.2, -0.1, 0.3, 12), 18, softOf(18, 1), true);
  p.refresh(L2, hand(0.2, -0.1, 0.3, 12), 18, softOf(18, 1), true);
  // The lantern on x = 0 and y = 0, then -0, the hand still: the box casts again for -0.
  p.refresh([0, 0, 1.2], still, 18, softOf(18, 0), true);
  p.refresh([-0, -0, 1.2], still, 18, softOf(18, 0), true);
  p.refresh([0, -0, 1.2], still, 18, softOf(18, 0), true);
  // Below the clamp (LZ_MIN 0.85): 0.5 and 0.6 cast from the same place.
  p.refresh([0.1, 0.1, 0.5], still, 18, softOf(18, 0), true);
  p.refresh([0.1, 0.1, 0.6], still, 18, softOf(18, 0), true);
  // A bone with a -0 corner, then +0.
  const z = hand(0.2, -0.1, 0.3);
  z[3]![2] = [-0, 0];
  p.refresh([0.1, 0.1, 0.6], z, 18, softOf(18, 0), true);
  z[3]![2] = [0, 0];
  p.refresh([0.1, 0.1, 0.6], z, 18, softOf(18, 0), true);
  // The hand leaves, bone by bone, then the box alone, then nothing to do.
  for (let i = 18; i >= 0; i -= 4) p.refresh(L2, still, i, softOf(18, 0), true);
  p.refresh(L2);
  p.refresh(L2);
  // Back in, the same bones as before it left (slots laid out before, drawn again).
  p.refresh(L2, still, 18, softOf(18, 0), true);
  p.refresh(L2, still, 9, softOf(18, 0), true);
  p.refresh(L2, still, 18, softOf(18, 0), true);
  // A finger lock's missing piece shows (a crystallise ends) with the hand still in: laid out again.
  const missing = box.elements.find((e): e is Piece => e.kind === "piece" && e.missing);
  if (missing) {
    p.show.add(missing);
    p.refresh(L2, still, 18, softOf(18, 0), true);
    p.refresh(L2, still, 18, softOf(18, 0), true);
    p.show.delete(missing);
    p.refresh(L2, still, 18, softOf(18, 0), true);
  }
  // Direct casts (the test hooks cast along a path), with and without extras.
  p.cast(L1);
  p.cast(L1, still, 18, softOf(18, 0));
  p.cast(L1, still, 18);
  p.cast(L1);
}

/** A lesson's swing: lock 0's pieces and rings moved in place, `t` of the way, then told. */
function swing(p: Pair, box: Box, by: number): void {
  for (const e of box.elements) {
    if (e.kind === "piece" && e.lock === 0) for (const v of e.verts) v[0] += by;
    if (e.kind === "ring" && e.lock === 0) {
      (e as Ring).c[0] += by;
      (e as Ring).nrm[0] += by / 4;
    }
  }
  p.moved();
}

describe("the shadow update writes exactly what BASE's full cast wrote", () => {
  it("over a recorded sequence: boxes 15, the heaviest from 10 to 60, a left-handed box, a lesson swing, a restored context", () => {
    const p = new Pair();
    const b15 = generateBox({ kind: "box", n: 15 });
    const heavy = generateBox({ kind: "box", n: heaviestBox().n });
    play(p, b15);
    play(p, heavy);
    // A left-handed player's box (every x negated).
    play(p, mirrorBox(b15));
    // A box change with the hand in the beam, and the box gone and back.
    const still = hand(0.2, -0.1, 0.3);
    p.setBox(heavy);
    p.refresh(heavy.start, still, 18, softOf(18, 0), true);
    p.setBox(b15);
    p.refresh(heavy.start, still, 18, softOf(18, 0), true);
    p.setBox(null);
    p.refresh(heavy.start, still, 18, softOf(18, 0), true);
    p.setBox(b15);
    // A lesson's swing (its own copy of the box: the swing moves the elements themselves), the hand still in.
    const lesson = generateBox({ kind: "box", n: 15 }), L = lesson.locks[0]!.L;
    p.setBox(lesson);
    p.refresh(L, still, 18, softOf(18, 0), true);
    for (let i = 0; i < 4; i++) {
      swing(p, lesson, 0.01);
      p.refresh(L, still, 18, softOf(18, 0), true);
      p.refresh(L, still, 18, softOf(18, 0), true);
    }
    // A restored GPU context: everything is rebuilt, the same.
    p.now.invalidate();
    p.old.moved();
    p.refresh(L, still, 18, softOf(18, 0), true);
    // The largest number of extras.
    const many = hand(-0.3, -0.3, 0.1, 12, MAX_EXTRAS);
    p.refresh(L, many, MAX_EXTRAS, softOf(MAX_EXTRAS, 2), true);
    p.refresh(L, many, MAX_EXTRAS, softOf(MAX_EXTRAS, 2), true);
  });
});

describe("dirty keys: a change rebuilds what it must, no change rebuilds nothing", () => {
  const box = generateBox({ kind: "box", n: 15 });
  const fresh = () => {
    const sh = new BoxShadows();
    sh.setBox(box);
    return sh;
  };
  const L: V3 = [0.05, -0.1, 1.25];
  const bones = () => hand(0.2, -0.1, 0.3);
  const soft = () => softOf(18, 0);
  /** A cast with the hand in, then the same again: settled, nothing to rebuild. */
  const settled = () => {
    const sh = fresh(), h = bones();
    sh.refresh(L, h, 18, soft(), true);
    sh.refresh(L, h, 18, soft(), true);
    expect(sh.projected).toBe(false);
    expect(sh.mesh.written).toBe(0);
    return { sh, h, all: sh.boxSlots + 18 };
  };

  it("no change: nothing projected and no slot rebuilt, though the hand system says the hand may have moved", () => {
    const { sh, h } = settled();
    for (let i = 0; i < 3; i++) {
      expect(sh.refresh(L, h, 18, soft(), true)).toBe(true);
      expect(sh.projected).toBe(false);
      expect(sh.mesh.written).toBe(0);
    }
    // And with no hand and nothing changed, no cast at all.
    sh.refresh(L);
    expect(sh.refresh(L)).toBe(false);
  });

  it("the lantern: every box slot, and the hand's (the caller casts them again from it)", () => {
    const { sh, h, all } = settled();
    sh.refresh([L[0] + 1e-9, L[1], L[2]], h, 18, soft(), true);
    expect(sh.projected).toBe(true);
    expect(sh.mesh.written).toBe(all - 18);
    for (const M of [[L[0], L[1] + 1e-9, L[2]], [L[0], L[1], L[2] + 1e-9]] as V3[]) {
      sh.refresh(M, h, 18, soft(), true);
      expect(sh.projected).toBe(true);
      expect(sh.mesh.written).toBe(sh.boxSlots);
    }
  });

  it("the lantern on 0 then -0: cast again (they can project to 0 and -0)", () => {
    const sh = fresh(), h = bones();
    sh.refresh([0, 0, 1.2], h, 18, soft(), true);
    sh.refresh([-0, 0, 1.2], h, 18, soft(), true);
    expect(sh.projected).toBe(true);
    sh.refresh([-0, -0, 1.2], h, 18, soft(), true);
    expect(sh.projected).toBe(true);
    sh.refresh([-0, -0, 1.2], h, 18, soft(), true);
    expect(sh.projected).toBe(false);
  });

  it("each scrap and ring moved in place (a lesson's swing): every box slot once told", () => {
    const own = generateBox({ kind: "box", n: 15 }), sh = new BoxShadows(), h = bones();
    sh.setBox(own);
    sh.refresh(L, h, 18, soft(), true);
    for (const e of own.elements) {
      if (e.kind === "ring") e.c[1] += 0.001;
      else e.verts[0]![1] += 0.001;
      sh.moved();
      sh.refresh(L, h, 18, soft(), true);
      expect(sh.projected).toBe(true);
      expect(sh.mesh.written).toBe(sh.boxSlots);
    }
  });

  it("a hand bone, the finger alone, or one softness: only that slot", () => {
    const { sh, h } = settled();
    const k = sh.boxSlots;
    h[0]![0]![0] += 1e-9;
    sh.refresh(L, h, 18, soft(), true);
    expect([sh.projected, sh.mesh.written]).toEqual([false, 1]);
    // The finger (the hand's last outline) only.
    h[17]![5]![1] -= 1e-9;
    sh.refresh(L, h, 18, soft(), true);
    expect([sh.projected, sh.mesh.written]).toEqual([false, 1]);
    const s = soft();
    s[9] = 0.02;
    sh.refresh(L, h, 18, s, true);
    expect([sh.projected, sh.mesh.written]).toEqual([false, 1]);
    // The very same arrays, rewritten in place with new values (as the hand system does), are seen.
    for (const p of h[4]!) p[0] += 0.001;
    sh.refresh(L, h, 18, s, true);
    expect(sh.mesh.written).toBe(1);
    // A bone fewer, then back: the box's slots stay.
    sh.refresh(L, h, 17, s, true);
    expect(sh.mesh.written).toBe(0);
    sh.refresh(L, h, 18, s, true);
    expect(sh.mesh.written).toBe(0);
    expect(sh.boxSlots).toBe(k);
  });

  it("a piece showing or hiding, a box change, a left-handed box, a restored context: everything", () => {
    const b = generateBox({ kind: "box", n: 15 });
    const missing = b.elements.find((e): e is Piece => e.kind === "piece" && e.missing)!;
    expect(missing).toBeDefined();
    let show = false;
    const sh = new BoxShadows((p) => !p.missing || show), h = bones();
    sh.setBox(b);
    sh.refresh(L, h, 18, soft(), true);
    sh.refresh(L, h, 18, soft(), true);
    expect(sh.mesh.written).toBe(0);
    show = true;
    sh.refresh(L, h, 18, soft(), true);
    expect(sh.projected).toBe(true);
    expect(sh.mesh.written).toBe(sh.boxSlots + 18);
    for (const next of [generateBox({ kind: "box", n: 16 }), mirrorBox(b)]) {
      sh.setBox(next);
      sh.refresh(L, h, 18, soft(), true);
      expect(sh.projected).toBe(true);
      expect(sh.mesh.written).toBe(sh.boxSlots + 18);
      sh.refresh(L, h, 18, soft(), true);
      expect(sh.mesh.written).toBe(0);
    }
    // A lost GPU context back (the box scene calls invalidate on webglcontextrestored): a full cast on the next
    // refresh, even with no hand and the lantern still.
    sh.refresh(L);
    expect(sh.refresh(L)).toBe(false);
    sh.invalidate();
    expect(sh.refresh(L)).toBe(true);
    expect(sh.projected).toBe(true);
    expect(sh.mesh.written).toBe(sh.boxSlots);
  });

  it("box size and a re-placed box: the cast is in box units, so only what moved in box units recasts", () => {
    // A new size or placement scales and moves the box root around the panel; the lantern held in the hand then sits
    // elsewhere in box units (a lantern change) and the hand's outlines change (a bone change); a lantern resting in
    // box units with no hand casts nothing new, as before.
    const { sh, h } = settled();
    const scale = 24 / 30;
    const held: V3 = [L[0] * scale, L[1] * scale, L[2] * scale];
    const moved = h.map((b) => b.map(([x, y]): V2 => [x * scale, y * scale]));
    sh.refresh(held, moved, 18, soft(), true);
    expect(sh.projected).toBe(true);
    expect(sh.mesh.written).toBe(sh.boxSlots + 18);
    sh.refresh(held);
    expect(sh.refresh(held)).toBe(false);
  });
});
