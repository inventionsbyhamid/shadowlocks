import { Matrix4, Vector3 } from "@iwsdk/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTipScript, gripOf, SAID, SWEEP_CLEAR } from "../../src/app/lesson-scripts";
import { tipLock } from "../../src/app/tips";
import { generateBox } from "../../src/core/generator";
import { buildLessonLock, LESSON_1, LESSON_2, lessonPlan } from "../../src/core/lessons-data";
import { mirrorBox } from "../../src/core/mirror";
import type { TipId } from "../../src/core/profile";
import type { Box, BoxSpec, V3 } from "../../src/core/types";
import { JOINT_COUNT } from "../../src/input/hand-joints";
import { GhostHand } from "../../src/render/ghost-hand";
import {
  BEAT_MS,
  type DirectorDeps,
  SUGGEST_AFTER_MS,
  FIRST_WIN_MS,
  EXAMPLES,
  exampleFor,
  FORM_MS,
  GHOST_CLEAR,
  IDLE_GHOST_MS,
  LESSON_STEPS,
  type LessonInputs,
  MARK_WARMTH,
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
  isRewardUp = false;
  /** The session's hint lantern glows (its stuck watch). */
  isStuck = false;
  /** The session's suggestion for the input in hand (held through brief drops), or null. */
  suggest: "controllerFinger" | null = null;
  pulled = false;
  reduced = false;
  /** Each lock's warmth (0 unless set). */
  warm = new Map<number, number>();
  at: V3 = [0.35, -0.3, 1.35];
  /** The real hand nearest the lantern: where it pinches (null: no hand in tracking). */
  handAt: V3 | null = null;
  held = () => this.isHeld;
  active = () => this.isActive;
  isOpen = (lock: number) => this.open.has(lock);
  aligned = (lock: number) => this.alignedLocks.has(lock);
  warmth = (lock: number) => this.warm.get(lock) ?? 0;
  inBeam = () => this.beam;
  settled = () => this.isSettled;
  rewardUp = () => this.isRewardUp;
  stuck = () => this.isStuck;
  suggestion = () => this.suggest;
  hand = (out: V3): boolean => {
    if (!this.handAt) return false;
    out[0] = this.handAt[0];
    out[1] = this.handAt[1];
    out[2] = this.handAt[2];
    return true;
  };
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
    onRestart: vi.fn(),
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

/**
 * Steps until `done`, placing a real GhostHand each frame the director shows one, as the view does (the box at the
 * origin, `sizeM` metres across: the ghost is human-sized whatever the box). Returns how far out (|x|) any joint
 * inside the box (z < 1) went, and where.
 */
function handInside(r: Rig, sizeM: number, done: () => boolean): { seen: number; worst: number; where: string } {
  const g = new GhostHand("right");
  const at = new Vector3(), fv = new Vector3(), pv = new Vector3(), w = new Vector3();
  const m = new Matrix4().makeScale(sizeM, sizeM, sizeM);
  let seen = 0, worst = 0, where = "";
  r.until(() => {
    const h = r.d.frame.hand;
    if (h.opacity > 0) {
      seen++;
      g.side = h.side;
      g.setPose(h.poseA, h.poseB, h.poseT);
      g.place(h.anchor, at.set(h.at[0], h.at[1], h.at[2]).applyMatrix4(m), fv.set(h.fingers[0], h.fingers[1], h.fingers[2]), pv.set(h.palm[0], h.palm[1], h.palm[2]));
      for (let j = 0; j < JOINT_COUNT; j++) {
        g.joint(j, w).divideScalar(sizeM);
        if (w.z < 1 && Math.abs(w.x) > worst) {
          worst = Math.abs(w.x);
          where = `joint ${j} at ${w.toArray().map((v) => v.toFixed(2))}, ${h.anchor} at ${h.at.map((v) => v.toFixed(2))}, fingers ${h.fingers.map((v) => v.toFixed(2))}`;
        }
      }
    }
    return done();
  });
  return { seen, worst, where };
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
    expect(r.d.frame.line).toBe(C.goal);
    expect(r.deps.onStep).toHaveBeenLastCalledWith("l1", 1);
  });

  it("says lock I's goal the moment the lantern is picked up, and tells which copy key shows and why", () => {
    r.d.start("l1");
    // The first frame after a start counts no time.
    r.run(FORM_MS + 16);
    expect([r.d.frame.key, r.d.frame.why, r.d.frame.line]).toEqual(["pickUp", "step", C.pickUp]);
    r.inp.isHeld = true;
    r.run(16);
    expect([r.d.frame.key, r.d.frame.why, r.d.frame.line]).toEqual(["goal", "step", "Move the lantern until the shadow fills the moon."]);
    // The goal stays while the player works (warmth rising: no help needed), letting go now and then.
    r.inp.isHeld = false;
    for (let k = 1; k <= 8; k++) {
      r.inp.warm.set(0, 0.1 * k);
      r.run(2000);
      expect(r.d.frame.key).toBe("goal");
    }
  });

  it("names the key of every line it shows, through a whole lesson: COPY.lessons[key] is the line", () => {
    const seen = new Set<string>();
    const check = () => {
      const f = r.d.frame;
      expect(f.line).toBe(f.key === null ? null : f.key === "game.controllerFinger" ? COPY.game.controllerFinger : C[f.key]);
      expect(f.why === null).toBe(f.key === null);
      if (f.key) seen.add(`${f.why} ${f.key}`);
    };
    r.d.start("l1");
    r.run(FORM_MS + 16, check);
    r.inp.isHeld = true;
    r.run(1000, check);
    r.inp.isHeld = false;
    for (const lock of [0, 1, 2]) {
      r.inp.open.add(lock);
      r.run(16, check);
      r.until(() => {
        check();
        return !r.d.showing && r.d.step !== 2 && r.d.step !== 4;
      });
      r.run(4000, check);
    }
    r.inp.isRewardUp = true;
    r.run(1000, check);
    expect([...seen]).toEqual(
      expect.arrayContaining(["step pickUp", "step goal", "example watchNearFar", "example nearSwing", "step turnNearFar", "example watchRings", "step lineUp"]),
    );
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
    // The win named, a pause, then Example 1: staged on the twin, three beats, one click, the scraps swing back, the
    // lantern lifts out.
    expect(r.d.step).toBe(2);
    expect(r.d.frame.line).toBe(C.lockOpen);
    const ex1 = watch(r);
    expect(ex1.lines).toEqual([C.lockOpen, C.watchNearFar, C.nearSwing, C.turnNearFar]);
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
    // The player's arrow: the task, not a fact, from the lantern's lift out of the cradle on.
    expect(r.d.frame.line).toBe(C.turnNearFar);
    r.run(YOUR_TURN_MS);
    expect(r.d.frame.line).toBe(C.turnNearFar);
    r.run(10_000);
    expect(r.d.step).toBe(3);
    r.inp.open.add(1);
    r.run(16);
    // Example 2: line up, ride the line, slide to the click.
    expect(r.d.step).toBe(4);
    const ex2 = watch(r);
    expect(ex2.lines).toEqual([C.twoOpen, C.watchRings, C.lineUp, C.slide, C.yourTurn]);
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
    // The box opens: no line while it does, then the reward's once it is up.
    expect(r.d.step).toBe(6);
    expect(r.d.frame.line).toBeNull();
    r.run(3000);
    expect(r.d.frame.line).toBeNull();
    r.inp.isRewardUp = true;
    r.run(16);
    expect([r.d.frame.key, r.d.frame.why]).toEqual(["boxOpen", "win"]);
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

  it("names each win, then pauses before the next example: 2.6 s after the first (its line is long), 1.8 s after the second", () => {
    r.d.start("l1", 1);
    r.run(500);
    r.inp.isHeld = true;
    r.inp.open.add(0);
    r.run(16);
    const f = r.d.frame;
    expect([r.d.step, f.key, f.why, r.d.showing]).toEqual([2, "lockOpen", "win", false]);
    // The pause: the lantern stays in the hand, no ghost, no cradle; long enough to read "Every shape on the wall is a lock."
    expect(FIRST_WIN_MS).toBe(2600);
    expect(BEAT_MS).toBe(1800);
    r.run(FIRST_WIN_MS - 100);
    expect([f.key, r.d.showing, f.park, f.hand.opacity]).toEqual(["lockOpen", false, 0, 0]);
    r.run(200);
    expect([r.d.showing, f.key, f.why]).toEqual([true, "watchNearFar", "example"]);
    watch(r);
    // The second lock: one to go.
    r.inp.open.add(1);
    r.run(16);
    expect([r.d.step, f.key, f.why]).toEqual([4, "twoOpen", "win"]);
    r.run(BEAT_MS - 100);
    expect([r.d.showing, f.key]).toEqual([false, "twoOpen"]);
    r.run(200);
    expect([r.d.showing, f.key]).toEqual([true, "watchRings"]);
    // Lesson 2's crown opening: the reward's line while it is up, then the drawer's.
    r.d.start("l2", 2);
    r.run(500);
    r.inp.open.add(0);
    r.run(16);
    expect([r.d.step, f.key]).toEqual([3, null]);
    r.inp.isRewardUp = true;
    r.run(16);
    expect([f.key, f.why]).toEqual(["boxOpen", "win"]);
    r.inp.isRewardUp = false;
    r.inp.isSettled = true;
    r.run(16);
    expect([f.key, f.why]).toEqual(["drawer", "step"]);
  });

  it("goes straight into the example on a resumed step (no win named for a lock opened before), and names a lock opened in the pause", () => {
    r.inp.open.add(0);
    r.d.start("l1", 2);
    expect([r.d.showing, r.d.frame.key]).toEqual([true, "watchNearFar"]);
    // The player opens the arrow during the pause after the Moon: its example is skipped, and that win named instead.
    const q = rig();
    q.d.start("l1", 1);
    q.run(500);
    q.inp.open.add(0);
    q.run(16);
    q.run(500);
    q.inp.open.add(1);
    q.run(FIRST_WIN_MS - 500);
    expect([q.d.step, q.d.frame.key, q.d.showing]).toEqual([4, "twoOpen", false]);
    q.run(BEAT_MS);
    expect([q.d.showing, q.d.frame.key]).toEqual([true, "watchRings"]);
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

  it("shows the reaching ghost 4 s after the line whatever the hands do, until the lantern is held", () => {
    r.d.start("l1");
    // A hand near the lantern all along (reaching, not pinching): the ghost comes anyway.
    r.inp.isActive = true;
    r.run(FORM_MS + 16);
    expect(r.d.frame.key).toBe("pickUp");
    r.run(IDLE_GHOST_MS - 100);
    expect(r.d.frame.hand.opacity).toBe(0);
    r.run(600);
    expect(r.d.frame.hand.opacity).toBeGreaterThan(0);
    // With no hand there, it reaches the lantern's own loop: its pinch within a few millimetres of it.
    let nearest = Infinity;
    r.run(4000, () => {
      const a = r.d.frame.hand.at, b = gripOf(r.inp.at);
      if (r.d.frame.hand.opacity > 0.5) nearest = Math.min(nearest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    });
    expect(nearest).toBeLessThan(0.02);
    expect(r.d.frame.hand.anchor).toBe("grasp");
    expect(r.d.frame.hand.side).toBe("right");
    // Picked up: gone within a fade.
    r.inp.isHeld = true;
    r.run(400);
    expect([r.d.step, r.d.frame.hand.opacity]).toEqual([1, 0]);
  });

  it("keeps the intro ghost clear of a real hand at the lantern: it shows the pinch beside the hand, not inside it", () => {
    const grip = gripOf(r.inp.at);
    const hands: V3[] = [
      grip,
      [grip[0] + 0.1, grip[1], grip[2]],
      [grip[0], grip[1] - 0.05, grip[2] + 0.15],
      [grip[0] - 0.12, grip[1] + 0.05, grip[2] - 0.05],
    ];
    for (const at of hands) {
      const q = rig();
      q.inp.isActive = true;
      q.inp.handAt = at;
      q.d.start("l1");
      q.run(FORM_MS + IDLE_GHOST_MS + 1500);
      let atHold = Infinity, any = Infinity, seen = 0;
      q.run(8000, () => {
        const h = q.d.frame.hand;
        if (h.opacity < 0.5) return;
        seen++;
        const d = Math.hypot(h.at[0] - at[0], h.at[1] - at[1], h.at[2] - at[2]);
        any = Math.min(any, d);
        if (h.poseA === "hold" && h.poseB === "hold") atHold = Math.min(atHold, d);
      });
      expect(seen, `${at}`).toBeGreaterThan(100);
      // Where it pinches, a hand's width from the real hand's pinch; never closer than about 8 cm on its way.
      expect(atHold, `${at}`).toBeGreaterThanOrEqual(GHOST_CLEAR - 1e-3);
      expect(any, `${at}`).toBeGreaterThan(0.3);
    }
    // The hand away from the lantern: the ghost goes back to the lantern's own loop.
    const q = rig();
    q.inp.handAt = [grip[0] + 0.8, grip[1], grip[2] + 0.3];
    q.d.start("l1");
    let nearest = Infinity;
    q.run(FORM_MS + IDLE_GHOST_MS + 9000, () => {
      const a = q.d.frame.hand.at;
      if (q.d.frame.hand.opacity > 0.5) nearest = Math.min(nearest, Math.hypot(a[0] - grip[0], a[1] - grip[1], a[2] - grip[2]));
    });
    expect(nearest).toBeLessThan(0.02);
  });

  it("on lock I, shows how to pick the lantern up again only after 4 s without input, and lets it go when the player moves", () => {
    r.d.start("l1", 1);
    r.run(IDLE_GHOST_MS - 16);
    expect(r.d.frame.hand.opacity).toBe(0);
    r.run(500);
    expect(r.d.frame.hand.opacity).toBeGreaterThan(0);
    // Input sends it away within a fade, and restarts the 4 s.
    r.inp.isActive = true;
    r.run(400);
    expect(r.d.frame.hand.opacity).toBe(0);
    r.inp.isActive = false;
    r.run(3000);
    r.inp.isActive = true;
    r.run(16);
    r.inp.isActive = false;
    r.run(IDLE_GHOST_MS - 100);
    expect(r.d.frame.hand.opacity).toBe(0);
    r.run(600);
    expect(r.d.frame.hand.opacity).toBeGreaterThan(0);
  });

  it("skips an example whose lock the player already opened", () => {
    r.inp.open.add(1);
    r.d.start("l1", 2);
    r.run(16);
    expect(r.d.step).toBe(4);
    expect(r.d.frame.line).toBe(C.watchRings);
    expect(r.deps.onStep).toHaveBeenCalledTimes(1);
    expect(r.deps.onStep).toHaveBeenCalledWith("l1", 4);
  });

  it("resumes at the start of a step, the locks of the steps before it open", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => openBefore("l1", n))).toEqual([[], [], [0], [0], [0, 1], [0, 1], [0, 1, 2]]);
    expect([0, 1, 2, 3].map((n) => openBefore("l2", n))).toEqual([[], [], [], [0]]);
    r.d.start("l1", 3);
    r.run(16);
    expect(r.d.step).toBe(3);
    expect(r.d.frame.line).toBe(C.turnNearFar);
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

describe("LessonsDirector: help for an idle player", () => {
  /** The key and why shown now. */
  const said = (r: Rig) => [r.d.frame.key, r.d.frame.why];

  it("on lock I: the moon outline at 12 s, nearer or farther at 25 s without progress, and none while warmth rises", () => {
    const r = rig();
    r.d.start("l1", 1);
    r.run(11_900);
    expect(said(r)).toEqual(["goal", "step"]);
    r.run(200);
    expect(said(r)).toEqual(["moveIdle", "idle"]);
    r.run(12_800);
    expect(said(r)).toEqual(["moveIdle", "idle"]);
    r.run(200);
    expect(said(r)).toEqual(["growShrink", "idle"]);
    // Progress (warmth up 0.1): back to the goal, and the nudges only after another idle stretch.
    r.inp.warm.set(0, 0.12);
    r.run(16);
    expect(said(r)).toEqual(["goal", "step"]);
    r.run(11_800);
    expect(r.d.frame.key).toBe("goal");
    r.run(300);
    expect(r.d.frame.key).toBe("moveIdle");
    // A player getting warmer all along never sees one (warmth falling back and coming again is no progress).
    const q = rig();
    q.d.start("l1", 1);
    for (let k = 1; k <= 9; k++) {
      q.inp.warm.set(0, 0.1 * k);
      q.run(10_000, () => expect(q.d.frame.key).toBe("goal"));
    }
  });

  it("every lesson lock says Stuck? at 40 s; the arrow nudges at 20 s, the Key at 20 s while its rings are apart, the crown at 15 s", () => {
    const arrow = rig();
    arrow.d.start("l1", 3);
    arrow.run(19_900);
    expect(said(arrow)).toEqual(["turnNearFar", "step"]);
    arrow.run(200);
    expect(said(arrow)).toEqual(["turnNearFarIdle", "idle"]);
    arrow.run(20_000);
    expect(said(arrow)).toEqual(["stuck", "idle"]);
    const key = rig();
    key.d.start("l1", 5);
    key.run(20_100);
    expect(said(key)).toEqual(["turnRingsIdle", "idle"]);
    // Rings lined up: the slide line says what to do next, no nudge over it.
    key.inp.alignedLocks.add(2);
    key.run(600);
    expect(said(key)).toEqual(["slide", "step"]);
    key.run(19_400);
    expect(said(key)).toEqual(["stuck", "idle"]);
    const crown = rig();
    crown.d.start("l2", 2);
    crown.run(14_900);
    expect(said(crown)).toEqual(["turnFinger", "step"]);
    crown.run(200);
    expect(said(crown)).toEqual(["fingerIdle", "idle"]);
    crown.run(25_000);
    expect(said(crown)).toEqual(["stuck", "idle"]);
  });

  it("starts its idle clocks over with the step (a resumed step waits the full time again), and says so", () => {
    const r = rig();
    r.d.start("l1", 3);
    expect(r.deps.onRestart).toHaveBeenLastCalledWith("l1", 3);
    r.run(30_000);
    expect(r.d.frame.key).toBe("turnNearFarIdle");
    // A reload: the same step, from its start.
    r.d.start("l1", 3);
    r.run(19_900);
    expect(r.d.frame.key).toBe("turnNearFar");
    // Each step's start says so too (the session starts its stuck watch over with it).
    r.inp.open.add(1);
    r.run(16);
    expect(r.deps.onRestart).toHaveBeenLastCalledWith("l1", 4);
  });

  it("says once, after the lantern is held 15 s without a break, that it can be let go, and never again", () => {
    const r = rig();
    r.d.start("l1", 1);
    r.inp.isHeld = true;
    // Getting warmer the whole time: no nudge in the way.
    let w = 0;
    const warmer = () => {
      w = Math.min(1, w + 0.0007);
      r.inp.warm.set(0, w);
    };
    r.run(14_900, warmer);
    expect(said(r)).toEqual(["goal", "step"]);
    r.run(200, warmer);
    expect(said(r)).toEqual(["letGo", "idle"]);
    r.run(5_700, warmer);
    expect(r.d.frame.key).toBe("letGo");
    r.run(300, warmer);
    expect(said(r)).toEqual(["goal", "step"]);
    // Held on, let go and held again, a new step: never again.
    r.run(20_000, warmer);
    r.inp.isHeld = false;
    r.run(100);
    r.inp.isHeld = true;
    r.run(20_000, () => expect(r.d.frame.key).not.toBe("letGo"));
    r.inp.open.add(0);
    r.run(16);
    r.until(() => r.d.step === 3);
    r.inp.isHeld = true;
    r.run(19_000, () => expect(r.d.frame.key).not.toBe("letGo"));
    // Held with breaks, it never comes at all.
    const q = rig();
    q.d.start("l1", 1);
    for (let i = 0; i < 6; i++) {
      q.inp.isHeld = true;
      q.run(10_000, () => expect(q.d.frame.key).not.toBe("letGo"));
      q.inp.isHeld = false;
      q.run(100);
    }
  });
});

describe("LessonsDirector: the coach line by the lantern", () => {
  it("puts the coach line by the lantern while it asks for it (from the box forming), and back over the box once it is held", () => {
    const r = rig(), f = r.d.frame;
    r.d.start("l1");
    expect(f.coachNear).toBe(true);
    r.run(FORM_MS + 5000, () => expect(f.coachNear).toBe(true));
    r.inp.isHeld = true;
    r.run(16);
    expect([r.d.step, f.coachNear]).toEqual([1, false]);
    r.run(3000, () => expect(f.coachNear).toBe(false));
    // A replay, a tip's demo, lesson 2: over the box.
    r.d.start("l1", 1);
    r.d.stop();
    r.d.replay("move");
    r.run(2000, () => expect(f.coachNear).toBe(false));
    const q = rig();
    q.d.start("l2");
    q.run(3000, () => expect(q.d.frame.coachNear).toBe(false));
  });
});

describe("LessonsDirector: lock I marked", () => {
  it("marks lock I through its step: its outline breathes softly (about 0.25, slowly), never during its example", () => {
    const r = rig(), f = r.d.frame;
    r.d.start("l1");
    r.run(FORM_MS + 500, () => expect(f.mark).toBe(-1));
    r.inp.isHeld = true;
    r.run(16);
    r.inp.isHeld = false;
    const w: number[] = [];
    r.run(6400, () => {
      expect(f.mark).toBe(0);
      w.push(f.markWarmth);
    });
    // Softly: at most MARK_WARMTH, never out; slowly: one breath every few seconds (no flashing).
    expect(Math.max(...w)).toBeCloseTo(MARK_WARMTH, 2);
    expect(Math.min(...w)).toBeGreaterThan(0.1);
    expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(0.08);
    let turns = 0;
    for (let i = 2; i < w.length; i++) if ((w[i]! - w[i - 1]!) * (w[i - 1]! - w[i - 2]!) < 0) turns++;
    expect(turns).toBeLessThanOrEqual(5);
    // The last-resort example owns the look: no mark while it plays, the mark back after.
    r.run(40_000, () => {
      if (r.d.showing) expect(f.mark).toBe(-1);
    });
    r.until(() => !r.d.showing);
    r.run(16);
    expect(f.mark).toBe(0);
    // Open: the next steps mark nothing.
    r.inp.open.add(0);
    r.run(16);
    r.run(30_000, () => expect(f.mark).toBe(-1));
    expect(r.d.step).toBe(3);
  });
});

describe("LessonsDirector: help taken, the session's suggestion, the intro's glow, lines coming back", () => {
  const said = (r: Rig) => [r.d.frame.key, r.d.frame.why];

  it("ends the Stuck? line when the player takes a hint: the nudges wait another stretch", () => {
    const r = rig();
    r.d.start("l1", 3);
    r.run(40_100);
    expect(said(r)).toEqual(["stuck", "idle"]);
    r.d.helpTaken();
    r.run(16);
    expect(said(r)).toEqual(["turnNearFar", "step"]);
    r.run(19_800);
    expect(r.d.frame.key).toBe("turnNearFar");
    r.run(300);
    expect(r.d.frame.key).toBe("turnNearFarIdle");
    // On lock I, help taken just before its last-resort example is due: no example now, the clocks start over.
    const q = rig();
    q.d.start("l1", 1);
    q.run(39_000);
    q.d.helpTaken();
    q.run(20_000, () => expect(q.d.showing).toBe(false));
    expect(q.d.frame.key).toBe("moveIdle");
    // Outside a lesson lock (the intro, no lesson) it changes nothing.
    const i = rig();
    i.d.start("l1");
    i.run(FORM_MS + 16);
    i.d.helpTaken();
    expect(i.d.frame.key).toBe("pickUp");
    rig().d.helpTaken();
  });

  it("does not bring Stuck? straight back after Show me: the replay's end starts the clocks over", () => {
    const r = rig();
    r.d.start("l1", 3);
    r.run(40_100);
    expect(r.d.frame.key).toBe("stuck");
    expect(r.d.replay("near-far")).toBe(true);
    r.until(() => r.d.replaying === null);
    r.run(16);
    expect(said(r)).toEqual(["turnNearFar", "step"]);
    r.run(19_000, () => expect(r.d.frame.key).toBe("turnNearFar"));
  });

  it("explains the hint lantern's glow in the intro: Stuck? while it glows, the pick-up line again when it goes out", () => {
    const r = rig();
    r.d.start("l1");
    r.run(FORM_MS + 1000);
    expect(said(r)).toEqual(["pickUp", "step"]);
    r.inp.isStuck = true;
    r.run(16);
    expect(said(r)).toEqual(["stuck", "idle"]);
    r.inp.isStuck = false;
    r.run(16);
    expect(said(r)).toEqual(["pickUp", "step"]);
  });

  it("gives the chip to the session's suggestion, but only once a turn's own line has had its time", () => {
    // Lesson 2's crown with controllers: the session suggests setting one down from the turn's start.
    const r = rig();
    r.inp.suggest = "controllerFinger";
    r.d.start("l2", 2);
    expect(SUGGEST_AFTER_MS).toBe(3000);
    r.run(SUGGEST_AFTER_MS - 100, () => expect(r.d.frame.key).toBe("turnFinger"));
    r.run(200);
    expect(said(r)).toEqual(["game.controllerFinger", "suggest"]);
    expect(r.d.frame.line).toBe(COPY.game.controllerFinger);
    // Gone (the player set a controller down): the turn's own line, at once.
    r.inp.suggest = null;
    r.run(16);
    expect(r.d.frame.key).toBe("turnFinger");
    // Back later in the turn: it takes the chip at once (the turn's line has had its time).
    r.inp.suggest = "controllerFinger";
    r.run(16);
    expect(r.d.frame.key).toBe("game.controllerFinger");
    // Elsewhere it takes the chip at once (lesson 1's intro, as before), and never over an example.
    const q = rig();
    q.inp.suggest = "controllerFinger";
    q.d.start("l1");
    q.run(500);
    expect(q.d.frame.key).toBe("game.controllerFinger");
    q.d.start("l2", 1);
    q.run(500);
    expect([q.d.frame.key, q.d.frame.why]).toEqual(["watchFinger", "example"]);
  });

  it("tells a line's first showing in a step from the same line coming back", () => {
    const r = rig(), f = r.d.frame;
    r.d.start("l1", 1);
    r.run(16);
    const first = f.shows;
    expect([f.key, f.again]).toEqual(["goal", false]);
    r.run(12_100);
    expect([f.key, f.again, f.shows]).toEqual(["moveIdle", false, first + 1]);
    // Getting warmer: the goal comes back, as a line already said; then the nudge again, already said too.
    r.inp.warm.set(0, 0.15);
    r.run(16);
    expect([f.key, f.again, f.shows]).toEqual(["goal", true, first + 2]);
    r.run(12_100);
    expect([f.key, f.again, f.shows]).toEqual(["moveIdle", true, first + 3]);
    // The same line every frame is one showing.
    r.run(2000);
    expect(f.shows).toBe(first + 3);
    // A new step: its lines are new.
    r.inp.open.add(0);
    r.run(16);
    expect([f.key, f.again]).toEqual(["lockOpen", false]);
    // An example's last line running on into its turn (the same key) is one showing, said once.
    const e = rig();
    e.d.start("l1", 2);
    let atLift = -1;
    e.until(() => {
      if (e.d.frame.key === "turnNearFar" && atLift < 0) atLift = e.d.frame.shows;
      return e.d.step === 3;
    });
    e.run(16);
    expect([e.d.frame.key, e.d.frame.shows, e.d.frame.again]).toEqual(["turnNearFar", atLift, false]);
    e.run(20_100);
    expect([e.d.frame.key, e.d.frame.again]).toEqual(["turnNearFarIdle", false]);
    e.inp.warm.set(1, 0.2);
    e.run(16);
    expect([e.d.frame.key, e.d.frame.again]).toEqual(["turnNearFar", true]);
    // A replay's lines are new each time it is asked for.
    const q = rig();
    for (let k = 0; k < 2; k++) {
      q.d.replay("move");
      q.run(16);
      expect([q.d.frame.key, q.d.frame.again]).toEqual(["watch", false]);
      q.until(() => q.d.replaying === null);
    }
  });

});

describe("LessonsDirector: lock I's last resort", () => {
  it("plays the Move the light example on lock I after 40 s without progress, once a visit; then Stuck? instead", () => {
    const r = rig();
    r.d.start("l1", 1);
    r.run(39_900);
    expect([r.d.showing, r.d.frame.key]).toEqual([false, "growShrink"]);
    (r.deps.onStep as ReturnType<typeof vi.fn>).mockClear();
    (r.deps.onRestart as ReturnType<typeof vi.fn>).mockClear();
    r.run(200);
    expect([r.d.showing, r.d.replaying, r.d.frame.key, r.d.frame.why]).toEqual([true, null, "watch", "example"]);
    // The example on lock I itself (no twin): the ghost lantern ends on its spot, lit as solved, the player's lantern
    // in its cradle meanwhile and back where it was after.
    const f = r.d.frame, lines: string[] = [], L = lessonPlan("l1", false).box.locks[0]!.L;
    let park = 0, solved = 0, nearest = Infinity;
    r.until(() => {
      if (f.key && lines[lines.length - 1] !== f.key) lines.push(f.key);
      park = Math.max(park, f.park);
      if (f.solvedLock === 0) solved = Math.max(solved, f.solved);
      if (f.lamp.opacity > 0) nearest = Math.min(nearest, Math.hypot(f.lamp.at[0] - L[0], f.lamp.at[1] - L[1], f.lamp.at[2] - L[2]));
      return !r.d.showing;
    });
    expect(lines).toEqual(["watch", "watchMove", "goal"]);
    expect([park, solved, f.lift]).toEqual([1, 1, null]);
    expect(nearest).toBeLessThan(1e-9);
    // Back on lock I, the same step: nothing saved, its clocks (and the session's stuck watch) started over.
    expect([r.d.step, r.d.frame.key, r.d.frame.why, f.park]).toEqual([1, "goal", "step", 0]);
    expect(r.deps.onStep).not.toHaveBeenCalled();
    expect(r.deps.onRestart).toHaveBeenCalledWith("l1", 1);
    r.run(11_900);
    expect(r.d.frame.key).toBe("goal");
    // Another 40 s without progress: Stuck?, and no second example this visit.
    r.run(28_300, () => expect(r.d.showing).toBe(false));
    expect(r.d.frame.key).toBe("stuck");
    r.run(30_000, () => expect(r.d.showing).toBe(false));
    // A new visit to the step (a reload) may play it again.
    r.d.start("l1", 1);
    let again = false;
    r.run(40_200, () => (again ||= r.d.showing));
    expect(again).toBe(true);
  });

  it("never plays it while the player gets warmer, nor on any other lesson lock", () => {
    const r = rig();
    r.d.start("l1", 1);
    for (let k = 1; k <= 7; k++) {
      r.inp.warm.set(0, 0.1 * k);
      r.run(10_000, () => expect(r.d.showing).toBe(false));
    }
    for (const [id, step] of [
      ["l1", 3],
      ["l1", 5],
      ["l2", 2],
    ] as const) {
      const q = rig();
      q.d.start(id, step);
      q.run(70_000, () => expect(q.d.showing).toBe(false));
      expect(q.d.frame.key).toBe("stuck");
    }
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
    expect(ex3.lines).toEqual([C.watchFinger, C.finger, C.turnFinger]);
    expect(ex3.clicks).toBe(1);
    expect(ex3.fill).toBe(1);
    expect(ex3.minLayout[0]).toBe(0);
    expect(r.d.step).toBe(2);
    expect(ex3.lift).toEqual(LESSON_2.locks[0]!.L);
    expect(r.d.frame.lift).toBeNull();
    expect(r.d.frame.line).toBe(C.turnFinger);
    r.run(YOUR_TURN_MS);
    expect(r.d.frame.line).toBe(C.turnFinger);
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
      // While the finger holds still at the prong (the fill rising).
      if (h.opacity === 1 && r.d.frame.fill > 0 && r.d.frame.fill < 1) {
        tipSeen = true;
        expect(h.anchor).toBe("tip");
        expect(h.poseA).toBe("point");
        expect(h.at[2]).toBeLessThanOrEqual(1);
        expect(h.at[2]).toBeGreaterThan(0.5);
        // In the plane through the spot and the prong's axis, so the finger's shadow runs along the prong: the tip
        // and the finger's direction both lie in it. Tilted out of the panel's plane, pointing into the box.
        const tw = lessonPlan("l2", false).twins[0]!.lock, T = tw.L, poly = tw.target[tw.missing]!;
        const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        const A = new Vector3(cx - T[0], cy - T[1], -T[2]);
        const B = new Vector3(cx + Math.cos(tw.fingerAngle) - T[0], cy + Math.sin(tw.fingerAngle) - T[1], -T[2]);
        const n = A.cross(B).normalize();
        expect(Math.abs(n.dot(new Vector3(...h.fingers)))).toBeLessThan(1e-6);
        expect(Math.abs(n.dot(new Vector3(h.at[0] - T[0], h.at[1] - T[1], h.at[2] - T[2])))).toBeLessThan(1e-6);
        expect(h.fingers[2]).toBeLessThan(-0.2);
      }
      return r.d.step !== 1;
    });
    expect(tipSeen).toBe(true);
  });

  it("brings the ghost finger in through the box mouth: no joint of the hand crosses a glass side (18 and 24 cm boxes)", () => {
    for (const sizeM of [0.18, 0.24]) {
      for (const left of [false, true]) {
        const q = rig(left);
        q.d.start("l2", 1);
        const { seen, worst, where } = handInside(q, sizeM, () => q.d.step !== 1);
        expect(seen).toBeGreaterThan(0);
        expect(worst, `${sizeM * 100} cm box, ${left ? "left" : "right"}-handed: ${where}`).toBeLessThanOrEqual(0.5);
      }
    }
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
    expect(r.d.frame.line).toBe(C.watchNearFar);
    // Opening a lock meanwhile changes nothing until the replay is over.
    r.inp.open.add(2);
    const res = watch(r);
    expect(res.lines).toEqual([C.watchNearFar, C.nearSwing, C.yourTurn]);
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
      expect(res.lines[0]).toBe(C[SAID[ex].open]);
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

  it("keeps the hand a lesson or a replay started with, should the setting change meanwhile", () => {
    const r = rig();
    let left = false;
    r.deps.leftHanded = () => left;
    r.d.start("l1", 2);
    r.run(2000);
    expect(r.d.frame.hand.side).toBe("right");
    left = true;
    r.run(100);
    expect(r.d.frame.hand.side).toBe("right");
    // The lesson's next example too: built for the box the lesson started with.
    watch(r);
    r.inp.open.add(1);
    r.run(16);
    expect(r.d.step).toBe(4);
    r.run(2000);
    expect(r.d.frame.hand.side).toBe("right");
    // A replay takes the hand as it starts.
    r.d.stop();
    r.d.replay("move");
    r.run(2000);
    expect(r.d.frame.hand.side).toBe("left");
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

describe("LessonsDirector: tip demos", () => {
  const TIPS = [
    ["decoys", 2],
    ["ringless", 4],
    ["hidden", 5],
  ] as const;
  const boxFor = (n: number, left: boolean) => (left ? mirrorBox(generateBox({ kind: "box", n })) : generateBox({ kind: "box", n }));
  const centroid = (v: V3[]): V3 => [0, 1, 2].map((k) => v.reduce((s, p) => s + p[k]!, 0) / v.length) as V3;

  it("plays about 6 s of ghost for each tip: a finger pointing at decoys, or a ghost lantern swept near (never on) the lock's spot", () => {
    for (const [tip, n] of TIPS) {
      const box = boxFor(n, false), r = rig();
      expect(r.d.tipDemo(tip, box)).toBe(true);
      expect(r.d.tipping).toBe(true);
      const decoys = box.elements.filter((e) => e.kind === "decoy").map((e) => centroid(e.verts));
      const L = box.locks[tipLock(tip, box)]?.L;
      let hand = 0, lamp = 0, light = false, pointedAt = 0, nearest = Infinity;
      const ms = r.until(() => {
        const f = r.d.frame;
        hand = Math.max(hand, f.hand.opacity);
        lamp = Math.max(lamp, f.lamp.opacity);
        light ||= f.ghostLight;
        if (f.hand.opacity >= 1 && tip === "decoys") {
          // The finger points at a decoy: the line on from the fingertip passes close by one.
          for (const c of decoys) {
            const d = new Vector3(c[0] - f.hand.at[0], c[1] - f.hand.at[1], c[2] - f.hand.at[2]);
            const along = d.dot(new Vector3(...f.hand.fingers));
            if (along > 0 && d.lengthSq() - along * along < 0.03 * 0.03) pointedAt++;
          }
        }
        if (L && f.lamp.opacity > 0) nearest = Math.min(nearest, Math.hypot(f.lamp.at[0] - L[0], f.lamp.at[1] - L[1], f.lamp.at[2] - L[2]));
        return !r.d.tipping;
      });
      expect(ms, tip).toBeGreaterThan(5000);
      expect(ms, tip).toBeLessThan(7000);
      expect(hand, tip).toBe(1);
      if (tip === "decoys") {
        expect([lamp, light]).toEqual([0, false]);
        expect(pointedAt).toBeGreaterThan(0);
      } else {
        expect([lamp, light]).toEqual([1, true]);
        expect(nearest, tip).toBeGreaterThanOrEqual(0.3);
      }
      // Over: nothing left showing, the light back on the player's lantern.
      expect([r.d.frame.hand.opacity, r.d.frame.lamp.opacity, r.d.frame.ghostLight]).toEqual([0, 0, false]);
    }
  });

  /** Boxes 2 to 30 and a few Daily Boxes, as each hand plays them, with every tip each has something to show for. */
  const everyTipDemo = (from: number): { tip: TipId; box: Box; left: boolean; name: string }[] => {
    const out: { tip: TipId; box: Box; left: boolean; name: string }[] = [];
    const specs: BoxSpec[] = [];
    for (let n = from; n <= 30; n++) specs.push({ kind: "box", n });
    for (const day of ["2026-11-06", "2026-11-07", "2026-12-24", "2027-03-01"]) specs.push({ kind: "daily", day });
    for (const spec of specs) {
      const base = generateBox(spec);
      for (const left of [false, true]) {
        const box = left ? mirrorBox(base) : base;
        for (const tip of ["decoys", "ringless", "hidden"] as const) {
          if (tip === "decoys" ? !box.elements.some((e) => e.kind === "decoy") : tipLock(tip, box) < 0) continue;
          out.push({ tip, box, left, name: `${tip} on ${JSON.stringify(spec)}, ${left ? "left" : "right"}-handed` });
        }
      }
    }
    return out;
  };

  it("never brings the ghost lantern within 0.3 of any lock's spot: the shadows slide, never form (boxes 4 to 30, dailies)", () => {
    let sweeps = 0;
    for (const { tip, box, name } of everyTipDemo(4)) {
      if (tip === "decoys") continue;
      sweeps++;
      const r = rig();
      expect(r.d.tipDemo(tip, box), name).toBe(true);
      let nearest = Infinity;
      r.until(() => {
        const f = r.d.frame;
        if (f.lamp.opacity > 0) {
          for (const l of box.locks) nearest = Math.min(nearest, Math.hypot(f.lamp.at[0] - l.L[0], f.lamp.at[1] - l.L[1], f.lamp.at[2] - l.L[2]));
        }
        return !r.d.tipping;
      });
      expect(nearest, name).toBeGreaterThanOrEqual(0.3);
    }
    expect(sweeps).toBeGreaterThan(20);
  });

  it("keeps the sweep 0.3 from every spot on every box: a floor, whatever the seed (300 Daily Boxes)", () => {
    const seg = (p: V3, a: V3, b: V3) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2;
      const u = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0]! + (p[1] - a[1]) * ab[1]! + (p[2] - a[2]) * ab[2]!) / l2)) : 0;
      return Math.hypot(a[0] + ab[0]! * u - p[0], a[1] + ab[1]! * u - p[1], a[2] + ab[2]! * u - p[2]);
    };
    let sweeps = 0, worst = Infinity, where = "";
    const day0 = Date.UTC(2026, 10, 1);
    for (let i = 0; i < 300; i++) {
      const day = new Date(day0 + i * 86_400_000).toISOString().slice(0, 10);
      const base = generateBox({ kind: "daily", day });
      for (const left of [false, true]) {
        const box = left ? mirrorBox(base) : base;
        for (const tip of ["ringless", "hidden"] as const) {
          const s = buildTipScript(tip, box, left);
          if (!s) continue;
          sweeps++;
          // The ghost lantern moves along its keys in straight lines (eased in time only): every leg, against every spot.
          for (let k = 1; k < s.lamp.length; k++) {
            for (const l of box.locks) {
              const d = seg(l.L, s.lamp[k - 1]!.at, s.lamp[k]!.at);
              if (d < worst) [worst, where] = [d, `${tip} on ${day}, ${left ? "left" : "right"}-handed`];
            }
          }
        }
      }
    }
    expect(sweeps).toBeGreaterThan(100);
    expect(worst, where).toBeGreaterThanOrEqual(SWEEP_CLEAR);
  }, 120_000);

  it("keeps a tip demo's ghost hand out of the glass sides (boxes 2 to 30 and dailies, 18 and 24 cm, both hands)", () => {
    let demos = 0;
    for (const { box, tip, name } of everyTipDemo(2)) {
      for (const sizeM of [0.18, 0.24]) {
        const r = rig();
        expect(r.d.tipDemo(tip, box), name).toBe(true);
        const { seen, worst, where } = handInside(r, sizeM, () => !r.d.tipping);
        expect(seen, name).toBeGreaterThan(0);
        expect(worst, `${name}, ${sizeM * 100} cm box: ${where}`).toBeLessThanOrEqual(0.5);
        demos++;
      }
    }
    expect(demos).toBeGreaterThan(100);
  });

  it("takes the ghost's hand from the box it plays on (a mirrored box is a left-handed player's)", () => {
    // The setting says right-handed; the box in play was mirrored for a left hand: the box decides.
    const r = rig(false);
    r.d.tipDemo("decoys", boxFor(2, true));
    expect(r.d.frame.hand.side).toBe("left");
    const q = rig(true);
    q.d.tipDemo("decoys", boxFor(2, false));
    expect(q.d.frame.hand.side).toBe("right");
  });

  it("needs no reduced-motion variant: the ghost glides and fades, nothing flies or swings, the same either way", () => {
    for (const [tip, n] of TIPS) {
      const box = boxFor(n, false);
      const run = (reduced: boolean): string[] => {
        const r = rig();
        r.inp.reduced = reduced;
        r.d.tipDemo(tip, box);
        const frames: string[] = [];
        r.until(() => {
          const f = r.d.frame;
          // No cradle, no swing, no lift: the player's lantern and the scraps are never moved by a tip demo.
          expect([f.park, f.lift, Array.from(f.layout).every((v) => v === 1)]).toEqual([0, null, true]);
          frames.push(JSON.stringify([f.hand, f.lamp, f.ghostLight]));
          return !r.d.tipping;
        });
        return frames;
      };
      expect(run(true), tip).toEqual(run(false));
    }
  });

  it("stops a tip demo when told, and never plays one over a lesson or an example", () => {
    const r = rig();
    const box = boxFor(2, false);
    r.d.tipDemo("decoys", box);
    r.run(1000);
    r.d.stopTip();
    expect(r.d.tipping).toBe(false);
    expect([r.d.frame.hand.opacity, r.d.frame.ghostLight]).toEqual([0, false]);
    r.d.start("l1");
    expect(r.d.tipDemo("decoys", box)).toBe(false);
    r.d.stop();
    r.d.replay("move");
    expect(r.d.tipDemo("decoys", box)).toBe(false);
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
