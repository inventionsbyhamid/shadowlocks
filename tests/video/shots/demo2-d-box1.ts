// The film's part D, "endless boxes" (second of five, under "They start with one gentle lock"): Box No. 1 on the dark
// stage, one lock, the Moon: the gentlest box. Its other locks were opened before the first frame the way a player
// does; the hand carries the lantern onto the last one's spot and the game opens it.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box1",
  n: 1,
  lock: 0,
  seconds: 2.6,
  off: [0.2, -0.05, 0.08],
  carryMs: 600,
  startMs: 250,
  first: [[-0.42, 0.5, 3.05], [0.0, 0.08, 0.45], 52],
  last: [[-0.38, 0.46, 2.85], [0.0, 0.1, 0.45], 49],
});
