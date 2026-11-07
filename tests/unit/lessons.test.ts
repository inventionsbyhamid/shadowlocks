// The lessons controller (lessons.ts) on fakes of the session, game, lantern, hands and profile: a first launch, a
// lesson left half done going on, replays putting back what was in play (or nothing, after an opened box), a stop
// putting back nothing, the director waiting while the headset is hidden or a menu is up, the coach line, and tips.
import type { World } from "@iwsdk/core";
import { describe, expect, it, vi } from "vitest";
import { emit } from "../../src/app/bus";
import type { LessonView } from "../../src/app/lesson-view";
import { Lessons, type LessonsDeps } from "../../src/app/lessons";
import { FORM_MS } from "../../src/app/lessons-director";
import { currentScreen, go } from "../../src/app/screens";
import type { Stage } from "../../src/app/session-deps";
import { newProfile } from "../../src/core/profile";
import type { BoxSnapshot } from "../../src/core/profile";
import type { Box, BoxSpec } from "../../src/core/types";
import type { BoxScene } from "../../src/render/box-scene";
import { COPY } from "../../src/ui/copy";

/** A box with decoys, as tipFor sees one (box 2 brings in the decoys tip). */
const box2 = (): Box =>
  ({
    key: "shadow-locks/2",
    spec: { kind: "box", n: 2 },
    locks: [{ i: 0, rings: true, hidden: false, L: [0.2, -0.2, 1.3] }],
    elements: [
      { kind: "decoy", verts: [[0.1, 0.1, 0.5], [0.2, 0.1, 0.5], [0.15, 0.2, 0.5]] },
      { kind: "decoy", verts: [[-0.2, -0.1, 0.4], [-0.1, -0.1, 0.4], [-0.15, 0, 0.4]] },
    ],
  }) as unknown as Box;

function bench(o: { presenting?: boolean; autoStart?: boolean } = {}) {
  const profile = newProfile(0, "1.0.0");
  const plays: { spec: BoxSpec; snap: BoxSnapshot | null; practice: boolean }[] = [];
  const open = new Set<number>();
  const session = {
    stage: "idle" as Stage,
    spec: null as BoxSpec | null,
    box: null as Box | null,
    practice: false,
    isOpen: (i: number) => open.has(i),
    snapshot: () => ({ key: session.box?.key ?? "", lantern: [0, 0, 1], open: [...open], crystal: [], elapsedMs: 1234, hints: 0, hintLevel: {} }) as BoxSnapshot,
  };
  const game = {
    play: vi.fn((spec: BoxSpec, snap: BoxSnapshot | null = null, practice = false) => {
      plays.push({ spec, snap, practice });
      session.spec = spec;
      session.practice = practice;
      session.stage = "playing";
      session.box = spec.kind === "box" && spec.n === 2 ? box2() : ({ key: `lesson ${JSON.stringify(spec)}`, spec, locks: [], elements: [] } as unknown as Box);
      go("play");
    }),
  };
  const view = { update: vi.fn(), coach: { text: null, opacity: 0 }, ghost: { opacity: 0 } };
  const play = { game, session, view: { coachLine: null as "controllerFinger" | null } };
  const env = { presenting: o.presenting ?? true };
  const deps = {
    world: {} as World,
    scene: {} as BoxScene,
    profiles: { profile, save: vi.fn(async () => {}) },
    settings: { get: () => ({ reducedMotion: false, handed: "right" }) },
    lantern: { grab: { holder: null, brightness: 0 }, feel: { aligned: () => false }, ctrl: { pos: [0.3, -0.3, 1.3] } },
    hands: { n: 0 },
    sound: { game: { lessonStep: vi.fn(), settle: vi.fn(), crystallise: vi.fn() } },
    play,
    presenting: () => env.presenting,
    autoStart: () => o.autoStart ?? true,
    view: view as unknown as LessonView,
  } as unknown as LessonsDeps;
  const lessons = new Lessons(deps);
  let t = 1000;
  const run = (ms: number) => {
    for (const end = t + ms; t < end; ) lessons.update((t += 16));
  };
  /** The line and the lesson the view was last given. */
  const shown = () => {
    const c = view.update.mock.calls.at(-1)!;
    return { lesson: (c[1] as { lesson: string | null }).lesson, line: c[2] as string | null };
  };
  /** Whether the view was last told a tip's demo is on screen. */
  const tipShown = () => (view.update.mock.calls.at(-1)![1] as { tip?: boolean }).tip === true;
  const lantern = (deps as unknown as { lantern: { grab: { holder: string | null } } }).lantern;
  return { lessons, profile, session, plays, open, env, run, shown, tipShown, play, lantern };
}

describe("Lessons", () => {
  it("goes into lesson 1 on a first launch, at the step it was left at; never once it is done or not allowed", () => {
    const b = bench();
    b.profile.lessons = { l1: false, l2: false, step: { id: "l1", index: 3 } };
    expect(b.lessons.startFirst()).toBe(true);
    expect(b.plays.at(-1)!.spec).toEqual({ kind: "lesson", id: "l1" });
    // Step 3 is the player's arrow: only lock I was opened before it.
    expect(b.plays.at(-1)!.snap!.open).toEqual([0]);
    expect([b.lessons.director.lesson, b.lessons.director.step]).toEqual(["l1", 3]);
    const done = bench();
    done.profile.lessons = { l1: true, l2: false, step: null };
    expect(done.lessons.startFirst()).toBe(false);
    expect(bench({ autoStart: false }).lessons.startFirst()).toBe(false);
  });

  it("keeps a lesson left half done waiting, and goes on with it at its saved step", () => {
    const b = bench();
    b.profile.lessons = { l1: true, l2: false, step: { id: "l2", index: 2 } };
    expect(b.lessons.waiting).toBe(true);
    expect(b.lessons.running).toBe(false);
    expect(b.lessons.resume()).toBe(true);
    expect(b.plays.at(-1)!.spec).toEqual({ kind: "lesson", id: "l2" });
    expect([b.lessons.director.lesson, b.lessons.director.step]).toEqual(["l2", 2]);
    expect(b.lessons.running).toBe(true);
    expect(b.lessons.waiting).toBe(false);
    // Nothing waits once the lessons are done.
    const c = bench();
    c.profile.lessons = { l1: true, l2: true, step: null };
    expect([c.lessons.waiting, c.lessons.resume()]).toEqual([false, false]);
  });

  it("puts back the box that was in play when a replay ends, from its snapshot", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 2 });
    b.open.add(0);
    expect(b.lessons.replay("move")).toBe(true);
    expect(b.plays.at(-1)).toEqual({ spec: { kind: "lesson", id: "l1" }, snap: null, practice: true });
    b.run(40_000);
    expect(b.lessons.director.replaying).toBeNull();
    const back = b.plays.at(-1)!;
    expect(back.spec).toEqual({ kind: "box", n: 2 });
    expect(back.snap!.open).toEqual([0]);
    expect(back.snap!.elapsedMs).toBe(1234);
    expect(back.practice).toBe(false);
  });

  it("puts nothing back after a replay over an opened box: Home, where Continue offers the next box", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 2 });
    b.session.stage = "offered";
    b.lessons.replay("rings");
    const n = b.plays.length;
    b.run(40_000);
    expect(b.lessons.director.replaying).toBeNull();
    expect(b.plays.length).toBe(n);
    expect(currentScreen()).toBe("home");
  });

  it("lets a replay go on a stop (a progress reset): nothing put back, no screen change", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 2 });
    b.lessons.replay("move");
    b.run(1000);
    const n = b.plays.length;
    b.lessons.stop();
    expect(b.plays.length).toBe(n);
    expect(currentScreen()).toBe("play");
    expect([b.lessons.running, b.lessons.director.replaying]).toEqual([false, null]);
  });

  it("holds the director's clock while the headset is hidden", () => {
    const b = bench({ presenting: false });
    b.lessons.start("l1");
    b.run(FORM_MS);
    expect(b.lessons.director.frame.form).toBe(0);
    b.env.presenting = true;
    b.run(FORM_MS / 2);
    expect(b.lessons.director.frame.form).toBeGreaterThan(0.3);
    expect(b.lessons.director.frame.form).toBeLessThan(0.7);
  });

  it("waits under a menu, its ghost and line put away", () => {
    const b = bench();
    b.lessons.start("l1");
    b.run(FORM_MS + 200);
    expect(b.shown()).toEqual({ lesson: "l1", line: COPY.lessons.pickUp });
    go("home");
    const form = b.lessons.director.frame.form, step = b.lessons.director.step;
    b.run(6000);
    expect(b.shown()).toEqual({ lesson: null, line: null });
    expect([b.lessons.director.frame.form, b.lessons.director.step]).toEqual([form, step]);
    go("play");
    b.run(32);
    expect(b.shown().lesson).toBe("l1");
  });

  it("shows the session's controller line under a lesson, with a line of its own or not, but never over an example", () => {
    const b = bench();
    b.lessons.start("l1");
    b.play.view.coachLine = "controllerFinger";
    // The box still forming (no lesson line yet), then formed ("Pick up the lantern."): the session's line either way.
    b.run(100);
    expect(b.lessons.director.frame.line).toBeNull();
    expect(b.shown().line).toBe(COPY.game.controllerFinger);
    b.run(FORM_MS);
    expect(b.lessons.director.frame.line).toBe(COPY.lessons.pickUp);
    expect(b.shown().line).toBe(COPY.game.controllerFinger);
    // Gone (after its 1.2 s hold): the lesson's own line.
    b.play.view.coachLine = null;
    b.run(1500);
    expect(b.shown().line).toBe(COPY.lessons.pickUp);
    // An example's lines always win.
    b.lessons.start("l1", { step: 2 });
    b.play.view.coachLine = "controllerFinger";
    b.run(500);
    expect(b.lessons.director.showing).toBe(true);
    expect(b.shown().line).toBe(b.lessons.director.frame.line);
  });

  it("lets the controller line win over a lesson's own line in lesson 2's turn, where a controller player needs it", () => {
    const b = bench();
    b.lessons.start("l2", { step: 2 });
    b.run(FORM_MS + 200);
    expect(b.lessons.director.step).toBe(2);
    expect(b.lessons.director.frame.line).not.toBeNull();
    b.play.view.coachLine = "controllerFinger";
    b.run(32);
    expect(b.shown().line).toBe(COPY.game.controllerFinger);
    // Hands again: once the session's line has gone (held 1.2 s), the lesson's own line is back.
    b.play.view.coachLine = null;
    b.run(2000);
    expect(b.shown().line).not.toBeNull();
    expect(b.shown().line).toBe(b.lessons.director.frame.line);
  });

  it("shows a tip on a practice box without counting it seen, and keeps it when \"Show me\" puts the box back", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 2 }, null, true);
    b.run(32);
    expect(b.shown().line).toBe(COPY.lessons.tips.decoys);
    expect(b.profile.tipsSeen).toEqual([]);
    // A real box counts it seen; "Show me" and back, and the tip is still up until a lock opens.
    const c = bench();
    c.play.game.play({ kind: "box", n: 2 });
    c.run(32);
    expect(c.profile.tipsSeen).toEqual(["decoys"]);
    c.lessons.replay("near-far");
    c.run(40_000);
    expect(c.plays.at(-1)!.spec).toEqual({ kind: "box", n: 2 });
    c.run(32);
    expect(c.shown().line).toBe(COPY.lessons.tips.decoys);
    c.open.add(0);
    c.run(32);
    expect(c.shown().line).toBeNull();
  });

  it("plays a tip's ghost demo once, as the tip first shows on its box, and on a practice box too", () => {
    for (const practice of [false, true]) {
      const b = bench();
      b.play.game.play({ kind: "box", n: 2 }, null, practice);
      b.run(32);
      expect(b.shown().line).toBe(COPY.lessons.tips.decoys);
      expect(b.lessons.director.tipping).toBe(true);
      expect(b.tipShown()).toBe(true);
      b.run(7000);
      expect(b.lessons.director.tipping).toBe(false);
      expect(b.tipShown()).toBe(false);
      // Once a box: the tip's line stays until done, the demo does not come back.
      b.run(3000);
      expect(b.shown().line).toBe(COPY.lessons.tips.decoys);
      expect(b.lessons.director.tipping).toBe(false);
    }
  });

  it("stops a tip's demo when the player takes the lantern, or a menu comes up, and skips it with the lantern held", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 2 });
    b.run(500);
    expect(b.lessons.director.tipping).toBe(true);
    b.lantern.grab.holder = "right";
    b.run(32);
    expect(b.lessons.director.tipping).toBe(false);
    const c = bench();
    c.play.game.play({ kind: "box", n: 2 });
    c.run(500);
    go("home");
    c.run(32);
    expect(c.lessons.director.tipping).toBe(false);
    go("play");
    const d = bench();
    d.lantern.grab.holder = "left";
    d.play.game.play({ kind: "box", n: 2 });
    d.run(500);
    expect(d.lessons.director.tipping).toBe(false);
    expect(d.shown().line).toBe(COPY.lessons.tips.decoys);
  });

  it("ends lesson 2 with the drawer's pull at its last step", () => {
    const b = bench();
    b.lessons.start("l2", { step: 3 });
    b.session.stage = "offered";
    b.run(FORM_MS + 100);
    expect(b.lessons.running).toBe(true);
    emit({ type: "drawer", hand: "right" });
    // Home comes up in this very frame, before the lesson finishes: it must not wait behind it as half done.
    expect([b.lessons.running, b.lessons.waiting]).toEqual([false, false]);
    go("home");
    b.run(32);
    expect(b.lessons.director.done).toBe(true);
    expect(b.profile.lessons).toEqual({ l1: false, l2: true, step: null });
  });
});
