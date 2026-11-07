// The e2e cost checks' stall rule (tests/e2e/helpers/stall-rule.ts): on a shared server a few frames now and then take
// 40-60 ms, the host's doing or ours. They are left out and counted; a window with more than MAX_STALLS of
// them is no measure. perf-budget's p95 is judged the same way as the other checks' means.
import { describe, expect, it } from "vitest";
import {
  busiestOwner,
  judgeSystemWindowsP95,
  judgeWindows,
  judgeWindowsP95,
  MAX_STALLS,
  p95WithoutStalls,
  STALL_MS,
  stallOwners,
  type SystemWindow,
  withoutStalls,
} from "../e2e/helpers/stall-rule";

/** 200 frames: 1 ms each, `slow` of them 2.9 ms, and `stalls` stalls of 60 ms. */
const window = (slow: number, stalls: number) => [
  ...Array.from({ length: 200 - slow - stalls }, () => 1),
  ...Array.from({ length: slow }, () => 2.9),
  ...Array.from({ length: stalls }, () => 60),
];

describe("the stall rule", () => {
  it("leaves stalls out of the p95 and counts them", () => {
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

  it("a window with more than MAX_STALLS stalls is no measure: the better of the others is judged", () => {
    // Ten stalls leave an ordinary p95 (1 ms) behind, but that window measures nothing; the fair one (4 stalls) counts.
    const many = window(0, 10), fair = window(12, 4);
    const j = judgeWindowsP95([fair, many]);
    expect(j.index).toBe(0);
    expect(j.stalls).toBe(4);
    expect(j.p95Ms).toBe(2.9);
    // The means likewise.
    expect(judgeWindows([fair, many]).index).toBe(0);
    // With no fair window at all, the one with the fewest stalls, so the check fails on its stall count.
    expect(judgeWindowsP95([window(0, 8), window(0, 7)]).index).toBe(1);
    expect(judgeWindows([window(0, 8), window(0, 7)]).index).toBe(1);
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

  it("takes a threshold scaled with another throttle: at 6x a 25 ms frame is no stall", () => {
    const frames = [1, 2, 25, 26, 40];
    expect(p95WithoutStalls(frames)).toEqual({ p95Ms: 2, stalls: 3 });
    expect(p95WithoutStalls(frames, (STALL_MS * 6) / 4)).toEqual({ p95Ms: 26, stalls: 1 });
    expect(judgeWindowsP95([frames, [1, 1, 50]], 30).index).toBe(1);
  });

  it("judges among the windows its own allowance lets in: the better p95, not the fewest stalls", () => {
    const calm = window(11, 7), busy = window(4, 8);
    // By the 4x allowance neither window counts, so the one with fewer stalls is judged (and fails on its count)...
    expect(judgeWindowsP95([calm, busy]).index).toBe(0);
    // ...by an allowance of 8 both count, and the lower p95 is judged.
    expect(judgeWindowsP95([calm, busy], STALL_MS, 8).index).toBe(1);
  });
});

describe("stalls counted against their cause", () => {
  const SYSTEMS = ["game", "shell", "lantern", "hands", "hand-pinch", "sound", "menus"];
  /**
   * A window of 200 frames: `stallsIn` lists, frame by frame from the start, the system each stall falls in; every other
   * frame is ordinary (`ms` a frame, spread over the systems). `excused`: the container's throttled periods meanwhile.
   */
  const win = (stallsIn: string[], excused: number, ms = 1): SystemWindow => {
    const frames: number[] = [], bySystem: Record<string, number[]> = Object.fromEntries(SYSTEMS.map((s) => [s, []]));
    for (let i = 0; i < 200; i++) {
      const who = stallsIn[i];
      frames.push(who ? 60 : ms);
      for (const s of SYSTEMS) bySystem[s]!.push(who ? (s === who ? 58 : 0.3) : ms / SYSTEMS.length);
    }
    return { frames, bySystem, excused };
  };
  const spread = (n: number) => Array.from({ length: n }, (_, i) => SYSTEMS[i % SYSTEMS.length]!);

  it("names the system each stall fell in, and the one holding the most", () => {
    const w = win(["game", "shell", "game"], 10);
    expect(stallOwners(w, 28)).toEqual(["game", "shell", "game"]);
    expect(busiestOwner(stallOwners(w, 28))).toEqual({ system: "game", stalls: 2 });
    expect(busiestOwner([])).toEqual({ system: null, stalls: 0 });
  });

  it("fails 15 stalls in one system, however many pauses the kernel made", () => {
    const j = judgeSystemWindowsP95([win(Array(15).fill("game"), 40)], 28);
    expect(j.stalls).toBe(15);
    expect(j.stalls).toBeLessThanOrEqual(j.excused);
    // The check: no one system holds more than the 4x rule's whole allowance.
    expect(j.owner).toEqual({ system: "game", stalls: 15 });
    expect(j.owner.stalls).toBeGreaterThan(MAX_STALLS);
    // The same 15 spread over the systems pass that check.
    expect(judgeSystemWindowsP95([win(spread(15), 40)], 28).owner.stalls).toBeLessThanOrEqual(MAX_STALLS);
  });

  it("checks the window it judges, not the last one", () => {
    // Window 1 is the faster one, so it is judged, and its 12 stalls are all in one system; window 2 is clean.
    const first = win(Array(12).fill("game"), 30, 1), second = win(spread(3), 30, 2);
    const j = judgeSystemWindowsP95([first, second], 28);
    expect(j.index).toBe(0);
    expect(j.owner.stalls).toBe(12);
    expect(j.owner.stalls).toBeGreaterThan(MAX_STALLS);
    // The last window alone would have passed: checking it hid the hitch.
    expect(busiestOwner(stallOwners(second, 28)).stalls).toBeLessThanOrEqual(MAX_STALLS);
  });

  it("excuses no more stalls than the kernel paused the container", () => {
    // Window 1 has 9 stalls but the container was paused 6 times: 3 are not the kernel's. Window 2's 4 are.
    const j = judgeSystemWindowsP95([win(spread(9), 6, 1), win(spread(4), 6, 2)], 28);
    expect(j.index).toBe(1);
    // With no window whose stalls are all excused, the one with the fewest past its excuse is judged, and fails.
    const k = judgeSystemWindowsP95([win(spread(9), 6), win(spread(5), 0)], 28);
    expect(k.index).toBe(0);
    expect(k.stalls).toBeGreaterThan(k.excused);
  });
});
