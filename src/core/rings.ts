// Sight rings: a lock's two rings hang on the line from its spot through its etched mark, so their shadows sit on the
// mark (as a bullseye) only while the lantern is on that line. Runs every frame: no allocations.
import { projInto } from "./geom";
import type { Lock, Ring, V2, V3 } from "./types";

/** The rings count as lined up once their shadows are this close to the mark, and stop counting past RING_OFF. */
export const RING_ON = 0.03;
export const RING_OFF = 0.045;

const at: V2 = [0, 0];

/**
 * How far the lock's ring shadows are from its mark with the lantern at L: the largest distance of a projected ring
 * centre from `mark`. Rings of other locks in `rings` are ignored; Infinity when the lock has no mark or no rings.
 */
export function ringOffset(lock: Lock, rings: Ring[], L: V3): number {
  const m = lock.mark;
  if (!m) return Infinity;
  let d = -1;
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i]!;
    if (r.lock !== lock.i) continue;
    projInto(r.c, L, at);
    d = Math.max(d, Math.hypot(at[0] - m[0], at[1] - m[1]));
  }
  return d < 0 ? Infinity : d;
}

/** Whether the rings are lined up, with hysteresis so the chime does not flicker at the edge. */
export class RingAlign {
  private on = false;

  /** Feeds this frame's ringOffset; true while lined up. A NaN offset counts as off. */
  update(offset: number): boolean {
    if (this.on) {
      if (!(offset <= RING_OFF)) this.on = false;
    } else if (offset <= RING_ON) this.on = true;
    return this.on;
  }
}
