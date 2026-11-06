import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLessonLock, LESSON_1, LESSON_2, lessonPlan } from "../../src/core/lessons-data";
import type { V3 } from "../../src/core/types";
import {
  type DirectorDeps,
  EXAMPLES,
  exampleFor,
  FORM_MS,
  IDLE_GHOST_MS,
  LESSON_STEPS,
  type LessonInputs,
  LessonsDirector,
  openBefore,
  PUPPET_MAX_MS,
  PUPPET_MS,
  YOUR_TURN_MS,
} from "../../src/app/lessons-director";
import { COPY } from "../../src/ui/copy";
import { expectCleanCopy } from "./helpers/ui";

const C = COPY.lessons;

/** Scripted player: each answer is a field the test sets. */
class FakeInputs implements LessonInputs {
  isHeld = false;
  isActive = false;
  open = new Set<number>();
  alignedLocks = new Set<number>();
  beam = false;
  isSettled = false;
  pulled = false;
  reduced = false;
  at: V3 = [0.35, -0.3, 1.35];
  held = () => this.isHeld;
  active = () => this.isActive;
  isOpen = (lock: number) => this.open.has(lock);
  aligned = (lock: number) => this.alignedLocks.has(lock);
  inBeam = () => this.beam;
  settled = () => this.isSettled;
  drawerPulled = () => this.pulled;
  reducedMotion = () => this.reduced;
  lantern = (out: V3): V3 => {
    out[0] = this.at[0];
    out[1] = this.at[1];
    out[2] = this.at[2];
    return out;
  };
}

interface Rig {
  d: LessonsDirector;
  inp: FakeInputs;
  deps: Required<DirectorDeps>;
  /** Time now (ms). */
  t: number;
  /** Step frames 16 ms apart for `ms`, calling `each` after every frame. */
  run(ms: number, each?: () => void): void;
  /** Step until `pred` holds (at most `max` ms); returns the time it took. */
  until(pred: () => boolean, max?: number): number;
}

function rig(left = false): Rig {
  const inp = new FakeInputs();
  const deps: Required<DirectorDeps> = {
    inputs: inp,
    leftHanded: () => left,
    onStep: vi.fn(),
    onDone: vi.fn(),
    onReplay: vi.fn(),
  };
  const r: Rig = {
    d: new LessonsDirector(deps),
    inp,
    deps,
    t: 0,
    run(ms, each) {
      const end = r.t + ms;
      while (r.t < end) {
        r.t = Math.min(end, r.t + 16);
        r.d.update(r.t);
        each?.();
      }
    },
    until(pred, max = 60_000) {
      const t0 = r.t;
      while (!pred()) {
        if (r.t - t0 > max) throw new Error(`still waiting after ${max} ms (step ${r.d.step})`);
        r.t += 16;
        r.d.update(r.t);
      }
      return r.t - t0;
    },
  };
  return r;
}

/** Plays the running example (or demo step) to its end, collecting what the frame showed. */
function watch(r: Rig): {
  lines: string[];
  clicks: number;
  maxLayout: number[];
  minLayout: number[];
  glow: number;
  fill: number;
  ghostLight: boolean;
  maxHand: number;
  maxLamp: number;
  park: number;
  lift: V3 | null;
} {
  const f = r.d.frame, seen: string[] = [], clicks0 = f.clicks;
  const maxLayout = [1, 1, 1], minLayout = [1, 1, 1];
  let glow = 0, fill = 0, ghostLight = false, maxHand = 0, maxLamp = 0, park = 0, lift: V3 | null = null;
  const step0 = r.d.step, replaying = r.d.replaying;
  r.until(() => {
    if (f.line && seen[seen.length - 1] !== f.line) seen.push(f.line);
    if (f.lift) lift = [f.lift[0], f.lift[1], f.lift[2]];
    for (let k = 0; k < 3; k++) {
      maxLayout[k] = Math.max(maxLayout[k]!, f.layout[k]!);
      minLayout[k] = Math.min(minLayout[k]!, f.layout[k]!);
    }
    glow = Math.max(glow, f.glow);
    fill = Math.max(fill, f.fill);
    ghostLight ||= f.ghostLight;
    maxHand = Math.max(maxHand, f.hand.opacity);
    maxLamp = Math.max(maxLamp, f.lamp.opacity);
    park = Math.max(park, f.park);
    return replaying ? r.d.replaying === null : r.d.step !== step0;
  });
  return { lines: seen, clicks: f.clicks - clicks0, maxLayout, minLayout, glow, fill, ghostLight, maxHand, maxLamp, park, lift };
}

describe("exampleFor", () => {
  const lock = (o: { finger?: boolean; rings?: boolean; hidden?: boolean }) => {
    const l = buildLessonLock("Crown", [0, 0], 0.4, [0.2, -0.3, 1.35], [0.3, 0.3, 0.4, 0.5, 0.4], o.finger ? { missing: 3 } : {}).lock;
    return { ...l, rings: o.rings ?? false, hidden: o.hidden ?? false };
  };
  it("shows a finger lock's example first, then a ringed lock's, else near and far", () => {
    expect(exampleFor(lock({ finger: true, rings: true }))).toBe("finger");
    expect(exampleFor(lock({ finger: true }))).toBe("finger");
    expect(exampleFor(lock({ rings: true }))).toBe("rings");
    expect(exampleFor(lock({ rings: true, hidden: true }))).toBe("rings");
    expect(exampleFor(lock({}))).toBe("near-far");
    expect(exampleFor(lock({ hidden: true }))).toBe("near-far");
    // Each lesson lock asks for its own example.
    expect(LESSON_1.locks.slice(1).map(exampleFor)).toEqual(["near-far", "rings"]);
    expect(exampleFor(LESSON_2.locks[0]!)).toBe("finger");
    expect(EXAMPLES).toEqual({
      move: { lesson: "l1", lock: 0 },
      "near-far": { lesson: "l1", lock: 1 },
      rings: { lesson: "l1", lock: 2 },
      finger: { lesson: "l2", lock: 0 },
    });
  });
});

describe("LessonsDirector: lesson 1", () => {
  let r: Rig;
  beforeEach(() => {
    r = rig();
  });

  it("forms the box from light over 2 s, then asks for the lantern and waits for a hand to hold it", () => {
    r.d.start("l1");
    r.d.update(0);
    expect([r.d.step, r.d.done, r.d.lesson]).toEqual([0, false, "l1"]);
    expect(r.deps.onStep).toHaveBeenCalledWith("l1", 0);
    expect(r.d.frame.form).toBe(0);
    expect(r.d.frame.line).toBeNull();
    r.run(FORM_MS / 2);
    expect(r.d.frame.form).toBeCloseTo(0.5, 1);
    r.run(FORM_MS / 2);
    expect(r.d.frame.form).toBe(1);
    expect(r.d.frame.line).toBe(C.pickUp);
    r.run(20_000);
    expect(r.d.step).toBe(0);
    r.inp.isHeld = true;
    r.run(16);
    expect(r.d.step).toBe(1);
    expect(r.d.frame.line).toBe(C.watchMove);
    expect(r.deps.onStep).toHaveBeenLastCalledWith("l1", 1);
  });

  it("steps through every step in order, each on its own completion predicate", () => {
    expect(LESSON_STEPS.l1.map((s) => s.kind)).toEqual(["intro", "move", "demo", "turn", "demo", "turn", "reward"]);
    r.d.start("l1");
    r.run(FORM_MS);
    r.inp.isHeld = true;
    r.run(16);
    // Lock I: only its opening moves on.
    r.run(5000);
    expect(r.d.step).toBe(1);
    r.inp.open.add(0);
    r.run(16);
    // Example 1: staged on the twin, three beats, one click, the scraps swing back, the lantern lifts out.
    expect(r.d.step).toBe(2);
    expect(r.d.frame.line).toBe(C.watch);
    const ex1 = watch(r);
    expect(ex1.lines).toEqual([C.watch, C.nearSwing, C.yourTurn]);
    expect(ex1.clicks).toBe(1);
    expect(ex1.minLayout[1]).toBe(0);
    expect(ex1.minLayout[0]).toBe(1);
    expect(ex1.minLayout[2]).toBe(1);
    expect(ex1.glow).toBeCloseTo(1, 6);
    expect(ex1.park).toBe(1);
    expect(ex1.ghostLight).toBe(true);
    expect(ex1.maxHand).toBe(1);
    expect(ex1.maxLamp).toBe(1);
    expect(r.d.step).toBe(3);
    expect(r.d.frame.layout[1]).toBe(1);
    expect(r.d.frame.park).toBe(0);
    expect(r.d.frame.ghostLight).toBe(false);
    expect(r.d.frame.line).toBe(C.yourTurn);
    r.run(YOUR_TURN_MS);
    expect(r.d.frame.line).toBe(C.nearSwing);
    r.run(10_000);
    expect(r.d.step).toBe(3);
    r.inp.open.add(1);
    r.run(16);
    // Example 2: line up, ride the line, slide to the click.
    expect(r.d.step).toBe(4);
    const ex2 = watch(r);
    expect(ex2.lines).toEqual([C.watch, C.lineUp, C.slide, C.yourTurn]);
    expect(ex2.clicks).toBe(1);
    expect(ex2.minLayout[2]).toBe(0);
    expect(r.d.step).toBe(5);
    r.run(YOUR_TURN_MS);
    expect(r.d.frame.line).toBe(C.lineUp);
    // The line follows the rings, but only once they have stayed lined up (or apart) for a moment.
    r.inp.alignedLocks.add(2);
    r.run(200);
    expect(r.d.frame.line).toBe(C.lineUp);
    r.run(400);
    expect(r.d.frame.line).toBe(C.slide);
    r.inp.alignedLocks.clear();
    r.run(200);
    r.inp.alignedLocks.add(2);
    r.run(400);
    expect(r.d.frame.line).toBe(C.slide);
    r.inp.open.add(2);
    r.run(16);
    // The box opens: no line until the reward is out of the box.
    expect(r.d.step).toBe(6);
    expect(r.d.frame.line).toBeNull();
    r.run(5000);
    expect(r.d.done).toBe(false);
    r.inp.isSettled = true;
    r.run(16);
    expect(r.d.done).toBe(true);
    expect(r.deps.onDone).toHaveBeenCalledTimes(1);
    expect(r.deps.onDone).toHaveBeenCalledWith("l1");
    expect((r.deps.onStep as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.d.frame.line).toBeNull();
    expect(r.d.frame.hand.opacity).toBe(0);
  });

  it("runs Example 1 in about twelve seconds of ghost work, its near scrap glowing", () => {
    r.d.start("l1", 2);
    let first = -1, last = -1;
    const t0 = r.t;
    const res = watch(r);
    // Measure the ghost's own time: from the hand showing to it gone.
    r.d.start("l1", 2);
    const t1 = r.t;
    r.until(() => {
      if (r.d.frame.hand.opacity > 0 && first < 0) first = r.t - t1;
      if (r.d.frame.hand.opacity > 0) last = r.t - t1;
      return r.d.step !== 2;
    });
    expect(last - first).toBeGreaterThan(10_000);
    expect(last - first).toBeLessThan(14_000);
    expect(r.t - t0).toBeLessThan(40_000);
    expect(res.glow).toBeCloseTo(1, 6);
    // The near scrap is the shaft, hung at 0.7.
    const twin = lessonPlan("l1", false).twins[1]!;
    const near = twin.elements.find((e) => e.kind === "piece" && e.verts[0]![2] === 0.7);
    expect(near && near.kind === "piece" && near.piece).toBe(0);
  });

  it("shows the ghost hand only after 4 s without input, and lets it go when the player moves", () => {
    r.d.start("l1");
    r.run(IDLE_GHOST_MS - 16);
    expect(r.d.frame.hand.opacity).toBe(0);
    r.run(500);
    expect(r.d.frame.hand.opacity).toBeGreaterThan(0);
    r.run(2000);
    // It reaches for the lantern: within a few centimetres of it at some point of its loop.
    let nearest = Infinity;
    r.run(4000, () => {
      const a = r.d.frame.hand.at, b = r.inp.at;
      if (r.d.frame.hand.opacity > 0.5) nearest = Math.min(nearest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    });
    expect(nearest).toBeLessThan(0.02);
    expect(r.d.frame.hand.anchor).toBe("grasp");
    expect(r.d.frame.hand.side).toBe("right");
    // Input sends it away within a fade, and restarts the 4 s.
    r.inp.isActive = true;
    r.run(400);
    expect(r.d.frame.hand.opacity).toBe(0);
    r.inp.isActive = false;
    r.run(IDLE_GHOST_MS - 100);
    expect(r.d.frame.hand.opacity).toBe(0);
    r.run(600);
    expect(r.d.frame.hand.opacity).toBeGreaterThan(0);
  });

  it("restarts the idle clock with any input before the 4 s are up", () => {
    r.d.start("l1");
    r.run(3000);
    r.inp.isActive = true;
    r.run(16);
    r.inp.isActive = false;
    r.run(3900);
    expect(r.d.frame.hand.opacity).toBe(0);
    r.run(600);
    expect(r.d.frame.hand.opacity).toBeGreaterThan(0);
  });

  it("skips an example whose lock the player already opened", () => {
    r.inp.open.add(1);
    r.d.start("l1", 2);
    r.run(16);
    expect(r.d.step).toBe(4);
    expect(r.d.frame.line).toBe(C.watch);
    expect(r.deps.onStep).toHaveBeenCalledTimes(1);
    expect(r.deps.onStep).toHaveBeenCalledWith("l1", 4);
  });

  it("resumes at the start of a step, the locks of the steps before it open", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => openBefore("l1", n))).toEqual([[], [], [0], [0], [0, 1], [0, 1], [0, 1, 2]]);
    expect([0, 1, 2, 3].map((n) => openBefore("l2", n))).toEqual([[], [], [], [0]]);
    r.d.start("l1", 3);
    r.run(16);
    expect(r.d.step).toBe(3);
    expect(r.d.frame.line).toBe(C.yourTurn);
    expect([...r.d.frame.layout]).toEqual([1, 1, 1]);
    expect(r.d.frame.park).toBe(0);
    // A damaged step starts the lesson over.
    for (const bad of [99, -1, 2.5, Number.NaN]) {
      r.d.start("l1", bad);
      expect(r.d.step).toBe(0);
    }
  });

  it("swings the scraps back past their places and settles them, and without overshoot with reduced motion", () => {
    r.d.start("l1", 2);
    expect(watch(r).maxLayout[1]).toBeGreaterThan(1.02);
    r.inp.reduced = true;
    r.d.start("l1", 2);
    const res = watch(r);
    expect(res.maxLayout[1]).toBeLessThanOrEqual(1);
    expect(res.minLayout[1]).toBe(0);
  });

  it("keeps one frame, written in place", () => {
    const f = r.d.frame, hand = f.hand, at = f.hand.at, lamp = f.lamp.at, layout = f.layout;
    r.d.start("l1");
    r.run(6000);
    r.inp.isHeld = true;
    r.inp.open.add(0);
    r.run(20_000);
    expect(r.d.frame).toBe(f);
    expect([f.hand, f.hand.at, f.lamp.at, f.layout]).toEqual([hand, at, lamp, layout]);
    expect(f.hand.at).toBe(at);
    expect(f.lamp.at).toBe(lamp);
  });

  it("mirrors the examples and the ghost hand for a left-handed player", () => {
    const left = rig(true), right = rig(false);
    left.d.start("l1", 4);
    right.d.start("l1", 4);
    let compared = 0;
    for (let i = 0; i < 600; i++) {
      left.run(16);
      right.run(16);
      const a = left.d.frame, b = right.d.frame;
      expect(a.hand.side).toBe("left");
      expect(b.hand.side).toBe("right");
      if (b.lamp.opacity > 0) {
        expect(a.lamp.at[0]).toBeCloseTo(-b.lamp.at[0], 12);
        expect(a.lamp.at[1]).toBeCloseTo(b.lamp.at[1], 12);
        expect(a.hand.at[0]).toBeCloseTo(-b.hand.at[0], 12);
        expect(a.hand.fingers[0]).toBeCloseTo(-b.hand.fingers[0], 12);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });
});

describe("LessonsDirector: lesson 2", () => {
  let r: Rig;
  beforeEach(() => {
    r = rig();
  });

  it("plays shadow puppets, the finger example, the player's crown, then teaches the drawer", () => {
    expect(LESSON_STEPS.l2.map((s) => s.kind)).toEqual(["puppets", "demo", "turn", "drawer"]);
    r.d.start("l2");
    // The first frame after a start counts no time.
    r.d.update(r.t);
    r.run(FORM_MS);
    expect(r.d.frame.line).toBe(C.puppets);
    // Five seconds of a hand in the beam, counted only while it is there.
    r.inp.beam = true;
    r.run(2000);
    r.inp.beam = false;
    r.run(2000);
    r.inp.beam = true;
    r.run(PUPPET_MS - 2000 - 100);
    expect(r.d.step).toBe(0);
    r.run(200);
    expect(r.d.step).toBe(1);
    r.inp.beam = false;
    // Example 3: a pale-blue ghost finger fills the twin crown's prong, then the player's lantern settles on the spot.
    const ex3 = watch(r);
    expect(ex3.lines).toEqual([C.watch, C.finger, C.yourTurn]);
    expect(ex3.clicks).toBe(1);
    expect(ex3.fill).toBe(1);
    expect(ex3.minLayout[0]).toBe(0);
    expect(r.d.step).toBe(2);
    expect(ex3.lift).toEqual(LESSON_2.locks[0]!.L);
    expect(r.d.frame.lift).toBeNull();
    expect(r.d.frame.line).toBe(C.yourTurn);
    r.run(YOUR_TURN_MS);
    expect(r.d.frame.line).toBe(C.finger);
    r.inp.open.add(0);
    r.run(16);
    // The drawer: its line waits for the box's celebration, and stays until the drawer is pulled once.
    expect(r.d.step).toBe(3);
    expect(r.d.frame.line).toBeNull();
    r.inp.isSettled = true;
    r.run(16);
    expect(r.d.frame.line).toBe(C.drawer);
    r.run(30_000);
    expect(r.d.done).toBe(false);
    r.inp.pulled = true;
    r.run(16);
    expect(r.d.done).toBe(true);
    expect(r.deps.onDone).toHaveBeenCalledWith("l2");
  });

  it("points the ghost's index finger along the twin's missing prong, in the beam", () => {
    r.d.start("l2", 1);
    let tipSeen = false;
    r.until(() => {
      const h = r.d.frame.hand;
      if (h.opacity === 1 && r.d.frame.fill > 0) {
        tipSeen = true;
        expect(h.anchor).toBe("tip");
        expect(h.poseA).toBe("point");
        expect(h.at[2]).toBeLessThanOrEqual(1);
        expect(h.at[2]).toBeGreaterThan(0.5);
        const a = lessonPlan("l2", false).twins[0]!.lock.fingerAngle;
        // Along the prong (either way), level with the panel.
        expect(Math.abs(h.fingers[0] * Math.cos(a) + h.fingers[1] * Math.sin(a))).toBeGreaterThan(0.99);
        expect(Math.abs(h.fingers[2])).toBeLessThan(1e-9);
      }
      return r.d.step !== 1;
    });
    expect(tipSeen).toBe(true);
  });

  it("moves on from the puppets after a while even without a hand in the beam, the ghost showing how", () => {
    r.d.start("l2");
    let ghost = false;
    r.run(PUPPET_MAX_MS - 100, () => {
      const h = r.d.frame.hand;
      if (h.opacity <= 0) return;
      ghost = true;
      // The ghost hand enters through the box mouth, and a human-sized hand (19 cm from wrist to fingertip) stays
      // under the lid even in the smallest box (18 cm: 1.06 box units).
      expect(h.anchor).toBe("wrist");
      expect(h.at[2]).toBeLessThanOrEqual(1);
      expect(h.at[1] + h.fingers[1] * (0.19 / 0.18)).toBeLessThan(0.45);
      expect(h.at[2] + h.fingers[2] * (0.19 / 0.18)).toBeGreaterThan(0);
    });
    expect(ghost).toBe(true);
    expect(r.d.step).toBe(0);
    r.run(200);
    expect(r.d.step).toBe(1);
  });
});

describe("LessonsDirector: replay", () => {
  it("runs one example alone, on a fresh lesson box, and never touches lesson progress", () => {
    const r = rig();
    r.d.start("l1", 5);
    r.run(YOUR_TURN_MS + 100);
    expect(r.d.frame.line).toBe(C.lineUp);
    (r.deps.onStep as ReturnType<typeof vi.fn>).mockClear();
    expect(r.d.replay("near-far")).toBe(true);
    expect(r.deps.onReplay).toHaveBeenCalledWith("near-far", "l1", true);
    expect(r.d.replaying).toBe("near-far");
    expect(r.d.replay("rings")).toBe(false);
    r.run(16);
    expect(r.d.frame.box).toBe("l1");
    expect(r.d.frame.line).toBe(C.watch);
    // Opening a lock meanwhile changes nothing until the replay is over.
    r.inp.open.add(2);
    const res = watch(r);
    expect(res.lines).toEqual([C.watch, C.nearSwing, C.yourTurn]);
    expect(res.clicks).toBe(1);
    expect(r.deps.onReplay).toHaveBeenLastCalledWith("near-far", "l1", false);
    expect(r.d.replaying).toBeNull();
    expect(r.d.frame.box).toBeNull();
    expect(r.deps.onStep).not.toHaveBeenCalled();
    expect(r.deps.onDone).not.toHaveBeenCalled();
    expect(r.d.step).toBe(5);
    r.run(16);
    expect(r.d.step).toBe(6);
  });

  it("plays every example from outside a lesson, each on its own lesson's box", () => {
    const r = rig();
    for (const ex of ["move", "near-far", "rings", "finger"] as const) {
      expect(r.d.replay(ex)).toBe(true);
      r.run(16);
      expect(r.d.frame.box).toBe(EXAMPLES[ex].lesson);
      const res = watch(r);
      expect(res.clicks).toBe(1);
      expect(res.lines[0]).toBe(C.watch);
      expect(res.lines[res.lines.length - 1]).toBe(C.yourTurn);
      if (ex === "move") expect(res.lines).toContain(C.watchMove);
      expect(r.d.frame.box).toBeNull();
      expect(r.d.lesson).toBeNull();
      r.run(1000);
      expect(r.d.frame.line).toBeNull();
      expect(r.d.frame.hand.opacity).toBe(0);
    }
    expect(r.deps.onStep).not.toHaveBeenCalled();
  });

  it("hands the box back when a replay is cut short by a lesson starting or a stop", () => {
    const r = rig();
    r.d.replay("finger");
    r.run(2000);
    r.d.start("l1");
    expect(r.deps.onReplay).toHaveBeenLastCalledWith("finger", "l2", false);
    expect(r.d.replaying).toBeNull();
    expect(r.d.frame.box).toBeNull();
    r.d.replay("rings");
    r.run(1000);
    r.d.stop();
    expect(r.deps.onReplay).toHaveBeenLastCalledWith("rings", "l1", false);
    expect(r.d.lesson).toBeNull();
    expect(r.deps.onReplay).toHaveBeenCalledTimes(4);
  });

  it("refuses a replay while a lesson's own example plays", () => {
    const r = rig();
    r.d.start("l1", 2);
    r.run(500);
    expect(r.d.replay("rings")).toBe(false);
  });

  it("says when an example is showing (the drawer stays shut meanwhile)", () => {
    const r = rig();
    expect(r.d.showing).toBe(false);
    r.d.start("l1", 1);
    r.run(500);
    expect(r.d.showing).toBe(false);
    // A lesson's own example, from its first frame to its last.
    r.d.start("l1", 2);
    expect(r.d.showing).toBe(true);
    r.run(16);
    expect(r.d.showing).toBe(true);
    watch(r);
    expect(r.d.showing).toBe(false);
    // A replay, until it hands the box back.
    r.d.replay("rings");
    expect(r.d.showing).toBe(true);
    watch(r);
    expect(r.d.showing).toBe(false);
    r.d.replay("move");
    r.d.stop();
    expect(r.d.showing).toBe(false);
  });
});

describe("lesson copy", () => {
  it("is word for word, with no em or en dashes", () => {
    expect([C.pickUp, C.watchMove, C.nearSwing, C.watch, C.yourTurn, C.lineUp, C.slide, C.finger, C.drawer]).toEqual([
      "Pick up the lantern.",
      "Watch the shadows move.",
      "Near pieces swing more.",
      "Watch.",
      "Your turn.",
      "Line up the two rings.",
      "Now slide nearer or farther until it fills.",
      "One piece is missing. Your finger can cast it.",
      "Pull the drawer to find these lessons again.",
    ]);
    expect(C.tips).toEqual({
      decoys: "Each lock has its own spot. Some scraps belong to none.",
      ringless: "No rings here. Read the shadows.",
      hidden: "This outline is hidden. What shape do the shadows make?",
    });
    expect(C.titles).toEqual({ l1: "Catch the light", l2: "Lend a hand" });
    expect(C.examples).toEqual({ move: "Move the light", "near-far": "Near and far", rings: "Sight the rings", finger: "Lend a hand" });
    expect(C.puppets).toMatch(/^[A-Z][^.]*\.$/);
    expectCleanCopy(C);
  });
});
