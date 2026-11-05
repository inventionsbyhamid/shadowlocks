import { describe, expect, it } from "vitest";
import { FingerHold } from "../../src/feel/finger-hold";
import { GazeFocus } from "../../src/feel/gaze-focus";
import { StuckWatch } from "../../src/feel/stuck-watch";

const DT = 1000 / 90;

/** `frames` updates of the finger hold; returns the last state. */
function hold(h: FingerHold, frames: number, meets: boolean, tracked = true) {
  let s = h.update(DT, meets, tracked);
  for (let i = 1; i < frames; i++) s = h.update(DT, meets, tracked);
  return s;
}

function gaze(g: GazeFocus, frames: number, hit: number | null) {
  let f = g.update(DT, hit);
  for (let i = 1; i < frames; i++) f = g.update(DT, hit);
  return f;
}

function watch(s: StuckWatch, frames: number, warmth: number, opened = false) {
  let r = s.update(DT, warmth, opened);
  for (let i = 1; i < frames; i++) r = s.update(DT, warmth, false);
  return r;
}

describe("FingerHold", () => {
  it("is done after 600 ms", () => {
    const h = new FingerHold();
    expect(h.update(DT, false, true)).toBe("idle");
    expect(h.progress).toBe(0);
    expect(hold(h, 53, true)).toBe("holding"); // 589 ms
    expect(h.progress).toBeCloseTo(53 / 54, 9);
    expect(hold(h, 1, true)).toBe("done"); // 600 ms
    expect(h.progress).toBe(1);
    expect(hold(h, 30, true)).toBe("done");
  });

  it("survives an 80 ms drop", () => {
    const h = new FingerHold();
    expect(hold(h, 30, true)).toBe("holding");
    const before = h.progress;
    expect(hold(h, 7, false)).toBe("holding"); // 78 ms without the finger in place
    expect(h.progress).toBe(before);
    expect(hold(h, 23, true)).toBe("holding");
    expect(hold(h, 1, true)).toBe("done"); // 54 frames in place in all
  });

  it("resets on a 150 ms drop", () => {
    const h = new FingerHold();
    hold(h, 30, true);
    expect(hold(h, 14, false)).toBe("idle"); // 156 ms
    expect(h.progress).toBe(0);
    expect(hold(h, 30, true)).toBe("holding");
    expect(hold(h, 23, true)).toBe("holding"); // starts again from zero
    expect(hold(h, 1, true)).toBe("done");
  });

  it("resets on tracked: false", () => {
    const h = new FingerHold();
    hold(h, 50, true);
    expect(h.update(DT, true, false)).toBe("idle");
    expect(h.progress).toBe(0);
    expect(hold(h, 53, true)).toBe("holding");
    expect(hold(h, 1, true)).toBe("done");
    expect(h.update(DT, true, false)).toBe("idle"); // even once done
  });
});

describe("GazeFocus", () => {
  it("switches after 400 ms only", () => {
    const g = new GazeFocus();
    expect(gaze(g, 35, 0)).toBeNull(); // 389 ms
    expect(gaze(g, 1, 0)).toBe(0); // 400 ms
    expect(gaze(g, 60, null)).toBe(0); // looking away keeps the focus
    expect(gaze(g, 35, 1)).toBe(0);
    expect(gaze(g, 1, 1)).toBe(1);
    expect(gaze(g, 30, 2)).toBe(1); // a glance at lock 2...
    expect(gaze(g, 1, 1)).toBe(1); // ...back to 1 restarts the dwell
    expect(gaze(g, 35, 2)).toBe(1);
    expect(gaze(g, 1, null)).toBe(1); // so does looking away
    expect(gaze(g, 35, 2)).toBe(1);
    expect(gaze(g, 1, 2)).toBe(2);
  });
});

describe("StuckWatch", () => {
  it("is true after 90 s without progress", () => {
    const s = new StuckWatch();
    expect(watch(s, 8090, 0)).toBe(false); // 89.9 s
    expect(watch(s, 20, 0)).toBe(true); // 90.1 s
    expect(watch(s, 900, 0.05)).toBe(true); // +0.05 is not progress
  });

  it("is reset by a 0.1 warmth gain", () => {
    const s = new StuckWatch();
    expect(watch(s, 8090, 0.3)).toBe(false); // 0 -> 0.3 on the first frame was progress: 89.9 s since
    expect(watch(s, 20, 0.3)).toBe(true);
    expect(watch(s, 1, 0.4)).toBe(false);
    expect(watch(s, 8090, 0.45)).toBe(false);
    expect(watch(s, 20, 0.2)).toBe(true); // falling back is not progress either
    expect(watch(s, 1, 0.2, true)).toBe(false); // a lock opening resets it too
    expect(watch(s, 8090, 0.25)).toBe(false);
    expect(watch(s, 20, 0.25)).toBe(true);
  });
});
