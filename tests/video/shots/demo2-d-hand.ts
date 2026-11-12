// The film's part D, hands first: Box No. 9 on the dark stage, every lock shut. The right hand already holds the
// lantern; it carries it in a short arc up and across, and every shadow on the panel sweeps with it.
import type { V3, Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxCurve, boxView, lanternPos, playedProfile, startBox, takeLantern } from "../lib/stage";
import { LETGO_AT } from "./demo2-d-kit";

interface Data {
  path: (k: number) => Vec3;
  grip: Vec3;
  first: View;
  last: View;
}

const BOX = 9;

export default defineShot<Data>({
  name: "demo2-d-hand",
  description: "Hands first: the hand carries the lantern in an arc and the shadows sweep across the panel.",
  seconds: 1.25,
  profile: playedProfile(BOX, 0, DEFAULT_DATE),
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    const right = hand("right");
    await right.park([0.55, 0.5, -1.0]);
    await startBox(app, page, BOX);
    const start = (await lanternPos(page)) as V3;
    const grip = await takeLantern(app, page, right, 900);
    await app.step(20);
    const to = LETGO_AT(start);
    return {
      path: await boxCurve(page, [start, [start[0] - 0.05, start[1] + 0.2, start[2]], [to[0] + 0.12, to[1] + 0.12, to[2]], to]),
      grip,
      first: await boxView(page, [-0.5, 0.32, 3.0], [0.0, 0.06, 0.5], 51),
      last: await boxView(page, [-0.46, 0.3, 2.88], [0.0, 0.07, 0.5], 49),
    };
  },
  firstView: ({ first }) => first,
  async play({ camera, hand, until }, { path, grip, last }) {
    camera.move(last, 1250);
    await hand("right").follow((k) => {
      const p = path(k);
      return [p[0] + grip[0], p[1] + grip[1], p[2] + grip[2]];
    }, 1150);
    await until(1.25);
  },
});
