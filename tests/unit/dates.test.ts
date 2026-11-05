import { describe, it, expect } from "vitest";
import { addDays, compareKeys, dayKey, dayNumber } from "../../src/core/dates";

describe("dates", () => {
  it("dayKey uses the local calendar, unpadded", () => {
    expect(dayKey(new Date(2026, 10, 1, 23, 59, 59))).toBe("2026-11-1");
    expect(dayKey(new Date(2026, 0, 5, 0, 0, 1))).toBe("2026-1-5");
  });
  it("dayNumber counts from 2026-11-1", () => {
    expect(dayNumber("2026-11-1")).toBe(1);
    expect(dayNumber("2026-11-18")).toBe(18);
    expect(dayNumber("2026-12-1")).toBe(31);
  });
  it("addDays crosses month and year", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-1");
    expect(addDays("2026-12-31", 1)).toBe("2027-1-1");
    expect(addDays("2026-11-1", -1)).toBe("2026-10-31");
  });
  it("compareKeys orders numerically", () => {
    expect(compareKeys("2026-11-9", "2026-11-10")).toBeLessThan(0);
    expect(compareKeys("2026-11-10", "2026-11-9")).toBeGreaterThan(0);
    expect(compareKeys("2026-11-9", "2026-11-9")).toBe(0);
  });
});
