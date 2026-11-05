// Tracked hand joints, read once per frame for everything that needs them (the pinch, the lantern grab, hand
// shadows): all 25 WebXR joints of each hand in one fillPoses call per hand, kept as world positions and as the
// raw poses (for a joint's turn). A hand counts as tracked only when the runtime gave every joint a finite pose this
// frame: a headset can keep listing a hand it no longer sees. Preallocated; nothing is allocated per frame.
import { Matrix4, type Vector3 } from "@iwsdk/core";

export type HandSide = "left" | "right";

/** The WebXR hand joints in their spec order (an XRHand lists them this way). */
export const HAND_JOINTS: readonly XRHandJoint[] = [
  "wrist",
  "thumb-metacarpal",
  "thumb-phalanx-proximal",
  "thumb-phalanx-distal",
  "thumb-tip",
  "index-finger-metacarpal",
  "index-finger-phalanx-proximal",
  "index-finger-phalanx-intermediate",
  "index-finger-phalanx-distal",
  "index-finger-tip",
  "middle-finger-metacarpal",
  "middle-finger-phalanx-proximal",
  "middle-finger-phalanx-intermediate",
  "middle-finger-phalanx-distal",
  "middle-finger-tip",
  "ring-finger-metacarpal",
  "ring-finger-phalanx-proximal",
  "ring-finger-phalanx-intermediate",
  "ring-finger-phalanx-distal",
  "ring-finger-tip",
  "pinky-finger-metacarpal",
  "pinky-finger-phalanx-proximal",
  "pinky-finger-phalanx-intermediate",
  "pinky-finger-phalanx-distal",
  "pinky-finger-tip",
];
export const JOINT_COUNT = HAND_JOINTS.length;

const JOINT_INDEX: Readonly<Record<string, number>> = Object.fromEntries(HAND_JOINTS.map((j, i) => [j, i]));
const THUMB_TIP = JOINT_INDEX["thumb-tip"]!;
const INDEX_TIP = JOINT_INDEX["index-finger-tip"]!;

type FillPoses = (spaces: XRSpace[], base: XRSpace, transforms: Float32Array) => boolean;
type GetJointPose = (joint: XRJointSpace, base: XRSpace) => XRJointPose | undefined;

/** One hand: the joint spaces of the input source they came from, and this frame's poses. */
interface Slot {
  source: XRInputSource | null;
  spaces: XRJointSpace[];
  /** 25 column-major 4x4 poses in the reference space. */
  readonly poses: Float32Array;
  /** 25 world positions (x, y, z). */
  readonly world: Float32Array;
  tracked: boolean;
  seen: boolean;
}

const newSlot = (): Slot => ({
  source: null,
  spaces: [],
  poses: new Float32Array(JOINT_COUNT * 16),
  world: new Float32Array(JOINT_COUNT * 3),
  tracked: false,
  seen: false,
});

const sideIndex = (h: HandSide): 0 | 1 => (h === "left" ? 0 : 1);

export class HandJoints {
  private readonly slots: [Slot, Slot] = [newSlot(), newSlot()];
  /** The XR reference space to world (the player rig's matrix); identity when none is given. */
  private readonly origin = new Matrix4();
  /** A failed joint read has been reported (once). */
  private warned = false;

  /**
   * Read both hands' joints for this frame. `origin` carries the reference space into the world (the player rig's
   * world matrix); without it the reference space is the world.
   */
  update(frame: XRFrame, ref: XRReferenceSpace, origin?: Readonly<Matrix4>): void {
    if (origin) this.origin.copy(origin);
    else this.origin.identity();
    const a = this.slots[0], b = this.slots[1];
    a.seen = false;
    b.seen = false;
    const list = frame.session.inputSources;
    for (let i = 0; i < list.length; i++) {
      const src = list[i]!;
      const hand = src.hand;
      if (!hand) continue;
      const s = src.handedness === "left" ? a : src.handedness === "right" ? b : null;
      if (!s || s.seen) continue;
      s.seen = true;
      this.read(s, src, hand, frame, ref);
    }
    if (!a.seen) a.tracked = false;
    if (!b.seen) b.tracked = false;
  }

  /** No frame (no XR session): neither hand is tracked. */
  clear(): void {
    this.slots[0].tracked = false;
    this.slots[1].tracked = false;
  }

  /** The hand has every joint's pose this frame. */
  tracked(h: HandSide): boolean {
    return this.slots[sideIndex(h)].tracked;
  }

  /** A joint's world position into `out`; false (and `out` untouched) when the hand is not tracked. */
  joint(h: HandSide, j: XRHandJoint, out: Vector3): boolean {
    const s = this.slots[sideIndex(h)];
    const k = JOINT_INDEX[j];
    if (!s.tracked || k === undefined) return false;
    const w = s.world, o = k * 3;
    out.set(w[o]!, w[o + 1]!, w[o + 2]!);
    return true;
  }

  /** Where the hand pinches: halfway between the thumb and index fingertips (world). */
  pinchPoint(h: HandSide, out: Vector3): boolean {
    const s = this.slots[sideIndex(h)];
    if (!s.tracked) return false;
    const w = s.world, t = THUMB_TIP * 3, i = INDEX_TIP * 3;
    out.set((w[t]! + w[i]!) / 2, (w[t + 1]! + w[i + 1]!) / 2, (w[t + 2]! + w[i + 2]!) / 2);
    return true;
  }

  /** Thumb tip to index tip in metres; NaN when the hand is not tracked. */
  pinchDistance(h: HandSide): number {
    const s = this.slots[sideIndex(h)];
    if (!s.tracked) return Number.NaN;
    const w = s.world, t = THUMB_TIP * 3, i = INDEX_TIP * 3;
    const x = w[t]! - w[i]!, y = w[t + 1]! - w[i + 1]!, z = w[t + 2]! - w[i + 2]!;
    return Math.sqrt(x * x + y * y + z * z);
  }

  /** A joint's world pose (position and turn) into `out`; false when the hand is not tracked. */
  pose(h: HandSide, j: XRHandJoint, out: Matrix4): boolean {
    const s = this.slots[sideIndex(h)];
    const k = JOINT_INDEX[j];
    if (!s.tracked || k === undefined) return false;
    out.fromArray(s.poses, k * 16).premultiply(this.origin);
    return true;
  }

  private read(s: Slot, src: XRInputSource, hand: XRHand, frame: XRFrame, ref: XRReferenceSpace): void {
    if (s.source !== src) {
      // A new input source (a hand coming back can be a new object): look its joint spaces up once.
      s.source = src;
      const spaces: XRJointSpace[] = [];
      for (const j of HAND_JOINTS) {
        const space = hand.get(j);
        if (!space) break;
        spaces.push(space);
      }
      s.spaces = spaces.length === JOINT_COUNT ? spaces : [];
    }
    let ok = false;
    if (s.spaces.length === JOINT_COUNT) {
      try {
        const f = frame as XRFrame & { fillPoses?: FillPoses; getJointPose?: GetJointPose };
        if (f.fillPoses) ok = f.fillPoses(s.spaces, ref, s.poses);
        else if (f.getJointPose) ok = this.readEach(s, f.getJointPose.bind(f), ref);
      } catch (err) {
        // Untracked this frame. Said once, never per frame (a runtime that throws here throws every frame).
        if (!this.warned) {
          this.warned = true;
          console.warn("hand joints unavailable: reading the joint poses failed", err);
        }
        ok = false;
      }
    }
    s.tracked = ok && this.toWorld(s);
  }

  /** Without fillPoses (older runtimes): one joint at a time. Allocates; never used on Quest. */
  private readEach(s: Slot, get: GetJointPose, ref: XRReferenceSpace): boolean {
    for (let j = 0; j < JOINT_COUNT; j++) {
      const pose = get(s.spaces[j]!, ref);
      if (!pose) return false;
      s.poses.set(pose.transform.matrix, j * 16);
    }
    return true;
  }

  /** Joint positions to world; false when any is not finite (then the hand counts as not tracked). */
  private toWorld(s: Slot): boolean {
    const e = this.origin.elements, p = s.poses, w = s.world;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const o = j * 16 + 12;
      const x = p[o]!, y = p[o + 1]!, z = p[o + 2]!;
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) return false;
      const k = j * 3;
      w[k] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      w[k + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      w[k + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    return true;
  }
}
