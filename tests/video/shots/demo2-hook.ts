// The film's first seconds (plan/submission/demo-video-script-v2.md, part A): the first frame is already the picture.
// The dark stage, Box No. 3's panel nearly straight on from a little right, its Key in shadow with one clear
// notch: the bit. The lantern sits on the finger lock's spot (low and left), so the Key's scraps hang down and left of
// their shadows and the Key stands clear. A right hand comes in low from the right edge, pointing; only its index finger reaches into the light
// (the palm stays outside the beam, its shadow off the panel), and the finger's shadow slides in from the right into
// the notch. The game forms the bit in brass and opens the lock with its chime. The box's other lock (the Diamond)
// stays shut, so the box does not open. Nothing is opened for the game.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxCurve, boxView, plainLock, playBoxReady, playedProfile } from "../lib/stage";

interface Data {
  lock: number;
  path: (k: number) => Vec3;
  open: View;
  close: View;
}

const BOX = 3;
/** Pointing into the box from the right, a little left, palm down (IWER directions). */
const POINT = { fingers: { x: -0.45, y: 0.1, z: -1 }, palm: { x: -0.1, y: -1, z: -0.1 } };

export default defineShot<Data>({
  name: "demo2-hook",
  description: "Hook: a fingertip's shadow slides into the Key's missing bit, and it turns to brass.",
  seconds: 4.5,
  profile: playedProfile(4, 0, DEFAULT_DATE),
  darkStage: true,
  hideHint: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    const f = await playBoxReady(app, page, BOX, [plainLock(BOX).lock]);
    // Low and right, at the box mouth, out of the beam and out of frame; then in along a curve to where the missing
    // scrap would hang (the fingertip there fills the notch).
    const path = await boxCurve(page, [[0.6, -0.5, 1.0], [0.52, -0.42, 0.6], [0.36, -0.28, 0.34], f.tip]);
    const right = hand("right");
    await right.park([0.7, 0.2, -0.9], POINT);
    await right.point();
    await right.glideTip(path(0), 300, POINT);
    await app.step(10);
    return {
      lock: f.lock,
      path,
      open: await boxView(page, [0.5, 0.14, 2.6], [0.21, -0.13, 0.0], 25),
      close: await boxView(page, [0.47, 0.12, 2.45], [0.22, -0.13, 0.0], 22),
    };
  },
  firstView: ({ open }) => open,
  async play({ app, camera, hand, until, time }, { lock, path, close }) {
    const right = hand("right");
    camera.move(close, 4400);
    await until(0.25);
    await right.follow(path, 1800, undefined, "index-tip");
    const t = time();
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 2_500, label: "the finger lock open" });
    } catch {
      console.warn(`demo2-hook: finger lock ${lock} did not open within 2.5 s of the fingertip reaching the gap (at ${t.toFixed(2)} s)`);
    }
    await until(Math.max(time() + 1.1, 4.4));
  },
});
