import { compareKeys } from "./dates";

/** The Daily Box streak: days in a row with a solved Daily Box. A missed day starts over (no freezes). */
export interface StreakState {
  lastDayKey: string | null;
  streak: number;
  best: number;
}

/**
 * A Daily Box solved on day `key`. The next day adds one, the same day changes nothing, a gap
 * starts over at 1, and a day before the last one (the device clock moved back) changes nothing.
 */
export function completeDaily(s: StreakState, key: string): StreakState {
  let gap = Infinity;
  if (s.lastDayKey !== null) {
    gap = compareKeys(key, s.lastDayKey);
    if (gap <= 0) return s;
  }
  const streak = gap === 1 ? s.streak + 1 : 1;
  return { lastDayKey: key, streak, best: Math.max(s.best, streak) };
}
