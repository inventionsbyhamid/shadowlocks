// The glow's lead-in, shared by the generator test and its opt-in sweep. Unlike box-checks.ts, it measures with the
// game's own solve.ts (the sample grid and warmth the player's lantern reads), since that is what has to lead in.
import { type Coverage, measure, prepareLock, shadowPolys, SKIP_MISSING, warmth, WARMTH_RANGE } from "../../../src/core/solve";
import type { Box, V2, V3 } from "../../../src/core/types";

/**
 * Locks of `box` not strictly warmest at their spot along the line in from WARMTH_RANGE toward the start (9 samples),
 * as "lock <i> at <sample>".
 */
export function notWarmest(box: Box): string[] {
  const out: string[] = [], scraps: V2[][] = [], cov: Coverage = { cover: 0, spill: 0, spillAll: 0, gap: 0 };
  for (const l of box.locks) {
    const s = prepareLock(l), d = [box.start[0] - l.L[0], box.start[1] - l.L[1], box.start[2] - l.L[2]];
    const len = Math.hypot(d[0]!, d[1]!, d[2]!);
    const w = (t: number) => {
      const L: V3 = [l.L[0] + (d[0]! / len) * t, l.L[1] + (d[1]! / len) * t, l.L[2] + (d[2]! / len) * t];
      return warmth(measure(s, scraps, shadowPolys(box.elements, L, scraps, SKIP_MISSING), [], 0, cov), t);
    };
    const peak = w(0);
    for (let k = 0; k < 9; k++) if (!(w(WARMTH_RANGE * (1 - k / 9)) < peak)) out.push(`lock ${l.i} at ${k}`);
  }
  return out;
}
