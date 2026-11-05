// Pipeline smoke shot (2 s): seated in the home office chair, the player looks down at the box on
// their lap and the home panel in front of it, and leans in a little; the right hand comes in from
// the side and hovers beside the box (clear of the panel's keys), so the see-through system hand
// shows. It frames whatever the scene holds now: the shot reads only the box pose and the panel, so
// it keeps working while the real box replaces the stand-in.
import type { Vec3 } from "../../../src/core/types";
import { SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";

interface Data {
  /** The box's back panel centre (world). */
  box: Vec3;
}

const at = (p: Vec3, dx: number, dy: number, dz: number): Vec3 => [p[0] + dx, p[1] + dy, p[2] + dz];

/** Hands at rest, low and wide at the player's sides: outside a Quest-like view. */
const REST_RIGHT: Vec3 = [0.45, 0.7, -1.3];
const REST_LEFT: Vec3 = [-0.45, 0.7, -1.3];
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];

/**
 * Right hand reaching forward: fingers ahead and tilted `tiltDeg` down, palm down, the whole hand
 * turned `inwardDeg` toward the middle (a turn about the vertical axis).
 */
function reaching(tiltDeg: number, inwardDeg: number) {
  const t = (tiltDeg * Math.PI) / 180;
  const a = (inwardDeg * Math.PI) / 180;
  const turn = (x: number, y: number, z: number) => ({ x: x * Math.cos(a) + z * Math.sin(a), y, z: -x * Math.sin(a) + z * Math.cos(a) });
  return { fingers: turn(0, -Math.sin(t), -Math.cos(t)), palm: turn(0, -Math.cos(t), Math.sin(t)) };
}

export default defineShot<Data>({
  name: "sample",
  description: "Seated, looking down at the box and the home panel; the right hand comes in beside the box.",
  seconds: 2,
  async setup({ app, hand }) {
    await hand("right").park(REST_RIGHT);
    await hand("left").park(REST_LEFT);
    await app.step(30);
    const s = await app.state();
    return { box: s.boxPose.position };
  },
  // From the seated eye point, the box and the panel in front of it both in view.
  firstView: ({ box }): View => ({ from: EYE, at: at(box, 0, -0.04, 0.05) }),
  async play({ camera, hand, until }, { box }) {
    // A slow lean in toward the box.
    camera.move({ from: at(EYE, 0.01, -0.02, -0.06), at: at(box, 0.01, -0.03, 0.04) }, 2000);
    // In from the right, ending beside the box's right edge, a little in front of it: clear of
    // the panel below and of the box face.
    await hand("right").glide(at(box, 0.19, 0.04, 0.12), 1300, reaching(25, 20));
    await until(2);
  },
});
