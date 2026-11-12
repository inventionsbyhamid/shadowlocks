// What the lesson view does with the director's frame that can be checked without a renderer: lock I's mark on the
// panel and its scraps, where the coach chip sits by the lantern while lesson 1 asks for it, and a view at rest (no
// lesson, nothing shown) that still shows what comes after.
import { Object3D, Quaternion, Vector3 } from "@iwsdk/core";
import { describe, expect, it, vi } from "vitest";
import { coachNearPose, LESSON_LOOK, LessonView, type LessonViewDeps, markLock, nominalEye } from "../../src/app/lesson-view";
import { LessonsDirector } from "../../src/app/lessons-director";
import { COACH } from "../../src/ui/coach-line";
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

describe("the lesson view at rest", () => {
  /** The view over a box scene that records what it is told, with no lesson box in play. */
  function bench() {
    const told = { light: [] as (V3 | null)[], ghosts: [] as number[], quiet: [] as boolean[] };
    const scene = {
      root: new Object3D(),
      box: null,
      size: 0.24,
      scraps: { offsetPiece() {}, moveRing() {}, handle: () => ({ setGlow() {} }) },
      shadowsMoved() {},
      setLightFrom: (p: Readonly<V3> | null) => void told.light.push(p ? [p[0], p[1], p[2]] : null),
      setGhostShadows: (_o: unknown, n: number) => void told.ghosts.push(n),
      lightPos: (out: V3) => out,
      lantern: { setQuiet: (on: boolean) => void told.quiet.push(on) },
      panelArt: { setWarmth() {} },
      crystals: { setBox() {} },
    };
    const sound = { settle: vi.fn(), crystallise: vi.fn(), coachLine: vi.fn() };
    const lantern = { ctrl: { pos: [0.1, -0.2, 1.2] as V3 }, place: vi.fn(), freeze: vi.fn() };
    const deps = { world: { scene: new Object3D() }, scene, lantern, sound, reducedMotion: () => false };
    const view = new LessonView(deps as unknown as LessonViewDeps);
    const f = new LessonsDirector({} as never).frame;
    let t = 0;
    const step = (on: { lesson: "l1" | null; tip?: boolean }, line: string | null, frames = 1) => {
      for (let i = 0; i < frames; i++) view.update(f, on, line, 16, (t += 16));
    };
    return { view, f, told, sound, step };
  }

  it("still shows a tip's line, then its ghost demo, after frames with nothing to show", () => {
    const { view, f, told, sound, step } = bench();
    step({ lesson: null }, null, 3);
    const told0 = told.light.length;
    step({ lesson: null }, null, 5);
    // Nothing to show and nothing shown: nothing more is told.
    expect(told.light.length).toBe(told0);
    // A tip's line comes up on the chip, with its tick.
    step({ lesson: null }, "Try the other lock.");
    expect(view.coach.text).toBe("Try the other lock.");
    expect(sound.coachLine).toHaveBeenCalledTimes(1);
    step({ lesson: null }, "Try the other lock.", 30);
    expect(view.coach.opacity).toBe(1);
    // It goes: the chip fades out, then rests again.
    step({ lesson: null }, null, Math.ceil(COACH.fadeOutMs / 16) + 2);
    expect(view.coach.text).toBeNull();
    expect(view.coach.opacity).toBe(0);
    // A tip's ghost demo on the box in play: its ghost lantern lights the box.
    f.lamp.opacity = 1;
    f.lamp.at = [0.1, 0.2, 1.1];
    f.ghostLight = true;
    step({ lesson: null, tip: true }, null);
    expect(told.light.at(-1)).toEqual([0.1, 0.2, 1.1]);
    expect(view.lamp.opacity).toBe(1);
  });

  it("shows a lesson that starts after frames at rest: its ghost hand and its light", () => {
    const { view, f, told, step } = bench();
    step({ lesson: null }, null, 5);
    expect(view.ghost.opacity).toBe(0);
    f.hand.opacity = 1;
    f.lamp.opacity = 1;
    f.lamp.at = [-0.1, 0, 1.2];
    f.ghostLight = true;
    step({ lesson: "l1" }, "Pick up the lantern.");
    expect(view.ghost.opacity).toBe(1);
    expect(view.coach.text).toBe("Pick up the lantern.");
    // Not its box in play (none is): the ghost lantern lights the box only on its own box or in a tip's demo.
    expect(told.light.at(-1)).toBeNull();
  });
});
