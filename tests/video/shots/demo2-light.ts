// Part B, beat 1 (one light), one unbroken take: Box No. 2 on the dark stage, seen from the front left and from far
// enough back that the lantern, the scraps on their threads and the panel are all in frame (from further round, the box's front post
// would cross the panel). Its Star stays shut, so the box does not open after the Crown. The right hand comes in, takes
// the lantern and carries it in one slow arc, up and across and down onto the lock's spot; on the panel the shadows slide and
// gather into the Crown's gold outline; it fills, and the lock opens in gold. The game opens it: the carry only ends on
// the spot and holds there, as a player does.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxCurve, boxView, lanternPos, playedProfile, spotOf, startBox, takeLantern } from "../lib/stage";

interface Data {
  start: Vec3;
  spot: Vec3;
  view: View;
  end: View;
}

const BOX = 2;
/** The Crown. */
const LOCK = 0;
const REST: Vec3 = [0.55, 0.5, -1.0];

export default defineShot<Data>({
  name: "demo2-light",
  description: "One light: the hand carries the lantern in an arc, the shadows gather into the Crown, it opens in gold.",
  seconds: 8,
  profile: playedProfile(3, 0, DEFAULT_DATE),
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    await startBox(app, page, BOX);
    const right = hand("right");
    await right.park(REST);
    return {
      start: (await lanternPos(page)) as Vec3,
      spot: (await spotOf(page, LOCK)) as Vec3,
      view: await boxView(page, [-0.62, 0.14, 3.05], [0.0, -0.14, 0.6], 50),
      end: await boxView(page, [-0.56, 0.12, 2.85], [-0.04, -0.12, 0.5], 47),
    };
  },
  firstView: ({ view }) => view,
  async play({ app, page, camera, hand, until, time }, { start, spot, end }) {
    const right = hand("right");
    // A slow drift in toward the panel over the whole take.
    camera.move(end, 7800);
    await until(0.2);
    const grip = await takeLantern(app, page, right, 1000);
    // Up and over to the left, then down onto the spot: the shadows sweep across the panel and come together.
    const path = await boxCurve(page, [
      start,
      [start[0] - 0.05, start[1] + 0.28, start[2] + 0.1],
      [spot[0] - 0.32, spot[1] + 0.26, spot[2] + 0.05],
      spot,
    ]);
    await right.follow((k) => {
      const p = path(k);
      return [p[0] + grip[0], p[1] + grip[1], p[2] + grip[2]];
    }, 5000);
    const t = time();
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: LOCK, maxMs: 2_000, label: "the Crown open" });
    } catch {
      console.warn(`demo2-light: lock ${LOCK} stayed shut with the lantern carried onto its spot at ${t.toFixed(2)} s (left as the game has it)`);
    }
    await until(Math.max(time() + 0.6, 8));
  },
});
