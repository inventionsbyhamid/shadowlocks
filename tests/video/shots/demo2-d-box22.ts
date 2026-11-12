// The film's part D, "endless boxes" (third of five): Box No. 22 on the dark stage, three locks and the most scraps of
// the run; the hidden Anchor is the last. Its other locks were opened before the first frame the way a player does; the
// hand carries the lantern onto the last one's spot and the game opens it.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box22",
  n: 22,
  lock: 1,
  seconds: 1.25,
  off: [0.2, -0.05, 0.08],
  carryMs: 420,
  first: [[-0.3, 0.22, 3.0], [0.0, 0.02, 0.45], 50],
  last: [[-0.26, 0.2, 2.75], [0.0, 0.02, 0.45], 46],
});
