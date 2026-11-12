// The film's part D, "endless boxes" (fourth of five): Box No. 22 on the dark stage, three locks and 47 scraps and
// decoys; the hidden Anchor opens. One other lock was opened before the first frame the way a player does and one
// stays shut, so the box stays closed and the gold holds; the hand carries the lantern onto the Anchor's spot.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box22",
  n: 22,
  lock: 1,
  shut: [2],
  seconds: 2.2,
  off: [0.2, -0.05, 0.08],
  carryMs: 500,
  startMs: 250,
  first: [[0.0, 0.22, 3.05], [0.0, 0.08, 0.45], 51],
  last: [[0.0, 0.2, 2.9], [0.0, 0.1, 0.45], 49],
});
