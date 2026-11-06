// The Daily Box: one box per local calendar day, unlocked after box 3, with a streak of days in a row.
// A missed day starts the streak over (no freezes). A day before the last one solved (the device clock
// moved back) changes nothing, so the streak never double counts and never breaks from a clock change.
import { isDayKey, type Profile } from "./profile";

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The local calendar day at `nowMs` as `YYYY-MM-DD`. `tzOffsetMin` is what `Date.getTimezoneOffset()`
 * gives for that moment (minutes behind UTC: UTC+1 is -60, UTC-5 is 300); pass
 * `new Date(nowMs).getTimezoneOffset()` so a daylight saving change is taken into account.
 */
export function dayKey(nowMs: number, tzOffsetMin: number): string {
  const local = new Date(nowMs - tzOffsetMin * MS_MIN);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/**
 * Today's day key on this device at `nowMs` (its own time zone, daylight saving included). The game names
 * days only through this, so one sign convention is used everywhere.
 */
export function todayKey(nowMs: number): string {
  return dayKey(nowMs, new Date(nowMs).getTimezoneOffset());
}

/** Days since 1970-01-01 for a valid day key. */
function dayIndex(key: string): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

/**
 * The Daily Box for `day` (a `dayKey`) was solved. The day after the last one adds one, the same day
 * changes nothing, a gap starts over at 1, and a day before the last one changes nothing. The best
 * streak follows. Returns a new profile (or `p` itself when nothing changes); `daily.current` is the
 * box session's to clear.
 */
export function recordDailySolve(p: Profile, day: string): Profile {
  if (!isDayKey(day)) return p;
  const { lastDay } = p.daily;
  let gap = Number.POSITIVE_INFINITY;
  if (lastDay !== null) {
    gap = dayIndex(day) - dayIndex(lastDay);
    if (gap <= 0) return p;
  }
  const streak = gap === 1 ? p.daily.streak + 1 : 1;
  return { ...p, daily: { ...p.daily, streak, best: Math.max(p.daily.best, streak), lastDay: day } };
}

/** The Daily Box opens once box 3 is solved. */
export function dailyUnlocked(p: Profile): boolean {
  return p.nextBox > 3;
}
