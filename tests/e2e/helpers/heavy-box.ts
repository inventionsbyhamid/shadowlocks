// The heaviest box a player meets early, for the cost specs: of boxes 10 to 60, the one whose frame costs most by the
// generator's frame cost model (src/core/frame-cost.ts, generator.ts boxFrame): the most shadow corners the render
// casts and rounds every frame, then the most shadows. Chosen from the generator itself, so the specs follow it when
// the boxes change; every box is within FRAME_CORNER_CAP.
import { boxFrame, generateBox } from "../../../src/core/generator";
import { type BoxKind, boxKind } from "../../../src/core/params";

export interface HeavyBox {
  n: number;
  kind: BoxKind;
  /** Its shadows, their corners, and its frame's mean JS at 4x by the model (ms). */
  shadows: number;
  corners: number;
  ms: number;
}

let found: HeavyBox | null = null;

export function heaviestBox(): HeavyBox {
  if (found) return found;
  let best: HeavyBox | null = null;
  for (let n = 10; n <= 60; n++) {
    const box = generateBox({ kind: "box", n }), f = boxFrame(box);
    const b: HeavyBox = { n, kind: boxKind(n), shadows: box.elements.length, corners: f.corners, ms: f.ms };
    if (!best || b.corners > best.corners || (b.corners === best.corners && b.shadows > best.shadows)) best = b;
  }
  return (found = best!);
}
