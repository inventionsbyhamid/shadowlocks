// The box session's rules that need no frame: what a solved box does to the profile, what a taken reward adds to the
// collection, and which lock a gaze ray picks on the panel. Pure apart from the profile they are handed.
import { recordDailySolve } from "../core/daily";
import type { Profile } from "../core/profile";
import type { Box, BoxSpec, Lock, V3 } from "../core/types";

/** The head's gaze picks a lock within this share of its size from its centre (between locks it picks none). */
export const GAZE_REACH = 0.62;

/**
 * A box was solved (it opens): a numbered box moves the next box on (never back: replaying an earlier box changes
 * nothing) and clears the box in progress; a Daily Box records the day (the streak counts a day once) and clears the
 * daily box in progress.
 */
export function solveBox(p: Profile, spec: BoxSpec): void {
  if (spec.kind === "box") {
    if (p.nextBox < spec.n + 1) p.nextBox = spec.n + 1;
    p.current = null;
  } else if (spec.kind === "daily") {
    p.daily = { ...recordDailySolve(p, spec.day).daily, current: null };
  }
}

/** The box's reward goes into the collection (once: a box already there is not added again). */
export function collect(p: Profile, box: Box, atMs: number, timeMs: number, hints: number): void {
  if (p.collection.some((c) => c.key === box.key)) return;
  p.collection.push({ key: box.key, owner: box.owner, loot: box.loot, shapes: box.locks.map((l) => l.shape), atMs, timeMs, hints });
}

/**
 * The lock whose outline the ray from `o` along `dir` (box units) meets on the panel: the nearest centre within
 * GAZE_REACH of its size, or null (looking away, or between locks). Allocation-free.
 */
export function lockOnPanel(locks: readonly { readonly lock: Lock }[], o: V3, dir: V3): number | null {
  if (!(dir[2] < 0) || !(o[2] > 0)) return null;
  const t = -o[2] / dir[2];
  const x = o[0] + dir[0] * t, y = o[1] + dir[1] * t;
  let best = -1, bd = Number.POSITIVE_INFINITY;
  for (let i = 0; i < locks.length; i++) {
    const l = locks[i]!.lock;
    const dx = x - l.center[0], dy = y - l.center[1];
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r <= l.size * GAZE_REACH && r < bd) {
      bd = r;
      best = l.i;
    }
  }
  return best < 0 ? null : best;
}
