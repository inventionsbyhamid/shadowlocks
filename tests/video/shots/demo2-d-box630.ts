// The film's part D, "endless boxes" (last of five, the busiest): Box No. 630 on the dark stage, three locks and 49
// elements on the panel and its threads, as many as any box from No. 100 to 999 that has a lock the lantern alone
// opens; the hidden Owl is the last. Its other locks were opened before the first frame the way a player does; the hand
// carries the lantern onto the last one's spot and the game opens it.
import { endlessShot } from "./demo2-d-kit";

export default endlessShot({
  name: "demo2-d-box630",
  n: 630,
  lock: 1,
  seconds: 2.2,
  off: [0.2, -0.05, 0.08],
  carryMs: 520,
  startMs: 250,
  first: [[0.48, 0.62, 3.0], [0.02, 0.08, 0.45], 52],
  last: [[0.44, 0.58, 2.8], [0.02, 0.1, 0.45], 49],
});
