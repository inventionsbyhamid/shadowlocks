// The demo film, shots 7 and 8 (plan/submission/demo-video-script.md) in one take: Box No. 3 with its plain locks
// already open and the lantern on the finger lock's spot, the shape one piece short. The open right hand comes into the
// beam and the whole hand casts a soft shadow on the panel; it turns to point, and the fingertip travels along the
// light toward the panel, its shadow shrinking into the gap; it holds and the piece forms in brass. That was the last
// lock: the walls hinge open, the room light comes back, the reward rises with its story plaque and the result card
// under it. Nothing is opened for the game.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { lerp3, offset, playBoxReady, playedProfile, toWorld } from "../lib/stage";

interface Data {
  lock: number;
  tip: Vec3;
  inBeam: Vec3;
  /** The open hand in the light, between the lantern and the panel (grasp point). */
  palm: Vec3;
  box: Vec3;
  panel: Vec3;
}

const BOX = 3;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];
/** IWER's open hand turned palm down, fingers into the box. */
const PALM_DOWN = { fingers: { x: -0.25, y: 0, z: -1 }, palm: { x: 0, y: -1, z: 0 } };

export default defineShot<Data>({
  name: "demo-box3",
  description: "Box No. 3: the hand in the beam, the fingertip casts the last lock's piece, the box opens, its reward and card.",
  seconds: 25,
  profile: playedProfile(3, 0, DEFAULT_DATE),
  async setup({ app, page, hand }) {
    await hand("left").park([-0.45, 0.7, -1.3]);
    // A player's pace: about 50 s on the first lock, 35 s to settle the lantern on the finger lock's spot.
    const f = await playBoxReady(app, page, BOX, [], 45_000);
    const right = hand("right");
    await right.park(REST_RIGHT);
    return {
      lock: f.lock,
      tip: await toWorld(page, f.tip),
      inBeam: await toWorld(page, lerp3(f.tip, f.spot, 0.45)),
      palm: await toWorld(page, lerp3(f.tip, f.spot, 0.3)),
      box: (await app.state()).boxPose.position as Vec3,
      panel: await toWorld(page, [0, 0, 0.1]),
    };
  },
  // From the seated eye a little to the left, the whole box and the panel.
  firstView: ({ box }): View => ({ from: offset(EYE, -0.05, -0.02, -0.03), at: offset(box, 0, 0.03, 0.08) }),
  async play({ app, page, hand, camera, until, time, wait }, { lock, tip, inBeam, palm, box, panel }) {
    const right = hand("right");
    await until(0.8);
    // The open hand into the light, slowly across it: the whole hand's soft shadow on the panel.
    await right.glide(offset(palm, 0.07, 0.02, 0.03), 2200, PALM_DOWN);
    await right.glide(offset(palm, -0.02, 0, 0), 2200);
    await wait(500);
    // Closer: the panel and the fingertip.
    camera.move({ from: offset(EYE, -0.07, -0.05, -0.12), at: panel }, 2600);
    await right.point(400);
    await right.glideTip(inBeam, 1300);
    await right.glideTip(tip, 2300);
    const t = time();
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, label: "the finger lock open" });
    } catch {
      console.warn(`demo-box3: finger lock ${lock} did not open within 3 s of the fingertip reaching the gap (at ${t.toFixed(2)} s)`);
    }
    await wait(1500);
    // The hand leaves; the camera sits back for the box opening, the reward and the card.
    await right.relax(300);
    await right.glide(REST_RIGHT, 1000);
    camera.move({ from: offset(EYE, 0, 0.01, 0), at: offset(box, 0, 0.06, 0.08) }, 2600);
    try {
      await app.stepUntil((_ns, w) => !!w.__sl.session.reward()?.up, { maxMs: 8_000, label: "the reward up" });
    } catch {
      console.warn("demo-box3: the reward was not up 8 s after the last lock");
    }
    try {
      await app.stepUntil((_ns, w) => !!w.__sl.session.card()?.shown, { maxMs: 6_000, label: "the result card in view" });
    } catch {
      console.warn("demo-box3: no result card in view");
    }
    const card = (await page.evaluate(() => (window as any).__sl.session.card())) as { world: Vec3 } | null;
    // In on the plaque and the card under it.
    if (card) camera.move({ from: offset(EYE, 0, -0.02, -0.1), at: lerp3(card.world, box, 0.3) }, 2400);
    await wait(6500);
  },
});
