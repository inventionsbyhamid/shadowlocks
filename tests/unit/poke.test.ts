import { describe, expect, it } from "vitest";
import { POKE_PRESS_M, POKE_REARM_M, PRESS_DEBOUNCE_MS } from "../../src/input/constants";
import { PokeTracker, PressGate } from "../../src/input/poke";

const mm = (x: number) => x / 1000;

describe("PressGate", () => {
  it("lets a press through only after 150 ms without any click", () => {
    expect(PRESS_DEBOUNCE_MS).toBe(150);
    const g = new PressGate();
    expect(g.accept(1000)).toBe(true);
    expect(g.accept(1080)).toBe(false);
    expect(g.accept(1149)).toBe(false);
    expect(g.accept(1150)).toBe(false); // only 70 ms after the last click
    expect(g.accept(1300)).toBe(true);
  });

  it("a fingertip jittering at the press threshold gives one press, not one every 150 ms", () => {
    const g = new PressGate();
    let presses = 0;
    for (let t = 0; t <= 1000; t += 40) if (g.accept(t)) presses++;
    expect(presses).toBe(1);
    // Once the finger is still (no clicks) for 150 ms, the next poke counts.
    expect(g.accept(1000 + 40 + 150)).toBe(true);
  });
});

describe("PokeTracker", () => {
  it("presses at 8 mm past the face and re-arms at 4 mm", () => {
    expect(POKE_PRESS_M).toBe(0.008);
    expect(POKE_REARM_M).toBe(0.004);
    const p = new PokeTracker(new PressGate());
    expect(p.update(mm(-20), true, 0)).toBe(false);
    expect(p.update(mm(7.9), true, 10)).toBe(false);
    expect(p.update(mm(8), true, 20)).toBe(true);
    expect(p.pressed).toBe(true);
    // Held in: still one press.
    for (let t = 30; t < 600; t += 14) expect(p.update(mm(12), true, t)).toBe(false);
    // Out to 5 mm is not enough to re-arm.
    expect(p.update(mm(5), true, 610)).toBe(false);
    expect(p.update(mm(10), true, 620)).toBe(false);
    // Out to 4 mm re-arms; the next push presses again.
    expect(p.update(mm(4), true, 630)).toBe(false);
    expect(p.pressed).toBe(false);
    expect(p.update(mm(9), true, 800)).toBe(true);
  });

  it("double poke = one press: two entries 80 ms apart", () => {
    const p = new PokeTracker(new PressGate());
    let presses = 0;
    const frames: Array<[number, number]> = [
      [0, -10],
      [20, 10], // first entry
      [40, 0],
      [60, -10],
      [100, 10], // second entry, 80 ms later
      [120, 0],
      [140, -10],
    ];
    for (const [t, d] of frames) if (p.update(mm(d), true, t)) presses++;
    expect(presses).toBe(1);
    // A deliberate second poke later counts.
    if (p.update(mm(10), true, 400)) presses++;
    expect(presses).toBe(2);
  });

  it("two buttons poked together count once when they share a gate", () => {
    const gate = new PressGate();
    const a = new PokeTracker(gate);
    const b = new PokeTracker(gate);
    expect(a.update(mm(10), true, 0)).toBe(true);
    expect(b.update(mm(10), true, 30)).toBe(false);
  });

  it("sliding off the button re-arms it; losing the fingertip does not", () => {
    const p = new PokeTracker(new PressGate());
    expect(p.update(mm(10), true, 0)).toBe(true);
    expect(p.update(Number.NaN, true, 200)).toBe(false);
    expect(p.update(mm(10), true, 400)).toBe(false); // still pushed in after the dropout
    expect(p.update(mm(10), false, 420)).toBe(false); // slid off the edge
    expect(p.update(mm(10), true, 600)).toBe(true);
  });
});
