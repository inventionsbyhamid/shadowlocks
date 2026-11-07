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
 * The window to judge: of those with at most `maxStalls` stalls (a window with more measures nothing), the one `better`
 * prefers; with none of those, the one with the fewest stalls, so the check fails on its stall count.
 */
function pick<T extends { stalls: number }>(judged: readonly T[], better: (a: T, b: T) => boolean, maxStalls = MAX_STALLS): number {
  let index = -1;
  judged.forEach((w, i) => {
    if (w.stalls <= maxStalls && (index < 0 || better(w, judged[index]!))) index = i;
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
 * Stalls left in would push the window's slow-but-ordinary frames down onto the 95th place. A check timed at another
 * throttle than 4x passes its own threshold, STALL_MS scaled with the throttle (a stall stretches with it).
 */
export function p95WithoutStalls(frames: readonly number[], stallMs = STALL_MS): StallP95 {
  const kept = frames.filter((ms) => ms < stallMs).sort((a, b) => a - b);
  const n = kept.length;
  return { p95Ms: n ? kept[Math.min(n - 1, Math.floor(n * 0.95))]! : Number.NaN, stalls: frames.length - n };
}

/**
 * Of several windows' frame times, the one judged on its p95 without stalls (the lower one, among those with at most
 * `maxStalls` stalls) and its index.
 */
export function judgeWindowsP95(
  windows: readonly (readonly number[])[],
  stallMs = STALL_MS,
  maxStalls = MAX_STALLS,
): StallP95 & { index: number } {
  const judged = windows.map((w) => p95WithoutStalls(w, stallMs));
  const index = pick(judged, (a, b) => a.p95Ms < b.p95Ms, maxStalls);
  return { ...judged[index]!, index };
}

/**
 * A window of frames with each system's own time a frame (the same frames, in order), and the stalls it may excuse: how
 * many times the kernel paused the whole test container meanwhile (its cgroup's `nr_throttled`: see
 * judgeSystemWindowsP95).
 */
export interface SystemWindow {
  frames: readonly number[];
  bySystem: Readonly<Record<string, readonly number[]>>;
  excused: number;
}

/** The test container's CPU quota counters (its cgroup's `nr_periods` and `nr_throttled`), read by helpers/perf-play.ts. */
export interface ContainerCpu {
  periods: number;
  throttled: number;
}

/**
 * The kernel's pauses of the container between two readings (a window's `excused`), or null when unknown: a counter
 * could not be read, or no quota period ran between them. A cgroup with no quota counts no periods, so its 0 pauses
 * say nothing, and the spec falls back to MAX_STALLS rather than excuse none.
 */
export function pausesBetween(a: ContainerCpu | null, b: ContainerCpu | null): number | null {
  if (!a || !b || b.periods <= a.periods) return null;
  return b.throttled - a.throttled;
}

/** Each stalled frame's owner: the system that took most of it. */
export function stallOwners(w: Pick<SystemWindow, "frames" | "bySystem">, stallMs = STALL_MS): string[] {
  const owners: string[] = [];
  w.frames.forEach((ms, i) => {
    if (ms < stallMs) return;
    let who = "?", most = -1;
    for (const [k, xs] of Object.entries(w.bySystem)) {
      const t = xs[i] ?? 0;
      if (t > most) {
        most = t;
        who = k;
      }
    }
    owners.push(who);
  });
  return owners;
}

/** The system holding the most stalls, and how many. */
export function busiestOwner(owners: readonly string[]): { system: string | null; stalls: number } {
  const n = new Map<string, number>();
  for (const o of owners) n.set(o, (n.get(o) ?? 0) + 1);
  let system: string | null = null, stalls = 0;
  for (const [k, v] of n) {
    if (v > stalls) {
      system = k;
      stalls = v;
    }
  }
  return { system, stalls };
}

/**
 * The p95 rule where the stalls are counted against their cause. The stalls of the e2e server are its test container's
 * CPU quota: the container may use 6 CPUs, the browser's software renderer starts threads for all 40 the host shows, and
 * when they burst past the quota the kernel stops every thread of the container until the next 100 ms period. Our page
 * then loses 46 to 80 ms in whatever it was doing (measured: a busy loop with no CPU throttle at all lost 31 such
 * pauses in 4 s while the cgroup's `nr_throttled` rose by 42; with the renderer quiet, none, and the counter stood
 * still). So a window's stalls are excused only up to the number of times the kernel paused the container during it
 * (`excused`), and, in the judged window, no one system may hold more than MAX_STALLS of them (the 4x rule's whole
 * allowance): the kernel's pauses land wherever the page happens to be, a hitch of ours keeps landing in one system.
 * The judged window is the one with the lowest p95 of those whose stalls are all excused; with none, the one with the
 * fewest stalls past its excuse, so the check fails on it.
 */
export function judgeSystemWindowsP95(
  windows: readonly SystemWindow[],
  stallMs: number,
): StallP95 & { index: number; excused: number; owner: { system: string | null; stalls: number } } {
  const judged = windows.map((w) => ({ ...p95WithoutStalls(w.frames, stallMs), excused: w.excused }));
  let index = -1;
  judged.forEach((w, i) => {
    if (w.stalls <= w.excused && (index < 0 || w.p95Ms < judged[index]!.p95Ms)) index = i;
  });
  if (index < 0) index = judged.reduce((best, w, i) => (w.stalls - w.excused < judged[best]!.stalls - judged[best]!.excused ? i : best), 0);
  return { ...judged[index]!, index, owner: busiestOwner(stallOwners(windows[index]!, stallMs)) };
}
