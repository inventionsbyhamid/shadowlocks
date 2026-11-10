// A phone in AR (Chrome's WebXR on ARCore): telling a phone's session, the lantern dragged by a touch, the finger a
// touch casts in the light, a key's poke, the box placed in the camera's view, the drawer tapped open, and the coach
// lines said the phone's way. The XR frame and session are fakes: a touch is a screen input source whose pose is a
// ray from the camera.
import { Euler, Matrix4, Quaternion, Vector3 } from "@iwsdk/core";
import { describe, expect, it, vi } from "vitest";
import { phoneLine } from "../../src/app/phone-lines";
import { type TouchDeps, Touches, TOUCH_SIDE } from "../../src/app/touch-system";
import type { Box, Lock, V2, V3 } from "../../src/core/types";
import { DRAWER_PULL, DrawerPull } from "../../src/input/drawer-pull";
import type { HandPinch } from "../../src/input/grab-system";
import {
  dragPoint,
  fingerEnds,
  grabDepth,
  hitKey,
  isHandheld,
  newKeyHit,
  panelPoint,
  pokeOffset,
  prongOf,
  rayNearSegment,
  TOUCH_FINGER,
  TOUCH_POKE,
} from "../../src/input/touch";
import { DRAWER, HANDLE, HANDLE_AT } from "../../src/render/drawer";
import { ENVELOPE } from "../../src/core/envelope";
import { LESSON_1, LESSON_2 } from "../../src/core/lessons-data";
import {
  BOX_EXTENT,
  boxToWorld,
  IN_VIEW_FILL,
  IN_VIEW_PITCH_DEG,
  IN_VIEW_RANGE_M,
  inViewDistance,
  PHONE_LEAN_DEG,
  PHONE_VIEW,
  phoneLean,
  Placement,
  placeBox,
  pitchFromQuaternion,
  TILT_DEG,
  VIEW_ELEVATION_DEG,
  viewOf,
  worldToBox,
} from "../../src/render/placement";
import { COPY } from "../../src/ui/copy";

const DEG = Math.PI / 180;
const EYE = new Vector3(0, 1.2, 0);
const BOX = placeBox({ pos: EYE.clone(), yaw: 0 }, 24);
const w = (v: V3) => boxToWorld(BOX, v, new Vector3());
const v3 = (p: Vector3): V3 => [p.x, p.y, p.z];
const dist = (a: Vector3, b: Vector3) => a.distanceTo(b);

/** A pose looking from `from` toward `to`: a touch's ray (it runs along the pose's -z). */
function rayPose(from: Vector3, to: Vector3) {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), to.clone().sub(from).normalize());
  return { transform: { position: { x: from.x, y: from.y, z: from.z }, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } } };
}

type Source = { targetRayMode: string; targetRaySpace: object };
type Listener = (e: { inputSource: Source; frame: XRFrame }) => void;

/**
 * A phone's session and frame: screen touches by aim (null: listed but with no pose this frame), the session's tap
 * events, and a headset's tracked pointer when a test adds one.
 */
class FakePhone {
  readonly session: {
    interactionMode: string;
    inputSources: Source[];
    addEventListener(type: string, fn: Listener): void;
    removeEventListener(type: string, fn: Listener): void;
  };
  private readonly aims = new Map<object, Vector3 | null>();
  private readonly listeners = new Map<string, Set<Listener>>();
  constructor(mode = "screen-space") {
    this.session = {
      interactionMode: mode,
      inputSources: [],
      addEventListener: (type, fn) => {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      },
      removeEventListener: (type, fn) => this.listeners.get(type)?.delete(fn),
    };
  }
  touch(at: Vector3 | null): Source {
    const src = this.source(at);
    this.session.inputSources.push(src);
    return src;
  }
  /** A screen source that is never listed among the input sources (a tap between two frames), aimed at `at`. */
  source(at: Vector3 | null): Source {
    const src = { targetRayMode: "screen", targetRaySpace: {} };
    this.aims.set(src.targetRaySpace, at);
    return src;
  }
  /** One of the session's events for `src`, with a frame that can pose it. */
  fire(type: "selectstart" | "select" | "selectend", src: Source): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ inputSource: src, frame: this.frame });
  }
  listening(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  aim(src: object, at: Vector3 | null): void {
    this.aims.set((src as { targetRaySpace: object }).targetRaySpace, at);
  }
  lift(src: object): void {
    this.session.inputSources = this.session.inputSources.filter((s) => s !== src);
  }
  /** A hand or a controller appears (a headset's tracked pointer). */
  trackedPointer(): Source {
    const src = { targetRayMode: "tracked-pointer", targetRaySpace: {} };
    this.session.inputSources.push(src);
    return src;
  }
  get frame(): XRFrame {
    return {
      session: this.session,
      getPose: (space: object) => {
        const at = this.aims.get(space);
        return at ? rayPose(EYE, at) : undefined;
      },
    } as unknown as XRFrame;
  }
}

const REF = {} as XRReferenceSpace;
const RIG = { matrixWorld: new Matrix4() };

/**
 * The touch system over a fake box scene and lantern, and a fake phone whose session has had its first frame (a
 * session's first frame tells a phone; touches come after).
 */
function bench(box: Box | null = null, lanternAt: V3 = [0.1, 0.05, 1.3], mode = "screen-space", sizeCm = 24) {
  const lantern = { ctrl: { pos: lanternAt }, grab: { holder: null as "left" | "right" | null }, frozen: false, away: false };
  const m = sizeCm === 24 ? BOX : placeBox({ pos: EYE.clone(), yaw: 0 }, sizeCm);
  const scene = { root: { matrixWorld: m }, box, size: sizeCm / 100 };
  const t = new Touches({ scene, lantern } as unknown as TouchDeps);
  const phone = new FakePhone(mode);
  const step = () => t.update(phone.frame, REF, RIG, EYE);
  step();
  /** A box point (box units) in the world, for this bench's box size. */
  const toWorld = (v: V3) => boxToWorld(m, v, new Vector3());
  return { t, phone, step, lantern, toWorld };
}

const newHand = (): HandPinch => ({
  kind: "none",
  tracked: false,
  pinching: false,
  edge: null,
  point: new Vector3(),
  anchor: new Vector3(),
  rot: new Quaternion(),
});

describe("telling a phone's session", () => {
  it("by the AR module's screen-space mode or a screen touch, never anything a headset gives", () => {
    expect(isHandheld({ interactionMode: "screen-space", inputSources: [] })).toBe(true);
    expect(isHandheld({ interactionMode: "world-space", inputSources: [{ targetRayMode: "screen" }] })).toBe(true);
    // Quest: world space, hands and controllers as tracked pointers (and gaze).
    expect(isHandheld({ interactionMode: "world-space", inputSources: [{ targetRayMode: "tracked-pointer" }, { targetRayMode: "gaze" }] })).toBe(false);
    // A browser without the AR module's attribute, before the first touch.
    expect(isHandheld({ inputSources: [] })).toBe(false);
    expect(isHandheld(null)).toBe(false);
    // Screen-space mode, or a screen touch, with a hand or a controller listed: a headset's, whatever it says.
    expect(isHandheld({ interactionMode: "screen-space", inputSources: [{ targetRayMode: "tracked-pointer" }] })).toBe(false);
    expect(isHandheld({ inputSources: [{ targetRayMode: "screen" }, { targetRayMode: "tracked-pointer" }] })).toBe(false);
  });

  it("stays a phone for the session once a touch said so, between touches too", () => {
    const { t, phone, step } = bench(null, undefined, "world-space");
    expect(t.phone).toBe(false);
    const src = phone.touch(w([0.3, 0.3, 0.5]));
    step();
    expect(t.phone).toBe(true);
    phone.lift(src);
    step();
    step();
    expect(t.phone).toBe(true);
  });

  it("decides no touch on the frame that first tells a phone: the box is placed in view first, the touch the frame after", () => {
    const { t, phone, step } = bench(null, undefined, "world-space");
    phone.touch(w([0.1, 0.05, 1.3]));
    step();
    expect(t.phone).toBe(true);
    expect(t.roles()).toEqual([null]);
    step();
    expect(t.roles()).toEqual(["lantern"]);
  });

  it("is never a phone's once a hand or a controller appears: it lets go then, and stays a headset's", () => {
    const { t, phone, step } = bench();
    expect(t.phone).toBe(true);
    phone.touch(w([0.1, 0.05, 1.3]));
    step();
    expect(t.roles()).toEqual(["lantern"]);
    const pointer = phone.trackedPointer();
    step();
    expect(t.phone).toBe(false);
    expect(t.roles()).toEqual([]);
    expect(t.virtualHand(TOUCH_SIDE, newHand())).toBe(false);
    // Gone again (a controller set down): still a headset's session, its touches never read.
    phone.lift(pointer);
    step();
    step();
    expect(t.phone).toBe(false);
    expect(t.roles()).toEqual([]);
  });

  it("does nothing on a headset: no touches, no stand-in hand", () => {
    const { t, phone, step } = bench(null, undefined, "world-space");
    phone.trackedPointer();
    step();
    expect(t.phone).toBe(false);
    expect(t.roles()).toEqual([]);
    expect(t.virtualHand(TOUCH_SIDE, newHand())).toBe(false);
    expect(phone.listening("selectstart")).toBe(0);
  });

});

describe("dragging the lantern by touch", () => {
  it("tells whether a ray passes within a radius of a segment, in front of the phone only", () => {
    const a: V3 = [0, 0, -1], b: V3 = [0, 0.2, -1];
    expect(rayNearSegment([0, 0.1, 0], [0, 0, -1], a, b, 0.01)).toBe(true);
    expect(rayNearSegment([0.05, 0.1, 0], [0, 0, -1], a, b, 0.04)).toBe(false);
    expect(rayNearSegment([0.03, 0.1, 0], [0, 0, -1], a, b, 0.04)).toBe(true);
    // Past either end: the end's round cap.
    expect(rayNearSegment([0, 0.23, 0], [0, 0, -1], a, b, 0.04)).toBe(true);
    expect(rayNearSegment([0, 0.25, 0], [0, 0, -1], a, b, 0.04)).toBe(false);
    // Behind the phone: never.
    expect(rayNearSegment([0, 0.1, -2], [0, 0, -1], a, b, 0.04)).toBe(false);
    // Along the segment's own line (parallel): its nearest end.
    expect(rayNearSegment([0, 0.5, -1], [0, -1, 0], a, b, 0.01)).toBe(true);
  });

  it("finds the lantern on a touch ray within the grab radius, at its depth; misses it otherwise", () => {
    const o: V3 = [0, 1.2, 0], L: V3 = [0.1, 1, -0.6];
    const len = Math.hypot(0.1, -0.2, -0.6), d: V3 = [0.1 / len, -0.2 / len, -0.6 / len];
    expect(grabDepth(o, d, L, 0.06)).toBeCloseTo(len, 9);
    const off: V3 = [L[0] + 0.07, L[1], L[2]];
    expect(grabDepth(o, d, off, 0.06)).toBeNaN();
    expect(grabDepth(o, [-d[0], -d[1], -d[2]], L, 0.06)).toBeNaN();
    expect(dragPoint(o, d, len, [0, 0, 0]).map((x, i) => Math.abs(x - L[i]!) < 1e-12)).toEqual([true, true, true]);
  });

  it("a touch on the lantern holds it as the right hand: pinching from the lantern, following the finger at that depth, let go on lifting", () => {
    const { t, phone, step } = bench();
    const at = w([0.1, 0.05, 1.3]);
    const hand = newHand();
    const src = phone.touch(at);
    step();
    expect(t.roles()).toEqual(["lantern"]);
    expect(t.virtualHand((1 - TOUCH_SIDE) as 0 | 1, newHand())).toBe(false);
    expect(t.virtualHand(TOUCH_SIDE, hand)).toBe(true);
    expect(hand).toMatchObject({ kind: "controller", tracked: true, pinching: true, edge: "start" });
    expect(dist(hand.point, at)).toBeLessThan(1e-9);
    const depth = dist(EYE, at);

    // The finger slides 4 cm right on the screen: the pinch point follows along the new ray at the same depth.
    const aim = at.clone().add(new Vector3(0.04, 0, 0));
    phone.aim(src, aim);
    step();
    expect(t.virtualHand(TOUCH_SIDE, hand)).toBe(true);
    expect(hand).toMatchObject({ pinching: true, edge: null });
    expect(dist(hand.point, EYE)).toBeCloseTo(depth, 9);
    const along = hand.point.clone().sub(EYE).normalize(), want = aim.clone().sub(EYE).normalize();
    expect(along.distanceTo(want)).toBeLessThan(1e-9);
    // It moves on a sphere round the phone, not a plane: 4 cm across at 33 cm leaves it under 6 mm short of the aim.
    expect(dist(hand.point, aim)).toBeLessThan(0.006);

    // The phone loses tracking: no pose, so the hand is out of tracking and the lantern stays held where it is.
    const before = hand.point.clone();
    phone.aim(src, null);
    step();
    t.virtualHand(TOUCH_SIDE, hand);
    expect(hand).toMatchObject({ tracked: false, pinching: true, edge: null });
    expect(dist(hand.point, before)).toBe(0);

    // Lifted: one frame not pinching where it was (the lantern is let go there), then the side is the real hand's again.
    phone.aim(src, aim);
    step();
    t.virtualHand(TOUCH_SIDE, hand);
    phone.lift(src);
    step();
    expect(t.virtualHand(TOUCH_SIDE, hand)).toBe(true);
    expect(hand).toMatchObject({ tracked: true, pinching: false, edge: "end" });
    step();
    expect(t.virtualHand(TOUCH_SIDE, hand)).toBe(false);
  });

  it("a lantern frozen, put away under a menu or already held is not taken: the touch is a finger instead", () => {
    for (const k of ["frozen", "away", "holder"] as const) {
      const { t, phone, step, lantern } = bench();
      if (k === "holder") lantern.grab.holder = "left";
      else lantern[k] = true;
      phone.touch(w([0.1, 0.05, 1.3]));
      step();
      expect(t.roles(), k).toEqual(["finger"]);
    }
  });

  it("takes the lantern over its whole drawn shape: the ring it hangs by, the spire, the foot, at every box size", () => {
    // Box units from the light, up the lantern's axis (lantern-view.ts): the ring's top, its middle, the spire's tip, a
    // fin's edge, the foot's rim.
    const parts: [string, V3][] = [
      ["the ring's top", [0, 0.172, 0]],
      ["the ring", [0.016, 0.155, 0]],
      ["the spire's tip", [0, 0.14, 0]],
      ["a fin", [0.045, 0, 0]],
      ["the foot", [0.05, -0.08, 0]],
    ];
    const L: V3 = [0.1, 0.05, 1.3];
    for (const cm of [18, 24, 30]) {
      for (const [name, off] of parts) {
        const { t, phone, step, toWorld } = bench(null, L, "screen-space", cm);
        phone.touch(toWorld([L[0] + off[0], L[1] + off[1], L[2] + off[2]]));
        step();
        expect(t.roles(), `${name}, ${cm} cm box`).toEqual(["lantern"]);
        // The drag holds from within the lantern controller's own 6 cm grab radius, so it really takes it.
        const hand = newHand();
        expect(t.virtualHand(TOUCH_SIDE, hand)).toBe(true);
        expect(hand.point.distanceTo(toWorld(L)), `${name}, ${cm} cm box`).toBeLessThanOrEqual(0.06);
      }
      // Above the ring, and well clear of its side: a finger, not the lantern.
      for (const off of [[0, 0.3, 0], [0.2, 0, 0]] as V3[]) {
        const { t, phone, step, toWorld } = bench(null, L, "screen-space", cm);
        phone.touch(toWorld([L[0] + off[0], L[1] + off[1], L[2] + off[2]]));
        step();
        expect(t.roles(), `${off.join(", ")} from the light, ${cm} cm box`).toEqual(["finger"]);
      }
    }
  });

  it("a touch on a gap behind the lantern stays a finger even where the ring or spire stands in front of it", () => {
    // The lantern on the line from the phone to the gap, lowered so its spire and ring cover the gap on screen: over a
    // gap only its body takes it.
    const box = { locks: [fingerLock(0)], elements: [] } as unknown as Box;
    const gap = w([0.1, -0.05, 0]);
    const toGap = gap.clone().sub(EYE).normalize();
    const onLine = EYE.clone().addScaledVector(toGap, gap.distanceTo(EYE) * 0.55);
    const up = new Vector3(0, 1, 0).addScaledVector(toGap, -toGap.y).normalize();
    // The light 3 cm below the line: the spire (3.4 cm up) and the ring (4.2 cm up) on it.
    const L = worldToBox(BOX, onLine.clone().addScaledVector(up, -0.03), [0, 0, 0]);
    const { t, phone, step } = bench(box, L);
    phone.touch(gap);
    step();
    expect(t.roles()).toEqual(["finger"]);
  });

  it("takes the lantern over its drawn size only, not a hand's 6 cm reach", () => {
    // The lantern 33 cm from the phone; touches aimed beside it (across the screen, square to the ray).
    const at = w([0.1, 0.05, 1.3]), across = new Vector3(1, 0, 0);
    for (const [cm, want] of [[0, "lantern"], [2, "lantern"], [4, "finger"], [5.5, "finger"]] as const) {
      const { t, phone, step } = bench();
      phone.touch(at.clone().addScaledVector(across, cm / 100));
      step();
      expect(t.roles(), `${cm} cm beside it`).toEqual([want]);
    }
  });

  it("a touch on a finger lock's gap seen just past the lantern casts the finger; a touch on the lantern's body takes it", () => {
    // The gap's middle on the panel, the lantern on the line from the phone to it, then moved 2 to 5 cm off that line
    // (up the screen): the setup a finger lock waits in, the lantern on its spot and the gap behind it.
    const box = { locks: [fingerLock(0)], elements: [] } as unknown as Box;
    const gap = w([0.1, -0.05, 0]);
    const toGap = gap.clone().sub(EYE).normalize();
    const onLine = EYE.clone().addScaledVector(toGap, gap.distanceTo(EYE) * 0.55);
    const up = new Vector3(0, 1, 0).addScaledVector(toGap, -toGap.y).normalize();
    for (const cm of [2, 3, 4, 5]) {
      const lanternWorld = onLine.clone().addScaledVector(up, cm / 100);
      const L = worldToBox(BOX, lanternWorld, [0, 0, 0]);
      expect(L[2], "the lantern in front of the box").toBeGreaterThan(1);
      const onGap = bench(box, L);
      onGap.phone.touch(gap);
      onGap.step();
      expect(onGap.t.roles(), `the gap, the lantern ${cm} cm off its line`).toEqual(["finger"]);
      const onBody = bench(box, L);
      onBody.phone.touch(lanternWorld);
      onBody.step();
      expect(onBody.t.roles(), `the lantern's body, ${cm} cm off the gap's line`).toEqual(["lantern"]);
    }
  });

  it("a touch elsewhere on the box is a finger, and a second touch while one holds the lantern too", () => {
    const { t, phone, step } = bench();
    phone.touch(w([0.1, 0.05, 1.3]));
    step();
    phone.touch(w([-0.2, 0.1, 0]));
    step();
    expect(t.roles()).toEqual(["lantern", "finger"]);
  });
});

/** A finger lock whose missing piece is a bar 0.2 long and 0.12 wide, centred at (0.1, -0.05), at `angle`. */
function fingerLock(angle: number): Lock {
  const c = Math.cos(angle), s = Math.sin(angle);
  const pt = (u: number, v: number): V2 => [0.1 + u * c - v * s, -0.05 + u * s + v * c];
  const bar = [pt(-0.1, -0.06), pt(0.1, -0.06), pt(0.1, 0.06), pt(-0.1, 0.06)];
  return {
    i: 0,
    shape: "teapot",
    center: [0.1, -0.05],
    size: 0.3,
    rot: 0,
    target: [[[0, 0], [0.01, 0], [0, 0.01]], bar],
    L: [0, 0, 1.5],
    finger: true,
    missing: 1,
    fingerAngle: angle,
    mark: null,
    rings: false,
    hidden: false,
  } as unknown as Lock;
}

/** Where a box point casts its shadow on the panel from the lantern `L`. */
function shadowOf(L: V3, p: ArrayLike<number>, o = 0): V2 {
  const k = L[2] / (L[2] - p[o + 2]!);
  return [L[0] + (p[o]! - L[0]) * k, L[1] + (p[o + 1]! - L[1]) * k];
}

describe("a touch's finger in the light", () => {
  it("lies so its shadow is centred under the touch, along the nearest finger lock's piece, as wide as it", () => {
    const L: V3 = [0.2, 0.1, 1.5], q: V2 = [0.12, -0.04], r = 0.9 / 24;
    for (const angle of [0, 30 * DEG, -40 * DEG]) {
      const prong = prongOf(fingerLock(angle))!;
      expect(prong.half).toBeCloseTo(0.1, 9);
      expect(prong.width).toBeCloseTo(0.12, 9);
      const ends = new Float64Array(6);
      expect(fingerEnds(L, q, prong, r, ends)).toBe(true);
      const a = shadowOf(L, ends, 0), b = shadowOf(L, ends, 3);
      // Centred under the touch, 80% of the piece's length, along its axis.
      expect((a[0] + b[0]) / 2).toBeCloseTo(q[0], 9);
      expect((a[1] + b[1]) / 2).toBeCloseTo(q[1], 9);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(2 * 0.1 * TOUCH_FINGER.lengthShare, 9);
      expect(Math.atan2(a[1] - b[1], a[0] - b[0])).toBeCloseTo(angle, 9);
      // At the depth where the finger's shadow is as wide as the piece, inside the box mouth.
      const z = ends[2]!;
      expect(ends[5]).toBe(z);
      expect(2 * r * (L[2] / (L[2] - z))).toBeCloseTo(0.12, 9);
      expect(z).toBeLessThanOrEqual(TOUCH_FINGER.maxZ);
    }
  });

  it("with no finger lock: level, twice a finger's width; never deeper than the mouth, never with the lantern behind", () => {
    const ends = new Float64Array(6), r = 0.9 / 24;
    expect(fingerEnds([0, 0, 1.2], [0, 0], null, r, ends)).toBe(true);
    const a = shadowOf([0, 0, 1.2], ends, 0), b = shadowOf([0, 0, 1.2], ends, 3);
    expect(a[1]).toBeCloseTo(b[1], 9);
    expect(Math.abs(a[0] - b[0])).toBeCloseTo(2 * TOUCH_FINGER.half, 9);
    expect(1.2 / (1.2 - ends[2]!)).toBeCloseTo(TOUCH_FINGER.magnification, 9);
    expect(fingerEnds([0, 0, 1.2], [0, 0], { lock: 0, cx: 0, cy: 0, angle: 0, half: 0.1, width: 2 }, r, ends)).toBe(true);
    expect(ends[2]).toBeLessThanOrEqual(TOUCH_FINGER.maxZ);
    expect(fingerEnds([0, 0, 0], [0, 0], null, r, ends)).toBe(false);
  });

  it("finds where a ray meets the panel", () => {
    const q: V2 = [0, 0];
    expect(panelPoint([0.1, 0.2, 2], [0.05, -0.1, -1], q)).toBe(true);
    expect(q[0]).toBeCloseTo(0.2, 9);
    expect(q[1]).toBeCloseTo(0, 9);
    expect(panelPoint([0, 0, 2], [0, 0, 1], q)).toBe(false);
  });

  it("the touch system casts it from a touch on the box: its shadow under the touch, along the box's finger lock", () => {
    const lock = fingerLock(20 * DEG);
    const box = { locks: [lock], elements: [] } as unknown as Box;
    // The lantern well off the touch's ray (a touch on it would take it).
    const L: V3 = [-0.35, -0.3, 1.4];
    const { t, phone, step } = bench(box, L);
    // The touch's ray reaches the panel at (0.08, -0.06).
    const on = w([0.08, -0.06, 0]);
    phone.touch(on);
    step();
    expect(t.roles()).toEqual(["finger"]);
    const ends = new Float64Array(6);
    expect(t.ends(L, ends)).toBe(true);
    const a = shadowOf(L, ends, 0), b = shadowOf(L, ends, 3);
    expect((a[0] + b[0]) / 2).toBeCloseTo(0.08, 6);
    expect((a[1] + b[1]) / 2).toBeCloseTo(-0.06, 6);
    expect(Math.atan2(a[1] - b[1], a[0] - b[0])).toBeCloseTo(20 * DEG, 6);
    // In box units the ray really does meet the panel there.
    const back = worldToBox(BOX, on, [0, 0, 0]);
    expect(back[2]).toBeCloseTo(0, 9);
  });
});

describe("a touch on a key pokes it", () => {
  /** A 40 mm key facing +z at (0, 1, -0.5). */
  const key = new Matrix4().makeTranslation(0, 1, -0.5).elements;

  it("finds the key a ray reaches from the front, within a few millimetres of its edge, the nearest first", () => {
    const hit = newKeyHit();
    const o: V3 = [0, 1.2, 0], toKey = new Vector3(0.019, -0.2, -0.5).normalize();
    expect(hitKey(o, v3(toKey), key, 0.02, 0.02, -0.004, hit)).toBe(true);
    expect(hit.point[0]).toBeCloseTo(0.019, 9);
    expect(hit.point[1]).toBeCloseTo(1, 9);
    expect(hit.normal).toEqual([0, 0, 1]);
    expect(hit.press).toBe(-0.004);
    // 8 mm outside its edge: a miss.
    const wide = new Vector3(0.028, -0.2, -0.5).normalize();
    expect(hitKey(o, v3(wide), key, 0.02, 0.02, -0.004, newKeyHit())).toBe(false);
    // From behind: a miss.
    expect(hitKey([0, 1, -1], [0, 0, 1], key, 0.02, 0.02, -0.004, newKeyHit())).toBe(false);
    // A key farther along the same ray does not replace a nearer hit.
    const far = new Matrix4().makeTranslation(0, 0.98, -0.55).elements;
    expect(hitKey(o, v3(toKey), far, 0.05, 0.05, -0.004, hit)).toBe(false);
  });

  it("comes in along the face, stays pressed while the finger is down, goes back out once it lifts, then is over", () => {
    const P = TOUCH_POKE, press = -0.004;
    expect(pokeOffset(0, Number.NaN, press)).toBeCloseTo(P.fromM, 12);
    expect(pokeOffset(P.inMs / 2, Number.NaN, press)).toBeCloseTo((P.fromM + press) / 2, 12);
    expect(pokeOffset(P.inMs, Number.NaN, press)).toBeCloseTo(press, 12);
    expect(pokeOffset(5000, Number.NaN, press)).toBeCloseTo(press, 12);
    // Lifted 60 ms ago, long after it was in: half way back out.
    expect(pokeOffset(5000, P.outMs / 2, press)).toBeCloseTo((P.fromM + press) / 2, 12);
    expect(pokeOffset(5000, P.outMs, press)).toBeNaN();
    // A quick tap (lifted after 30 ms) still goes all the way in before it comes out.
    expect(pokeOffset(P.inMs, P.inMs - 30, press)).toBeCloseTo(press, 12);
    expect(pokeOffset(P.inMs + P.outMs / 2, P.inMs + P.outMs / 2 - 30, press)).toBeCloseTo((P.fromM + press) / 2, 12);
  });

  it("the touch system gives the poking fingertip to the keys, on the key and along its normal", () => {
    const { t, phone, step } = bench();
    const keyAt = new Vector3(0, 1, -0.5);
    t.connect({ keys: [{ tapHit: (o, d, out) => hitKey(o, d, key, 0.02, 0.02, -0.004, out) }] });
    phone.touch(keyAt);
    step();
    expect(t.roles()).toEqual(["key"]);
    const tip = new Vector3();
    expect(t.pokeTip(tip)).toBe(true);
    expect(tip.x).toBeCloseTo(0, 9);
    expect(tip.y).toBeCloseTo(1, 9);
    expect(tip.z).toBeGreaterThan(keyAt.z);
  });

  /** The touch system on the frame clock `clock.t` (ms), with the key at (0, 1, -0.5) to poke. */
  function keyBench(clock: { t: number }) {
    vi.spyOn(performance, "now").mockImplementation(() => clock.t);
    const b = bench();
    b.t.connect({ keys: [{ tapHit: (o, d, out) => hitKey(o, d, key, 0.02, 0.02, -0.004, out) }] });
    /** The poking fingertip's offset in front of the key's plane (m), or null with none. */
    const offset = (): number | null => {
      const tip = new Vector3();
      return b.t.pokeTip(tip) ? tip.z - -0.5 : null;
    };
    return { ...b, offset };
  }

  it("catches a tap shorter than a frame through the session's events, and pokes the key with it", () => {
    const clock = { t: 1000 };
    try {
      const { t, phone, step, offset } = keyBench(clock);
      expect(phone.listening("selectstart")).toBe(1);
      // Down and up between two frames: never listed among the input sources.
      const src = phone.source(new Vector3(0, 1, -0.5));
      phone.fire("selectstart", src);
      phone.fire("select", src);
      clock.t += 33;
      step();
      expect(t.roles()).toEqual(["key"]);
      // Its poke goes all the way in, then out, then is over.
      clock.t += TOUCH_POKE.inMs;
      expect(offset()).toBeCloseTo(-0.004, 9);
      clock.t += TOUCH_POKE.outMs + 1;
      expect(offset()).toBeNull();
      step();
      expect(t.roles()).toEqual([]);
      // A touch the frames list as well as the events: one touch, not two.
      const listed = phone.touch(new Vector3(0, 1, -0.5));
      phone.fire("selectstart", listed);
      step();
      expect(t.roles()).toEqual(["key"]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("a quick second tap on a key is a key too: its poke follows the first once that is back out, and both press", () => {
    const clock = { t: 1000 };
    try {
      const { t, phone, step, offset } = keyBench(clock);
      const first = phone.touch(new Vector3(0, 1, -0.5));
      step();
      clock.t += 40;
      phone.lift(first);
      step();
      // 60 ms later, while the first poke is still going out: the second tap.
      clock.t += 60;
      phone.touch(new Vector3(0, 1, -0.5));
      step();
      expect(t.roles()).toEqual(["key", "key"]);
      // The first poke: in by 120 ms, back out by 240 ms; the second then comes in.
      const presses: number[] = [];
      let wasIn = false;
      for (let ms = 1000; ms <= 1700; ms += 5) {
        clock.t = ms;
        const off = offset();
        const isIn = off !== null && off <= -0.004 + 1e-9;
        if (isIn && !wasIn) presses.push(ms);
        wasIn = isIn;
      }
      expect(presses.length, "two presses").toBe(2);
      expect(presses[1]! - presses[0]!).toBeGreaterThanOrEqual(TOUCH_POKE.inMs + TOUCH_POKE.outMs);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("the box in a phone's view", () => {
  it("stands its middle along the camera's view, facing it, whatever the camera's pitch", () => {
    const p = new Placement();
    for (const pitchDeg of [0, -20, -45, 5]) {
      const pitch = pitchDeg * DEG, yaw = 0.7;
      // The camera's pitch as its quaternion gives it.
      const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
      expect(pitchFromQuaternion(q.x, q.y, q.z, q.w)).toBeCloseTo(pitch, 9);
      p.startInView({ position: [0.3, 1.1, -0.2], yaw }, pitch);
      expect(p.source).toBe("view");
      expect(p.inViewM).toBeGreaterThanOrEqual(IN_VIEW_RANGE_M.near);
      expect(p.inViewM).toBeLessThanOrEqual(IN_VIEW_RANGE_M.far);
      const mid = boxToWorld(p.matrix() as Matrix4, [0, 0, 0.5], new Vector3());
      const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
      const want = new Vector3(0.3, 1.1, -0.2).addScaledVector(fwd, p.inViewM);
      expect(mid.distanceTo(want)).toBeLessThan(1e-9);
    }
  });

  it("a phone pointed at the floor or the ceiling places it as if pointed only so far", () => {
    const p = new Placement(), at: [number, number, number] = [0, 1, 0];
    p.startInView({ position: at, yaw: 0 }, -85 * DEG);
    const steep = boxToWorld(p.matrix() as Matrix4, [0, 0, 0.5], new Vector3());
    p.startInView({ position: at, yaw: 0 }, -IN_VIEW_PITCH_DEG.down * DEG);
    expect(boxToWorld(p.matrix() as Matrix4, [0, 0, 0.5], new Vector3()).distanceTo(steep)).toBeLessThan(1e-9);
    p.startInView({ position: at, yaw: 0 }, 40 * DEG);
    const up = boxToWorld(p.matrix() as Matrix4, [0, 0, 0.5], new Vector3());
    expect(up.y - 1).toBeCloseTo(p.inViewM * Math.sin(IN_VIEW_PITCH_DEG.up * DEG), 9);
  });

  it("the extent it keeps in view covers the frame, the plinth and the drawer's handle", () => {
    // Around the box's middle (z 0.5): the drawer front's bottom and the handle's bar, in box units.
    expect(-BOX_EXTENT.down).toBeLessThanOrEqual(DRAWER.y - DRAWER.h / 2);
    expect(-BOX_EXTENT.down).toBeLessThanOrEqual(-0.645);
    expect(0.5 + BOX_EXTENT.front).toBeGreaterThanOrEqual(HANDLE_AT[2] + HANDLE.r);
    expect(BOX_EXTENT.x).toBeGreaterThanOrEqual(0.55);
  });

  it("the whole box, plinth and drawer handle included, is in view in portrait and landscape at every box size", () => {
    // A phone's AR view on a 20:9 screen: about 33 degrees across its short side, 66 along its long one.
    const short = Math.tan(16.5 * DEG), long = Math.tan(33 * DEG);
    const views = { portrait: { tanH: short, tanV: long }, landscape: { tanH: long, tanV: short } };
    const E = BOX_EXTENT, head = new Vector3(0.1, 1.25, -0.3), yaw = -0.4;
    const corners: V3[] = [];
    for (const x of [-E.x, E.x]) for (const y of [-E.down, E.up]) for (const z of [-E.back, E.front]) corners.push([x, y, 0.5 + z]);
    let worst = 0;
    for (const [name, view] of Object.entries(views)) {
      for (const cm of [18, 24, 30]) {
        for (const pitchDeg of [0, -15, -30, -45, -60]) {
          const p = new Placement();
          p.setSize(cm);
          p.startInView({ position: [head.x, head.y, head.z], yaw }, pitchDeg * DEG, view);
          // Each corner as the camera sees it (x right, y up, looking down -z).
          const cam = new Matrix4().compose(head, new Quaternion().setFromEuler(new Euler(pitchDeg * DEG, yaw, 0, "YXZ")), new Vector3(1, 1, 1));
          const toCam = cam.clone().invert();
          for (const c of corners) {
            const v = boxToWorld(p.matrix() as Matrix4, c, new Vector3()).applyMatrix4(toCam);
            expect(v.z, `${name} ${cm} cm pitch ${pitchDeg}: in front`).toBeLessThan(0);
            const sx = Math.abs(v.x / -v.z) / view.tanH, sy = Math.abs(v.y / -v.z) / view.tanV;
            worst = Math.max(worst, sx, sy);
            expect(Math.max(sx, sy), `${name} ${cm} cm pitch ${pitchDeg}: corner ${c.join(", ")}`).toBeLessThanOrEqual(IN_VIEW_FILL + 1e-9);
          }
        }
      }
    }
    // Not placed far off for nothing: some corner comes right to the margin.
    expect(worst).toBeCloseTo(IN_VIEW_FILL, 6);
  });

  it("reads the camera's view from its projection, the narrower side of an off-centre one, a phone's without one", () => {
    const out = { tanH: 0, tanV: 0 };
    // Symmetric: 1 / P[0] and 1 / P[5].
    viewOf(new Matrix4().makePerspective(-0.03, 0.03, 0.05, -0.05, 0.1, 100).elements, out);
    expect(out.tanH).toBeCloseTo(0.3, 9);
    expect(out.tanV).toBeCloseTo(0.5, 9);
    // Off centre: right 0.5 and left 0.3 across, up 0.6 and down 0.4: the narrower each way.
    viewOf(new Matrix4().makePerspective(-0.03, 0.05, 0.06, -0.04, 0.1, 100).elements, out);
    expect(out.tanH).toBeCloseTo(0.3, 9);
    expect(out.tanV).toBeCloseTo(0.4, 9);
    // No projection yet (or a broken one): a phone's narrow view.
    expect(viewOf(undefined, out)).toEqual({ tanH: PHONE_VIEW.tanH, tanV: PHONE_VIEW.tanV });
    expect(viewOf(new Array(16).fill(0), out)).toEqual({ tanH: PHONE_VIEW.tanH, tanV: PHONE_VIEW.tanV });
  });

  it("stands farther for a bigger box and a narrower view", () => {
    const view = PHONE_VIEW, pitch = -30 * DEG;
    expect(inViewDistance(pitch, 0.3, view)).toBeGreaterThan(inViewDistance(pitch, 0.24, view));
    expect(inViewDistance(pitch, 0.24, view)).toBeGreaterThan(inViewDistance(pitch, 0.18, view));
    expect(inViewDistance(pitch, 0.24, { tanH: 0.2, tanV: 0.2 })).toBeGreaterThan(inViewDistance(pitch, 0.24, view));
  });

  it("a headset's placement is the lap's, as before", () => {
    const p = new Placement();
    p.startInView({ position: [0, 1.2, 0], yaw: 0 }, -0.3);
    p.start({ position: [0, 1.2, 0], yaw: 0 });
    expect(p.source).toBe("head");
    expect(p.tiltDeg).toBe(TILT_DEG);
    expect(p.pose().tiltDeg).toBe(TILT_DEG);
    expect((p.matrix() as Matrix4).equals(placeBox({ pos: EYE.clone(), yaw: 0 }, 24))).toBe(true);
  });

  it("leans the box so the phone sees it from the seated eye's angle: 20 degrees above its axis from 60 down to level", () => {
    expect(VIEW_ELEVATION_DEG).toBe(20);
    expect(PHONE_LEAN_DEG).toEqual({ min: -20, max: 40 });
    // Pointed 30 degrees down: the lap's 10; level: its top leans 20 toward the phone; 45 down: back 25.
    expect(phoneLean(-30 * DEG)).toBeCloseTo(10, 9);
    expect(phoneLean(0)).toBeCloseTo(-20, 9);
    expect(phoneLean(-45 * DEG)).toBeCloseTo(25, 9);
    expect(phoneLean(-60 * DEG)).toBeCloseTo(40, 9);
    // Past the limits it stops.
    expect(phoneLean(-85 * DEG)).toBeCloseTo(40, 9);
    expect(phoneLean(10 * DEG)).toBe(-20);
    const head = new Vector3(0.1, 1.25, -0.3);
    for (const pitchDeg of [-60, -45, -30, -15, 0]) {
      const p = new Placement();
      p.startInView({ position: [head.x, head.y, head.z], yaw: 0.6 }, pitchDeg * DEG);
      expect(p.tiltDeg).toBeCloseTo(phoneLean(pitchDeg * DEG), 9);
      expect(p.pose().tiltDeg).toBe(p.tiltDeg);
      // The camera, in box units, seen from the box's middle: 20 degrees above the box's own axis.
      const c = worldToBox(p.matrix() as Matrix4, head, [0, 0, 0]);
      expect(Math.abs(c[0])).toBeLessThan(1e-9);
      expect((Math.atan2(c[1], c[2] - 0.5) / DEG), `pitch ${pitchDeg}`).toBeCloseTo(VIEW_ELEVATION_DEG, 9);
    }
  });

  it("sees the box from the seated eye's angle at any pitch: no lantern spot stands in front of the panel", () => {
    // The lantern's drawn shape round its light (box units): the foot's rim 0.058 out and 0.087 down, the ring's top
    // 0.174 up.
    const shape: V3[] = [];
    for (const x of [-0.058, 0.058]) for (const y of [-0.087, 0.174]) for (const z of [-0.058, 0.058]) shape.push([x, y, z]);
    // Lesson 1's and 2's spots, the start, and a 7 x 5 x 4 grid over the whole envelope (and its mirror: x both ways).
    const E = ENVELOPE, spots: V3[] = [...LESSON_1.locks.map((l) => l.L), ...LESSON_2.locks.map((l) => l.L), [...E.START]];
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 5; j++) {
        for (let k = 0; k < 4; k++) {
          spots.push([-E.LX_MAX + (2 * E.LX_MAX * i) / 6, E.LY[0] + ((E.LY[1] - E.LY[0]) * j) / 4, E.LZ[0] + ((E.LZ[1] - E.LZ[0]) * k) / 3]);
        }
      }
    }
    const short = Math.tan(16.5 * DEG), long = Math.tan(33 * DEG);
    const views = { square: PHONE_VIEW, portrait: { tanH: short, tanV: long }, landscape: { tanH: long, tanV: short } };
    const head = new Vector3(0.1, 1.25, -0.3);
    let highest = -Infinity, worst = "";
    for (const [name, view] of Object.entries(views)) {
      for (const cm of [18, 24, 30]) {
        for (let pitchDeg = -60; pitchDeg <= 0; pitchDeg += 5) {
          const p = new Placement();
          p.setSize(cm);
          p.startInView({ position: [head.x, head.y, head.z], yaw: -0.4 }, pitchDeg * DEG, view);
          const c = worldToBox(p.matrix() as Matrix4, head, [0, 0, 0]);
          for (const s of spots) {
            for (const d of shape) {
              const q: V3 = [s[0] + d[0], s[1] + d[1], s[2] + d[2]];
              // Between the camera and the panel; seen from the camera, where it falls on the panel's plane.
              expect(c[2]).toBeGreaterThan(q[2]);
              const t = c[2] / (c[2] - q[2]), y = c[1] + (q[1] - c[1]) * t;
              if (y > highest) {
                highest = y;
                worst = `${name} ${cm} cm pitch ${pitchDeg}, spot ${s.join(", ")}`;
              }
            }
          }
        }
      }
    }
    console.log(`phone view: the lantern's highest point falls at y ${highest.toFixed(3)} on the panel's plane (${worst})`);
    // Below the panel's lower edge (y -0.5) everywhere: the lantern never stands in front of the panel.
    expect(highest, worst).toBeLessThan(-0.5);
  });

});

describe("the drawer tapped open", () => {
  const frame = { handle: (o: Vector3) => o.set(0, 0.9, -0.5), toward: (o: Vector3) => o.set(0, 0, 1) };

  it("opens as a full pull does, counted as one, only while it could be pulled", () => {
    let enabled = false;
    const pull = new DrawerPull(frame, { enabled: () => enabled });
    expect(pull.tap("right")).toBe(false);
    enabled = true;
    expect(pull.tap("right")).toBe(true);
    expect(pull).toMatchObject({ state: "open", progress: 1, opened: 1, hand: "right" });
    expect(pull.tap("right")).toBe(false);
    expect(pull.opened).toBe(1);
    expect(DRAWER_PULL.gripM).toBeGreaterThan(0);
  });
});

describe("coach lines on a phone", () => {
  it("say the lines about hands the phone's way, and leave every other line as it is", () => {
    expect(phoneLine(COPY.lessons.pickUp)).toBe(COPY.phone.pickUp);
    expect(phoneLine(COPY.lessons.slide)).toBe(COPY.phone.slide);
    expect(phoneLine(COPY.lessons.finger)).toBe(COPY.phone.finger);
    expect(phoneLine(COPY.lessons.drawer)).toBe(COPY.phone.drawer);
    expect(phoneLine(COPY.lessons.puppets)).toBe(COPY.phone.puppets);
    expect(phoneLine(COPY.game.controllerFinger)).toBe(COPY.phone.finger);
    expect(phoneLine(COPY.lessons.watch)).toBe(COPY.lessons.watch);
    expect(phoneLine(null)).toBeNull();
    for (const s of Object.values(COPY.phone)) expect(s).toMatch(/^[A-Z].*\.$/);
  });
});
