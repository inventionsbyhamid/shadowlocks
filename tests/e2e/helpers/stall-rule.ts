// The stall rule, the one place every cost check takes it from (lantern-cost, hand-cost, session-cost through
// helpers/lantern.ts, which re-exports it, and perf-budget). A frame this long (ms, at 4x) is a stall, the host's or
// ours: about seven times the whole 3 ms budget of all our systems. This shared server stalls 40-60 ms now and then,
// one or two in 200 frames of late and often both in one window, which leaving out a window's single worst frame
// cannot absorb (a check failed at 0.56 ms with a median of 0.15). So stalls are left out of the measure and counted;
// a window with more than MAX_STALLS of them is no measure at all, and a regression that slow would show in every
// frame anyway. Pure (no Playwright), so the unit tests hold it too.
export const STALL_MS = 20;
export const MAX_STALLS = 5;

/** A window judged by the stall rule: its mean without stalls (host or ours) and how many there were. */
export interface StallMean {
  meanMs: number;
  stalls: number;
}

/** A window judged by the stall rule for its slowest frames: its p95 without stalls (NaN with none left). */
export interface StallP95 {
  p95Ms: number;
  stalls: number;
}

/** A window's frame times (ms) by the stall rule. */
export function withoutStalls(frames: readonly number[]): StallMean {
  const kept = frames.filter((ms) => ms < STALL_MS);
  return { meanMs: kept.reduce((a, b) => a + b, 0) / Math.max(1, kept.length), stalls: frames.length - kept.length };
}

/**
 * The window to judge: of those with at most MAX_STALLS stalls (a window with more measures nothing), the one `better`
 * prefers; with none of those, the one with the fewest stalls, so the check fails on its stall count.
 */
function pick<T extends { stalls: number }>(judged: readonly T[], better: (a: T, b: T) => boolean): number {
  let index = -1;
  judged.forEach((w, i) => {
    if (w.stalls <= MAX_STALLS && (index < 0 || better(w, judged[index]!))) index = i;
  });
  if (index >= 0) return index;
  return judged.reduce((best, w, i) => (w.stalls < judged[best]!.stalls ? i : best), 0);
}

/** Of several windows' frame times, the one the cost is judged on (the lower mean without stalls) and its index. */
export function judgeWindows(windows: readonly (readonly number[])[]): StallMean & { index: number } {
  const judged = windows.map(withoutStalls);
  const index = pick(judged, (a, b) => a.meanMs < b.meanMs);
  return { ...judged[index]!, index };
}

/**
 * A window's p95 by the stall rule: of the frames under STALL_MS, the one at the 95th place (as frameStats takes it).
 * Stalls left in would push the window's slow-but-ordinary frames down onto the 95th place.
 */
export function p95WithoutStalls(frames: readonly number[]): StallP95 {
  const kept = frames.filter((ms) => ms < STALL_MS).sort((a, b) => a - b);
  const n = kept.length;
  return { p95Ms: n ? kept[Math.min(n - 1, Math.floor(n * 0.95))]! : Number.NaN, stalls: frames.length - n };
}

/** Of several windows' frame times, the one judged on its p95 without stalls (the lower one) and its index. */
export function judgeWindowsP95(windows: readonly (readonly number[])[]): StallP95 & { index: number } {
  const judged = windows.map(p95WithoutStalls);
  const index = pick(judged, (a, b) => a.p95Ms < b.p95Ms);
  return { ...judged[index]!, index };
}
