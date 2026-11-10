// A headset's lost box brought back on the player's word: the arrow at the edge of the view toward the box, what takes
// it (a pinch on it, a ray's pinch, a poke, a controller's trigger), and the fade out and in round the placement.
import { Euler, Object3D, Quaternion, Vector3 } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { SUMMON, Summon, type SummonInput } from "../../src/app/summon";
import type { HandPinch } from "../../src/input/grab-system";
import { ARROW } from "../../src/render/summon-arrow";

const DEG = Math.PI / 180;
const FRAME_MS = 1000 / 72;
const EYE = new Vector3(0, 1.2, 0);
const look = (yawDeg: number, pitchDeg = -20) => new Quaternion().setFromEuler(new Euler(pitchDeg * DEG, yawDeg * DEG, 0, "YXZ"));
/** The box a quarter turn to the head's right (the head looks down -z), at lap height. */
const BOX = new Vector3(0.6, 0.9, 0);

const hand = (kind: HandPinch["kind"] = "hand"): HandPinch => ({
  kind,
  tracked: true,
  pinching: false,
  edge: null,
  point: new Vector3(0, 0.8, 0.3),
  anchor: new Vector3(),
  rot: new Quaternion(),
});

/** A ray from `from` toward `to`: it looks down its -z (Object3D.lookAt turns +z toward the target). */
function aim(ray: Object3D, from: Vector3, to: Vector3): void {
  ray.position.copy(from);
  ray.lookAt(from.clone().multiplyScalar(2).sub(to));
}

function rig() {
  const hands = [hand(), hand()];
  const tips = { count: 0, points: [new Vector3(), new Vector3(), new Vector3()] };
  const rays = { left: new Object3D(), right: new Object3D() };
  // Rays pointing at the floor until a test aims one.
  for (const r of [rays.left, rays.right]) aim(r, new Vector3(0, 1, 0), new Vector3(0, -1, 0));
  const input: SummonInput = { hands, tips: () => tips, rays };
  const s = new Summon(input);
  let t = 0;
  const step = (arrow = true, head = look(0)) => {
    t += FRAME_MS;
    return s.update(t, FRAME_MS / 1000, arrow, EYE, head, BOX);
  };
  return { s, hands, tips, rays, step, now: () => t };
}

/** A pinch starting at `p` on `h` (this frame). */
function pinch(h: HandPinch, p: Vector3): void {
  h.point.copy(p);
  h.pinching = true;
  h.edge = "start";
}

describe("the summon arrow", () => {
  it("sits at the edge of the view toward the box, faces the eyes, and follows the head loosely", () => {
    const { s, step } = rig();
    expect(step(false)).toBeNull();
    expect(s.view.arrow.visible).toBe(false);
    step();
    expect(s.phase).toBe("arrow");
    expect(s.view.arrow.visible).toBe(true);
    const a = s.view.at.clone();
    // ARROW.distM from the eyes, ARROW.edgeDeg off the view's middle, on the box's side (to the right).
    expect(a.distanceTo(EYE)).toBeCloseTo(ARROW.distM, 9);
    const fwd = new Vector3(0, 0, -1).applyQuaternion(look(0));
    expect(Math.acos(a.clone().sub(EYE).normalize().dot(fwd)) / DEG).toBeCloseTo(ARROW.edgeDeg, 6);
    expect(a.x).toBeGreaterThan(0.15);
    // It faces the eyes, its tip toward the box (its +x across the view, to the right).
    const n = new Vector3(0, 0, 1).applyQuaternion(s.view.arrow.quaternion);
    expect(n.dot(EYE.clone().sub(a).normalize())).toBeCloseTo(1, 6);
    const tip = new Vector3(1, 0, 0).applyQuaternion(s.view.arrow.quaternion);
    expect(tip.x).toBeGreaterThan(0.7);
    // The head turns 30 degrees left at once: the arrow eases after it (not head-locked), and gets there.
    step(true, look(30));
    const lagging = s.view.at.clone();
    expect(lagging.distanceTo(a)).toBeGreaterThan(0);
    expect(lagging.distanceTo(a)).toBeLessThan(0.05);
    for (let i = 0; i < 144; i++) step(true, look(30));
    // Two seconds on, it stands where the turned head puts it (the box is still to the right, now further round).
    expect(s.view.at.distanceTo(EYE)).toBeCloseTo(ARROW.distM, 3);
    const fwd30 = new Vector3(0, 0, -1).applyQuaternion(look(30));
    expect(Math.acos(s.view.at.clone().sub(EYE).normalize().dot(fwd30)) / DEG).toBeCloseTo(ARROW.edgeDeg, 1);
    // The box in view again: it goes.
    step(false);
    expect(s.phase).toBe("idle");
    expect(s.view.arrow.visible).toBe(false);
  });

  it("a pinch on it, a pinch with a ray on it, a poke and a controller's trigger at it take it; a pinch elsewhere does not", () => {
    // A pinch elsewhere, a pinch held from before (no start this frame), an untracked hand: not taken.
    {
      const { s, hands, step } = rig();
      step();
      pinch(hands[1]!, new Vector3(0.3, 0.8, 0.2));
      expect(step()).toBeNull();
      hands[1]!.point.copy(s.view.at);
      hands[1]!.edge = null;
      expect(step()).toBeNull();
      pinch(hands[0]!, s.view.at);
      hands[0]!.tracked = false;
      expect(step()).toBeNull();
      expect(s.phase).toBe("arrow");
    }
    const cases: [string, (r: ReturnType<typeof rig>) => void][] = [
      ["right hand's pinch on it", ({ s, hands }) => pinch(hands[1]!, s.view.at.clone().add(new Vector3(0, 0.03, 0.02)))],
      ["left hand's pinch on it", ({ s, hands }) => pinch(hands[0]!, s.view.at)],
      ["a controller's trigger at it", ({ s, hands }) => {
        hands[1]!.kind = "controller";
        pinch(hands[1]!, s.view.at.clone().add(new Vector3(0.05, 0, 0)));
      }],
      ["a pinch with the ray on it", ({ s, hands, rays }) => {
        aim(rays.right, new Vector3(0.25, 0.9, -0.1), s.view.at);
        pinch(hands[1]!, new Vector3(0.25, 0.9, -0.1));
      }],
      ["a controller's trigger with its ray on it", ({ s, hands, rays }) => {
        hands[0]!.kind = "controller";
        aim(rays.left, new Vector3(-0.2, 0.85, -0.1), s.view.at);
        pinch(hands[0]!, new Vector3(-0.2, 0.85, -0.1));
      }],
      ["a fingertip poking it", ({ s, tips }) => {
        tips.count = 1;
        tips.points[0]!.copy(s.view.at).add(new Vector3(0, 0, 0.02));
      }],
    ];
    for (const [name, take] of cases) {
      const r = rig();
      r.step();
      expect(r.s.phase, name).toBe("arrow");
      take(r);
      expect(r.step(), name).toBe("taken");
      expect(r.s.phase, name).toBe("out");
      expect(r.s.view.arrow.visible, name).toBe(false);
    }
    // A ray pointing past it (10 cm off) with a pinch: not taken.
    const r = rig();
    r.step();
    aim(r.rays.right, new Vector3(0.25, 0.9, -0.1), r.s.view.at.clone().add(new Vector3(0, 0.1, 0)));
    pinch(r.hands[1]!, new Vector3(0.25, 0.9, -0.1));
    expect(r.step()).toBeNull();
  });

  it("taken: the view fades out, the box is placed at full dark, the view fades back in; the arrow and the fade never draw at once", () => {
    const { s, hands, step, now } = rig();
    step();
    pinch(hands[1]!, s.view.at);
    expect(step()).toBe("taken");
    hands[1]!.edge = null;
    const drawn = () => [s.view.arrow.visible, s.view.fade.visible].filter(Boolean).length;
    let placeAt = Number.NaN;
    let peak = 0;
    for (let i = 0; i < 60 && placeAt !== placeAt; i++) {
      const r = step(false);
      expect(drawn()).toBeLessThanOrEqual(1);
      peak = Math.max(peak, s.view.fadeNow);
      if (r === "place") placeAt = now();
    }
    expect(placeAt).toBeGreaterThan(0);
    expect(peak).toBe(1);
    // Not placed yet (the head out of tracking): it stays dark and asks again.
    s.placed(false, placeAt);
    expect(step(false)).toBe("place");
    // Placed: it fades back in, and is idle after SUMMON.inMs.
    s.placed(true, now());
    expect(s.phase).toBe("in");
    const back = now();
    let last = 1;
    while (s.phase === "in") {
      step(false);
      expect(drawn()).toBeLessThanOrEqual(1);
      expect(s.view.fadeNow).toBeLessThanOrEqual(last);
      last = s.view.fadeNow;
      expect(now() - back).toBeLessThan(SUMMON.inMs + 2 * FRAME_MS);
    }
    expect(s.view.fade.visible).toBe(false);
    expect(s.view.arrow.visible).toBe(false);
    // Dark too long without a tracked head: it comes back anyway.
    const r = rig();
    r.step();
    pinch(r.hands[0]!, r.s.view.at);
    r.step();
    r.hands[0]!.edge = null;
    for (let i = 0; i < 20; i++) r.step(false);
    r.s.placed(false, r.now() + SUMMON.holdMaxMs + SUMMON.outMs);
    expect(r.s.phase).toBe("in");
  });
});
