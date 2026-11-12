// The demo film's cold open (shot 1), the signature moment, close: Box No. 3 in play, its other locks already open,
// the lantern settled on the finger lock's spot and the shape one piece short. The right hand rises into the beam,
// pointing; the fingertip travels along the light toward the panel, so its shadow shrinks and sharpens into the gap;
// it holds, and the game forms the piece in brass and opens the lock. Nothing is opened for the game.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { lerp3, offset, plainLock, playBoxReady, playedProfile, toWorld } from "../lib/stage";

interface Data {
  lock: number;
  tip: Vec3;
  /** On the light's line from the lantern to the gap, nearer the lantern: where the fingertip comes into the beam. */
  inBeam: Vec3;
  panel: Vec3;
}

const BOX = 3;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];

export default defineShot<Data>({
  name: "demo-finger",
  description: "Cold open: a fingertip in the lantern's beam casts the missing piece, and it turns to brass.",
  seconds: 7,
  profile: playedProfile(3, 0, DEFAULT_DATE),
  async setup({ app, page, hand }) {
    await hand("left").park([-0.45, 0.7, -1.3]);
    // One plain lock stays shut, so the box does not open on the finger lock (the film shows that later).
    const f = await playBoxReady(app, page, BOX, [plainLock(BOX).lock]);
    const tip = await toWorld(page, f.tip);
    const inBeam = await toWorld(page, lerp3(f.tip, f.spot, 0.45));
    const right = hand("right");
    await right.park([0.42, 0.72, -1.28]);
    await right.point();
    // The fingertip waits low and to the right, out of the beam.
    await right.glideTip(offset(inBeam, 0.1, -0.12, 0.06), 300);
    await app.step(10);
    return { lock: f.lock, tip, inBeam, panel: await toWorld(page, [0, 0, 0.1]) };
  },
  // Low and close, a little right of the middle: the hand comes in from the left (IWER's pointing hand), so from here
  // its body stays off the lock it fills, and the fingertip and its shadow are in one frame.
  firstView: ({ panel }): View => ({ from: offset(EYE, 0.05, -0.06, -0.14), at: panel }),
  async play({ app, hand, until, time }, { lock, tip, inBeam }) {
    const right = hand("right");
    await until(0.4);
    await right.glideTip(inBeam, 1100);
    await right.glideTip(tip, 1700);
    const t = time();
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, label: "the finger lock open" });
    } catch {
      console.warn(`demo-finger: finger lock ${lock} did not open within 3 s of the fingertip reaching the gap (at ${t.toFixed(2)} s)`);
    }
    await until(Math.max(time() + 1.2, 7));
  },
});
