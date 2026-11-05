// Where the box sits: placed in the lap from the seated head when an XR session starts, and again on
// Recenter. No plane detection or desk tap (a headset cannot find a lap). This is the placeholder
// placement: the box scene (src/render/placement.ts) adds the size and the backward tilt.
import type { Vec3 } from "../core/types";

/** The box's back panel this far in front of the eyes at session start (horizontal). */
export const BOX_FORWARD_M = 0.55;
/** The panel's centre this far below the eyes, before the height offset. */
export const BOX_BELOW_HEAD_M = 0.28;
/** The box root's scene name (the perf panel and tests find the box by it). */
export const BOX_ROOT_NAME = "Box";

/** The back panel's centre and heading. Yaw is about +Y; the panel faces the player at yaw 0 from +Z. */
export interface BoxPose {
  position: Vec3;
  yaw: number;
}

export interface HeadPose {
  position: Readonly<Vec3>;
  yaw: number;
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

/** Where the box goes for a head pose: 0.55 m ahead, 0.28 m below the eyes, plus the offset. */
export function headBoxPose(head: HeadPose, offsetCm = 0, out?: BoxPose): BoxPose {
  const o = out ?? { position: [0, 0, 0], yaw: 0 };
  o.position[0] = head.position[0] - Math.sin(head.yaw) * BOX_FORWARD_M;
  o.position[1] = head.position[1] - BOX_BELOW_HEAD_M + offsetCm / 100;
  o.position[2] = head.position[2] - Math.cos(head.yaw) * BOX_FORWARD_M;
  o.yaw = head.yaw;
  return o;
}

/** "default" until a session starts and the box is placed from the head ("head"). */
export type PlacementSource = "default" | "head";

/** Where the box sits. The height offset applies on top of the head-based height. No allocation after creation. */
export class Placement {
  /** Increments on every change, so systems can tell cheaply. */
  version = 0;
  source: PlacementSource = "default";
  private readonly current: BoxPose = { position: [0, 1.2 - BOX_BELOW_HEAD_M, -BOX_FORWARD_M], yaw: 0 };
  /** Height from the head, without the offset. */
  private baseY = 1.2 - BOX_BELOW_HEAD_M;
  private offsetCm = 0;

  pose(): Readonly<BoxPose> {
    return this.current;
  }

  /** Place the box from the head (session start, Recenter). */
  start(head: HeadPose, offsetCm = 0): void {
    headBoxPose(head, 0, this.current);
    this.offsetCm = offsetCm;
    this.baseY = this.current.position[1];
    this.source = "head";
    this.apply();
  }

  /** Raise (+) or lower (-) the box by `cm` from its head-based height. */
  setOffset(cm: number): void {
    if (cm === this.offsetCm) return;
    this.offsetCm = cm;
    this.apply();
  }

  private apply(): void {
    this.current.position[1] = this.baseY + this.offsetCm / 100;
    this.version++;
  }
}

/** The app's box placement. */
export const placement = new Placement();

export function boxPose(): Readonly<BoxPose> {
  return placement.pose();
}
