// Part B, beat 2 (depth): Box No. 1 on the dark stage, the lantern already in the hand just above the Moon's spot.
// First from beside the box (a view a player never has): the scraps hang on their threads at plainly different
// distances between the lantern and the panel. Then the camera swings round to the front while the hand moves the
// lantern a little left and right: the near scrap's shadow sweeps wide and soft, the far one barely moves and stays
// sharp. The lantern is kept well above the spot, so the lock stays shut (the box would open with it).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxCurve, boxView, playedProfile, spotOf, startBox, takeLantern, toWorld } from "../lib/stage";

interface Data {
  grip: Vec3;
  hover: Vec3;
  side: View;
  front: View;
}

const BOX = 1;
const LOCK = 0;
/** Above and in front of the spot by this much (box units): the shadows near the Moon, the lock nowhere near filled. */
const LIFT = 0.22;
const OUT = 0.06;
/** How far the lantern swings to each side (box units). */
const SWING = 0.2;

export default defineShot<Data>({
  name: "demo2-depth",
  description: "Depth: from beside the box the scraps hang at different depths; from the front the near shadow swings wide.",
  seconds: 7,
  profile: playedProfile(2, 0, DEFAULT_DATE),
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    await startBox(app, page, BOX);
    const right = hand("right");
    await right.park([0.55, 0.5, -1.0]);
    const grip = await takeLantern(app, page, right, 600);
    const spot = await spotOf(page, LOCK);
    const hover: Vec3 = [spot[0], spot[1] + LIFT, spot[2] + OUT];
    const at = await toWorld(page, hover);
    await right.glide([at[0] + grip[0], at[1] + grip[1], at[2] + grip[2]], 600);
    await app.step(60);
    return {
      grip,
      hover,
      // Beside the box and a little in front of it, so the front post stands clear of the lantern.
      side: await boxView(page, [-1.75, 0.1, 1.15], [0, -0.04, 0.66], 50),
      // From above and left of the lantern: the hand that holds it stays below the panel's middle.
      front: await boxView(page, [-0.32, 0.5, 2.9], [0.0, -0.04, 0.3], 46),
    };
  },
  firstView: ({ side }) => side,
  async play({ page, camera, hand, until }, { grip, hover, front }) {
    const right = hand("right");
    await until(1.5);
    camera.move(front, 2200);
    await until(2.0);
    // Left, right, and back to the middle: one smooth swing.
    const left: Vec3 = [hover[0] - SWING, hover[1], hover[2]];
    const right_: Vec3 = [hover[0] + SWING, hover[1], hover[2]];
    const a = await boxCurve(page, [hover, [left[0] - 0.08, left[1], left[2]], [left[0] - 0.08, left[1], left[2]], left]);
    const b = await boxCurve(page, [left, [left[0], left[1], left[2]], [right_[0], right_[1], right_[2]], right_]);
    const c = await boxCurve(page, [right_, [right_[0] + 0.04, right_[1], right_[2]], [hover[0] + 0.04, hover[1], hover[2]], hover]);
    const at = (f: (k: number) => Vec3) => (k: number): Vec3 => {
      const p = f(k);
      return [p[0] + grip[0], p[1] + grip[1], p[2] + grip[2]];
    };
    await right.follow(at(a), 1200);
    await right.follow(at(b), 2000);
    await right.follow(at(c), 1300);
    await until(7);
  },
});
