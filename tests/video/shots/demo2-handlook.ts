// A close look at the video build's stand-in hand (src/video/hand-look.ts) before it goes in the film: Box No. 3 on the
// dark stage, the right hand pointing with its fingertip at the Key's notch, the left hand open in the light near the
// box mouth. Not part of an edit.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxView, plainLock, playBoxReady, playedProfile, toWorld } from "../lib/stage";

const BOX = 3;
const POINT = { fingers: { x: -0.45, y: 0.1, z: -1 }, palm: { x: -0.1, y: -1, z: -0.1 } };
const OPEN = { fingers: { x: 0.2, y: 1, z: -0.3 }, palm: { x: 0.1, y: 0.1, z: -1 } };

export default defineShot<{ view: View }>({
  name: "demo2-handlook",
  description: "The stand-in hand, close: pointing at the Key's notch, and open in the light.",
  seconds: 0.5,
  profile: playedProfile(4, 0, DEFAULT_DATE),
  darkStage: true,
  hideHint: true,
  async setup({ app, page, hand }) {
    const f = await playBoxReady(app, page, BOX, [plainLock(BOX).lock]);
    const right = hand("right");
    await right.park([0.7, 0.2, -0.9], POINT);
    await right.point();
    await right.glideTip(await toWorld(page, f.tip), 300, POINT);
    await hand("left").park(await toWorld(page, [-0.2, -0.05, 0.8]), OPEN);
    await app.step(10);
    return { view: await boxView(page, [0.5, 0.3, 1.9], [0.25, -0.15, 0.45], 32) };
  },
  firstView: ({ view }) => view,
  async play({ until }) {
    await until(0.5);
  },
});

