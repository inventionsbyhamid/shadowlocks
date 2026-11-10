// A box's result as the player sees and shares it: a tile per lock for how much help the lock took (never which shape it
// was), the time in whole seconds, and the player's own bests. Bests come from the collection, which holds each box's
// first solve once: a box solved again (a Daily Box played again the same day, or an earlier day's after the device
// clock moved back) is never added twice, so no best is ever counted twice. Pure: the collection is handed in.
import type { CollectionItem } from "./profile";
import type { BoxSpec } from "./types";

/** What the box session reports as a box opens (box-session.ts). */
export interface BoxResult {
  spec: BoxSpec;
  /** The box's seed key (a box rebuilt under an older generator version has the same key). */
  key: string;
  /** A practice box (`?box=N`, a shared link's box): it changed nothing about the player's progress. */
  practice: boolean;
  /**
   * This solve went into the collection: the box's first solve, played for real. False for practice, and for a box
   * already there (a Daily Box played again the same day, or an earlier day's after the clock moved back).
   */
  recorded: boolean;
  /** Play time (hidden time never counts). */
  timeMs: number;
  /** Hints taken (every ask counts). */
  hints: number;
  /** The hint level each lock reached, in panel order (0: none). */
  levels: number[];
}

/**
 * A lock's tile: opened with no hint, opened after a hint, or opened after its spot was shown (the fourth hint, a ghost
 * lantern on the spot).
 */
export type Tile = "clear" | "hinted" | "shown";

/** The hint level that shows the spot itself (hints.ts MAX_HINT): from it a lock's tile is "shown". */
export const SPOT_SHOWN_LEVEL = 4;

export function tileOf(level: number): Tile {
  if (!(level > 0)) return "clear";
  return level >= SPOT_SHOWN_LEVEL ? "shown" : "hinted";
}

/** The hint levels of a box's `locks` locks in panel order, from a save's map (missing or bad levels count as none). */
export function levelsOf(levels: Readonly<Record<number, number>>, locks: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < locks; i++) {
    const v = levels[i];
    out.push(typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(SPOT_SHOWN_LEVEL, Math.floor(v)) : 0);
  }
  return out;
}

/** The tiles of a box, one per lock in panel order. */
export function tilesOf(levels: readonly number[]): Tile[] {
  return levels.map(tileOf);
}

/** The longest time a result names: 99:59:59. */
export const MAX_SECONDS = 359_999;

/** A time (ms) in the whole seconds a result shows: rounded down, at least 1, at most MAX_SECONDS. */
export function secondsOf(ms: number): number {
  const s = Math.floor((Number.isFinite(ms) ? ms : 0) / 1000 + 1e-9);
  return Math.min(MAX_SECONDS, Math.max(1, s));
}

const two = (n: number) => (n < 10 ? "0" : "") + n;

/** Whole seconds as a clock: "4:12", "0:07", "1:02:03" from an hour. */
export function clockText(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

const DAILY_PREFIX = "shadow-locks/daily/";

/** The time recorded for the box with seed key `key` (its first solve), or null when it is not in the collection. */
export function recordedMs(collection: readonly CollectionItem[], key: string): number | null {
  const item = collection.find((c) => c.key === key);
  return item ? item.timeMs : null;
}

/** The best (lowest) time of the collection's Daily Boxes, leaving out the one with key `except`; null with none. */
export function bestDailyMs(collection: readonly CollectionItem[], except: string | null = null): number | null {
  let best: number | null = null;
  for (const c of collection) {
    if (!c.key.startsWith(DAILY_PREFIX) || c.key === except) continue;
    if (best === null || c.timeMs < best) best = c.timeMs;
  }
  return best;
}

/** What the reward says of a time against the player's bests: a new best, their best so far, or nothing. */
export type Best = { kind: "new" } | { kind: "best"; ms: number } | null;

/**
 * The best line for a box opened in `timeMs`, from the collection (as it is after the box opened):
 * - a Daily Box's first solve: against every other Daily Box; faster than all of them (in whole seconds, a tie is not)
 *   is a new best; the first Daily Box ever says nothing;
 * - a numbered box's first solve: nothing (it is its own record);
 * - a solve that was not recorded (practice: a shared link's box, `?box=N`; or a box solved before): the player's own
 *   record of that box, if they have one. Only a recorded solve can ever be a best.
 */
export function bestOf(collection: readonly CollectionItem[], r: Pick<BoxResult, "spec" | "key" | "recorded" | "timeMs">): Best {
  if (r.spec.kind === "lesson") return null;
  if (!r.recorded) {
    const own = recordedMs(collection, r.key);
    return own === null ? null : { kind: "best", ms: own };
  }
  if (r.spec.kind !== "daily") return null;
  const prior = bestDailyMs(collection, r.key);
  if (prior === null) return null;
  return secondsOf(r.timeMs) < secondsOf(prior) ? { kind: "new" } : { kind: "best", ms: prior };
}
