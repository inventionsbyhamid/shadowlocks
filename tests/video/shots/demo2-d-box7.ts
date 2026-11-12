// The film's part D, "endless boxes" (third of five, from "and keep getting trickier"): Box No. 7 on the dark stage,
// three locks; the Arrow is the last. Its other locks were opened before the first frame the way a player does; the
// hand carries the lantern onto the last one's spot and the game opens it.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box7",
  n: 7,
  lock: 0,
  seconds: 2.2,
  off: [0.2, -0.05, 0.08],
  carryMs: 500,
  startMs: 250,
  first: [[0.38, 0.58, 3.0], [0.02, 0.08, 0.45], 51],
  last: [[0.35, 0.54, 2.85], [0.02, 0.1, 0.45], 49],
});
