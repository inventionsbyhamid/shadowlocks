// The film's part D, "endless boxes" (second of five): Box No. 7 on the dark stage, three locks; the Arrow is the last.
// Its other locks were opened before the first frame the way a player does; the hand carries the lantern onto the last
// one's spot and the game opens it.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box7",
  n: 7,
  lock: 0,
  seconds: 1.25,
  off: [0.2, -0.05, 0.08],
  carryMs: 420,
  first: [[0.38, 0.58, 2.9], [0.02, 0.0, 0.45], 50],
  last: [[0.33, 0.52, 2.7], [0.02, 0.0, 0.45], 46],
});
