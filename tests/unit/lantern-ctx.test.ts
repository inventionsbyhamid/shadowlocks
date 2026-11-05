import { beforeAll, describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import { RING_OFF, RING_ON, ringOffset } from "../../src/core/rings";
import type { Box, Ring, V3 } from "../../src/core/types";
import { LANTERN_MIN_Z } from "../../src/feel/constants";
import { LanternCtxBuilder } from "../../src/feel/lantern-ctx";

const boxes: Box[] = [];
beforeAll(() => {
  for (let n = 1; n <= 8; n++) boxes.push(generateBox({ kind: "box", n }));
}, 120_000);

const ringsOf = (box: Box) => box.elements.filter((e): e is Ring => e.kind === "ring");
const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

describe("LanternCtxBuilder", () => {
  it("has a spot per lock and a line per lock with rings, from the mark through the rings to the spot", () => {
    let lines = 0;
    for (const box of boxes) {
      const b = new LanternCtxBuilder();
      b.setBox(box);
      const ctx = b.ctx;
      expect(ctx.minZ).toBe(LANTERN_MIN_Z);
      expect(ctx.spots.map((s) => [s.lock, s.L, s.open])).toEqual(box.locks.map((l) => [l.i, l.L, false]));
      const ringed = box.locks.filter((l) => l.rings && l.mark);
      expect(ctx.lines.map((l) => l.lock)).toEqual(ringed.map((l) => l.i));
      for (const line of ctx.lines) {
        const lock = box.locks[line.lock]!;
        expect(line.mark).toEqual([lock.mark![0], lock.mark![1], 0]);
        // mark + dir is the spot: the line runs out of the box through the lock's spot.
        const end = add(line.mark, line.dir, 1);
        for (let i = 0; i < 3; i++) expect(end[i]).toBeCloseTo(lock.L[i]!, 12);
        // Every point on it lines the rings up.
        for (const k of [0.6, 1, 1.4]) expect(ringOffset(lock, ringsOf(box), add(line.mark, line.dir, k))).toBeLessThan(RING_ON);
        lines++;
      }
    }
    expect(lines).toBeGreaterThan(0);
  });

  it("lines up a lock's rings with the lantern at its spot, with the chime's hysteresis", () => {
    const box = boxes.find((b) => b.locks.some((l) => l.rings))!;
    const lock = box.locks.find((l) => l.rings)!;
    const b = new LanternCtxBuilder();
    b.setBox(box);
    const line = b.ctx.lines.find((l) => l.lock === lock.i)!;
    expect(line.aligned).toBe(false);
    b.update([...lock.L], 24);
    expect(line.aligned).toBe(true);
    expect(b.aligned(lock.i)).toBe(true);
    // Sideways off the line: it stays lined up until the offset passes RING_OFF, then needs RING_ON again.
    const side: V3 = [1, 0, 0];
    let k = 0;
    const off = (d: number) => ringOffset(lock, ringsOf(box), add(lock.L, side, d));
    while (off(k) <= RING_OFF) {
      b.update(add(lock.L, side, k), 24);
      expect(line.aligned).toBe(true);
      k += 0.001;
    }
    b.update(add(lock.L, side, k), 24);
    expect(line.aligned).toBe(false);
    let back = k;
    while (off(back) > RING_ON) {
      b.update(add(lock.L, side, back), 24);
      expect(line.aligned).toBe(false);
      back -= 0.001;
    }
    b.update(add(lock.L, side, back), 24);
    expect(line.aligned).toBe(true);
  });

  it("keeps the same objects frame to frame, marks open locks, and empties for no box", () => {
    const b = new LanternCtxBuilder();
    b.setBox(boxes[2]!);
    const ctx = b.ctx, spots = ctx.spots, lines = ctx.lines;
    for (let i = 0; i < 50; i++) expect(b.update(boxes[2]!.start, 18 + i / 10)).toBe(ctx);
    expect(ctx.spots).toBe(spots);
    expect(ctx.lines).toBe(lines);
    expect(ctx.cmPerUnit).toBeCloseTo(22.9, 9);
    b.setOpen(spots[0]!.lock, true);
    expect(spots[0]!.open).toBe(true);
    b.setOpen(spots[0]!.lock, false);
    expect(spots[0]!.open).toBe(false);
    b.setBox(null);
    expect(b.ctx.spots).toEqual([]);
    expect(b.ctx.lines).toEqual([]);
    expect(b.update([0, 0, 1.3], 24).lines).toEqual([]);
  });
});
