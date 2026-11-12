// The film's end (part E): Box No. 12 on the dark stage, its last lock opened by the lantern on its spot just before the
// first frame (its other locks opened the way a player does). The box opens: the sunburst fills the panel, the walls
// hinge open, the drawer slides out. The box sits left of centre so the end card's words have the dark to the right;
// the edit holds the last frame under the card.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxView, playedProfile, spotOf, startBox } from "../lib/stage";
import { isOpen, openAllBut } from "./demo2-d-kit";

interface Data {
  first: View;
  last: View;
}

const BOX = 12;
/** The Diamond, the box's one plain lock. */
const LOCK = 1;

export default defineShot<Data>({
  name: "demo2-e-open",
  description: "End: Box No. 12 opens in gold, left of the frame, the dark to its right for the end card.",
  seconds: 1.5,
  profile: playedProfile(BOX, 0, DEFAULT_DATE),
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    await hand("right").park([0.7, 0.3, -0.9]);
    await startBox(app, page, BOX);
    await openAllBut(app, page, [LOCK]);
    await hand("right").park([0.7, 0.3, -0.9]);
    await app.step(60);
    const spot = await spotOf(page, LOCK);
    await page.evaluate((p) => (window as any).__sl.placeLantern(p), spot);
    await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: LOCK, maxMs: 3_000, batch: 1, label: "the Diamond open" });
    if (!(await isOpen(page, LOCK))) throw new Error("demo2-e-open: the Diamond did not open");
    return {
      first: await boxView(page, [0.32, 0.4, 3.1], [0.58, 0.0, 0.45], 54),
      last: await boxView(page, [0.3, 0.37, 2.9], [0.56, 0.0, 0.45], 52),
    };
  },
  firstView: ({ first }) => first,
  async play({ camera, until }, { last }) {
    camera.move(last, 1500);
    await until(1.5);
  },
});
