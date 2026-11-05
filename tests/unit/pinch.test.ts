import { describe, expect, it } from "vitest";
import { PINCH_END_M, PINCH_START_M, TRACKING_GRACE_MS } from "../../src/input/constants";
import { PinchDetector } from "../../src/input/pinch";

const mm = (x: number) => x / 1000;
const F = 1000 / 72;

describe("PinchDetector hysteresis", () => {
  it("uses 15 mm to start and 30 mm to end", () => {
    expect(PINCH_START_M).toBe(0.015);
    expect(PINCH_END_M).toBe(0.03);
  });

  it("starts at 14 mm, holds at 20 mm, ends at 31 mm", () => {
    const p = new PinchDetector();
    expect(p.update(0, true, mm(40), false)).toBeNull();
    expect(p.active).toBe(false);
    expect(p.update(F, true, mm(14), false)).toBe("start");
    expect(p.active).toBe(true);
    expect(p.update(2 * F, true, mm(20), false)).toBeNull();
    expect(p.active).toBe(true);
    expect(p.update(3 * F, true, mm(31), false)).toBeNull(); // open for one frame: not yet
    expect(p.update(4 * F, true, mm(31), false)).toBe("end");
    expect(p.active).toBe(false);
  });

  it("one open frame (an occlusion spike) does not end a pinch", () => {
    const p = new PinchDetector();
    p.update(0, true, mm(10), false);
    expect(p.update(F, true, mm(45), false)).toBeNull();
    expect(p.update(2 * F, true, mm(12), false)).toBeNull();
    expect(p.update(3 * F, true, mm(45), false)).toBeNull();
    expect(p.update(4 * F, true, mm(12), false)).toBeNull();
    expect(p.active).toBe(true);
  });

  it("does not start between the thresholds, and starts and ends exactly on them", () => {
    const p = new PinchDetector();
    expect(p.update(0, true, mm(20), false)).toBeNull();
    expect(p.update(F, true, mm(15.5), false)).toBeNull();
    expect(p.update(2 * F, true, mm(15), false)).toBe("start");
    expect(p.update(3 * F, true, mm(29.9), false)).toBeNull();
    expect(p.update(4 * F, true, mm(30), false)).toBeNull();
    expect(p.update(5 * F, true, mm(30), false)).toBe("end");
  });

  it("lets the runtime's own pinch start it while the fingertips are under 30 mm apart", () => {
    const p = new PinchDetector();
    expect(p.update(0, true, mm(35), true)).toBeNull();
    expect(p.update(F, true, mm(22), true)).toBe("start");
  });

  it("keeps holding when the runtime lets go but the fingertips are still close", () => {
    const p = new PinchDetector();
    p.update(0, true, mm(10), true);
    expect(p.update(F, true, mm(22), false)).toBeNull();
    expect(p.active).toBe(true);
  });

  it("follows the runtime's pinch on a tracked hand without joint data", () => {
    const p = new PinchDetector();
    expect(p.update(0, true, Number.NaN, false)).toBeNull();
    expect(p.update(F, true, Number.NaN, true)).toBe("start");
    expect(p.update(2 * F, true, Number.NaN, true)).toBeNull();
    expect(p.update(3 * F, true, Number.NaN, false)).toBeNull();
    expect(p.update(4 * F, true, Number.NaN, false)).toBe("end");
  });
});

describe("PinchDetector across tracking loss", () => {
  it("keeps a pinch through a short loss and asks to resume it", () => {
    const p = new PinchDetector();
    p.update(0, true, mm(10), true);
    expect(p.update(F, false, Number.NaN, false)).toBeNull();
    expect(p.update(100, false, Number.NaN, false)).toBeNull();
    expect(p.active).toBe(true);
    expect(p.update(100 + F, true, mm(12), true)).toBe("resume");
    expect(p.active).toBe(true);
    expect(p.update(100 + 2 * F, true, mm(12), true)).toBeNull();
  });

  it("ends a pinch whose hand comes back open after a short loss at once (never resumes it)", () => {
    const p = new PinchDetector();
    p.update(0, true, mm(10), true);
    p.update(F, false, Number.NaN, false);
    expect(p.update(80, true, mm(45), false)).toBe("end");
    expect(p.active).toBe(false);
  });

  it("cancels a pinch lost for more than 150 ms, then waits for an open hand", () => {
    const p = new PinchDetector();
    p.update(0, true, mm(10), true);
    expect(p.update(F, false, Number.NaN, false)).toBeNull();
    expect(p.update(F + TRACKING_GRACE_MS, false, Number.NaN, false)).toBeNull();
    expect(p.update(F + TRACKING_GRACE_MS + 1, false, Number.NaN, false)).toBe("cancel");
    expect(p.active).toBe(false);
    // Back still pinched: no new pinch until the hand opens.
    expect(p.update(400, true, mm(8), true)).toBeNull();
    expect(p.update(400 + F, true, mm(8), true)).toBeNull();
    expect(p.active).toBe(false);
    expect(p.update(400 + 2 * F, true, mm(35), false)).toBeNull();
    expect(p.update(400 + 3 * F, true, mm(10), false)).toBe("start");
  });

  it("a hand lost while open is just a hand again when it returns", () => {
    const p = new PinchDetector();
    p.update(0, true, mm(50), false);
    p.update(F, false, Number.NaN, false);
    expect(p.update(500, false, Number.NaN, false)).toBeNull();
    expect(p.update(600, true, mm(10), false)).toBe("start");
  });

  it("reset forgets everything", () => {
    const p = new PinchDetector();
    p.update(0, true, mm(10), false);
    p.reset();
    expect(p.active).toBe(false);
    expect(p.update(F, true, mm(10), false)).toBe("start");
  });
});
