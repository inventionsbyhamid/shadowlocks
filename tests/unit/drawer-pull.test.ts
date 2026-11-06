import { Vector3 } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { DRAWER_PULL, type DrawerFrame, type DrawerHands, DrawerPull, type DrawerState } from "../../src/input/drawer-pull";
import type { HandSide } from "../../src/input/hand-joints";

/** The handle 30 cm in front of the origin, the player further along +z (a box facing the player). */
const HANDLE = new Vector3(0, 0.9, -1.1);
const TOWARD = new Vector3(0, 0, 1);

const frame = (handle = HANDLE, toward = TOWARD): DrawerFrame => ({
  handle: (out) => out.copy(handle),
  toward: (out) => out.copy(toward),
});

/** Scripted hands: where each pinches, how far apart its thumb and index tips are, tracked or not. */
class FakeHands implements DrawerHands {
  readonly at: Record<HandSide, Vector3> = { left: new Vector3(-0.3, 0.9, -0.8), right: new Vector3(0.3, 0.9, -0.8) };
  readonly gap: Record<HandSide, number> = { left: 0.06, right: 0.06 };
  readonly on: Record<HandSide, boolean> = { left: true, right: true };
  tracked(h: HandSide): boolean {
    return this.on[h];
  }
  pinchPoint(h: HandSide, out: Vector3): boolean {
    if (!this.on[h]) return false;
    out.copy(this.at[h]);
    return true;
  }
  pinchDistance(h: HandSide): number {
    return this.on[h] ? this.gap[h] : Number.NaN;
  }
  /** The index knuckle: where the pinch is, unless a test moves the fingertips alone (`tips`). */
  readonly tips: Record<HandSide, Vector3> = { left: new Vector3(), right: new Vector3() };
  joint(h: HandSide, _j: XRHandJoint, out: Vector3): boolean {
    if (!this.on[h]) return false;
    out.copy(this.at[h]).sub(this.tips[h]);
    return true;
  }
}

class Bench {
  t = 0;
  readonly hands = new FakeHands();
  readonly seen: DrawerState[] = [];
  constructor(readonly drawer: DrawerPull) {}
  step(n = 1, ms = 1000 / 72): DrawerState {
    let s: DrawerState = this.drawer.state;
    for (let i = 0; i < n; i++) {
      this.t += ms;
      s = this.drawer.update(this.hands, this.t);
      if (this.seen[this.seen.length - 1] !== s) this.seen.push(s);
    }
    return s;
  }
  /** Hand `h` comes to `p` open, then closes its fingers there. */
  pinchAt(h: HandSide, p: Vector3): void {
    this.hands.gap[h] = 0.06;
    this.hands.at[h].copy(p);
    this.step(2);
    this.hands.gap[h] = 0.008;
    this.step();
  }
  /** Move hand `h` by `d` over `frames` frames. */
  move(h: HandSide, d: Vector3, frames = 12): void {
    const step = d.clone().multiplyScalar(1 / frames);
    for (let i = 0; i < frames; i++) {
      this.hands.at[h].add(step);
      this.step();
    }
  }
  open(h: HandSide): void {
    this.hands.gap[h] = 0.06;
    this.step(3);
  }
}

const bench = (o: ConstructorParameters<typeof DrawerPull>[1] = {}, f = frame()) => {
  const b = new Bench(new DrawerPull(f, o));
  b.step();
  return b;
};

describe("DrawerPull", () => {
  it("pulls open only past 4 cm toward the player", () => {
    expect(DRAWER_PULL.openM).toBe(0.04);
    const b = bench();
    b.pinchAt("right", HANDLE);
    expect(b.drawer.state).toBe("opening");
    expect(b.drawer.hand).toBe("right");
    b.move("right", new Vector3(0, 0, 0.03));
    expect(b.drawer.state).toBe("opening");
    expect(b.drawer.progress).toBeCloseTo(0.75, 2);
    b.move("right", new Vector3(0, 0, 0.012), 3);
    expect(b.drawer.state).toBe("open");
    expect(b.drawer.progress).toBe(1);
    expect(b.seen).toEqual(["closed", "opening", "open"]);
    // Open stays open, whatever the hand does next, until the menus close it.
    b.move("right", new Vector3(0, 0, -0.1));
    b.open("right");
    expect(b.drawer.state).toBe("open");
    expect(b.drawer.opened).toBe(1);
  });

  it("a poke does nothing: a fingertip pushing or dragging the handle without a pinch", () => {
    const b = bench();
    b.hands.at.right.copy(HANDLE);
    b.step(3);
    b.move("right", new Vector3(0, 0, -0.02), 4);
    b.move("right", new Vector3(0, 0, 0.1));
    expect(b.seen).toEqual(["closed"]);
    expect(b.drawer.progress).toBe(0);
  });

  it("a short pull let go springs back closed", () => {
    const b = bench();
    b.pinchAt("left", HANDLE);
    b.move("left", new Vector3(0, 0, 0.035));
    b.open("left");
    expect(b.drawer.state).toBe("closed");
    expect(b.drawer.progress).toBe(0);
    expect(b.drawer.hand).toBeNull();
    expect(b.seen).toEqual(["closed", "opening", "closed"]);
  });

  it("fingers closing and opening never count as a pull: the pull is the hand's (its index knuckle's)", () => {
    const b = bench();
    b.pinchAt("right", HANDLE);
    b.move("right", new Vector3(0, 0, 0.025));
    expect(b.drawer.state).toBe("opening");
    // Letting go: the fingertips spread and their midpoint swings 3 cm toward the player before the
    // pinch counts as over; the hand itself stays.
    const swing = new Vector3(0, 0, 0.03);
    b.hands.gap.right = 0.022;
    b.hands.at.right.add(swing);
    b.hands.tips.right.copy(swing);
    b.step();
    b.hands.gap.right = 0.06;
    b.step(3);
    expect(b.seen).toEqual(["closed", "opening", "closed"]);
    expect(b.drawer.opened).toBe(0);
  });

  it("a pinch that starts away from the handle never takes it, even dragged over it", () => {
    const b = bench();
    b.pinchAt("right", new Vector3(HANDLE.x + 0.09, HANDLE.y, HANDLE.z));
    b.move("right", new Vector3(-0.09, 0, 0));
    b.move("right", new Vector3(0, 0, 0.08));
    expect(b.seen).toEqual(["closed"]);
  });

  it("pushing in, sliding sideways or lifting does not open it", () => {
    const b = bench();
    b.pinchAt("right", HANDLE);
    b.move("right", new Vector3(0, 0, -0.06));
    b.move("right", new Vector3(0.1, 0, 0));
    b.move("right", new Vector3(0, 0.1, 0));
    expect(b.drawer.state).toBe("opening");
    expect(b.drawer.progress).toBe(0);
  });

  it("measures the pull along the box's own outward direction", () => {
    const toward = new Vector3(1, 0, 1).normalize();
    const b = bench({}, frame(HANDLE, toward));
    b.pinchAt("right", HANDLE);
    // 3.5 cm along the box's direction is not yet 4.
    b.move("right", toward.clone().multiplyScalar(0.035));
    expect(b.drawer.state).toBe("opening");
    expect(b.drawer.progress).toBeCloseTo(0.875, 3);
    b.move("right", toward.clone().multiplyScalar(0.01), 2);
    expect(b.drawer.state).toBe("open");
  });

  it("a mostly sideways drag never opens it: the pull toward you must be at least twice the drift across", () => {
    expect(DRAWER_PULL.dominance).toBe(2);
    const b = bench();
    b.pinchAt("right", HANDLE);
    // 4.5 cm toward you, 10 cm to the side: a swipe across the plinth, not a pull.
    b.move("right", new Vector3(0.1, 0, 0.045));
    expect(b.drawer.state).toBe("opening");
    // Coming back across (the drift now 2 cm against 4.5 cm toward): it opens.
    b.move("right", new Vector3(-0.08, 0, 0), 8);
    expect(b.drawer.state).toBe("open");
    // At an angle: 5 cm toward with 3 cm up is not a pull (5 < 2 x 3); 6.5 cm toward with 3 cm up is.
    const c = bench();
    c.pinchAt("right", HANDLE);
    c.move("right", new Vector3(0, 0.03, 0.05));
    expect(c.drawer.state).toBe("opening");
    c.move("right", new Vector3(0, 0, 0.015), 2);
    expect(c.drawer.state).toBe("open");
  });

  it("losing the hand mid pull lets the drawer go back", () => {
    const b = bench();
    b.pinchAt("right", HANDLE);
    b.move("right", new Vector3(0, 0, 0.02));
    b.hands.on.right = false;
    b.step(5);
    expect(b.drawer.state).toBe("opening");
    // Past the tracking grace the pull is over (never a release that opens).
    b.step(20);
    expect(b.drawer.state).toBe("closed");
    b.hands.on.right = true;
    b.hands.at.right.add(new Vector3(0, 0, 0.05));
    b.step(5);
    expect(b.drawer.state).toBe("closed");
  });

  it("the hand holding the lantern never pulls it", () => {
    const b = bench({ busy: (side) => side === 1 });
    b.pinchAt("right", HANDLE);
    b.move("right", new Vector3(0, 0, 0.06));
    expect(b.seen).toEqual(["closed"]);
    b.pinchAt("left", HANDLE);
    b.move("left", new Vector3(0, 0, 0.06));
    expect(b.drawer.state).toBe("open");
    expect(b.drawer.hand).toBeNull();
  });

  it("cannot be pulled while switched off (a panel is up, or the box is opening)", () => {
    let on = false;
    const b = bench({ enabled: () => on });
    b.pinchAt("right", HANDLE);
    b.move("right", new Vector3(0, 0, 0.06));
    expect(b.seen).toEqual(["closed"]);
    b.open("right");
    on = true;
    b.pinchAt("right", HANDLE);
    expect(b.drawer.state).toBe("opening");
    // Switched off mid pull: the pull ends and the drawer goes back.
    on = false;
    b.step();
    expect(b.drawer.state).toBe("closed");
  });

  it("closes when the menus close it, and the next pull needs a new pinch", () => {
    const b = bench();
    b.pinchAt("right", HANDLE);
    b.move("right", new Vector3(0, 0, 0.05));
    expect(b.drawer.state).toBe("open");
    b.drawer.close();
    expect(b.drawer.state).toBe("closed");
    // The hand is still pinched from the last pull, far out: nothing.
    b.hands.at.right.copy(HANDLE);
    b.move("right", new Vector3(0, 0, 0.06));
    expect(b.drawer.state).toBe("closed");
    b.open("right");
    b.pinchAt("right", HANDLE);
    b.move("right", new Vector3(0, 0, 0.05));
    expect(b.drawer.state).toBe("open");
    expect(b.drawer.opened).toBe(2);
  });

  it("opens from code too (boot, the test hooks), and counts it", () => {
    const b = bench();
    b.drawer.open();
    expect(b.drawer.state).toBe("open");
    expect(b.drawer.progress).toBe(1);
    expect(b.drawer.opened).toBe(0);
  });

  it("takes a pinch only within the grip radius of the handle", () => {
    const b = bench();
    b.pinchAt("right", new Vector3(HANDLE.x, HANDLE.y + DRAWER_PULL.gripM + 0.01, HANDLE.z));
    expect(b.drawer.state).toBe("closed");
    b.open("right");
    b.pinchAt("right", new Vector3(HANDLE.x, HANDLE.y + DRAWER_PULL.gripM - 0.005, HANDLE.z));
    expect(b.drawer.state).toBe("opening");
  });
});
