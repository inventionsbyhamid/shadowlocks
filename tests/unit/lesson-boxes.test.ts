// The lessons' boxes in the box session: a fresh lesson box for each lesson spec (other specs passed on), and the
// save a lesson resumed at a step starts from.
import { describe, expect, it, vi } from "vitest";
import { lessonSnapshot, withLessons } from "../../src/app/lesson-boxes";
import { openBefore } from "../../src/app/lessons-director";
import { GENERATOR_VERSION } from "../../src/core/generator";
import { lessonPlan } from "../../src/core/lessons-data";
import type { Box, BoxSpec } from "../../src/core/types";

describe("withLessons", () => {
  it("serves a fresh copy of a lesson's box for every lesson spec, and passes every other spec on", async () => {
    const other = { key: "shadow-locks/4" } as Box;
    const inner = { get: vi.fn(async () => other), prefetch: vi.fn() };
    const client = withLessons(inner);
    const a = await client.get({ kind: "lesson", id: "l1" }), b = await client.get({ kind: "lesson", id: "l1" });
    expect(a.key).toBe(lessonPlan("l1", false).box.key);
    expect(b).not.toBe(a);
    // A lesson moves its scraps in place: no two copies share an element or a corner.
    expect(b.elements[0]).not.toBe(a.elements[0]);
    expect((await client.get({ kind: "lesson", id: "l2" })).key).toBe(lessonPlan("l2", false).box.key);
    expect(inner.get).not.toHaveBeenCalled();
    const spec: BoxSpec = { kind: "box", n: 4 };
    expect(await client.get(spec)).toBe(other);
    expect(inner.get).toHaveBeenCalledWith(spec);
    client.prefetch({ kind: "lesson", id: "l2" });
    client.prefetch(spec);
    expect(inner.prefetch.mock.calls).toEqual([[spec]]);
  });
});

describe("lessonSnapshot", () => {
  it("starts a lesson afresh at step 0", () => {
    expect(lessonSnapshot("l1", 0, false)).toBeNull();
    expect(lessonSnapshot("l2", 0, true)).toBeNull();
  });

  it("opens the locks the steps before it opened, the lantern at the box's start or where it is asked", () => {
    const box = lessonPlan("l1", false).box;
    const s = lessonSnapshot("l1", 3, false)!;
    expect(s.key).toBe(box.key);
    expect(s.gen).toBe(GENERATOR_VERSION);
    expect(s.open).toEqual(openBefore("l1", 3));
    expect(s.open).toEqual([0]);
    expect(s.lantern).toEqual([...box.start]);
    expect(s.crystal).toEqual([]);
    expect([s.elapsedMs, s.hints]).toEqual([0, 0]);
    expect(lessonSnapshot("l1", 3, false, [0.1, -0.2, 1.4])!.lantern).toEqual([0.1, -0.2, 1.4]);
    // A left-handed player's box is the mirror image: the lantern starts on the other side.
    expect(lessonSnapshot("l1", 3, true)!.lantern[0]).toBeCloseTo(-box.start[0], 9);
  });

  it("puts an open finger lock's piece in place, where its scrap would hang", () => {
    const box = lessonPlan("l2", false).box;
    const s = lessonSnapshot("l2", 3, false)!;
    expect(s.open).toEqual([0]);
    expect(box.locks[0]!.finger).toBe(true);
    const piece = box.elements.find((e) => e.kind === "piece" && e.lock === 0 && e.piece === box.locks[0]!.missing);
    if (!piece || piece.kind !== "piece") throw new Error("lesson 2 has no missing piece");
    const z = piece.verts.reduce((t, v) => t + v[2], 0) / piece.verts.length;
    expect(s.crystal).toHaveLength(1);
    expect(s.crystal[0]!.lock).toBe(0);
    expect(s.crystal[0]!.z).toBeCloseTo(z, 9);
  });
});
