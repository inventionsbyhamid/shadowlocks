// Where the box sits: in the lap, placed from the seated head when an XR session starts and again on
// Recenter (no plane detection: a headset cannot find a lap). One matrix carries box units to world
// metres: the back panel's centre is the origin, 1 unit = the box size, the open front faces the
// player and leans back by the tilt like a book on the lap. A size change scales everything around
// the panel, so lantern positions and solve state (all in box units) never move in the box.
import { Euler, Matrix4, Quaternion, Vector3 } from "@iwsdk/core";
import type { V3, Vec3 } from "../core/types";

/** The back panel's centre this far in front of the eyes, horizontally. */
export const BOX_FORWARD_M = 0.55;
/** The back panel's centre this far below the eyes (the box's own centre sits about 4 cm higher). */
export const BOX_BELOW_HEAD_M = 0.28;
/**
 * How far the box leans back, in degrees. The comfort spike (plan comfort-spike.md) chose 10: at the
 * planned 20 the open front points so far up that lantern spots in front of it rise above the sternum
 * line (only 15 cm below the eyes) and sit within 6 degrees of the line of sight to the panel.
 */
export const TILT_DEG = 10;
/** The box size setting's default, in cm (the setting runs 18-30). */
export const DEFAULT_BOX_CM = 24;
/** Seated eye height used until a session gives a real head pose. */
export const DEFAULT_EYE_Y_M = 1.2;
/** The box root's scene name (the perf panel and tests find the box by it). */
export const BOX_ROOT_NAME = "Box";

/** A head for placement: where the eyes are and which way they face (yaw about +Y; 0 looks down -Z). */
export interface Eye {
  pos: Vector3;
  yaw: number;
}

const DEG = Math.PI / 180;
const tmpEuler = new Euler(0, 0, 0, "YXZ");
const tmpQuat = new Quaternion();
const tmpPos = new Vector3();
const tmpScale = new Vector3();

/**
 * The box-to-world matrix for a head: the panel centre `forwardM` ahead of the eyes (along the head's
 * heading, flattened; 0.55 m) and `belowM` below them (0.28 m), turned to face the head and leaning
 * back `tiltDeg`, scaled so one box unit is `sizeCm`.
 */
export function placeBox(
  eye: Eye,
  sizeCm: number,
  tiltDeg = TILT_DEG,
  out = new Matrix4(),
  forwardM = BOX_FORWARD_M,
  belowM = BOX_BELOW_HEAD_M,
): Matrix4 {
  tmpPos.set(eye.pos.x - Math.sin(eye.yaw) * forwardM, eye.pos.y - belowM, eye.pos.z - Math.cos(eye.yaw) * forwardM);
  tmpQuat.setFromEuler(tmpEuler.set(-tiltDeg * DEG, eye.yaw, 0, "YXZ"));
  const s = sizeCm / 100;
  tmpScale.set(s, s, s);
  return out.compose(tmpPos, tmpQuat, tmpScale);
}

/** A point in box units to world metres. */
export function boxToWorld(m: Matrix4, v: V3, out: Vector3): Vector3 {
  return out.set(v[0], v[1], v[2]).applyMatrix4(m);
}

/**
 * A world point to box units, for a matrix from placeBox (a turn and one uniform scale): each box
 * axis is a column of the matrix, so the point is its offset from the panel dotted with each column
 * over the scale squared. No inverse, no allocation.
 */
export function worldToBox(m: Matrix4, v: Vector3, out: V3): V3 {
  const e = m.elements;
  const dx = v.x - e[12]!, dy = v.y - e[13]!, dz = v.z - e[14]!;
  const s2 = e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!;
  out[0] = (e[0]! * dx + e[1]! * dy + e[2]! * dz) / s2;
  out[1] = (e[4]! * dx + e[5]! * dy + e[6]! * dz) / s2;
  out[2] = (e[8]! * dx + e[9]! * dy + e[10]! * dz) / s2;
  return out;
}

/**
 * Heading of a head (camera) quaternion: the direction its -Z axis points, flattened onto the floor.
 * Looking up or down does not change it.
 */
export function yawFromQuaternion(x: number, y: number, z: number, w: number): number {
  const fx = -2 * (x * z + w * y);
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz);
}

/** How far a head (camera) quaternion looks up (positive) or down (negative), in radians: its -Z axis above the floor. */
export function pitchFromQuaternion(x: number, y: number, z: number, w: number): number {
  const fx = -2 * (x * z + w * y);
  const fy = 2 * (w * x - y * z);
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(fy, Math.hypot(fx, fz));
}

/**
 * A phone in AR: the box's middle stands this far (m) from the camera along its view, so the whole box is in the
 * picture when it appears (the seated lap is below a phone's narrower view).
 */
export const IN_VIEW_M = 0.65;
/** A phone pointed steeper than this, down or up (degrees), places the box as if it were not: upright, still ahead. */
export const IN_VIEW_PITCH_DEG = { down: 60, up: 10 } as const;

/**
 * Where the panel centre goes so the box's middle (half a box in front of the panel, along the box's own tilted axis)
 * is IN_VIEW_M along a camera pitched `pitch` radians: how far ahead (flattened) and below the camera, for placeBox.
 */
export function inViewOffsets(pitch: number, sizeM: number, tiltDeg = TILT_DEG): { forwardM: number; belowM: number } {
  const p = Math.min(IN_VIEW_PITCH_DEG.up * DEG, Math.max(-IN_VIEW_PITCH_DEG.down * DEG, pitch));
  const t = tiltDeg * DEG, half = sizeM / 2;
  return {
    forwardM: IN_VIEW_M * Math.cos(p) + half * Math.cos(t),
    belowM: -IN_VIEW_M * Math.sin(p) + half * Math.sin(t),
  };
}

/** The back panel's centre (world) and the box's heading, for what lays itself out around the box. */
export interface BoxPose {
  position: Vec3;
  yaw: number;
}

export interface HeadPose {
  position: Readonly<Vec3>;
  yaw: number;
}

/** "default" until a session starts and the box is placed from the head ("head"), or in a phone's view ("view"). */
export type PlacementSource = "default" | "head" | "view";

/**
 * Where the box sits: the head it was placed from and the box size. Placing again (Recenter) keeps
 * the size; a size change keeps the panel where it is. No allocation after creation.
 */
export class Placement {
  /** Increments on every change, so systems can tell cheaply. */
  version = 0;
  source: PlacementSource = "default";
  private readonly eye: Eye = { pos: new Vector3(0, DEFAULT_EYE_Y_M, 0), yaw: 0 };
  private sizeCm = DEFAULT_BOX_CM;
  /** The panel centre ahead of and below the eyes: the lap's, or a phone's view's (startInView). */
  private forwardM = BOX_FORWARD_M;
  private belowM = BOX_BELOW_HEAD_M;
  private readonly m = new Matrix4();
  private readonly current: BoxPose = { position: [0, 0, 0], yaw: 0 };

  constructor() {
    this.apply();
  }

  /** The panel centre and heading (the same object every call). */
  pose(): Readonly<BoxPose> {
    return this.current;
  }

  /** Box units to world metres (the same object every call). */
  matrix(): Readonly<Matrix4> {
    return this.m;
  }

  /** The box edge in metres. */
  get sizeM(): number {
    return this.sizeCm / 100;
  }

  /** Place the box from the head (session start, Recenter). The size stays. */
  start(head: HeadPose): void {
    this.eye.pos.set(head.position[0], head.position[1], head.position[2]);
    this.eye.yaw = head.yaw;
    this.forwardM = BOX_FORWARD_M;
    this.belowM = BOX_BELOW_HEAD_M;
    this.source = "head";
    this.apply();
  }

  /**
   * Place the box in a phone's view (session start, Recenter): its middle IN_VIEW_M along the camera's view, `pitch`
   * radians up or down, upright and facing it. A size change after keeps the panel where it is, as for the lap.
   */
  startInView(head: HeadPose, pitch: number): void {
    const o = inViewOffsets(pitch, this.sizeM);
    this.eye.pos.set(head.position[0], head.position[1], head.position[2]);
    this.eye.yaw = head.yaw;
    this.forwardM = o.forwardM;
    this.belowM = o.belowM;
    this.source = "view";
    this.apply();
  }

  /** The box size setting (cm); the box grows or shrinks around its panel. */
  setSize(cm: number): void {
    if (cm === this.sizeCm) return;
    this.sizeCm = cm;
    this.apply();
  }

  private apply(): void {
    placeBox(this.eye, this.sizeCm, TILT_DEG, this.m, this.forwardM, this.belowM);
    const e = this.m.elements;
    this.current.position[0] = e[12]!;
    this.current.position[1] = e[13]!;
    this.current.position[2] = e[14]!;
    this.current.yaw = this.eye.yaw;
    this.version++;
  }
}

/** The app's box placement. */
export const placement = new Placement();

export function boxPose(): Readonly<BoxPose> {
  return placement.pose();
}
