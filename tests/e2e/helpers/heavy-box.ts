// The heaviest box a player meets early, for the cost specs: of boxes 10 to 60, the fingers or silhouettes box (the
// kinds that cast the most) whose shadows have the most corners, then the most shadows. Chosen from the generator
// itself, so the specs follow it when the boxes change.
import { generateBox } from "../../../src/core/generator";
import { type BoxKind, boxKind } from "../../../src/core/params";
import { RING_SIDES } from "../../../src/core/solve";

export interface HeavyBox {
  n: number;
  kind: BoxKind;
  /** Shadows the box casts (scraps, decoys, rings), and their corners (a ring's RING_SIDES). */
  shadows: number;
  corners: number;
}

let found: HeavyBox | null = null;

export function heaviestBox(): HeavyBox {
  if (found) return found;
  let best: HeavyBox | null = null;
  for (let n = 10; n <= 60; n++) {
    const kind = boxKind(n);
    if (kind !== "fingers" && kind !== "silhouettes") continue;
    const box = generateBox({ kind: "box", n });
    const corners = box.elements.reduce((s, e) => s + (e.kind === "ring" ? RING_SIDES : e.verts.length), 0);
    const b: HeavyBox = { n, kind, shadows: box.elements.length, corners };
    if (!best || b.corners > best.corners || (b.corners === best.corners && b.shadows > best.shadows)) best = b;
  }
  return (found = best!);
}
