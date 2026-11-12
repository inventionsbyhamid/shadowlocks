// Part B, beat 3 (your hand): Box No. 4 on the dark stage, its Key still shut and the lantern on the Star's spot, the
// Star one point short. The open left hand rises low in the beam near the floor of the box, fingers up: their shadows
// climb the panel, larger than the hand, while the hand itself stays at the bottom edge of the frame. Then it turns to
// point, the index finger goes in toward the Star's empty left point and its shadow closes it; the game forms the
// piece in brass. Nothing is opened for the game.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxView, plainLock, playBoxReady, playedProfile, toWorld } from "../lib/stage";

interface Data {
  lock: number;
  tip: Vec3;
  palm: Vec3;
  view: View;
  end: View;
}

const BOX = 4;
/** The open left hand, palm to the panel and fingers up: its whole outline in the light. */
const OPEN = { fingers: { x: 0.15, y: 1, z: -0.25 }, palm: { x: -0.1, y: 0.15, z: -1 } };
/** Pointing into the box from the left, a little up, palm down (IWER directions). */
const POINT = { fingers: { x: 0.45, y: 0.12, z: -1 }, palm: { x: 0.1, y: -1, z: -0.1 } };

export default defineShot<Data>({
  name: "demo2-hand",
  description: "Your hand: the open hand's shadow climbs the panel, then the index finger closes the Star's gap; brass.",
  seconds: 5,
  profile: playedProfile(5, 0, DEFAULT_DATE),
  darkStage: true,
  hideHint: true,
  async setup({ app, page, hand }) {
    await hand("right").park([0.7, 0.3, -0.9]);
    const f = await playBoxReady(app, page, BOX, [plainLock(BOX).lock]);
    const tip = await toWorld(page, f.tip);
    // Low in the beam, under a third of the way from the panel to the lantern: the fingers' shadows reach up the
    // panel at about 1.4 times their size, fairly sharp, the palm's falls on the panel's lower edge.
    // Left of the Star: the open hand's index finger casts too, and over the Star's gap it would finish the lock.
    const palm = await toWorld(page, [-0.24, -0.3, 0.45]);
    const left = hand("left");
    await left.park(await toWorld(page, [-0.38, -0.62, 1.3]), OPEN);
    await app.step(10);
    return {
      lock: f.lock,
      tip,
      palm,
      // From above and a little left: the hand at the bottom of the frame, its shadow on the panel above it.
      view: await boxView(page, [-0.1, 0.6, 2.45], [0.02, -0.08, 0.15], 44),
      end: await boxView(page, [-0.06, 0.52, 2.3], [0.06, -0.1, 0.1], 38),
    };
  },
  firstView: ({ view }) => view,
  async play({ app, camera, hand, until, time }, { lock, tip, palm, end }) {
    const left = hand("left");
    camera.move(end, 4800);
    // Up into the light, open.
    await left.glide(palm, 1200, OPEN);
    await until(1.9);
    // Turn to point and reach the gap with the fingertip.
    await left.point(240);
    await left.glideTip(tip, 900, POINT);
    const t = time();
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 2_500, label: "the Star open" });
    } catch {
      console.warn(`demo2-hand: finger lock ${lock} did not open within 2.5 s of the fingertip reaching the gap (at ${t.toFixed(2)} s)`);
    }
    await until(time() + 0.9);
  },
});
