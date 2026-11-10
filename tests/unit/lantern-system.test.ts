import { afterEach, describe, expect, it } from "vitest";
import { Group, Quaternion, Vector3 } from "@iwsdk/core";
import { on } from "../../src/app/bus";
import { Lantern, type LanternBoxScene } from "../../src/app/lantern-system";
import { generateBox } from "../../src/core/generator";
import type { Box, V3 } from "../../src/core/types";
import type { HandPinch } from "../../src/input/grab-system";
import type { HandJoints } from "../../src/input/hand-joints";

const CM = 24;
const u = (cm: number) => cm / CM;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const DT = 1000 / 72;

const newPin = (): HandPinch => ({
  kind: "none",
  tracked: false,
  pinching: false,
  edge: null,
  point: new Vector3(),
  anchor: new Vector3(),
  rot: new Quaternion(),
});

/** A box scene without a renderer (box units are world units: the root is the identity), as BoxScene behaves. */
function fakeScene(box: Box) {
  const pos: V3 = [...box.start];
  const scene = {
    box: box as Box | null,
    size: CM / 100,
    root: new Group(),
    lantern: {
      getPos: (out: V3) => {
        out[0] = pos[0];
        out[1] = pos[1];
        out[2] = pos[2];
        return out;
      },
      setPos: (p: V3) => {
        pos[0] = p[0];
        pos[1] = p[1];
        pos[2] = p[2];
      },
      flare: () => {},
      ripple: () => {},
      setBrightness: () => {},
    },
    /** BoxScene.setBox: the new box, the lantern at its start. */
    show(b: Box) {
      this.box = b;
      this.lantern.setPos([...b.start]);
    },
    pos,
  };
  return scene;
}

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

describe("Lantern", () => {
  it("lets a held lantern go when a new box comes, and puts it at the new box's start", () => {
    const a = generateBox({ kind: "box", n: 1 });
    const b = generateBox({ kind: "box", n: 2 });
    const scene = fakeScene(a);
    const pins: [HandPinch, HandPinch] = [newPin(), newPin()];
    const lantern = new Lantern(scene as unknown as LanternBoxScene, { pinches: pins, joints: {} as HandJoints });
    const said: string[] = [];
    offs.push(on("grab", (e) => said.push(`grab ${e.hand}`)), on("release", (e) => said.push(`release ${e.hand}`)));
    const feel: string[] = [];
    lantern.onFeel((e) => feel.push(e.type));

    let t = 0;
    const right = pins[1];
    /** The right controller's grip at `p` with the trigger up or down, one frame. */
    const frame = (p: V3, trigger: boolean) => {
      right.edge = trigger && !right.pinching ? "start" : !trigger && right.pinching ? "end" : null;
      right.kind = "controller";
      right.tracked = true;
      right.pinching = trigger;
      right.point.set(p[0], p[1], p[2]);
      t += DT;
      lantern.update(t);
    };

    // Grab it at box A's start and carry it 10 cm.
    const grip = add(a.start, [0, u(2), 0]);
    frame(grip, false);
    frame(grip, true);
    expect(lantern.grab.holder).toBe("right");
    for (let i = 1; i <= 20; i++) frame(add(grip, [u(i / 2), 0, 0]), true);
    for (let i = 0; i < 60; i++) frame(add(grip, [u(10), 0, 0]), true);
    expect(scene.pos[0]).toBeCloseTo(a.start[0] + u(10), 3);

    // Box B comes while the trigger is still down: the hold is let go first, then the lantern is put at B's start.
    scene.show(b);
    frame(add(grip, [u(10), 0, 0]), true);
    expect(lantern.grab.holder).toBeNull();
    expect(lantern.ctrl.held).toBe(false);
    expect(said).toEqual(["grab right", "release right"]);
    expect(feel.filter((x) => x === "grab" || x === "release")).toEqual(["grab", "release"]);
    expect(scene.pos).toEqual(b.start);
    expect(lantern.ctrl.pos).toEqual(b.start);
    // The controller, trigger still down, moves on: the lantern stays at B's start, and nothing grabs it again.
    for (let i = 1; i <= 30; i++) frame(add(grip, [u(10 + i / 3), 0, 0]), true);
    expect(scene.pos).toEqual(b.start);
    expect(said).toEqual(["grab right", "release right"]);
  });

  it("is put away under a menu: a hold lets go at once where it stands, nothing takes it, and it carries on after", () => {
    const a = generateBox({ kind: "box", n: 1 });
    const scene = fakeScene(a);
    const pins: [HandPinch, HandPinch] = [newPin(), newPin()];
    const lantern = new Lantern(scene as unknown as LanternBoxScene, { pinches: pins, joints: {} as HandJoints });
    const said: string[] = [];
    offs.push(on("grab", (e) => said.push(`grab ${e.hand}`)), on("release", (e) => said.push(`release ${e.hand}`)));
    let t = 0;
    const right = pins[1];
    const frame = (p: V3, trigger: boolean) => {
      right.edge = trigger && !right.pinching ? "start" : !trigger && right.pinching ? "end" : null;
      right.kind = "controller";
      right.tracked = true;
      right.pinching = trigger;
      right.point.set(p[0], p[1], p[2]);
      t += DT;
      lantern.update(t);
    };
    const grip = add(a.start, [0, u(2), 0]);
    frame(grip, false);
    frame(grip, true);
    for (let i = 1; i <= 10; i++) frame(add(grip, [u(i / 2), 0, 0]), true);
    for (let i = 0; i < 40; i++) frame(add(grip, [u(5), 0, 0]), true);
    expect(lantern.grab.holder).toBe("right");
    const held: V3 = [...scene.pos];

    lantern.setAway(true, t);
    expect(lantern.away).toBe(true);
    // Let go where it stood (the release looks back to the standstill: within a hair).
    const stood: V3 = [...scene.pos];
    for (let i = 0; i < 3; i++) expect(stood[i]).toBeCloseTo(held[i]!, 4);
    expect(lantern.grab.holder).toBeNull();
    expect(said).toEqual(["grab right", "release right"]);
    // The hand moves on and pinches again on it: nothing moves it or takes it.
    frame(add(grip, [u(9), 0, 0]), false);
    frame(stood, false);
    frame(stood, true);
    for (let i = 0; i < 20; i++) frame(add(stood, [u(i), 0, 0]), true);
    expect(scene.pos).toEqual(stood);
    expect(lantern.grab.holder).toBeNull();
    expect(said).toEqual(["grab right", "release right"]);

    // Back: a new pinch on it takes it again; no release is told twice.
    lantern.setAway(false, t);
    frame(stood, false);
    frame(stood, true);
    expect(lantern.grab.holder).toBe("right");
    expect(said).toEqual(["grab right", "release right", "grab right"]);
  });

  it("waits with the box for its first placement: while the box is hidden no hand takes it or moves it; once shown, it can be taken", () => {
    const a = generateBox({ kind: "box", n: 1 });
    const scene = fakeScene(a);
    const pins: [HandPinch, HandPinch] = [newPin(), newPin()];
    const lantern = new Lantern(scene as unknown as LanternBoxScene, { pinches: pins, joints: {} as HandJoints });
    const said: string[] = [];
    offs.push(on("grab", (e) => said.push(`grab ${e.hand}`)));
    let t = 0;
    const right = pins[1];
    const frame = (p: V3, trigger: boolean) => {
      right.edge = trigger && !right.pinching ? "start" : !trigger && right.pinching ? "end" : null;
      right.kind = "controller";
      right.tracked = true;
      right.pinching = trigger;
      right.point.set(p[0], p[1], p[2]);
      t += DT;
      lantern.update(t);
    };
    lantern.setUnplaced(true, t);
    expect(lantern.unplaced).toBe(true);
    // A controller's grip on the invisible lantern at its default place, trigger down, then carried: nothing.
    const grip = add(a.start, [0, u(2), 0]);
    frame(grip, false);
    frame(grip, true);
    for (let i = 1; i <= 20; i++) frame(add(grip, [u(i / 2), 0, 0]), true);
    expect(lantern.grab.holder).toBeNull();
    expect(scene.pos).toEqual(a.start);
    expect(said).toEqual([]);
    // Placed and shown: a new pinch on it takes it.
    lantern.setUnplaced(false, t);
    frame(grip, false);
    frame(grip, true);
    expect(lantern.grab.holder).toBe("right");
    expect(said).toEqual(["grab right"]);
  });
});
