// The reward's rise, pinch and drop, and a key on the box pressed by a fingertip, without a renderer.
import { describe, expect, it } from "vitest";
import { Group, Vector3 } from "@iwsdk/core";
import { generateBox } from "../../src/core/generator";
import type { V3 } from "../../src/core/types";
import { KEY_EVENT } from "../../src/render/finger-key";
import { REWARD, Reward, type RewardHands } from "../../src/render/reward";
import { COPY } from "../../src/ui/copy";
import { PLATE, plateLayout, wrapTwo } from "../../src/ui/plate";
import { PokeKey } from "../../src/ui/poke-key";

const DT = 1 / 72;
const CM = 24;

/** One scripted hand (box units), the other away. */
function hand() {
  const h = { at: [0, 0, 0] as V3, pinching: false, started: false, tracked: true, busy: false };
  const hands: RewardHands = {
    point: (i, out) => {
      if (i !== 1 || !h.tracked) return false;
      out[0] = h.at[0];
      out[1] = h.at[1];
      out[2] = h.at[2];
      return true;
    },
    pinching: (i) => i === 1 && h.pinching,
    started: (i) => i === 1 && h.started,
    busy: (i) => i === 1 && h.busy,
  };
  return { h, hands };
}

function risen() {
  const root = new Group();
  const r = new Reward(root);
  r.setBox(generateBox({ kind: "box", n: 3 }));
  r.rise([-0.22, -0.55, 1.27]);
  const { h, hands } = hand();
  let taken = 0;
  const run = (s: number, live = true) => {
    for (let t = 0; t < s; t += DT) if (r.update(DT, hands, live, CM, false)) taken++;
  };
  return { r, h, hands, run, taken: () => taken };
}

describe("reward", () => {
  it("rises out of the drawer with the tune and floats there", () => {
    const { r, run } = risen();
    run(REWARD.riseAtS - 0.05);
    expect(r.group.visible).toBe(false);
    expect(r.up).toBe(false);
    run(REWARD.riseS + 0.1);
    expect(r.up).toBe(true);
    const p = r.position([0, 0, 0]);
    expect(p[0]).toBeCloseTo(-0.22, 6);
    expect(p[1]).toBeCloseTo(-0.55 + REWARD.rise, 6);
  });

  it("pinched and let go nearer the player: taken; let go elsewhere: it floats back", () => {
    const { r, h, run, taken } = risen();
    run(REWARD.riseAtS + REWARD.riseS + 0.1);
    const rest = r.position([0, 0, 0]);
    // A pinch starting 10 cm away takes nothing.
    h.at = [rest[0] + 10 / CM, rest[1], rest[2]];
    h.pinching = h.started = true;
    run(DT);
    expect(r.held).toBe(false);
    h.pinching = h.started = false;
    run(DT);
    // On it: held, and it follows the hand.
    h.at = [rest[0] + 1 / CM, rest[1], rest[2]];
    h.pinching = h.started = true;
    run(DT);
    h.started = false;
    expect(r.held).toBe(true);
    h.at = [rest[0] + 1 / CM, rest[1] + 3 / CM, rest[2]];
    run(DT);
    expect(r.position([0, 0, 0])[1]).toBeCloseTo(rest[1] + 3 / CM, 6);
    // Let go only 3 cm up: it floats back and is not taken.
    h.pinching = false;
    run(REWARD.backS + 0.1);
    expect(taken()).toBe(0);
    expect(r.held).toBe(false);
    expect(r.position([0, 0, 0])[1]).toBeCloseTo(rest[1], 6);
    // Again, carried 8 cm toward the player: taken on the frame it is let go.
    h.at = [rest[0], rest[1], rest[2]];
    h.pinching = h.started = true;
    run(DT);
    h.started = false;
    h.at = [rest[0], rest[1], rest[2] + 8 / CM];
    run(DT);
    h.pinching = false;
    run(DT);
    expect(taken()).toBe(1);
  });

  it("the hand holding the lantern cannot take it, and nothing is taken before it is live", () => {
    const { r, h, run } = risen();
    run(REWARD.riseAtS + REWARD.riseS + 0.1);
    h.at = r.position([0, 0, 0]);
    h.busy = true;
    h.pinching = h.started = true;
    run(DT);
    expect(r.held).toBe(false);
    h.busy = false;
    run(DT, false);
    expect(r.held).toBe(false);
  });

  it("taken: it shrinks away and hides", () => {
    const { r, run } = risen();
    run(REWARD.riseAtS + REWARD.riseS + 0.1);
    r.take();
    run(REWARD.takeS + 0.1);
    expect(r.group.visible).toBe(false);
    expect(r.up).toBe(false);
  });
});

describe("the plate", () => {
  it("keeps the box's name clear of its latch lights, with room for it at full size", () => {
    const w = PLATE.w * 5000, h = PLATE.h * 5000;
    for (const n of [1, 2, 3]) {
      const L = plateLayout(w, h, n);
      expect(L.lightX).toHaveLength(n);
      // The name ends before the first light's edge, and every light is inside the plate.
      expect(L.nameX + L.nameMax).toBeLessThan(L.lightX[0]! - L.lightR);
      for (const x of L.lightX) {
        expect(x - L.lightR).toBeGreaterThan(0);
        expect(x + L.lightR).toBeLessThan(w);
      }
      // "Box No. 123" in bold serif is about 5.5 em: it fits at the full lettering size with three lights.
      expect(L.nameMax).toBeGreaterThan(5.5 * 0.46 * h * 0.85);
    }
  });

  it("sets the coach line in two balanced lines on its card, at full size", () => {
    // Italic serif runs about half an em a letter: the card's lettering is 0.26 of its height.
    const em = PLATE.coach.h * 5000 * 0.26, width = (s: string) => s.length * 0.5 * em, max = PLATE.coach.w * 5000 * 0.9;
    const lines = wrapTwo(COPY.game.controllerFinger, width, max);
    expect(lines).toEqual(["Or set a controller down", "and use your finger."]);
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(max);
    // At least 12 mm lettering, and no wider than the box's plate by much.
    expect(PLATE.coach.h * 0.26).toBeGreaterThanOrEqual(0.012);
    expect(PLATE.coach.w).toBeLessThanOrEqual(PLATE.w + 0.04);
    // A line that fits stays one; one word stays whole.
    expect(wrapTwo("Hint", width, max)).toEqual(["Hint"]);
    expect(wrapTwo("x".repeat(80), width, max)).toEqual(["x".repeat(80)]);
  });
});

describe("a key on the box", () => {
  /** A fingertip `d` metres in front of the key's face, at (x, y) on it. */
  const tips = (k: PokeKey, d: number, x = 0, y = 0) => {
    k.group.updateWorldMatrix(true, false);
    const p = new Vector3(x, y, d).applyMatrix4(k.group.matrixWorld);
    return { points: [p, new Vector3()], count: 1 };
  };

  it("presses at 80% of its travel and acts when the finger comes back out; not live, it feels nothing", () => {
    const k = new PokeKey("plate-next", 0.07, 0.044, "Next box");
    const root = new Group();
    root.add(k.group);
    k.group.position.set(0.1, 1, -0.5);
    k.group.rotation.x = -0.3;
    expect(k.feel(tips(k, 0.005))).toBe(KEY_EVENT.none);
    k.live = true;
    const seen: number[] = [];
    for (const d of [0.05, 0.02, 0.012, 0.008, 0.006, 0.004, 0.002, 0.006, 0.012, 0.03]) seen.push(k.feel(tips(k, d)));
    expect(seen.filter((e) => e === KEY_EVENT.press)).toHaveLength(1);
    expect(seen.filter((e) => e === KEY_EVENT.click)).toHaveLength(1);
    expect(seen.indexOf(KEY_EVENT.press)).toBeLessThan(seen.indexOf(KEY_EVENT.click));
    // Off its face, a finger pushing through presses nothing.
    const off: number[] = [];
    for (const d of [0.05, 0.01, 0.002]) off.push(k.feel(tips(k, d, 0.06, 0)));
    expect(off.includes(KEY_EVENT.press)).toBe(false);
    // Its pose for the hooks: centre and facing in the world, size in metres.
    const pose = k.pose();
    expect(pose.size).toEqual([0.07, 0.044]);
    expect(Math.hypot(...pose.normal)).toBeCloseTo(1, 6);
    expect(pose.world[1]).toBeCloseTo(1, 6);
  });
});
