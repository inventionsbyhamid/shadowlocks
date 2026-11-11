import { describe, expect, it } from "vitest";
import { Group, Quaternion, Vector3 } from "@iwsdk/core";
import type { V3 } from "../../src/core/types";
import { GRAB_RADIUS_CM, LANTERN_MIN_Z } from "../../src/feel/constants";
import {
  type FeelEvent,
  LanternController,
  type LanternCtx,
  type LanternInput,
  type RingLine,
} from "../../src/feel/lantern-controller";
import type { HandPinch } from "../../src/input/grab-system";
import type { HandJoints } from "../../src/input/hand-joints";
import { GLOW_FAR_CM, GLOW_NEAR_CM, LanternGrab } from "../../src/input/lantern-grab";
import { BEAM } from "../../src/render/ring-beam";

const CM = 24;
const u = (cm: number) => cm / CM;
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const START: V3 = [0.35, -0.3, 1.35];
const SIDES = ["left", "right"] as const;
type Side = (typeof SIDES)[number];

const newPin = (): HandPinch => ({
  kind: "none",
  tracked: false,
  pinching: false,
  edge: null,
  point: new Vector3(),
  anchor: new Vector3(),
  rot: new Quaternion(),
});

/**
 * LanternGrab with scripted hands (box units are world units here: the box root is the identity). Each hand is set by
 * where it pinches and whether it pinches; the pinch edges come from the changes, as the pinch detector makes them.
 */
class Bench {
  t = 0;
  readonly dt = 1000 / 72;
  readonly ctrl = new LanternController([...START]);
  readonly pins: [HandPinch, HandPinch] = [newPin(), newPin()];
  readonly view = {
    pos: [0, 0, 0] as V3,
    flares: 0,
    ripples: 0,
    glow: -1,
    setPos(p: V3) {
      this.pos = [p[0], p[1], p[2]];
    },
    flare() {
      this.flares++;
    },
    ripple() {
      this.ripples++;
    },
    setBrightness(v: number) {
      this.glow = v;
    },
  };
  readonly root = new Group();
  readonly ctx: LanternCtx;
  readonly grab: LanternGrab;
  readonly events: FeelEvent[] = [];
  readonly said: string[] = [];
  private readonly at: [V3 | null, V3 | null] = [null, null];
  private readonly joints = {
    pinchPoint: (h: Side, out: Vector3) => {
      const p = this.at[h === "left" ? 0 : 1];
      if (!p) return false;
      out.set(p[0], p[1], p[2]);
      return true;
    },
  };

  constructor(ctx: Partial<LanternCtx> = {}) {
    this.ctx = { spots: [], lines: [], cmPerUnit: CM, minZ: LANTERN_MIN_Z, ...ctx };
    this.grab = new LanternGrab(this.ctrl, this.joints as unknown as HandJoints, { root: this.root, lantern: this.view }, this.pins);
  }

  /** A tracked hand pinching (or not) at `p`. */
  hand(side: Side, p: V3, pinching: boolean): void {
    const i = side === "left" ? 0 : 1;
    const pin = this.pins[i];
    pin.edge = pinching && !pin.pinching ? "start" : !pinching && pin.pinching ? "end" : null;
    pin.kind = "hand";
    pin.tracked = true;
    pin.pinching = pinching;
    this.at[i] = [...p];
  }

  /** The hand out of tracking; its pinch rides it out (the detector's `hold` for the holder). */
  lose(side: Side): void {
    const i = side === "left" ? 0 : 1;
    const pin = this.pins[i];
    pin.kind = "none";
    pin.tracked = false;
    pin.edge = null;
    pin.pinching = this.grab.holding(i as 0 | 1) ? pin.pinching : false;
    this.at[i] = null;
  }

  /** A controller: its trigger is the pinch, at its grip. */
  controller(side: Side, grip: V3, trigger: boolean): void {
    const i = side === "left" ? 0 : 1;
    const pin = this.pins[i];
    pin.edge = trigger && !pin.pinching ? "start" : !trigger && pin.pinching ? "end" : null;
    pin.kind = "controller";
    pin.tracked = true;
    pin.pinching = trigger;
    pin.point.set(grip[0], grip[1], grip[2]);
    this.at[i] = null;
  }

  frame(n = 1): void {
    for (let k = 0; k < n; k++) {
      this.t += this.dt;
      this.grab.update(this.t, this.ctx);
      for (let e = 0; e < this.grab.eventCount; e++) this.events.push({ ...this.grab.events[e]! });
      // In the order they happen within a frame (as LanternSystem tells the bus): lost, let go, taken.
      if (this.grab.lostBy) this.said.push(`lost ${this.grab.lostBy}`);
      if (this.grab.releasedBy) this.said.push(`release ${this.grab.releasedBy}`);
      if (this.grab.grabbedBy) this.said.push(`grab ${this.grab.grabbedBy}`);
      // Edges last one frame.
      for (const pin of this.pins) pin.edge = null;
    }
  }

  types(): string[] {
    return this.events.map((e) => e.type).filter((t) => t !== "tick");
  }
}

describe("LanternGrab: one pinch stream", () => {
  it("grabs on a pinch starting within the grab radius, keeping the grip; flares; follows; lets go", () => {
    const b = new Bench();
    b.hand("right", add(START, [u(3), 0, 0]), false);
    b.frame(3);
    b.hand("right", add(START, [u(3), 0, 0]), true);
    b.frame();
    expect(b.grab.holder).toBe("right");
    expect(b.said).toEqual(["grab right"]);
    expect(b.view.flares).toBe(1);
    expect(b.view.pos).toEqual(START);
    // Carry it 4 cm up: the lantern keeps its 3 cm offset from the fingers.
    for (let i = 1; i <= 30; i++) {
      b.hand("right", add(START, [u(3), u((4 * i) / 30), 0]), true);
      b.frame();
    }
    b.frame(60);
    expect(b.view.pos[1]).toBeCloseTo(START[1] + u(4), 3);
    expect(b.view.pos[0]).toBeCloseTo(START[0], 3);
    b.hand("right", add(START, [u(3), u(4), 0]), false);
    b.frame();
    expect(b.grab.holder).toBeNull();
    expect(b.said).toEqual(["grab right", "release right"]);
    expect(b.types()).toEqual(["grab", "release"]);
  });

  it("never grabs on a pinch starting outside the radius, even once it moves onto the lantern", () => {
    const b = new Bench();
    b.hand("right", add(START, [u(GRAB_RADIUS_CM + 1), 0, 0]), false);
    b.frame();
    b.hand("right", add(START, [u(GRAB_RADIUS_CM + 1), 0, 0]), true);
    b.frame();
    for (let i = 0; i < 20; i++) {
      b.hand("right", add(START, [u(GRAB_RADIUS_CM + 1 - i * 0.4), 0, 0]), true);
      b.frame();
    }
    expect(b.grab.holder).toBeNull();
    expect(b.events).toEqual([]);
  });

  it("the other hand mid-pinch elsewhere neither hides a grab start nor counts as one", () => {
    const b = new Bench();
    const drawer: V3 = [-0.2, -0.6, 1.3];
    // The left hand pulls the drawer: pinching the whole time, far from the lantern.
    b.hand("left", drawer, false);
    b.hand("right", add(START, [0, u(10), 0]), false);
    b.frame();
    b.hand("left", drawer, true);
    b.frame(5);
    // The right hand's pinch starts on the lantern while the left still pinches: it grabs.
    b.hand("left", drawer, true);
    b.hand("right", add(START, [0, u(2), 0]), true);
    b.frame();
    expect(b.grab.holder).toBe("right");
    // The right lets go while the left keeps pinching: it is let go.
    b.hand("left", drawer, true);
    b.hand("right", add(START, [0, u(2), 0]), false);
    b.frame();
    expect(b.grab.holder).toBeNull();
    // The left hand, still pinching, comes onto the lantern: no grab (its pinch started elsewhere).
    for (let i = 0; i <= 10; i++) {
      b.hand("left", add(drawer, add(START, drawer, -1), i / 10), true);
      b.hand("right", add(START, [0, u(2), 0]), false);
      b.frame();
    }
    expect(b.grab.holder).toBeNull();
    // The left opens and closes on the lantern: now it grabs.
    b.hand("left", START, false);
    b.frame();
    b.hand("left", START, true);
    b.frame();
    expect(b.grab.holder).toBe("left");
    expect(b.said).toEqual(["grab right", "release right", "grab left"]);
  });

  it("while held the other hand's pinch on the lantern changes nothing", () => {
    const b = new Bench();
    b.hand("right", START, false);
    b.frame();
    b.hand("right", START, true);
    b.frame();
    b.hand("left", add(START, [u(-2), 0, 0]), false);
    b.frame();
    b.hand("left", add(START, [u(-2), 0, 0]), true);
    b.hand("right", START, true);
    b.frame(5);
    expect(b.grab.holder).toBe("right");
    // The holder lets go: released, though the left still pinches right beside it.
    b.hand("right", START, false);
    b.hand("left", add(START, [u(-2), 0, 0]), true);
    b.frame();
    expect(b.grab.holder).toBeNull();
    expect(b.types()).toEqual(["grab", "release"]);
  });

  it("two pinches starting on it at once: the nearer takes it", () => {
    const b = new Bench();
    b.hand("left", add(START, [u(-1), 0, 0]), false);
    b.hand("right", add(START, [u(4), 0, 0]), false);
    b.frame();
    b.hand("left", add(START, [u(-1), 0, 0]), true);
    b.hand("right", add(START, [u(4), 0, 0]), true);
    b.frame();
    expect(b.grab.holder).toBe("left");
  });

  it("a controller's trigger is the pinch, at its grip", () => {
    const b = new Bench();
    b.controller("right", add(START, [0, u(2), u(1)]), false);
    b.frame();
    b.controller("right", add(START, [0, u(2), u(1)]), true);
    b.frame();
    expect(b.grab.holder).toBe("right");
    for (let i = 1; i <= 20; i++) {
      b.controller("right", add(START, [u(-i / 5), u(2), u(1)]), true);
      b.frame();
    }
    b.frame(60);
    expect(b.view.pos[0]).toBeCloseTo(START[0] - u(4), 3);
    b.controller("right", add(START, [u(-4), u(2), u(1)]), false);
    b.frame();
    expect(b.said).toEqual(["grab right", "release right"]);
  });
});

describe("LanternGrab: tracking lost while holding", () => {
  const held = () => {
    const b = new Bench();
    b.hand("right", START, false);
    b.frame();
    b.hand("right", START, true);
    b.frame();
    for (let i = 1; i <= 20; i++) {
      b.hand("right", add(START, [u(-i / 10), u(i / 10), 0]), true);
      b.frame();
    }
    b.frame(60);
    return b;
  };

  it("keeps the lantern exactly where it is, held, with no release; says so once after the grace time", () => {
    const b = held();
    b.lose("right");
    b.frame();
    const kept = [...b.view.pos];
    for (let i = 0; i < 144; i++) {
      b.frame();
      expect(b.view.pos).toEqual(kept);
      expect(b.grab.holder).toBe("right");
    }
    expect(b.types()).toEqual(["grab"]);
    expect(b.said).toEqual(["grab right", "lost right"]);
  });

  it("back with the hand open: let go where it stood, at once", () => {
    const b = held();
    b.lose("right");
    b.frame(30);
    const kept = [...b.view.pos] as V3;
    b.pins[1].pinching = false; // the detector ends the pinch on the first frame back open
    b.hand("right", add(kept, [u(5), u(5), 0]), false);
    b.frame();
    expect(b.grab.holder).toBeNull();
    expect(b.view.pos).toEqual(kept);
    expect(b.said).toEqual(["grab right", "lost right", "release right"]);
  });

  it("back still pinched: still held with the same grip, following the hand again", () => {
    const b = held();
    const before = [...b.view.pos] as V3;
    b.lose("right");
    b.frame(30);
    // The hand comes back where it was and moves 3 cm right.
    const hand = add(START, [u(-2), u(2), 0]);
    for (let i = 0; i <= 20; i++) {
      b.hand("right", add(hand, [u((3 * i) / 20), 0, 0]), true);
      b.frame();
    }
    b.frame(60);
    expect(b.grab.holder).toBe("right");
    expect(b.view.pos[0]).toBeCloseTo(before[0] + u(3), 3);
    expect(b.types()).toEqual(["grab"]);
  });

  it("once the loss is told, the other hand's pinch takes it: let go where it stood, then grabbed, in one frame", () => {
    const b = held();
    b.lose("right");
    b.frame();
    const kept = [...b.view.pos] as V3;
    const beside = add(kept, [u(-2), 0, 0]);
    // Within the grace time a pinch of the other hand changes nothing.
    b.hand("left", beside, false);
    b.frame(2);
    b.hand("left", beside, true);
    b.frame();
    expect(b.grab.holder).toBe("right");
    expect(b.said).toEqual(["grab right"]);
    // Past it (the loss told), a new pinch of the other hand within the grab radius takes the lantern.
    b.hand("left", beside, false);
    b.frame(12);
    expect(b.said).toEqual(["grab right", "lost right"]);
    expect(b.grab.holder).toBe("right");
    b.hand("left", beside, true);
    b.frame();
    expect(b.grab.holder).toBe("left");
    expect(b.said).toEqual(["grab right", "lost right", "release right", "grab left"]);
    expect(b.types()).toEqual(["grab", "release", "grab"]);
    expect(b.view.pos).toEqual(kept);
    expect([b.grab.holding(0), b.grab.holding(1)]).toEqual([true, false]);
    // The new hand carries it with its own grip; the old hand coming back still pinched changes nothing.
    for (let i = 1; i <= 20; i++) {
      b.hand("left", add(beside, [0, u((3 * i) / 20), 0]), true);
      b.hand("right", add(kept, [u(1), 0, 0]), true);
      b.frame();
    }
    b.frame(60);
    expect(b.grab.holder).toBe("left");
    expect(b.view.pos[1]).toBeCloseTo(kept[1] + u(3), 3);
    expect(b.types()).toEqual(["grab", "release", "grab"]);
  });

  it("a pinch of the other hand outside the grab radius never takes a lost hold", () => {
    const b = held();
    b.lose("right");
    b.frame(20);
    const far = add(b.view.pos, [u(-(GRAB_RADIUS_CM + 2)), 0, 0]);
    b.hand("left", far, false);
    b.frame();
    b.hand("left", far, true);
    b.frame();
    expect(b.grab.holder).toBe("right");
    expect(b.said).toEqual(["grab right", "lost right"]);
  });

  it("drop lets a hold go where the lantern stands, reported by the next update; a hand still pinching does not grab again", () => {
    const b = held();
    const kept = [...b.view.pos] as V3;
    b.grab.drop(b.t, b.ctx);
    expect(b.grab.holder).toBeNull();
    expect(b.ctrl.held).toBe(false);
    b.grab.place(START);
    b.frame();
    expect(b.said).toEqual(["grab right", "release right"]);
    expect(b.types()).toEqual(["grab", "release"]);
    expect(b.view.pos).toEqual(START);
    // The hand, still pinching beside where it was, moves on: the lantern stays at its new place.
    for (let i = 1; i <= 20; i++) {
      b.hand("right", add(kept, [u(i / 5), 0, 0]), true);
      b.frame();
    }
    expect(b.view.pos).toEqual(START);
    expect(b.grab.holder).toBeNull();
    // Nobody holding: drop does nothing.
    b.grab.drop(b.t, b.ctx);
    b.frame();
    expect(b.said).toEqual(["grab right", "release right"]);
  });
});

describe("LanternGrab: the view", () => {
  it("brightens with hand proximity: 0 from 30 cm, 1 within 6 cm, smoothly, full while held", () => {
    const b = new Bench();
    const at = (cm: number) => {
      b.hand("right", add(START, [u(cm), 0, 0]), false);
      b.frame(72);
      return b.grab.brightness;
    };
    expect(at(40)).toBe(0);
    expect(at(GLOW_FAR_CM)).toBe(0);
    expect(at(18)).toBeCloseTo((GLOW_FAR_CM - 18) / (GLOW_FAR_CM - GLOW_NEAR_CM), 2);
    expect(at(GLOW_NEAR_CM)).toBe(1);
    expect(at(2)).toBe(1);
    // Smooth: one frame after the hand jumps from 40 cm to 3 cm it is on its way, not there.
    at(40);
    b.hand("right", add(START, [u(3), 0, 0]), false);
    b.frame();
    expect(b.grab.brightness).toBeGreaterThan(0.1);
    expect(b.grab.brightness).toBeLessThan(0.3);
    expect(b.view.glow).toBe(b.grab.brightness);
    // No hand at all: it fades out.
    b.lose("right");
    b.frame(72);
    expect(b.grab.brightness).toBe(0);
  });

  it("a hand within reach or holding is busy (its ray off); only the holder holds", () => {
    const b = new Bench();
    b.hand("right", add(START, [u(20), 0, 0]), false);
    b.hand("left", add(START, [u(-10), 0, 0]), false);
    b.frame();
    expect([b.grab.busy(0), b.grab.busy(1)]).toEqual([true, false]);
    b.hand("right", add(START, [u(1), 0, 0]), true);
    b.frame();
    expect([b.grab.holding(0), b.grab.holding(1)]).toEqual([false, true]);
    expect(b.grab.busy(1)).toBe(true);
  });

  it("tells where the hand nearest the lantern pinches (box units), and nothing with no hand in tracking", () => {
    const b = new Bench();
    const out: V3 = [9, 9, 9];
    b.frame();
    expect(b.grab.nearestPinch(out)).toBe(false);
    b.hand("right", add(START, [u(20), 0, 0]), false);
    b.hand("left", add(START, [u(-8), 0, 0]), false);
    b.frame();
    expect(b.grab.nearestPinch(out)).toBe(true);
    add(START, [u(-8), 0, 0]).forEach((v, k) => expect(out[k]).toBeCloseTo(v, 9));
    b.lose("left");
    b.frame();
    expect(b.grab.nearestPinch(out)).toBe(true);
    add(START, [u(20), 0, 0]).forEach((v, k) => expect(out[k]).toBeCloseTo(v, 9));
  });

  it("shows the ring beam only while riding a line, from its mark toward the lantern; ripples on a settle", () => {
    // A ring line through a spot; the lantern starts on it, 6 cm out from the spot.
    const spotL: V3 = [0.1, -0.25, 1.3];
    const mark: V3 = [0.02, 0.05, 0];
    const dir: V3 = [spotL[0] - mark[0], spotL[1] - mark[1], spotL[2]];
    const n = Math.hypot(...dir);
    const out: V3 = [dir[0] / n, dir[1] / n, dir[2] / n];
    const line: RingLine = { lock: 0, mark, dir, aligned: true };
    const b = new Bench({ spots: [{ lock: 0, L: spotL, open: false }], lines: [line] });
    const startOn = add(spotL, out, u(6));
    b.grab.place(startOn);
    b.hand("right", startOn, false);
    b.frame();
    b.hand("right", startOn, true);
    b.frame();
    expect(b.grab.beam.shown).toBe(false);
    b.hand("right", startOn, true);
    b.frame(40);
    expect(b.ctrl.mode).toBe("line");
    expect(b.grab.beam.shown).toBe(true);
    const m = b.grab.beam.mesh;
    expect(m.position.toArray()).toEqual(mark);
    const along = new Vector3(0, 1, 0).applyQuaternion(m.quaternion);
    expect(along.distanceTo(new Vector3(...out))).toBeLessThan(1e-6);
    // It reaches to just short of the lantern.
    const reach = (b.view.pos[0] - mark[0]) * out[0] + (b.view.pos[1] - mark[1]) * out[1] + (b.view.pos[2] - mark[2]) * out[2];
    expect(m.scale.y).toBeCloseTo(reach - BEAM.gap, 9);
    expect(b.root.children).toContain(m);
    // Slowly onto the spot: settled (beam off) with a ripple.
    for (let i = 1; i <= 216; i++) {
      b.hand("right", add(spotL, out, u(6 - (6 * i) / 216)), true);
      b.frame();
    }
    b.frame(30);
    expect(b.ctrl.mode).toBe("settled");
    expect(b.grab.beam.shown).toBe(false);
    expect(b.view.ripples).toBe(1);
    expect(b.view.pos).toEqual(spotL);
  });

  it("places the lantern never deeper than the box front", () => {
    const b = new Bench();
    b.grab.place([0.1, -0.2, 0.4]);
    expect(b.view.pos).toEqual([0.1, -0.2, LANTERN_MIN_Z]);
    expect(b.ctrl.pos).toEqual([0.1, -0.2, LANTERN_MIN_Z]);
    b.grab.place([0.1, -0.2, 1.4]);
    expect(b.ctrl.pos).toEqual([0.1, -0.2, 1.4]);
  });

  it("reuses its event array, the input it gives the controller and its pinch point arrays every frame", () => {
    const b = new Bench();
    const events = b.grab.events;
    const seen: { inp: LanternInput; pos: V3 | null }[] = [];
    const update = b.ctrl.update.bind(b.ctrl);
    b.ctrl.update = (inp: LanternInput, ctx: LanternCtx) => {
      seen.push({ inp, pos: inp.pinchPos });
      update(inp, ctx);
    };
    b.hand("right", START, false);
    b.frame(5); // nobody pinching
    b.hand("right", START, true);
    b.frame(); // the grab
    for (let i = 1; i <= 20; i++) {
      b.hand("right", add(START, [u(i / 10), 0, 0]), true);
      b.frame(); // held and moving
    }
    expect(seen).toHaveLength(26);
    expect(new Set(seen.map((s) => s.inp)).size).toBe(1);
    expect(new Set(seen.slice(0, 5).map((s) => s.pos)).size).toBe(1);
    expect(new Set(seen.slice(6).map((s) => s.pos)).size).toBe(1);
    expect(seen.every((s) => s.pos !== null)).toBe(true);
    expect(b.grab.events).toBe(events);
    expect(events.length).toBe(32);
  });
});
