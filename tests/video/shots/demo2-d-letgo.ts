// The film's part D, comfort: Box No. 9 on the dark stage, the lantern held where the hand shot's arc left it (not on
// any lock's spot). The hand opens and draws back out of the light; the lantern stays exactly where it was left.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { V3, Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxView, lanternPos, offset, playedProfile, startBox, takeLantern } from "../lib/stage";
import { LETGO_AT } from "./demo2-d-kit";

interface Data {
  first: View;
  last: View;
}

const BOX = 9;
const REST: Vec3 = [0.6, 0.45, -0.95];

export default defineShot<Data>({
  name: "demo2-d-letgo",
  description: "Let go any time: the hand opens and leaves; the lantern stays where it was left.",
  seconds: 1.6,
  profile: playedProfile(BOX, 0, DEFAULT_DATE),
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    const right = hand("right");
    await right.park([0.55, 0.5, -1.0]);
    await startBox(app, page, BOX);
    const start = (await lanternPos(page)) as V3;
    await page.evaluate((p) => (window as any).__sl.placeLantern(p), LETGO_AT(start));
    await app.step(60);
    await takeLantern(app, page, right, 900);
    await app.step(20);
    const at = (await lanternPos(page)) as V3;
    return {
      first: await boxView(page, [0.25, 0.36, 2.75], [at[0] * 0.5, at[1] * 0.5 - 0.02, 0.55], 46),
      last: await boxView(page, [0.22, 0.34, 2.62], [at[0] * 0.5, at[1] * 0.5 - 0.02, 0.55], 44),
    };
  },
  firstView: ({ first }) => first,
  async play({ app, page, camera, hand, until, wait }, { last }) {
    const right = hand("right");
    camera.move(last, 1600);
    await wait(100);
    await right.open(180);
    await right.glide(offset(REST, 0, 0, 0), 800);
    await until(1.6);
    const held = (await page.evaluate(() => (window as any).__sl.lantern().held)) as boolean;
    if (held) console.warn("demo2-d-letgo: the lantern is still held after the hand opened");
    void app;
  },
});
