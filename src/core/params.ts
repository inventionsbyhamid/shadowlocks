// The difficulty curve: every mechanic by box 5 (decoys from box 2, a finger lock from box 3, a lock without rings
// from box 4, a hidden outline from box 5), then more of each up to a cap.
import type { BoxParams } from "./types";

type Row = Pick<BoxParams, "locks" | "fingerLocks" | "decoys" | "ringless" | "hidden">;

function row(n: number): Row {
  if (n === 1) return { locks: 1, fingerLocks: 0, decoys: 2, ringless: 0, hidden: 0 };
  if (n === 2) return { locks: 2, fingerLocks: 0, decoys: 6, ringless: 0, hidden: 0 };
  if (n === 3) return { locks: 2, fingerLocks: 1, decoys: 8, ringless: 0, hidden: 0 };
  if (n === 4) return { locks: 2, fingerLocks: 1, decoys: 10, ringless: 1, hidden: 0 };
  if (n === 5) return { locks: 3, fingerLocks: 1, decoys: 12, ringless: 1, hidden: 1 };
  if (n <= 7) return { locks: 3, fingerLocks: 1, decoys: 12 + (n - 5), ringless: 1, hidden: 1 };
  if (n <= 9) return { locks: 3, fingerLocks: 2, decoys: 12 + (n - 5), ringless: 2, hidden: 2 };
  if (n <= 14) return { locks: 3, fingerLocks: 2, decoys: 16, ringless: 2, hidden: 2 };
  return { locks: 3, fingerLocks: 2, decoys: 16, ringless: 2, hidden: 3 };
}

/** The settings for box n (1, 2, 3, ...). `amp` is the share of the envelope's x range the spots may use. */
export function boxParams(n: number): BoxParams {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Box numbers start at 1, got ${n}`);
  return { ...row(n), tilt: Math.min(0.03 + 0.012 * n, 0.14), amp: Math.min(0.4 + 0.06 * n, 1) };
}

/** The Daily Box plays like box 7: three locks, one finger lock, one without rings, one hidden. */
export function dailyParams(): BoxParams {
  return boxParams(7);
}
