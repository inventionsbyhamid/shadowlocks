import { describe, expect, it } from "vitest";
import { Group, type Material, Mesh, type MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry } from "@iwsdk/core";
import { LOCK_TO_BOX_MS } from "../../src/app/box-session";
import { generateBox } from "../../src/core/generator";
import { BOX_OPEN_FX, BoxOpenFx } from "../../src/render/fx/box-open";
import { FlashBudget, MIN_GAP_S } from "../../src/render/fx/flash-budget";
import { LOCK_OPEN_FX, LockOpenFx } from "../../src/render/fx/lock-open";
import { PER_LOCK, SPARKLE, SPARKLE_S } from "../../src/render/fx/sparkle";

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
  it("wins its flash: the last lock opens at 0 and the box at 0.7 s on the same budget, at full strength; the glints wait", () => {
    const budget = new FlashBudget(), s = lockScene();
    const lockFx = new LockOpenFx(s, budget);
    lockFx.setBox(box5);
    const box = new BoxOpenFx(boxRoot().root, budget);
    // The last lock: the box opens LOCK_TO_BOX_MS after it.
    lockFx.open(2, false, LOCK_TO_BOX_MS / 1000);
    expect(budget.started).toBe(1);
    const takes: number[] = [];
    let t = 0;
    const frame = () => {
      budget.step(DT);
      t += DT;
      const before = budget.started;
      lockFx.update(DT, false);
      if (budget.started > before) takes.push(t);
    };
    while (t < LOCK_TO_BOX_MS / 1000 - 1e-9) frame();
    box.start(1);
    // Full strength: its burst as bright as a box opening on a budget of its own.
    const ref = new BoxOpenFx(boxRoot().root, new FlashBudget());
    ref.start(1);
    box.update(0.1, false);
    ref.update(0.1, false);
    const opacity = (fx: BoxOpenFx) => ((fx.group.getObjectByName("Box Burst") as Mesh).material as MeshBasicMaterial).opacity;
    expect(opacity(ref)).toBeGreaterThan(0);
    expect(opacity(box)).toBeCloseTo(opacity(ref), 9);
    // No glint flared within the gap before the opening; they flare after it, a gap apart, none lost.
    expect(takes.every((x) => x <= LOCK_TO_BOX_MS / 1000 - MIN_GAP_S)).toBe(true);
    const after: number[] = [];
    for (let i = 0; i < 3 / DT; i++) {
      budget.step(DT);
      t += DT;
      const before = budget.started;
      lockFx.update(DT, false);
      if (budget.started > before) after.push(t);
    }
    expect(after.length + takes.length).toBe(SPARKLE.glints);
    expect(after[0]! - LOCK_TO_BOX_MS / 1000).toBeGreaterThanOrEqual(MIN_GAP_S - DT);
  });

  it("a reservation nobody claims lapses: flashes go on after its time has passed", () => {
    const budget = new FlashBudget();
    budget.reserve(0.7);
    budget.step(0.5);
    expect(budget.take()).toBe(false);
    budget.step(0.6);
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
