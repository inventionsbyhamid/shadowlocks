// The film's first five seconds (plan/submission/demo-video-script-v2.md, part A): the first frame is already the
// picture. The dark stage, the panel of Box No. 4 close, its Star one point short; the lantern sits on the finger
// lock's spot. A fingertip rises into the beam, its shadow shrinks and sharpens into the gap, holds, and the game forms
// the piece in brass and opens the lock with its chime. The camera pushes in slowly on the Star as it does. The box's
// other lock (the Key) stays shut, so the box does not open. Nothing is opened for the game.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxView, lerp3, offset, plainLock, playBoxReady, playedProfile, toWorld } from "../lib/stage";

interface Data {
  lock: number;
  tip: Vec3;
  inBeam: Vec3;
  wait: Vec3;
  open: View;
  close: View;
}

const BOX = 4;
/** A left hand pointing into the box from the left, a little up, palm down (IWER directions). */
const POINT = { fingers: { x: 0.45, y: 0.12, z: -1 }, palm: { x: 0.1, y: -1, z: -0.1 } };

export default defineShot<Data>({
  name: "demo2-hook",
  description: "Hook: a fingertip in the lantern's beam casts the Star's missing point, and it turns to brass.",
  seconds: 5,
  profile: playedProfile(5, 0, DEFAULT_DATE),
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("right").park([0.7, 0.3, -0.9]);
    const f = await playBoxReady(app, page, BOX, [plainLock(BOX).lock]);
    const tip = await toWorld(page, f.tip);
    // Where the fingertip comes into the beam: on the light's line from the lantern to the gap, nearer the lantern.
    const inBeam = await toWorld(page, lerp3(f.tip, f.spot, 0.4));
    // The Star's missing point is its left one: the left hand comes in from the left, so neither the hand nor its
    // arm stands between the camera (right of the lantern) and the Star.
    const left = hand("left");
    await left.park([-0.5, 0.55, -1.2], POINT);
    await left.point();
    // The fingertip waits low and to the left, out of the beam and out of the first frame.
    const wait = offset(inBeam, -0.1, -0.12, 0.05);
    await left.glideTip(wait, 300, POINT);
    await app.step(10);
    // Long lenses from beside and above the lantern, near its line of light: the scraps sit over their own shadows, so
    // the Star reads as one shape short one point. The first view holds the panel; the second is close on the Star.
    const open = await boxView(page, [0.4, 0.14, 2.65], [0.2, -0.08, 0.0], 34);
    const close = await boxView(page, [0.38, 0.06, 2.45], [0.21, -0.12, 0.0], 22);
    return { lock: f.lock, tip, inBeam, wait, open, close };
  },
  firstView: ({ open }) => open,
  async play({ app, camera, hand, until, time }, { lock, tip, inBeam, close }) {
    const left = hand("left");
    camera.move(close, 4600);
    await until(0.4);
    await left.glideTip(inBeam, 1100, POINT);
    await left.glideTip(tip, 1900, POINT);
    const t = time();
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 2_500, label: "the finger lock open" });
    } catch {
      console.warn(`demo2-hook: finger lock ${lock} did not open within 2.5 s of the fingertip reaching the gap (at ${t.toFixed(2)} s)`);
    }
    await until(Math.max(time() + 0.8, 5));
  },
});
