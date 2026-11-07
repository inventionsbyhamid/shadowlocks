// The e2e cost checks' stall rule (tests/e2e/helpers/stall-rule.ts): on a shared server a few frames now and then take
// 40-60 ms for reasons that are not our code. They are left out and counted; a window with more than MAX_STALLS of
// them is no measure. perf-budget's p95 is judged the same way as the other checks' means.
import { describe, expect, it } from "vitest";
import { judgeWindows, judgeWindowsP95, MAX_STALLS, p95WithoutStalls, STALL_MS, withoutStalls } from "../e2e/helpers/stall-rule";

/** 200 frames: 1 ms each, `slow` of them 2.9 ms, and `stalls` host stalls of 60 ms. */
const window = (slow: number, stalls: number) => [
  ...Array.from({ length: 200 - slow - stalls }, () => 1),
  ...Array.from({ length: slow }, () => 2.9),
  ...Array.from({ length: stalls }, () => 60),
];

describe("the stall rule", () => {
  it("leaves host stalls out of the p95 and counts them", () => {
    expect(STALL_MS).toBe(20);
    expect(MAX_STALLS).toBe(5);
    // Six slow frames and five stalls: left out, the stalls leave the p95 on an ordinary frame (6 slow of 195 are
    // all above the 95th place)...
    expect(p95WithoutStalls(window(6, 5))).toEqual({ p95Ms: 1, stalls: 5 });
    // ...counted in, they push the slow frames down the ranking onto it.
    const withThem = [...window(6, 5)].sort((a, b) => a - b)[Math.floor(200 * 0.95)]!;
    expect(withThem).toBe(2.9);
    // Ten slow frames of 195: past the 95th place, they show.
    expect(p95WithoutStalls(window(11, 5)).p95Ms).toBe(2.9);
    // No frames left at all: no measure.
    expect(p95WithoutStalls([60, 70]).p95Ms).toBeNaN();
  });

  it("judges the better window by its p95 without stalls, as the means are judged", () => {
    const quiet = window(4, 1), busy = window(12, 6);
    const j = judgeWindowsP95([busy, quiet]);
    expect(j.index).toBe(1);
    expect(j.p95Ms).toBe(1);
    expect(j.stalls).toBe(1);
    // The mean rule is unchanged.
    expect(withoutStalls([1, 3, 60])).toEqual({ meanMs: 2, stalls: 1 });
    expect(judgeWindows([[2, 2], [1, 1, 60]]).index).toBe(1);
  });
});
