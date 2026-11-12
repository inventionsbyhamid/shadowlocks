// The film's part D, records: today's Daily Box opened in about 2:50 by a player whose earlier Daily Boxes all took
// over 3:30, so its result card says "New best" under the time. The box was opened before the first frame the way a
// player does (the lantern on each spot, a fingertip in each finger lock's gap, at a player's pace); the shot is the
// card, close, the camera easing in on its time and best line.
import type { Vec3 } from "../../../src/core/types";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { lerp3, offset } from "../lib/stage";
import { DAILY_PLAYER, dailyOpened, EYE } from "./demo2-d-kit";

interface Data {
  first: View;
  last: View;
}

export default defineShot<Data>({
  name: "demo2-d-best",
  description: "Records: the Daily Box's result card, its time and New best, close.",
  seconds: 1.8,
  profile: DAILY_PLAYER,
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    await hand("right").park([0.7, 0.3, -0.9]);
    const { card, box } = await dailyOpened(app, page);
    await hand("right").park([0.7, 0.3, -0.9]);
    const at: Vec3 = lerp3(card, box, 0.04);
    return {
      first: { from: offset(EYE, 0.03, -0.04, -0.12), at, hfovDeg: 30 },
      last: { from: offset(EYE, 0.02, -0.05, -0.16), at: offset(at, 0, -0.005, 0), hfovDeg: 26 },
    };
  },
  firstView: ({ first }) => first,
  async play({ camera, until }, { last }) {
    camera.move(last, 1800);
    await until(1.8);
  },
});
