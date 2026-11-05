// The shared finger-follow key (src/render/finger-key.ts), as the menus use it: the shared rules,
// plus the cases a menu key adds (latched toggles, the key's cap motion).
import { describe, expect, it } from "vitest";
import { FINGER_KEY, FingerKey, KEY_EVENT, nearestFinger } from "../../src/render/finger-key";
import { KeyMotion } from "../../src/ui/keys";
import { MOTION } from "../../src/ui/motion";

const TRAVEL = 0.005;
const R = FINGER_KEY.fingerRadius;

function drive(k: FingerKey, dists: number[], inside = true): number[] {
  const out: number[] = [];
  for (const d of dists) {
    k.dist = d;
    k.inside = inside;
    const e = k.step();
    if (e !== KEY_EVENT.none) out.push(e);
  }
  return out;
}

function poke(deepest: number): number[] {
  const d: number[] = [];
  for (let x = 0.05; x > deepest; x -= 0.001) d.push(x);
  for (let x = deepest; x < 0.05; x += 0.001) d.push(x);
  return d;
}

describe("finger-follow key (shared rules)", () => {
  it("does nothing until the finger touches the cap, then travels with it", () => {
    const k = new FingerKey(TRAVEL);
    drive(k, [0.05, 0.02, R + 0.0005]);
    expect(k.depth).toBe(0);
    expect(k.pressed).toBe(false);
    drive(k, [R - 0.002]);
    expect(k.depth).toBeCloseTo(0.002, 9);
    drive(k, [-0.02]);
    expect(k.depth).toBe(TRAVEL);
  });

  it("presses at 80 % travel and acts on the way back out, past rest + 3 mm", () => {
    const k = new FingerKey(TRAVEL);
    const seen: Array<[number, number]> = [];
    for (const d of poke(-0.004)) {
      k.dist = d;
      k.inside = true;
      const e = k.step();
      if (e === KEY_EVENT.press || e === KEY_EVENT.click) seen.push([e, d]);
    }
    expect(seen.map((s) => s[0])).toEqual([KEY_EVENT.press, KEY_EVENT.click]);
    expect(seen[0]![1]).toBeLessThanOrEqual(R - FINGER_KEY.pressAt * TRAVEL + 1e-9);
    expect(seen[0]![1]).toBeGreaterThan(R - FINGER_KEY.pressAt * TRAVEL - 0.0011);
    expect(seen[1]![1]).toBeGreaterThanOrEqual(R + FINGER_KEY.rearm - 1e-9);
  });

  it("does not press on a touch that stops short of 80 %", () => {
    const k = new FingerKey(TRAVEL);
    expect(drive(k, poke(R - 0.6 * TRAVEL)).filter((e) => e === KEY_EVENT.press)).toEqual([]);
  });

  it("gives one press for a finger that jitters at the bottom (no re-arm without backing out)", () => {
    const k = new FingerKey(TRAVEL);
    const jitter = [0.02, R - 0.0045, R - 0.003, R - 0.0046, R - 0.0025, R - 0.0048, R - 0.001, R - 0.0045];
    expect(drive(k, jitter).filter((e) => e === KEY_EVENT.press)).toHaveLength(1);
  });

  it("gives two presses for two full pokes", () => {
    const k = new FingerKey(TRAVEL);
    const events = drive(k, [...poke(-0.003), ...poke(-0.003)]);
    expect(events.filter((e) => e === KEY_EVENT.press)).toHaveLength(2);
    expect(events.filter((e) => e === KEY_EVENT.click)).toHaveLength(2);
  });

  it("cancels without acting when the finger slides off while pressed", () => {
    const k = new FingerKey(TRAVEL);
    const events = [...drive(k, [0.02, 0.005, 0.0]), ...drive(k, [0.0, 0.01, 0.03], false)];
    expect(events).toEqual([KEY_EVENT.hoverIn, KEY_EVENT.press, KEY_EVENT.cancel]);
    expect(k.depth).toBe(0);
  });

  it("lets go when tracking is lost (no click, no stuck cap)", () => {
    const k = new FingerKey(TRAVEL);
    const events = drive(k, [0.02, 0.0, Number.NaN]);
    expect(events).toEqual([KEY_EVENT.hoverIn, KEY_EVENT.press, KEY_EVENT.cancel]);
    expect(k.pressed).toBe(false);
    expect(k.depth).toBe(0);
  });

  it("cannot be pressed by a finger already behind the cap or sliding in from the side", () => {
    const acts = (e: number[]) => e.filter((x) => x === KEY_EVENT.press || x === KEY_EVENT.click);
    const k = new FingerKey(TRAVEL);
    expect(acts(drive(k, [-0.004, -0.002, 0.0, 0.004, 0.02]))).toEqual([]);
    const j = new FingerKey(TRAVEL);
    expect(acts([...drive(j, [-0.004, -0.004], false), ...drive(j, [-0.004, -0.003, 0.02])])).toEqual([]);
    expect(drive(j, poke(-0.003)).filter((e) => e === KEY_EVENT.press)).toHaveLength(1);
  });

  it("sliding low from one key onto the next does not press the next one", () => {
    const a = new FingerKey(TRAVEL);
    const b = new FingerKey(TRAVEL);
    // Pressed on a, then the finger slides sideways at the same depth: off a, onto b.
    drive(a, [0.02, 0.0]);
    drive(b, [0.0], false);
    expect(drive(a, [0.0], false)).toEqual([KEY_EVENT.cancel]);
    expect(drive(b, [0.0, -0.001]).filter((e) => e === KEY_EVENT.press || e === KEY_EVENT.click)).toEqual([]);
    expect(b.depth).toBe(TRAVEL);
  });

  it("hovers a fingertip within 3 cm in front of the cap", () => {
    const k = new FingerKey(TRAVEL);
    expect(drive(k, [0.06, R + 0.035])).toEqual([]);
    expect(drive(k, [R + 0.02])).toEqual([KEY_EVENT.hoverIn]);
    expect(k.hovered).toBe(true);
  });
});

describe("a menu key's cap on the finger", () => {
  const K = MOTION.key;
  const mm = 0.001;
  const RMM = FINGER_KEY.fingerRadius / mm;
  const frames = (k: KeyMotion, n: number) => {
    for (let i = 0; i < n; i++) k.step(1 / 90, false);
  };
  /** Fingertip centre `fromPlate` mm in front of the plate, over the key; returns the event. */
  const at = (k: KeyMotion, fromPlate: number, inside = true) => {
    k.finger.dist = (fromPlate - k.restZ) * mm;
    k.finger.inside = inside;
    return k.stepFinger();
  };

  it("follows the finger: the cap top sits under the finger pad, never past full travel", () => {
    const k = new KeyMotion();
    at(k, 40);
    at(k, K.restMm + RMM - 2);
    frames(k, 40);
    expect(k.capZ).toBeCloseTo(K.restMm - 2, 1);
    at(k, -20);
    frames(k, 40);
    expect(k.capZ).toBeCloseTo(K.restMm - K.travelMm, 1);
  });

  it("clicks at 80 % of the remaining travel when latched (rest 5 mm, stop 2 mm: click at 2.6 mm)", () => {
    const k = new KeyMotion();
    k.latched = true;
    expect(k.restZ).toBe(5);
    at(k, 40);
    // Cap top at 2.7 mm: not yet.
    expect(at(k, 2.7 + RMM)).toBe(KEY_EVENT.none);
    expect(at(k, 2.55 + RMM)).toBe(KEY_EVENT.press);
  });

  it("pops back past rest with a squash when the finger backs out after a click", () => {
    const k = new KeyMotion();
    at(k, 40);
    expect(at(k, 0)).toBe(KEY_EVENT.press);
    frames(k, 30);
    expect(at(k, 40)).toBe(KEY_EVENT.click);
    let maxZ = 0;
    let maxSquash = 0;
    for (let i = 0; i < 40; i++) {
      k.step(1 / 90, false);
      maxZ = Math.max(maxZ, k.capZ);
      maxSquash = Math.max(maxSquash, Math.abs(k.scaleX - 1));
    }
    expect(maxZ).toBeGreaterThan(K.restMm + 0.3);
    expect(maxSquash).toBeGreaterThan(0.02);
  });

  it("a cap pushed half way goes home when tracking is lost", () => {
    const k = new KeyMotion();
    at(k, 40);
    at(k, K.restMm + RMM - 3);
    frames(k, 30);
    expect(k.capZ).toBeLessThan(K.restMm - 2);
    k.finger.dist = Number.NaN;
    k.stepFinger();
    frames(k, 90);
    expect(k.capZ).toBeCloseTo(K.restMm, 1);
    expect(k.touched).toBe(false);
  });

  it("counts as touched only within 3 cm in front of the cap and over it", () => {
    const k = new KeyMotion();
    at(k, 80);
    expect(k.touched).toBe(false);
    at(k, 30);
    expect(k.touched).toBe(true);
    at(k, 30, false);
    expect(k.touched).toBe(false);
  });
});

describe("which fingertip drives a key", () => {
  const T = 0.006;
  it("ignores a fingertip more than the travel and 10 mm behind the face (a hand resting under the panel)", () => {
    expect(nearestFinger(1, [-0.017], [1], T)).toBeNaN();
    expect(nearestFinger(1, [-0.015], [1], T)).toBeCloseTo(-0.015, 9);
  });

  it("a hand under the panel never wins over a real finger in front", () => {
    expect(nearestFinger(2, [-0.05, 0.004], [1, 1], T)).toBeCloseTo(0.004, 9);
  });

  it("counts only fingertips over the key; the nearest one drives it", () => {
    expect(nearestFinger(2, [0.001, 0.02], [0, 1], T)).toBeCloseTo(0.02, 9);
    expect(nearestFinger(2, [0.01, 0.003], [1, 1], T)).toBeCloseTo(0.003, 9);
    expect(nearestFinger(0, [], [], T)).toBeNaN();
  });

  it("a poke gone more than 16 mm past the face cancels the press, like every fingertip key", () => {
    const k = new FingerKey(T);
    const seen: number[] = [];
    for (const d of [0.03, 0.0, -0.01, -0.017]) {
      k.dist = nearestFinger(1, [d], [1], T);
      k.inside = k.dist === k.dist;
      const e = k.step();
      if (e !== KEY_EVENT.none) seen.push(e);
    }
    expect(seen).toEqual([KEY_EVENT.hoverIn, KEY_EVENT.press, KEY_EVENT.cancel]);
  });
});
