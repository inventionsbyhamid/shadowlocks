// The film's part D, "endless boxes" (last of five): Box No. 500 on the dark stage, three locks; the hidden Rabbit is
// the last, and the box opens. Its other locks were opened before the first frame the way a player does; the hand
// carries the lantern onto the last one's spot and the game opens it.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box500",
  n: 500,
  lock: 1,
  seconds: 1.75,
  off: [0.2, -0.05, 0.08],
  carryMs: 450,
  first: [[0.0, 0.42, 3.1], [0.0, 0.02, 0.45], 52],
  last: [[0.0, 0.38, 2.7], [0.0, 0.02, 0.45], 47],
});
