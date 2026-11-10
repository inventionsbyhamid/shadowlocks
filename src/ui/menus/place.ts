// Where the menu panels stand (the menus lay them out with standPanel; pure, so it is unit tested on its own).
import type { Euler, Vector3 } from "@iwsdk/core";
import { TILT_DEG } from "../../render/placement";

/**
 * Where panels stand: the bottom edge on the open drawer (DRAWER_PANEL_ANCHOR, box units, so it
 * follows the box size), then `toward` metres nearer the player, leaning back `leanRad` from upright
 * (in the world, not with the box's own tilt): enough to face a seated player's eyes, not so much
 * that a tall panel's top reaches back into the box mouth at any box size. Panels grow upward from
 * that edge (UIKit anchor bottom).
 */
export const MENU_PLACE = { toward: 0.015, leanRad: (15 * Math.PI) / 180 };

/**
 * How far a panel leans back from upright (radians) on a box leaning back `tiltDeg`: MENU_PLACE.leanRad on the lap's
 * box, and the same angle to the box on a phone's leaning one (a box leaning toward the phone would otherwise reach its
 * mouth over a panel leaning away from it). A headset's is the lap's, exactly.
 */
export function panelLean(tiltDeg: number): number {
  return MENU_PLACE.leanRad + ((tiltDeg - TILT_DEG) * Math.PI) / 180;
}

/**
 * A panel stood for a box: its bottom edge's middle MENU_PLACE.toward nearer the player than the drawer's anchor
 * `anchor` (world), along the box's heading `yaw`, turned to that heading and leaning back panelLean(tiltDeg). Into
 * `pos` and `rot` (YXZ). Allocation free.
 */
export function standPanel(anchor: Readonly<Vector3>, yaw: number, tiltDeg: number, pos: Vector3, rot: Euler): void {
  const t = MENU_PLACE.toward;
  pos.set(anchor.x + Math.sin(yaw) * t, anchor.y, anchor.z + Math.cos(yaw) * t);
  rot.set(-panelLean(tiltDeg), yaw, 0, "YXZ");
}
