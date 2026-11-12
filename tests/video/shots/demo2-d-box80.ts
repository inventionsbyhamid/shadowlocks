// The film's part D, "endless boxes" (fourth of five): Box No. 80 on the dark stage, three locks; the Key is the last.
// Its other locks were opened before the first frame the way a player does; the hand carries the lantern onto the last
// one's spot and the game opens it.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box80",
  n: 80,
  lock: 2,
  seconds: 1.25,
  off: [0.2, -0.05, 0.08],
  carryMs: 420,
  first: [[0.5, 0.66, 2.8], [0.02, 0.0, 0.45], 50],
  last: [[0.44, 0.6, 2.6], [0.02, 0.0, 0.45], 46],
});
