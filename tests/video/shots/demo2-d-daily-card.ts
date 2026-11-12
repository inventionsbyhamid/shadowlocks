// The film's part D, Daily Box: today's Daily Box opened by a player on a 4-day streak; the reward stands over the
// opened box with its story plaque, and the result card under it reads "Daily Box Nov 2" and "Streak 5". Opened before
// the first frame the way a player does (as demo2-d-best); a slow drift across the reward and the card.
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
  name: "demo2-d-daily-card",
  description: "Daily Box: the opened Daily Box, its reward and the card reading Streak 5.",
  seconds: 2.6,
  profile: DAILY_PLAYER,
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    await hand("right").park([0.7, 0.3, -0.9]);
    const { card, box } = await dailyOpened(app, page);
    await hand("right").park([0.7, 0.3, -0.9]);
    const at: Vec3 = lerp3(card, box, 0.25);
    return {
      first: { from: offset(EYE, -0.06, -0.02, -0.06), at, hfovDeg: 44 },
      last: { from: offset(EYE, -0.02, -0.03, -0.1), at: offset(at, 0, -0.01, 0), hfovDeg: 40 },
    };
  },
  firstView: ({ first }) => first,
  async play({ camera, until }, { last }) {
    camera.move(last, 2600);
    await until(2.6);
  },
});
