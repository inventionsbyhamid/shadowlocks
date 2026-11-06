// Store listing inline media 1 (a still): seated, the box in the lap in the room, which the game dims while a box is in
// play, and the lantern glowing in the right hand, lifted a little. scripts/store-inline.sh takes the still from the
// middle of this short shot.
import type { Vec3 } from "../../../src/core/types";
import { SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { lanternPos, offset, showBox, toWorld } from "../lib/stage";

interface Data {
  box: Vec3;
}

const BOX = 3;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_LEFT: Vec3 = [-0.45, 0.7, -1.3];

export default defineShot<Data>({
  name: "inline-room",
  description: "Seated, the box in the dimmed room, the lantern glowing in the right hand.",
  seconds: 1.5,
  async setup({ app, page, hand }) {
    await hand("left").park(REST_LEFT);
    await showBox(app, page, BOX);
    const lw = await toWorld(page, await lanternPos(page));
    const right = hand("right");
    await right.pinchAt(lw);
    try {
      await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 1_000, batch: 1, label: "lantern held" });
      await right.moveTo(offset(lw, 0.035, 0.045, -0.015), 500);
    } catch {
      console.warn("inline-room: the pinch did not hold the lantern; the hand stays at it");
    }
    await app.step(20);
    return { box: (await app.state()).boxPose.position as Vec3 };
  },
  // From the seated eye, a little left of the right hand, the box and the lifted lantern in view.
  firstView: ({ box }): View => ({ from: offset(EYE, -0.03, -0.01, -0.02), at: offset(box, 0.02, -0.03, 0.09) }),
  async play({ until }) {
    await until(1.5);
  },
});
