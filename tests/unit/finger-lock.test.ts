import { describe, expect, it } from "vitest";
import { FingerLockLoop, type FingerLockState } from "../../src/app/finger-lock";
import type { Coverage } from "../../src/core/solve";
import { FINGER_GRACE_MS, FINGER_HOLD_MS } from "../../src/feel/constants";

const DT = 1000 / 72;
/** Scraps in place and the finger filling the gap; the same without the finger; the scraps scattered. */
const FILLED: Coverage = { cover: 0.97, spill: 0.05, spillAll: 0.2, gap: 0.9 };
const SHORT: Coverage = { cover: 0.97, spill: 0.05, spillAll: 0.05, gap: 0.1 };
const SCATTERED: Coverage = { cover: 0.5, spill: 0.05, spillAll: 0.2, gap: 1 };
/** Frames of DT it takes to hold for FINGER_HOLD_MS: 44 at 72 Hz (43 frames are 597 ms). */
const HOLD_FRAMES = Math.ceil(FINGER_HOLD_MS / DT);

function loop() {
  let done = 0;
  const l = new FingerLockLoop(() => {
    done++;
    return Promise.resolve();
  });
  const run = (frames: number, c: Coverage, tracked = true): FingerLockState[] => {
    const out: FingerLockState[] = [];
    for (let i = 0; i < frames; i++) out.push(l.update(DT, c, tracked));
    return out;
  };
  return { l, run, done: () => done };
}

describe("FingerLockLoop", () => {
  it("opens 600 ms after the finger fills the gap, crystallises once, and stays open", () => {
    expect(HOLD_FRAMES).toBe(44);
    const { l, run, done } = loop();
    expect(l.state).toBe("idle");
    const s = run(HOLD_FRAMES, FILLED);
    expect(s.slice(0, HOLD_FRAMES - 1).every((x) => x === "holding")).toBe(true);
    expect(s[HOLD_FRAMES - 1]).toBe("done");
    expect(l.open).toBe(true);
    expect(l.progress).toBe(1);
    expect(done()).toBe(1);
    expect(l.crystal).toBeInstanceOf(Promise);
    // The hand leaves, the gap empties, tracking goes: the lock stays open, and crystallises only once.
    expect(run(100, SHORT, false).every((x) => x === "done")).toBe(true);
    expect(run(10, FILLED).every((x) => x === "done")).toBe(true);
    expect(done()).toBe(1);
  });

  it("counts only with the scraps in place", () => {
    const { l, run, done } = loop();
    expect(run(200, SCATTERED).every((x) => x === "idle")).toBe(true);
    expect(run(200, SHORT).every((x) => x === "idle")).toBe(true);
    expect(l.progress).toBe(0);
    expect(done()).toBe(0);
  });

  it("a slip under 100 ms pauses the hold; a longer one starts it over", () => {
    let { l, run } = loop();
    run(22, FILLED);
    expect(run(5, SHORT).every((x) => x === "holding")).toBe(true); // 69 ms out of the gap
    const progress = l.progress;
    expect(progress).toBeCloseTo((22 * DT) / FINGER_HOLD_MS, 9);
    // The count carries on from where it was.
    expect(run(HOLD_FRAMES - 22, FILLED).at(-1)).toBe("done");

    ({ l, run } = loop());
    run(22, FILLED);
    const slip = run(Math.ceil(FINGER_GRACE_MS / DT) + 1, SHORT);
    expect(slip.at(-1)).toBe("idle");
    expect(l.progress).toBe(0);
    // From zero again: a full 600 ms.
    expect(run(HOLD_FRAMES - 1, FILLED).every((x) => x === "holding")).toBe(true);
    expect(run(1, FILLED)[0]).toBe("done");
  });

  it("tracking lost resets the finger hold, and a stale finger pose never counts", () => {
    const { l, run, done } = loop();
    run(30, FILLED);
    expect(l.state).toBe("holding");
    // Out of tracking: the last coverage would still fill the gap, but a hand that is not seen never counts.
    const lost = run(10, FILLED, false);
    expect(lost.includes("done")).toBe(false);
    expect(lost.at(-1)).toBe("idle");
    expect(l.progress).toBe(0);
    expect(done()).toBe(0);
    // Back in tracking with the finger in place: the full hold again.
    expect(run(HOLD_FRAMES - 1, FILLED).every((x) => x === "holding")).toBe(true);
    expect(run(1, FILLED)[0]).toBe("done");
    expect(done()).toBe(1);
  });

  it("a one-frame tracking blip does not reset it", () => {
    const { l, run } = loop();
    run(30, FILLED);
    expect(run(1, FILLED, false)[0]).toBe("holding");
    expect(l.progress).toBeCloseTo((30 * DT) / FINGER_HOLD_MS, 9);
    expect(run(HOLD_FRAMES - 31, FILLED).at(-1)).toBe("holding");
    expect(run(1, FILLED)[0]).toBe("done");
  });
});
