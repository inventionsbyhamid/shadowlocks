import { describe, expect, it } from "vitest";
import { FINGER_KEY, FingerKey, KEY_EVENT } from "../../src/render/finger-key";

const TRAVEL = 0.005;
const R = FINGER_KEY.fingerRadius;

/** Move the fingertip through `dists` (over the key unless `inside` says not), collecting events. */
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

/** A straight poke: from 5 cm out to `deepest`, and back out to 5 cm, in 1 mm steps. */
function poke(deepest: number): number[] {
  const d: number[] = [];
  for (let x = 0.05; x > deepest; x -= 0.001) d.push(x);
  for (let x = deepest; x < 0.05; x += 0.001) d.push(x);
  return d;
}

describe("finger-follow key", () => {
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
    // Press: the cap is 80 % down (finger centre R - 0.8 * travel from the rest face).
    expect(seen[0]![1]).toBeLessThanOrEqual(R - FINGER_KEY.pressAt * TRAVEL + 1e-9);
    expect(seen[0]![1]).toBeGreaterThan(R - FINGER_KEY.pressAt * TRAVEL - 0.0011);
    // Click: back out to 3 mm past the rest face (finger surface).
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
    // The key appears around a fingertip that is already past its face, which then pulls back out.
    expect(acts(drive(k, [-0.004, -0.002, 0.0, 0.004, 0.02]))).toEqual([]);
    // A fingertip behind the face slides in from the side.
    const j = new FingerKey(TRAVEL);
    expect(acts([...drive(j, [-0.004, -0.004], false), ...drive(j, [-0.004, -0.003, 0.02])])).toEqual([]);
    // From in front, the same key presses as usual.
    expect(drive(j, poke(-0.003)).filter((e) => e === KEY_EVENT.press)).toHaveLength(1);
  });

  it("hovers a fingertip within 3 cm in front of the cap", () => {
    const k = new FingerKey(TRAVEL);
    expect(drive(k, [0.06, R + 0.035])).toEqual([]);
    expect(drive(k, [R + 0.02])).toEqual([KEY_EVENT.hoverIn]);
    expect(k.hovered).toBe(true);
  });
});
