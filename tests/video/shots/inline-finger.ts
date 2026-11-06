// Store listing inline media 3 (a loop and a still), the signature moment: the lantern sits on a finger lock's spot,
// its shape short one piece; the right hand rises into the beam and the fingertip, held where the missing piece would
// hang, casts it; the shape fills with gold. The finger lock opens it in a build that has it; otherwise the shot shows
// the game's own opening (lib/stage.ts openIfShut) and says so in its log.
import type { Vec3 } from "../../../src/core/types";
import { SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { fingerLock, offset, openIfShut, showBox, toWorld } from "../lib/stage";

interface Data {
  lock: number;
  tip: Vec3;
  panel: Vec3;
}

const BOX = 3;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_LEFT: Vec3 = [-0.45, 0.7, -1.3];

export default defineShot<Data>({
  name: "inline-finger",
  description: "A fingertip in the lantern's beam casts the missing piece, and the lock fills with gold.",
  seconds: 5,
  async setup({ app, page, hand }) {
    await hand("left").park(REST_LEFT);
    await showBox(app, page, BOX);
    const f = fingerLock(BOX);
    await page.evaluate((p) => window.__sl!.placeLantern(p), f.spot);
    await app.step(10);
    const tip = await toWorld(page, f.tip);
    const right = hand("right");
    await right.point();
    // The fingertip waits low and to the right, out of the beam.
    await right.glideTip(offset(tip, 0.07, -0.09, 0.06), 300);
    return { lock: f.lock, tip, panel: await toWorld(page, [0, 0, 0.1]) };
  },
  // Low and from the left: the fingertip and its shadow on the panel in one frame.
  firstView: ({ panel }): View => ({ from: offset(EYE, -0.06, -0.05, -0.08), at: panel }),
  async play({ page, hand, until }, { lock, tip }) {
    await hand("right").glideTip(tip, 1600);
    await until(3.6);
    if (await openIfShut(page, lock)) console.warn(`inline-finger: lock ${lock} did not open by itself; shown open`);
    await until(5);
  },
});
