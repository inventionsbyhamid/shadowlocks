// What a box costs a frame in play, by a model fitted to our JS in the browser (Task 26 report, fix round 2). With the
// lantern moving in small loops round each box's heaviest spot, a hand in the beam, at 4x CPU throttle on the steady
// e2e cores, our JS a frame grew with the corners of the shadows the box casts: the render projects every corner from
// the lantern and rounds the soft edge along it each frame (box-shadows.ts, shadow-mesh.ts), a ring's two circles
// counting 2 x RING_SIDES. Over 16 boxes the frame's mean was about FRAME_MS.base plus FRAME_MS.corner a corner (r 0.82;
// the shell system alone, which draws the box, r 0.93). What else differs between boxes showed no measurable effect:
// a big lock's measure (a 0.46 silhouette of many pieces cost no more than box 15), how many locks are finger locks.
import { RING_SIDES } from "./solve";
import type { Element } from "./types";

/** A frame's mean JS in play at 4x CPU throttle (ms): a base, and its growth per shadow corner the box casts. */
export const FRAME_MS = { base: 0.986, corner: 0.000702 } as const;

/** Corners the render casts and rounds every frame: every scrap's and decoy's, and both circles of each ring. */
export function renderCorners(elements: readonly Element[]): number {
  let n = 0;
  for (const e of elements) n += e.kind === "ring" ? 2 * RING_SIDES : e.verts.length;
  return n;
}

/** A frame's mean JS in play at 4x CPU throttle (ms) for a box with these elements, by the model. */
export function frameMs(elements: readonly Element[]): number {
  return FRAME_MS.base + FRAME_MS.corner * renderCorners(elements);
}
