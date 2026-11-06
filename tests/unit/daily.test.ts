import { describe, expect, it } from "vitest";
import { dailyUnlocked, dayKey, recordDailySolve, todayKey } from "../../src/core/daily";
import { newProfile, type Profile } from "../../src/core/profile";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

/** A profile whose daily streak is `streak` (best `best`), last solved on `lastDay`. */
function withDaily(lastDay: string | null, streak = 0, best = streak): Profile {
  const p = newProfile(NOW, "1.0.0");
  p.daily = { streak, best, lastDay, current: null };
  return p;
}

const pad = (n: number) => String(n).padStart(2, "0");

describe("dayKey", () => {
  it("dayKey at 23:59 and 00:01 local", () => {
    // UTC+1 (Date.getTimezoneOffset() says -60): 23:59 local on Nov 6 is 22:59 UTC.
    expect(dayKey(Date.UTC(2026, 10, 6, 22, 59), -60)).toBe("2026-11-06");
    expect(dayKey(Date.UTC(2026, 10, 6, 23, 1), -60)).toBe("2026-11-07");
    // UTC-5 (offset 300): 23:59 local on Nov 6 is 04:59 UTC on Nov 7.
    expect(dayKey(Date.UTC(2026, 10, 7, 4, 59), 300)).toBe("2026-11-06");
    expect(dayKey(Date.UTC(2026, 10, 7, 5, 1), 300)).toBe("2026-11-07");
    // UTC+5:30 (offset -330): 00:01 local on Jan 1 is 18:31 UTC on Dec 31.
    expect(dayKey(Date.UTC(2026, 11, 31, 18, 29), -330)).toBe("2026-12-31");
    expect(dayKey(Date.UTC(2026, 11, 31, 18, 31), -330)).toBe("2027-01-01");
  });

  it("pads month and day", () => {
    expect(dayKey(Date.UTC(2027, 0, 5, 9, 0), 0)).toBe("2027-01-05");
  });

  it("todayKey is dayKey with the device's own offset at that moment", () => {
    for (const t of [Date.UTC(2026, 10, 6, 0, 30), Date.UTC(2026, 2, 29, 1, 30), Date.UTC(2026, 9, 25, 23, 59)]) {
      expect(todayKey(t)).toBe(dayKey(t, new Date(t).getTimezoneOffset()));
      const d = new Date(t);
      expect(todayKey(t)).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
  });

  it("matches the device's own calendar when given the device's offset", () => {
    for (const t of [NOW, Date.UTC(2026, 6, 1, 23, 30), Date.UTC(2027, 0, 1, 0, 30)]) {
      const d = new Date(t);
      expect(dayKey(t, d.getTimezoneOffset())).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
  });
});

describe("daily streak", () => {
  it("the first solve starts the streak at 1", () => {
    expect(recordDailySolve(withDaily(null), "2026-11-06").daily).toEqual({ streak: 1, best: 1, lastDay: "2026-11-06", current: null });
  });

  it("the next day adds one and raises the best", () => {
    expect(recordDailySolve(withDaily("2026-11-05", 3, 3), "2026-11-06").daily).toMatchObject({ streak: 4, best: 4, lastDay: "2026-11-06" });
  });

  it("the same day changes nothing", () => {
    const p = withDaily("2026-11-06", 3, 5);
    expect(recordDailySolve(p, "2026-11-06")).toEqual(p);
  });

  it("a missed day starts over at 1 and keeps the best", () => {
    expect(recordDailySolve(withDaily("2026-11-03", 4, 4), "2026-11-05").daily).toMatchObject({ streak: 1, best: 4, lastDay: "2026-11-05" });
    expect(recordDailySolve(withDaily("2026-10-01", 9, 9), "2026-11-05").daily).toMatchObject({ streak: 1, best: 9 });
  });

  it("crosses a month and a year end", () => {
    expect(recordDailySolve(withDaily("2026-11-30", 9), "2026-12-01").daily.streak).toBe(10);
    expect(recordDailySolve(withDaily("2026-12-31", 2), "2027-01-01").daily.streak).toBe(3);
    expect(recordDailySolve(withDaily("2028-02-28", 2), "2028-02-29").daily.streak).toBe(3);
  });

  it("clock going backwards keeps streak", () => {
    const p = withDaily("2026-11-10", 5, 5);
    // The device clock is moved back three days and the player solves "that" day's box: nothing changes.
    const back = recordDailySolve(p, "2026-11-07");
    expect(back).toEqual(p);
    expect(recordDailySolve(back, "2026-11-08")).toEqual(p);
    // The clock is put right: the next real day continues the streak, never double counted.
    expect(recordDailySolve(back, "2026-11-11").daily).toMatchObject({ streak: 6, best: 6, lastDay: "2026-11-11" });
    expect(recordDailySolve(recordDailySolve(back, "2026-11-11"), "2026-11-11").daily.streak).toBe(6);
  });

  it("ignores a day that is not a YYYY-MM-DD key", () => {
    const p = withDaily("2026-11-05", 2, 2);
    for (const bad of ["", "2026-11-6", "11/06/2026", "2026-13-01", "2026-02-30", "soon"]) expect(recordDailySolve(p, bad)).toEqual(p);
  });

  it("returns a new profile and leaves the old one as it was", () => {
    const p = withDaily("2026-11-05", 2, 2);
    p.daily.current = {
      key: "shadow-locks/daily/2026-11-06",
      lantern: [0, -0.2, 1.2],
      open: [0],
      crystal: [],
      elapsedMs: 1000,
      hints: 0,
      hintLevel: {},
    };
    const before = JSON.parse(JSON.stringify(p));
    const next = recordDailySolve(p, "2026-11-06");
    expect(p).toEqual(before);
    expect(next).not.toBe(p);
    expect(next.daily.current).toEqual(p.daily.current);
    expect({ ...next, daily: p.daily }).toEqual(p);
  });
});

describe("daily box unlock", () => {
  it("unlocks once box 3 is solved", () => {
    const at = (nextBox: number) => dailyUnlocked({ ...newProfile(NOW, "1.0.0"), nextBox });
    expect([1, 2, 3, 4, 5, 40].map(at)).toEqual([false, false, false, true, true, true]);
  });
});
