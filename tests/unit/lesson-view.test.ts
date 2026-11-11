// What the lesson view does with the director's frame that can be checked without a renderer: lock I's mark on the
// panel and its scraps, and where the coach chip sits by the lantern while lesson 1 asks for it.
import { Quaternion, Vector3 } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { coachNearPose, LESSON_LOOK, markLock, nominalEye } from "../../src/app/lesson-view";
import { LANTERN_GRIP_Y } from "../../src/app/lesson-scripts";
import { placeBox, worldToBox } from "../../src/render/placement";
import type { V3 } from "../../src/core/types";
import { HINT_LOOK } from "../../src/app/hints";
import { lessonPlan } from "../../src/core/lessons-data";

/** A panel and scraps that record what they are told. */
function scene(own = 0) {
  const warmth: [number, number][] = [], glow: string[] = [];
  return {
    warmth,
    glow,
    panelArt: { setWarmth: (lock: number, w: number) => void warmth.push([lock, w]), warmthTarget: () => own },
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

describe("the coach chip by the lantern", () => {
  /** The e2e's seated head. */
  const HEAD = new Vector3(0, 1.2, -1.38);
  /** "Pick up the lantern." at 13 mm on the chip: the widest of the six languages' headset lines, with room to spare. */
  const CHIP = { w: 200, h: 29 };
  const start = lessonPlan("l1", false).box.start;
  const deg = (a: Vector3, b: Vector3) => (a.angleTo(b) * 180) / Math.PI;

  it("knows where the seated eye is in box units, as the box was placed for it", () => {
    for (const cm of [18, 24, 30]) {
      const m = placeBox({ pos: HEAD.clone(), yaw: 0 }, cm);
      const want = worldToBox(m, HEAD, [0, 0, 0]);
      const eye = nominalEye(cm / 100, new Vector3());
      [eye.x, eye.y, eye.z].forEach((v, k) => expect(v, `${cm} cm`).toBeCloseTo(want[k]!, 9));
    }
  });

  it("sits above and outside the lantern, facing the eye, about 15 degrees from it, clear of the panel and the lantern", () => {
    for (const cm of [18, 24, 30]) {
      for (const side of [1, -1]) {
        const s = cm / 100, L: V3 = [start[0] * side, start[1], start[2]];
        const pos = new Vector3(), q = new Quaternion();
        coachNearPose(L, side, s, CHIP.w, CHIP.h, pos, q);
        const eye = nominalEye(s, new Vector3()), why = `${cm} cm, ${side > 0 ? "right" : "left"}-handed`;
        // It faces the eye.
        const normal = new Vector3(0, 0, 1).applyQuaternion(q);
        expect(normal.dot(eye.clone().sub(pos).normalize()), why).toBeGreaterThan(0.999);
        // Every point of the chip, seen from the eye, is off the panel: no sight line to it passes through the chip.
        const ax = new Vector3(1, 0, 0).applyQuaternion(q), ay = new Vector3(0, 1, 0).applyQuaternion(q);
        const w = CHIP.w / 1000 / s, h = CHIP.h / 1000 / s;
        let lowest = Infinity;
        for (let i = 0; i <= 10; i++) {
          for (let j = 0; j <= 4; j++) {
            const p = pos.clone().addScaledVector(ax, (i / 10 - 0.5) * w).addScaledVector(ay, (j / 4 - 0.5) * h);
            const k = eye.z / (eye.z - p.z), x = eye.x + (p.x - eye.x) * k, y = eye.y + (p.y - eye.y) * k;
            expect(Math.abs(x) > 0.5 || Math.abs(y) > 0.5, `${why}: a sight line to the panel at ${x.toFixed(2)}, ${y.toFixed(2)}`).toBe(true);
            lowest = Math.min(lowest, Math.atan2(p.y - eye.y, Math.hypot(p.x - eye.x, p.z - eye.z)));
          }
        }
        // Its lowest edge above the lantern's top (its handle's loop) as the eye sees them: it hides none of it.
        const top = new Vector3(L[0], L[1] + LANTERN_GRIP_Y + 0.03, L[2]);
        const topAngle = Math.atan2(top.y - eye.y, Math.hypot(top.x - eye.x, top.z - eye.z));
        expect((lowest - topAngle) * (180 / Math.PI), why).toBeGreaterThan(1.5);
        // Near the lantern, as the eye looks at it: about 15 degrees off (over the box it is 35 to 52, by the box size).
        const toChip = pos.clone().sub(eye), toLantern = new Vector3(...L).sub(eye);
        expect(deg(toChip, toLantern), why).toBeLessThan(25);
        expect(deg(toChip, toLantern), why).toBeGreaterThan(8);
        const over = new Vector3(...LESSON_LOOK.coachAt).sub(eye);
        expect(deg(over, toLantern) - deg(toChip, toLantern), why).toBeGreaterThan(15);
        // On the dominant side.
        expect(pos.x * side, why).toBeGreaterThan(L[0] * side);
      }
    }
  });
});
