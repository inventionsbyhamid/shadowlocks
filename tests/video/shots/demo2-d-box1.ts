// The film's part D, "endless boxes" (first of five): Box No. 1 on the dark stage, one lock, the Moon: the gentlest
// box. Its other locks were opened before the first frame the way a player does; the hand carries the lantern onto the
// last one's spot and the game opens it.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box1",
  n: 1,
  lock: 0,
  seconds: 1.4,
  off: [0.2, -0.05, 0.08],
  carryMs: 450,
  first: [[-0.42, 0.5, 2.95], [0.0, 0.02, 0.45], 52],
  last: [[-0.36, 0.44, 2.7], [0.0, 0.02, 0.45], 47],
});
