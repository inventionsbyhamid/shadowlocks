import { describe, expect, it } from "vitest";
import { LessonLayout, type LayoutSink } from "../../src/app/lesson-layout";
import { reviveBox } from "../../src/core/box-client";
import { lessonPlan } from "../../src/core/lessons-data";
import { mirrorBox } from "../../src/core/mirror";
import type { Box, Piece, Ring, V3 } from "../../src/core/types";

/** A sink that records what the layout drew. */
function sink() {
  const pieces = new Map<string, V3>(), rings = new Map<number, { c: V3; nrm: V3; off: V3 }>();
  let moved = 0;
  const s: LayoutSink = {
    offsetPiece: (lock, piece, x, y, z) => void pieces.set(`${lock}/${piece}`, [x, y, z]),
    moveRing: (r, c, nrm, off) => void rings.set(r, { c: [c[0], c[1], c[2]], nrm: [nrm[0], nrm[1], nrm[2]], off: [off[0], off[1], off[2]] }),
    shadowsMoved: () => void moved++,
  };
  return { s, pieces, rings, moved: () => moved };
}

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]!) <= eps);

describe("LessonLayout", () => {
  for (const left of [false, true]) {
    it(`swings a lesson lock's scraps and rings between its twin's layout and the player's, in place${left ? " (left-handed)" : ""}`, () => {
      const plan = lessonPlan("l1", left);
      // The session's own copy of the box (what the scene shows).
      const box: Box = reviveBox(left ? mirrorBox(lessonPlan("l1", false).box) : plan.box);
      const player = reviveBox(box);
      const twin = plan.twins[2]!;
      const lay = new LessonLayout(box, plan.twins);
      const k = sink();
      // At 0 every scrap and ring of lock 2 hangs where its twin's does; nothing else moves.
      expect(lay.set(2, 0, k.s)).toBe(true);
      expect(k.moved()).toBe(1);
      const els = (b: Box, lock: number) => b.elements.filter((e) => e.kind !== "decoy" && e.lock === lock);
      els(box, 2).forEach((e, i) => {
        const t = twin.elements[i]!;
        expect(e.kind).toBe(t.kind);
        if (e.kind === "piece" && t.kind === "piece") e.verts.forEach((v, j) => expect(near(v, t.verts[j]!)).toBe(true));
        if (e.kind === "ring" && t.kind === "ring") {
          expect(near(e.c, t.c)).toBe(true);
          expect(near(e.nrm, t.nrm, 1e-9)).toBe(true);
        }
      });
      for (const l of [0, 1]) els(box, l).forEach((e, i) => expect(e).toEqual(els(player, l)[i]));
      // The scrap mesh is told each piece's offset from the player's place, and each ring's pose.
      const p0 = els(box, 2)[0] as Piece, q0 = els(player, 2)[0] as Piece;
      expect(near(k.pieces.get(`2/${p0.piece}`)!, [p0.verts[0]![0] - q0.verts[0]![0], p0.verts[0]![1] - q0.verts[0]![1], p0.verts[0]![2] - q0.verts[0]![2]])).toBe(true);
      const ringIdx = box.elements.filter((e) => e.kind === "ring").findIndex((r) => (r as Ring).lock === 2);
      const r0 = box.elements.filter((e) => e.kind === "ring")[ringIdx] as Ring;
      expect(near(k.rings.get(ringIdx)!.c, r0.c)).toBe(true);
      // Half way and past the end (the swing's overshoot) are in between and beyond; 1 is the player's layout exactly.
      lay.set(2, 0.5, k.s);
      const mid = (els(box, 2)[0] as Piece).verts[0]!, a = (els(player, 2)[0] as Piece).verts[0]!, b = (twin.elements[0] as Piece).verts[0]!;
      expect(near(mid, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], 1e-12)).toBe(true);
      lay.set(2, 1.07, k.s);
      const over = (els(box, 2)[0] as Piece).verts[0]![0];
      expect(Math.sign(over - a[0])).toBe(Math.sign(a[0] - b[0]));
      lay.set(2, 1, k.s);
      expect(box).toEqual(player);
      expect(near(k.pieces.get(`2/${p0.piece}`)!, [0, 0, 0])).toBe(true);
      // The same value again moves nothing and asks no recast.
      const before = k.moved();
      expect(lay.set(2, 1, k.s)).toBe(false);
      expect(k.moved()).toBe(before);
      // A lock with no twin never moves; reset puts every lock back.
      expect(lay.set(0, 0, k.s)).toBe(false);
      lay.set(1, 0, k.s);
      lay.reset(k.s);
      expect(box).toEqual(player);
    });
  }

  it("keeps the arrays it moves: the same vertex arrays before and after", () => {
    const plan = lessonPlan("l2", false);
    const box = reviveBox(plan.box);
    const v = (box.elements[0] as Piece).verts[0]!;
    const lay = new LessonLayout(box, plan.twins);
    const k = sink();
    for (let i = 0; i <= 20; i++) lay.set(0, i / 20, k.s);
    expect((box.elements[0] as Piece).verts[0]).toBe(v);
  });
});
