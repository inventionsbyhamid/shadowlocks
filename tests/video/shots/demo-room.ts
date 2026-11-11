// The demo film, shot 2 (plan/submission/demo-video-script.md): seated, the box in the lap in the room (dimmed while
// a box is in play), the lantern glowing in the right hand, which carries it slowly across the box so the shadows
// sweep the panel. The camera eases in from a little behind the eye.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { lanternPos, offset, playedProfile, toWorld } from "../lib/stage";

interface Data {
  box: Vec3;
  grasp: Vec3;
}

const BOX = 5;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_LEFT: Vec3 = [-0.45, 0.7, -1.3];

export default defineShot<Data>({
  name: "demo-room",
  description: "Seated, the box in the lap in the dimmed room, the lantern glowing in the right hand.",
  seconds: 6,
  profile: playedProfile(BOX, 0, DEFAULT_DATE),
  async setup({ app, page, hand }) {
    await hand("left").park(REST_LEFT);
    await page.evaluate(() => (window as any).__ns.ui.go("play"));
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
    await page.evaluate((k) => (window as any).__sl.session.play({ kind: "box", n: k }), BOX);
    await app.stepUntil((_ns, w) => !!w.__sl.session.state()?.revealed, { maxMs: 15_000, label: `box ${BOX} in play` });
    const lw = await toWorld(page, await lanternPos(page));
    const right = hand("right");
    await right.pinchAt(lw);
    await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 1_000, batch: 1, label: "lantern held" });
    const grasp = offset(lw, 0.035, 0.045, -0.015);
    await right.moveTo(grasp, 500);
    await app.step(120);
    return { box: (await app.state()).boxPose.position as Vec3, grasp };
  },
  // A little behind and above the seated eye: the lap, the box and the room ahead.
  firstView: ({ box }): View => ({ from: offset(EYE, 0.05, 0.08, 0.22), at: offset(box, 0.02, 0, 0.05) }),
  async play({ hand, camera, until }, { box, grasp }) {
    camera.move({ from: offset(EYE, -0.02, 0, 0.02), at: offset(box, 0.02, 0.03, 0.09) }, 5800);
    const right = hand("right");
    await right.glide(offset(grasp, -0.1, 0.03, -0.03), 3000);
    await right.glide(offset(grasp, -0.05, 0.0, 0.0), 2600);
    await until(6);
  },
});
