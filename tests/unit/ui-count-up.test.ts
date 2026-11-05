import { describe, expect, it } from "vitest";
import { CountUp, countUpSteps } from "../../src/ui/count-up";

const int = (n: number) => String(Math.round(n));

describe("count up", () => {
  it("starts at the first value, ends exactly at the last, never goes back", () => {
    const s = countUpSteps(0, 14, 24, int);
    expect(s[0]).toBe("0");
    expect(s.at(-1)).toBe("14");
    const nums = s.map(Number);
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThan(nums[i - 1] as number);
  });

  it("has no repeated frames and at most the step count", () => {
    const s = countUpSteps(1000, 1016, 24, int);
    expect(new Set(s).size).toBe(s.length);
    expect(s.length).toBeLessThanOrEqual(24);
    expect(s.length).toBe(17);
  });

  it("counts down too (a value going down)", () => {
    const s = countUpSteps(1016, 1004, 24, int);
    expect(s[0]).toBe("1016");
    expect(s.at(-1)).toBe("1004");
  });

  it("formats times in tenths", () => {
    const s = countUpSteps(0, 83.4, 30, (v) => `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, "0")}`);
    expect(s.at(-1)).toBe("1:23.4");
    expect(s.length).toBe(30);
  });

  it("a single value is one step", () => {
    expect(countUpSteps(5, 5, 24, int)).toEqual(["5"]);
  });

  it("plays its steps over the duration, eased (fast first)", () => {
    const c = new CountUp();
    c.start(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], 900, 0);
    expect(c.text).toBe("0");
    let changes = 0;
    let shown = c.text;
    const step = () => {
      c.step(1 / 90);
      if (c.text !== shown) changes++;
      shown = c.text;
    };
    for (let i = 0; i < 30; i++) step();
    expect(Number(c.text)).toBeGreaterThan(4); // a third of the time, past half of the values
    for (let i = 0; i < 200; i++) step();
    expect(c.text).toBe("9");
    expect(c.done).toBe(true);
    expect(changes).toBe(9);
  });

  it("waits for its delay and can jump to the end", () => {
    const c = new CountUp();
    c.start(["0", "5", "10"], 900, 0.3);
    for (let i = 0; i < 20; i++) c.step(1 / 90);
    expect(c.text).toBe("0");
    c.finish();
    expect(c.text).toBe("10");
    expect(c.done).toBe(true);
  });
});

describe("count up progress", () => {
  it("goes from 0 at the first value to 1 when it lands (for a rising tick)", () => {
    const c = new CountUp();
    c.start(countUpSteps(0, 20, 24, int), 900, 0);
    expect(c.progress).toBe(0);
    let last = 0;
    while (!c.done) {
      c.step(1 / 72);
      expect(c.progress).toBeGreaterThanOrEqual(last);
      last = c.progress;
    }
    expect(c.progress).toBe(1);
    // Nothing to count: landed at once.
    c.start(["7"], 900, 0);
    expect(c.done).toBe(true);
    expect(c.progress).toBe(1);
  });
});

describe("count up landing", () => {
  it("reports the landing even when the last value already showed a frame early", () => {
    const c = new CountUp();
    c.start(countUpSteps(1000, 1012, 24, int), 900, 0);
    // A hair before the time is up: the eased index is already the last one.
    expect(c.step(0.9 - 1e-12)).toBe(true);
    expect(c.text).toBe("1012");
    expect(c.done).toBe(false);
    // Time up: nothing new to show, but it landed.
    expect(c.step(1 / 72)).toBe(true);
    expect(c.done).toBe(true);
    expect(c.step(1 / 72)).toBe(false);
  });
});
