// A box lost from view, and what then. The box's bounding sphere is tested against the camera's view each frame, and a
// timer counts how long no part of it has been in view.
// - A phone places it in front again by itself once it has been out of view for LOST_MS, the phone held still in a
//   looking pose (PlaceGate.steady), no touch down and the lantern not held (a held lantern's pinch point is read in box
//   units every frame: moving the box under it would make it jump).
// - A headset never moves it by itself (content stays anchored in the room, as Meta's MR design guideline asks): after
//   LOST_MS, with the lantern not held and no pinch down, an arrow at the edge of the view points to it (`arrow`), and
//   a pinch or poke on the arrow brings it in front (summon.ts). The arrow goes once any part of the box is in view.
// Lantern position, open locks and solve state live in box units and the session: a re-place moves only the root.
// Pure parts; allocation free per frame.
import { type Matrix4, Quaternion, Vector3 } from "@iwsdk/core";
import { BOX_EXTENT, type ViewTangents } from "./placement";

/** Fully out of view this long (ms) before anything happens. */
export const LOST_MS = 2000;

const E = BOX_EXTENT;
/** The box's bounding sphere in box units: round the middle of BOX_EXTENT (frame, plinth and drawer handle). */
export const BOX_SPHERE = {
  center: [0, (E.up - E.down) / 2, 0.5 + (E.front - E.back) / 2] as const,
  radius: Math.hypot(E.x, (E.up + E.down) / 2, (E.front + E.back) / 2),
} as const;

/**
 * Whether any part of a sphere is inside a view: its centre `c` in camera space (x right, y up, looking down -z), radius
 * `r`, the view's half-angle tangents `view`. Conservative near the view's corners (it may say "in" there).
 */
export function sphereInView(c: Readonly<{ x: number; y: number; z: number }>, r: number, view: ViewTangents): boolean {
  const x = c.x, y = c.y, z = c.z;
  if (z > r) return false;
  const h = view.tanH, v = view.tanV;
  // Past a side plane (through the eye, its outward normal (±1, 0, tan) / |...|) by more than the radius: out.
  const kh = Math.sqrt(1 + h * h), kv = Math.sqrt(1 + v * v);
  if (x + z * h > r * kh || -x + z * h > r * kh) return false;
  if (y + z * v > r * kv || -y + z * v > r * kv) return false;
  return true;
}

const c = new Vector3();
const inv = new Quaternion();

/**
 * Whether any part of the box is in a camera's view: the box `box` (box units to world, a turn and one scale), the
 * camera at `eye` turned `turn` (it looks down its -z), the view's half-angle tangents `view`.
 */
export function boxInView(box: Readonly<Matrix4>, eye: Readonly<Vector3>, turn: Readonly<Quaternion>, view: ViewTangents): boolean {
  const e = box.elements, s = BOX_SPHERE.center;
  const scale = Math.sqrt(e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!);
  c.set(s[0], s[1], s[2]).applyMatrix4(box as Matrix4).sub(eye);
  c.applyQuaternion(inv.copy(turn).invert());
  return sphereInView(c, BOX_SPHERE.radius * scale, view);
}

/** What the lost-box rule reads each frame (filled in place). */
export interface LostInput {
  /** The session is a phone's. */
  phone: boolean;
  /** The phone or head is held still in a looking pose (PlaceGate.steady). */
  steady: boolean;
  /** A phone's touch is down. */
  touchDown: boolean;
  /** The lantern is held. */
  held: boolean;
  /** A hand's pinch (or a controller's trigger or squeeze) is down. */
  pinchDown: boolean;
}

/** How long the box has been out of view, and what to do about it (see the module comment). */
export class LostBox {
  /** A headset's arrow toward the box is up. */
  arrow = false;
  private since = Number.NaN;
  private lost = 0;

  /** How long (ms) no part of the box has been in view, as of the last update (0 while it is, or after a reset). */
  get lostMs(): number {
    return this.lost;
  }

  /**
   * This frame: whether any part of the box is in view, at `nowMs`. True on the frame a phone's box should be placed in
   * front again (the timer then starts over); a headset's answer is `arrow`.
   */
  update(nowMs: number, inView: boolean, s: Readonly<LostInput>): boolean {
    if (inView) {
      this.reset();
      return false;
    }
    if (this.since !== this.since) this.since = nowMs;
    this.lost = nowMs - this.since;
    if (this.lost < LOST_MS) return false;
    if (s.phone) {
      this.arrow = false;
      if (!s.steady || s.touchDown || s.held) return false;
      this.reset();
      return true;
    }
    // Once up it stays (the pinch that takes it is a pinch down) until the box is in view or it is taken.
    if (!this.arrow && !s.held && !s.pinchDown) this.arrow = true;
    return false;
  }

  /**
   * One frame, deciding and doing: update, and when a phone's box should be placed in front again, `place` it now, on
   * this frame, so the decision and the move read the same frame's inputs (a touch starting the next frame finds the
   * box already moved, never moved under it). True when it was placed; a `place` that does not take (the head not
   * tracked) still starts the timer over. `place` is made once by the caller: nothing is allocated per frame.
   */
  frame(nowMs: number, inView: boolean, s: Readonly<LostInput>, place: () => boolean): boolean {
    return this.update(nowMs, inView, s) && place();
  }

  /** Start over: the box placed again, the arrow taken, or a new session. */
  reset(): void {
    this.since = Number.NaN;
    this.lost = 0;
    this.arrow = false;
  }
}
