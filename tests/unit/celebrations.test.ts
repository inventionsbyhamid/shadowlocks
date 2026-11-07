import { describe, expect, it } from "vitest";
import { Group, type Material, Mesh, type MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry } from "@iwsdk/core";
import { LOCK_TO_BOX_MS } from "../../src/app/box-session";
import { generateBox } from "../../src/core/generator";
import { BOX_OPEN_FX, BoxOpenFx } from "../../src/render/fx/box-open";
import { FlashBudget, MIN_GAP_S } from "../../src/render/fx/flash-budget";
import { LOCK_OPEN_FX, LockOpenFx } from "../../src/render/fx/lock-open";
import { PER_LOCK, SPARKLE, SPARKLE_S } from "../../src/render/fx/sparkle";
import { REWARD, Reward, type RewardHands } from "../../src/render/reward";

const DT = 1 / 72;
const box5 = generateBox({ kind: "box", n: 5 });

function lockScene() {
  const root = new Group();
  const glow = new Map<string, number>();
  return { root, glow, scrapMesh: (lock: number, piece: number) => ({ setGlow: (v: number) => glow.set(`${lock}:${piece}`, v) }) };
}

/** A box root with the parts the box opening reads by name: the side glass, the smoked lid and the trim. */
function boxRoot() {
  const root = new Group();
  const pane = (name: string, mat: Material) => {
    const m = new Mesh(new PlaneGeometry(1, 1), mat);
    m.name = name;
    root.add(m);
    return m;
  };
  const glass = pane("Box Glass", new MeshPhysicalMaterial({ color: "#a6aebb", transparent: true, opacity: 0.11 }));
  const lid = pane("Box Lid", new MeshPhysicalMaterial({ color: "#1d2026", transparent: true, opacity: 0.1 }));
  pane("Box Trim", new MeshStandardMaterial({ color: "#e2bd62" }));
  return { root, glass, lid };
}

describe("a lock opening", () => {
  it("bursts on the box's one flash, then its glints take the same budget in turn; a second opening the same frame is half strength", () => {
    const budget = new FlashBudget(), s = lockScene();
    const fx = new LockOpenFx(s, budget);
    fx.setBox(box5);
    fx.open(0, false);
    fx.open(2, false);
    expect(budget.started).toBe(1);
    let shown = 0;
    for (let t = 0; t < 4; t += DT) {
      budget.step(DT);
      fx.update(DT, false);
      if (fx.sparkle.points.visible) shown++;
    }
    // Both locks' glints flared, one at a time through the budget, none dropped.
    expect(budget.started).toBe(1 + 2 * SPARKLE.glints);
    expect(shown).toBeGreaterThan(0);
    expect(fx.running).toBe(false);
    expect(fx.sparkle.points.visible).toBe(false);
    // Its scraps rest at a warm glow.
    expect(s.glow.get("0:0")).toBeCloseTo(LOCK_OPEN_FX.glowRest, 6);
  });

  it("glitter rises from the opened shape, and with reduced motion only the glints show", () => {
    for (const reduced of [false, true]) {
      const budget = new FlashBudget(), fx = new LockOpenFx(lockScene(), budget);
      fx.setBox(box5);
      fx.update(DT, reduced);
      fx.open(0, false);
      let glitter = 0, glints = 0;
      for (let t = 0; t < SPARKLE_S + 0.2; t += DT) {
        budget.step(DT);
        fx.update(DT, reduced);
        glints = Math.max(glints, ...fx.sparkle.bright.subarray(0, SPARKLE.glints));
        glitter = Math.max(glitter, ...fx.sparkle.bright.subarray(SPARKLE.glints, PER_LOCK));
      }
      expect(glints).toBeGreaterThan(0.9);
      if (reduced) expect(glitter).toBe(0);
      else expect(glitter).toBeGreaterThan(0.5);
    }
  });

  it("a lock restored with a resumed box only glows: no burst, no sparkle, no flash", () => {
    const budget = new FlashBudget(), s = lockScene(), fx = new LockOpenFx(s, budget);
    fx.setBox(box5);
    fx.open(1, true);
    fx.update(DT, false);
    expect(budget.started).toBe(0);
    expect(fx.running).toBe(false);
    expect(s.glow.get("1:0")).toBeCloseTo(LOCK_OPEN_FX.glowRest, 6);
  });

  it("never brightens twice within the budget's gap, however the openings come", () => {
    const budget = new FlashBudget(), fx = new LockOpenFx(lockScene(), budget);
    fx.setBox(box5);
    // Three locks open at 0, 0.1 and 0.5 s; record when each full-strength brightening began.
    const opens: [number, number][] = [
      [0, 0],
      [0.1, 1],
      [0.5, 2],
    ];
    const takes: number[] = [];
    let next = 0, last = 0;
    for (let t = 0; t < 7; t += DT) {
      while (next < opens.length && opens[next]![0] <= t) fx.open(opens[next++]![1], false);
      budget.step(DT);
      fx.update(DT, false);
      if (budget.started > last) takes.push(t);
      last = budget.started;
    }
    for (let i = 1; i < takes.length; i++) expect(takes[i]! - takes[i - 1]!).toBeGreaterThanOrEqual(MIN_GAP_S - DT);
    expect(takes.length).toBeGreaterThan(SPARKLE.glints);
    expect(fx.running).toBe(false);
  });
});

describe("the box opening", () => {
  it("the last lock, the box opening 0.7 s on and the reward's bloom all flash at full strength, at 72 and 90 Hz", () => {
    const noHands: RewardHands = { point: () => false, pinching: () => false, started: () => false, busy: () => false };
    const opacity = (fx: BoxOpenFx) => ((fx.group.getObjectByName("Box Burst") as Mesh).material as MeshBasicMaterial).opacity;
    for (const hz of [72, 90]) {
      const dt = 1 / hz, budget = new FlashBudget(), s = lockScene();
      const lockFx = new LockOpenFx(s, budget);
      lockFx.setBox(box5);
      const box = new BoxOpenFx(boxRoot().root, budget);
      // A box opening on a budget of its own, started on the same frame: what full strength looks like.
      const ref = new BoxOpenFx(boxRoot().root, new FlashBudget());
      const reward = new Reward(new Group(), budget);
      reward.setBox(box5);
      // The last lock (its glints due from 0.34 s): the box opens LOCK_TO_BOX_MS after it, as the game view does.
      lockFx.open(2, false, LOCK_TO_BOX_MS / 1000);
      expect(budget.started).toBe(1);
      const takes: number[] = [];
      let t = 0, opened = false, burst = 0, burstRef = 0, bloom = 0;
      for (let i = 0; i < 4 * hz; i++) {
        budget.step(dt);
        t += dt;
        const before = budget.started;
        // The session opens the box on the first frame at or past its time: the view quiets the glints, then claims.
        if (!opened && t >= LOCK_TO_BOX_MS / 1000 - 1e-9) {
          opened = true;
          lockFx.quiet();
          box.start(1);
          ref.start(1);
          reward.rise([0.22, -0.55, 1.27]);
        }
        lockFx.update(dt, false);
        box.update(dt, false);
        ref.update(dt, false);
        reward.update(dt, noHands, false, 24, false);
        if (budget.started > before) takes.push(t);
        burst = Math.max(burst, opacity(box));
        burstRef = Math.max(burstRef, opacity(ref));
        if (reward.glow.visible) bloom = Math.max(bloom, (reward.glow.material as Material).opacity);
      }
      expect(burstRef).toBeGreaterThan(0);
      expect(burst).toBeCloseTo(burstRef, 9);
      expect(bloom).toBeCloseTo(REWARD.glow.peak, 2);
      // After the lock's own burst: the opening, then the bloom. The glints still waiting were let go at the opening.
      expect(takes).toHaveLength(2);
      expect(takes[0]!).toBeCloseTo(Math.ceil((LOCK_TO_BOX_MS / 1000) * hz - 1e-6) / hz, 6);
      expect(takes[1]! - takes[0]!).toBeGreaterThanOrEqual(MIN_GAP_S);
      expect(lockFx.running).toBe(false);
    }
  });

  it("a box's last lock reserves the opening's flash whatever its index, even past the burst slots", () => {
    const budget = new FlashBudget(), fx = new LockOpenFx(lockScene(), budget);
    fx.setBox(box5);
    // Lock index 3 has no burst slot (three slots; a box has three locks today): its reservation must still be made.
    fx.open(3, false, LOCK_TO_BOX_MS / 1000);
    budget.step(0.5);
    expect(budget.take()).toBe(false);
    expect(budget.claim()).toBe(true);
    // A restored lock (a resumed box) opens nothing and reserves nothing.
    const quiet = new FlashBudget(), again = new LockOpenFx(lockScene(), quiet);
    again.setBox(box5);
    again.open(2, true, LOCK_TO_BOX_MS / 1000);
    quiet.step(0.5);
    expect(quiet.take()).toBe(true);
  });

  it("a paused box still opens at full strength: the reservation holds past its time until claimed, and a new box clears it", () => {
    const budget = new FlashBudget();
    budget.reserve(0.7);
    budget.step(0.5);
    expect(budget.take()).toBe(false);
    // Paused at the opening for 5 s while the scene runs on: nothing else takes the opening's turn.
    budget.step(5);
    expect(budget.take()).toBe(false);
    expect(budget.claim()).toBe(true);
    // Claimed, the budget is as usual again.
    budget.step(MIN_GAP_S);
    expect(budget.take()).toBe(true);
    // A box left before it opened: the next box starts with the budget reset.
    budget.reserve(0.7);
    budget.reset();
    expect(budget.take()).toBe(true);
  });

  it("hides the box's side glass and smoked lid while its panes swing, and a new box puts them back", () => {
    const { root, glass, lid } = boxRoot(), budget = new FlashBudget();
    const fx = new BoxOpenFx(root, budget);
    expect(fx.group.visible).toBe(false);
    fx.start(1);
    expect(budget.started).toBe(1);
    expect(glass.visible).toBe(false);
    expect(lid.visible).toBe(false);
    for (let t = 0; t < 3; t += DT) fx.update(DT, false);
    fx.reset();
    expect(glass.visible).toBe(true);
    expect(lid.visible).toBe(true);
    expect(fx.group.visible).toBe(false);
  });

  it("the hinged lid wears the smoked lid's look and fades as it lifts, gone before it stands upright behind the plate", () => {
    const { root, lid } = boxRoot(), fx = new BoxOpenFx(root, new FlashBudget());
    const pane = root.getObjectByName("Box Lid Open") as Mesh;
    const mat = pane.material as MeshPhysicalMaterial, lidMat = lid.material as MeshPhysicalMaterial;
    // A copy of the lid's material (its fade must not touch the box's own lid).
    expect(mat).not.toBe(lidMat);
    expect(mat.color.getHex()).toBe(lidMat.color.getHex());
    expect(mat.opacity).toBeCloseTo(lidMat.opacity, 6);
    for (const reduced of [false, true]) {
      fx.reset();
      fx.start(-1);
      const seen: { angle: number; opacity: number; visible: boolean }[] = [];
      for (let t = 0; t < 4; t += DT) {
        fx.update(DT, reduced);
        seen.push({ angle: -pane.parent!.rotation.x, opacity: mat.opacity, visible: pane.parent!.visible });
      }
      // Never more opaque than the lid; faded out while still well short of upright (90 degrees).
      for (const s of seen) expect(s.opacity).toBeLessThanOrEqual(lidMat.opacity + 1e-9);
      const gone = seen.find((s) => s.opacity === 0)!;
      expect(gone).toBeTruthy();
      expect(gone.angle).toBeLessThan((80 * Math.PI) / 180);
      expect(seen.at(-1)!.visible).toBe(false);
      expect(seen.at(-1)!.angle).toBeCloseTo(BOX_OPEN_FX.wallAngle, 3);
    }
    expect(lidMat.opacity).toBeCloseTo(0.1, 6);
    fx.reset();
    expect(mat.opacity).toBeCloseTo(lidMat.opacity, 6);
  });
});
