import { describe, expect, it } from "vitest";
import { KeyMotion } from "../../src/ui/keys";
import { MOTION, settledAt, stepSpring, stepToward, type SpringState } from "../../src/ui/motion";
import { PanelMotion } from "../../src/ui/transitions";

const run = (n: number, fn: () => void) => {
  for (let i = 0; i < n; i++) fn();
};

describe("springs", () => {
  it("a crisp spring reaches its target quickly without overshoot", () => {
    const s: SpringState = { x: 0, v: 0 };
    let max = 0;
    run(12, () => {
      stepSpring(s, 1, MOTION.key.down, 1 / 90);
      max = Math.max(max, s.x);
    });
    expect(s.x).toBeGreaterThan(0.97);
    expect(max).toBeLessThan(1.01);
  });

  it("a bouncy spring overshoots and settles", () => {
    const s: SpringState = { x: 0, v: 0 };
    let max = 0;
    run(90, () => {
      stepSpring(s, 1, MOTION.key.up, 1 / 90);
      max = Math.max(max, s.x);
    });
    expect(max).toBeGreaterThan(1.05);
    expect(settledAt(s, 1)).toBe(true);
  });

  it("is stable with a long frame, which counts as at most 100 ms", () => {
    const s: SpringState = { x: 0, v: 0 };
    stepSpring(s, 1, MOTION.key.down, 5);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeGreaterThan(0.85);
    expect(s.x).toBeLessThan(1.01);
  });

  it("reduced motion moves in a straight line and arrives in 40 ms", () => {
    const s: SpringState = { x: 0, v: 0 };
    stepToward(s, 6, MOTION.key.up, 0.02, true, 6);
    expect(s.x).toBeCloseTo(3, 5);
    stepToward(s, 6, MOTION.key.up, 0.02, true, 6);
    expect(s.x).toBe(6);
    stepToward(s, 6, MOTION.key.up, 0.02, true, 6);
    expect(s.x).toBe(6);
    expect(MOTION.reducedMs).toBe(40);
  });
});

describe("key motion", () => {
  const frames = (k: KeyMotion, n: number, reduced = false) => run(n, () => k.step(1 / 90, reduced));

  it("rests proud of the plate and travels 6 mm when pressed", () => {
    const k = new KeyMotion();
    expect(k.capZ).toBe(MOTION.key.restMm);
    k.setDown(true);
    frames(k, 30);
    expect(MOTION.key.travelMm).toBe(6);
    expect(k.capZ).toBeCloseTo(MOTION.key.restMm - MOTION.key.travelMm, 2);
  });

  it("glows on hover and lifts a little", () => {
    const k = new KeyMotion();
    k.setHover(true);
    frames(k, 40);
    expect(k.glow).toBeGreaterThan(0.9);
    expect(k.capZ).toBeGreaterThan(MOTION.key.restMm);
    k.setHover(false);
    frames(k, 90);
    expect(k.glow).toBeLessThan(0.02);
  });

  it("pops back past rest with a squash on release, then sleeps", () => {
    const k = new KeyMotion();
    k.setDown(true);
    frames(k, 30);
    k.setDown(false, true);
    let maxZ = 0;
    let maxSquash = 0;
    run(40, () => {
      k.step(1 / 90, false);
      maxZ = Math.max(maxZ, k.capZ);
      maxSquash = Math.max(maxSquash, Math.abs(k.scaleX - 1));
    });
    expect(maxZ).toBeGreaterThan(MOTION.key.restMm + 0.3);
    expect(maxSquash).toBeGreaterThan(0.02);
    frames(k, 200);
    expect(k.active).toBe(false);
    expect(k.capZ).toBeCloseTo(MOTION.key.restMm, 2);
    expect(k.scaleX).toBeCloseTo(1, 3);
    expect(k.scaleY).toBeCloseTo(1, 3);
  });

  it("with reduced motion there is no squash and the press lands in 40 ms", () => {
    const k = new KeyMotion();
    k.setDown(true);
    run(4, () => k.step(0.01, true));
    expect(k.capZ).toBeCloseTo(MOTION.key.restMm - MOTION.key.travelMm, 5);
    k.setDown(false, true);
    let maxSquash = 0;
    run(6, () => {
      k.step(0.01, true);
      maxSquash = Math.max(maxSquash, Math.abs(k.scaleX - 1));
    });
    expect(maxSquash).toBe(0);
    expect(k.capZ).toBeCloseTo(MOTION.key.restMm, 5);
  });

  it("a latched toggle rests half way down; letting go of the pointers keeps the springs going", () => {
    const k = new KeyMotion();
    k.latched = true;
    frames(k, 60);
    expect(k.capZ).toBeCloseTo(MOTION.key.restMm - MOTION.key.travelMm / 2, 2);
    k.setHover(true);
    k.setDown(true);
    k.release();
    expect(k.hovered).toBe(false);
    expect(k.pressed).toBe(false);
    expect(k.active).toBe(true);
    k.latched = false;
    frames(k, 200);
    expect(k.capZ).toBeCloseTo(MOTION.key.restMm, 2);
    expect(k.active).toBe(false);
  });

  it("runs the key's action a moment after the click, so the pop is seen first", () => {
    const K = MOTION.key;
    const k = new KeyMotion();
    expect(K.actionDelayS).toBeGreaterThanOrEqual(0.1);
    expect(K.actionDelayS).toBeLessThanOrEqual(0.15);
    expect(k.actionDue(0.05)).toBe(false);
    k.queueAction();
    expect(k.pendingAction).toBe(true);
    expect(k.actionDue(0.05)).toBe(false);
    expect(k.actionDue(0.05)).toBe(false);
    expect(k.actionDue(0.05)).toBe(true);
    expect(k.pendingAction).toBe(false);
    expect(k.actionDue(0.05)).toBe(false);
  });

  it("counts several pointers so one leaving does not end the hover", () => {
    const k = new KeyMotion();
    expect(k.setHover(true)).toBe(true);
    expect(k.setHover(true)).toBe(false);
    k.setHover(false);
    expect(k.hovered).toBe(true);
    k.setHover(false);
    k.setHover(false);
    expect(k.hovered).toBe(false);
  });
});

describe("panel motion", () => {
  it("enters with a small overshoot and settles fully shown", () => {
    const p = new PanelMotion();
    expect(p.visible).toBe(false);
    p.enter(0);
    expect(p.visible).toBe(true);
    let maxScale = 0;
    let steps = 0;
    while (p.step(1 / 90, false) && steps < 400) {
      maxScale = Math.max(maxScale, p.scale);
      steps++;
    }
    expect(maxScale).toBeGreaterThan(1.005);
    expect(steps).toBeLessThan(90); // under a second
    expect(p.scale).toBeCloseTo(1, 3);
    expect(p.opacity).toBe(1);
    expect(p.liftMm).toBeCloseTo(0, 2);
  });

  it("starts lower, smaller and faded (no instant pop)", () => {
    const p = new PanelMotion();
    p.enter(0);
    p.step(1 / 90, false);
    expect(p.scale).toBeLessThan(0.95);
    expect(p.opacity).toBeLessThan(0.5);
    expect(p.liftMm).toBeLessThan(-5);
  });

  it("waits for its delay before entering", () => {
    const p = new PanelMotion();
    p.enter(0.1);
    run(5, () => p.step(1 / 90, false));
    expect(p.opacity).toBe(0);
    run(30, () => p.step(1 / 90, false));
    expect(p.opacity).toBeGreaterThan(0.5);
  });

  it("exits quickly and hides", () => {
    const p = new PanelMotion();
    p.show();
    p.exit();
    let steps = 0;
    while (p.step(1 / 90, false) && steps < 400) steps++;
    expect(steps).toBeLessThan(30);
    expect(p.visible).toBe(false);
  });

  it("with reduced motion only fades, in 40 ms", () => {
    const p = new PanelMotion();
    p.enter(0);
    let steps = 0;
    while (p.step(0.01, true) && steps < 100) {
      expect(p.scale).toBe(1);
      expect(p.liftMm).toBe(0);
      steps++;
    }
    expect(steps).toBeLessThanOrEqual(5);
    expect(p.opacity).toBe(1);
  });
});
