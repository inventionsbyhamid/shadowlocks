// Synthetic tracked hands for unit tests: joints laid out in box units, carried into the world through a box
// placement, and read by a real HandJoints from a fake XR frame (as the headset's runtime would hand them over).
import { Matrix4, Vector3 } from "@iwsdk/core";
import type { V3 } from "../../../src/core/types";
import { HAND_JOINTS, HandJoints } from "../../../src/input/hand-joints";
import { boxToWorld, placeBox } from "../../../src/render/placement";

export type JointMap = Record<XRHandJoint, V3>;

/** The box as the game places it: 24 cm, in the lap of a seated player turned a little to the left. */
export const BOX_CM = 24;
export const boxMatrix = (cm = BOX_CM): Matrix4 => placeBox({ pos: new Vector3(0.1, 1.2, -0.2), yaw: 0.3 }, cm);

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A flat pointing hand in box units at one depth: the index finger straight along `dir` (in the panel's plane), the
 * middle of its last two bones (intermediate joint to tip) at `mid`; the palm and the curled fingers behind it, the
 * curled ones a little toward the player. Real proportions in cm, scaled to a `boxCm` box.
 */
export function pointingHand(mid: V3, dir: V3, boxCm = BOX_CM): JointMap {
  const u = norm([dir[0], dir[1], 0]);
  const s: V3 = [-u[1], u[0], 0];
  // [along the finger, across the hand, toward the player] in cm from `mid`.
  const at = (a: number, b: number, c = 0): V3 => [
    mid[0] + (u[0] * a + s[0] * b) / boxCm,
    mid[1] + (u[1] * a + s[1] * b) / boxCm,
    mid[2] + c / boxCm,
  ];
  const curled = (b: number): V3[] => [at(-12, b), at(-6.5, b), at(-4, b, 1), at(-4.5, b, 2.5), at(-5.5, b, 2.5)];
  const [mm, mp, mi, md, mt] = curled(-2);
  const [rm, rp, ri, rd, rt] = curled(-4);
  const [pm, pp, pi, pd, pt] = curled(-5.8);
  return {
    wrist: at(-15.5, -2.5),
    "thumb-metacarpal": at(-12, 1.5),
    "thumb-phalanx-proximal": at(-9, 2.8),
    "thumb-phalanx-distal": at(-6.5, 3.2, 1),
    "thumb-tip": at(-4.5, 3.2, 1.5),
    "index-finger-metacarpal": at(-12.3, 0),
    "index-finger-phalanx-proximal": at(-6.3, 0),
    "index-finger-phalanx-intermediate": at(-2.3, 0),
    "index-finger-phalanx-distal": at(0.1, 0),
    "index-finger-tip": at(2.3, 0),
    "middle-finger-metacarpal": mm!,
    "middle-finger-phalanx-proximal": mp!,
    "middle-finger-phalanx-intermediate": mi!,
    "middle-finger-phalanx-distal": md!,
    "middle-finger-tip": mt!,
    "ring-finger-metacarpal": rm!,
    "ring-finger-phalanx-proximal": rp!,
    "ring-finger-phalanx-intermediate": ri!,
    "ring-finger-phalanx-distal": rd!,
    "ring-finger-tip": rt!,
    "pinky-finger-metacarpal": pm!,
    "pinky-finger-phalanx-proximal": pp!,
    "pinky-finger-phalanx-intermediate": pi!,
    "pinky-finger-phalanx-distal": pd!,
    "pinky-finger-tip": pt!,
  };
}

/** The same hand moved by `d` (box units). */
export const moved = (h: JointMap, d: V3): JointMap =>
  Object.fromEntries(Object.entries(h).map(([j, p]) => [j, [p[0] + d[0], p[1] + d[1], p[2] + d[2]]])) as JointMap;

interface FakeSpace {
  joint: XRHandJoint;
  side: "left" | "right";
}

/** What the fake runtime reports: each hand's joints in world metres, or null (that hand is not listed). */
export interface Frame {
  left?: JointMap | null;
  right?: JointMap | null;
}

/**
 * A HandJoints fed from a fake frame: `feed(f)` reads the hands of `f` (given in box units) through the box matrix,
 * as HandPinchSystem's `update` does once a frame. One input source object per hand, kept across frames.
 */
export function fakeJoints(m: Matrix4 = boxMatrix()) {
  const hj = new HandJoints();
  const sources = (["left", "right"] as const).map((side) => {
    const spaces = new Map<XRHandJoint, FakeSpace>();
    for (const j of HAND_JOINTS) spaces.set(j, { joint: j, side });
    return { handedness: side, hand: { get: (j: XRHandJoint) => spaces.get(j) } };
  });
  const v = new Vector3();
  const pose = new Matrix4();
  const feed = (f: Frame): HandJoints => {
    const world: Partial<Record<"left" | "right", JointMap>> = {};
    for (const side of ["left", "right"] as const) {
      const h = f[side];
      if (h) world[side] = h;
    }
    const frame = {
      session: { inputSources: sources.filter((s) => world[s.handedness as "left" | "right"]) },
      fillPoses(spaces: FakeSpace[], _base: unknown, out: Float32Array) {
        spaces.forEach((sp, k) => {
          const p = world[sp.side]![sp.joint];
          boxToWorld(m, p, v);
          out.set(pose.makeTranslation(v.x, v.y, v.z).elements, k * 16);
        });
        return true;
      },
    };
    hj.update(frame as unknown as XRFrame, {} as XRReferenceSpace);
    return hj;
  };
  return { joints: hj, feed, m };
}
