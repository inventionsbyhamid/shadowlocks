// The film's part D, "endless boxes" (first of five, under "The boxes never run out."): Box No. 382 on the dark stage,
// 48 elements; the Candle opens. One other lock was opened before the first frame the way a player does and one stays
// shut, so the box stays closed and the gold holds; the hand carries the lantern onto the Candle's spot.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box382",
  n: 382,
  lock: 1,
  shut: [2],
  seconds: 2.2,
  off: [0.2, -0.05, 0.08],
  carryMs: 520,
  startMs: 250,
  first: [[-0.3, 0.3, 3.05], [0.0, 0.08, 0.45], 52],
  last: [[-0.27, 0.28, 2.85], [0.0, 0.1, 0.45], 49],
});
