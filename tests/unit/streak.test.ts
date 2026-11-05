import { describe, it, expect } from "vitest";
import { completeDaily, type StreakState } from "../../src/core/streak";
import { dayKey } from "../../src/core/dates";

const st = (o: Partial<StreakState> = {}): StreakState => ({ lastDayKey: null, streak: 0, best: 0, ...o });

describe("streak", () => {
  it("first completion starts at 1", () => {
    expect(completeDaily(st(), "2026-11-1")).toEqual({ lastDayKey: "2026-11-1", streak: 1, best: 1 });
  });
  it("next day adds one", () => {
    const r = completeDaily(st({ lastDayKey: "2026-11-1", streak: 1, best: 1 }), "2026-11-2");
    expect(r.streak).toBe(2);
    expect(r.best).toBe(2);
  });
  it("same day is unchanged", () => {
    const s = st({ lastDayKey: "2026-11-1", streak: 3, best: 3 });
    expect(completeDaily(s, "2026-11-1")).toEqual(s);
  });
  it("one missed day starts over at 1 and keeps the best", () => {
    const r = completeDaily(st({ lastDayKey: "2026-11-1", streak: 4, best: 4 }), "2026-11-3");
    expect(r.streak).toBe(1);
    expect(r.best).toBe(4);
  });
  it("crosses a month end", () => {
    const r = completeDaily(st({ lastDayKey: "2026-11-30", streak: 9, best: 9 }), "2026-12-1");
    expect(r.streak).toBe(10);
  });
  it("credits the start day across midnight", () => {
    const started = dayKey(new Date(2026, 10, 2, 23, 59, 30));
    const finished = new Date(2026, 10, 3, 0, 0, 20);
    expect(dayKey(finished)).toBe("2026-11-3");
    const r = completeDaily(st({ lastDayKey: "2026-11-1", streak: 1, best: 1 }), started);
    expect(r.lastDayKey).toBe("2026-11-2");
    expect(r.streak).toBe(2);
  });
  it("clock going backwards keeps streak", () => {
    const s = st({ lastDayKey: "2026-11-5", streak: 5, best: 5 });
    expect(completeDaily(s, "2026-11-2")).toEqual(s);
  });
});
