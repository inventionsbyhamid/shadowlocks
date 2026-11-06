// Store listing inline media 2 (a loop and a still): the hand carries the lantern onto a lock's spot, the shadows slide
// across the panel into the lock's outline, and the lock opens in gold. A build whose box session opens the lock by
// itself does so; otherwise the shot shows the game's own opening (lib/stage.ts openIfShut) and says so in its log.
import type { Vec3 } from "../../../src/core/types";
import { grab } from "../../e2e/helpers/lantern";
import { SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { offset, openIfShut, plainLock, showBox, toWorld } from "../lib/stage";

interface Data {
  lock: number;
  /** Where the grasp point goes for the lantern to sit on the spot (world). */
  graspAtSpot: Vec3;
  panel: Vec3;
}

const BOX = 3;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_LEFT: Vec3 = [-0.45, 0.7, -1.3];

export default defineShot<Data>({
  name: "inline-lock",
  description: "The lantern carried onto a lock's spot; the shadows slide into its outline and the lock opens in gold.",
  seconds: 4.5,
  async setup({ app, page, hand }) {
    await hand("left").park(REST_LEFT);
    await showBox(app, page, BOX);
    const { lock, spot } = plainLock(BOX);
    const right = hand("right");
    // Pinch the lantern where it starts, then take it to a point off the spot: the shot starts there.
    const off = await grab(app, page, right);
    const spotW = await toWorld(page, spot);
    const graspAtSpot: Vec3 = [spotW[0] - off[0], spotW[1] - off[1], spotW[2] - off[2]];
    await right.moveTo(offset(graspAtSpot, 0.06, 0.035, 0.02), 500);
    await app.step(20);
    return { lock, graspAtSpot, panel: await toWorld(page, [0, 0, 0.1]) };
  },
  // From a little left of the eye, so the raised right hand does not hide the panel.
  firstView: ({ panel }): View => ({ from: offset(EYE, -0.05, -0.02, -0.06), at: panel }),
  async play({ page, hand, until }, { lock, graspAtSpot }) {
    await hand("right").glide(graspAtSpot, 2400);
    await until(2.9);
    if (await openIfShut(page, lock)) console.warn(`inline-lock: lock ${lock} did not open by itself; shown open`);
    await until(4.5);
  },
});
