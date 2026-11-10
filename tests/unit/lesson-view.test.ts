// What the lesson view does with the director's frame that can be checked without a renderer: lock I's mark on the
// panel and its scraps.
import { describe, expect, it } from "vitest";
import { markLock } from "../../src/app/lesson-view";
import { HINT_LOOK } from "../../src/app/hints";
import { lessonPlan } from "../../src/core/lessons-data";

/** A panel and scraps that record what they are told. */
function scene(own = 0) {
  const warmth: [number, number][] = [], glow: string[] = [];
  return {
    warmth,
    glow,
    panelArt: { setWarmth: (lock: number, w: number) => void warmth.push([lock, w]), warmthOf: () => own },
    scrapMesh: (lock: number, piece: number) => ({ setGlow: (v: number) => void glow.push(`${lock}.${piece} ${v}`) }),
  };
}

describe("lock I's mark", () => {
  const moon = lessonPlan("l1", false).box.locks[0]!;

  it("breathes its outline over whatever warmth it has of its own, never below it", () => {
    const s = scene(0.05);
    markLock(s, moon, 0.25, false);
    expect(s.warmth).toEqual([[0, 0.25]]);
    const warm = scene(0.6);
    markLock(warm, moon, 0.25, false);
    expect(warm.warmth).toEqual([[0, 0.6]]);
    // The scraps are told only as the mark starts.
    expect([s.glow, warm.glow]).toEqual([[], []]);
  });

  it("lights its scraps as a first hint does, once, as the mark starts", () => {
    const s = scene();
    markLock(s, moon, 0.2, true);
    expect(s.glow).toEqual(moon.target.map((_, p) => `0.${p} ${HINT_LOOK.scrapGlow}`));
  });
});
