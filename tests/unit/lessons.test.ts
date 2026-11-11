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
import type { BoxSnapshot, Profile } from "../../src/core/profile";
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

function bench(o: { presenting?: boolean; autoStart?: boolean; afterFirst?: () => boolean } = {}) {
  const profile = newProfile(0, "1.0.0");
  const plays: { spec: BoxSpec; snap: BoxSnapshot | null; practice: boolean }[] = [];
  const open = new Set<number>();
  const session = {
    stage: "idle" as Stage,
    spec: null as BoxSpec | null,
    box: null as Box | null,
    practice: false,
    revealed: true,
    isOpen: (i: number) => open.has(i),
    warmth: () => 0,
    stuck: false,
    restartStuck: vi.fn(),
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
  /** The profile store's onAdopt listeners (another window's profile taken in place of this one's). */
  const adopters: ((before: Profile, held: Profile) => void)[] = [];
  const deps = {
    world: {} as World,
    scene: {} as BoxScene,
    profiles: {
      profile,
      save: vi.fn(async () => {}),
      onAdopt: (fn: (before: Profile, held: Profile) => void) => {
        adopters.push(fn);
        return () => {};
      },
    },
    settings: { get: () => ({ reducedMotion: false, handed: "right" }) },
    lantern: { grab: { holder: null, brightness: 0, nearestPinch: () => false }, feel: { aligned: () => false }, ctrl: { pos: [0.3, -0.3, 1.3] } },
    hands: { n: 0 },
    sound: { game: { lessonStep: vi.fn(), settle: vi.fn(), crystallise: vi.fn() } },
    play,
    presenting: () => env.presenting,
    autoStart: () => o.autoStart ?? true,
    afterFirst: o.afterFirst,
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
  const hands = (deps as unknown as { hands: { n: number; controllers?: boolean } }).hands;
  /**
   * Another window's profile taken in place of this one's, as profile-store.ts does it: `change` makes the other
   * window's from this one's, which is copied in place, and the listeners hear of this one's as it was.
   */
  const adopt = (change: (p: Profile) => void) => {
    const before = JSON.parse(JSON.stringify(profile)) as Profile;
    const theirs = JSON.parse(JSON.stringify(profile)) as Profile;
    change(theirs);
    Object.assign(profile, theirs);
    for (const fn of adopters) fn(before, before);
  };
  return { lessons, profile, session, plays, open, env, run, shown, tipShown, play, lantern, hands, adopt };
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

  it("starts the session's stuck watch over with every lesson step, so the hint lantern glows 40 s into a step", () => {
    const b = bench();
    b.lessons.start("l1", { step: 1 });
    expect(b.session.restartStuck).toHaveBeenCalledTimes(1);
    b.run(500);
    b.open.add(0);
    b.run(32);
    expect(b.lessons.director.step).toBe(2);
    expect(b.session.restartStuck).toHaveBeenCalledTimes(2);
  });

  it("tells a controller player the lines about a free hand or a finger the controllers' way; the director's stay English", () => {
    const b = bench();
    b.hands.controllers = true;
    b.lessons.start("l2");
    b.run(FORM_MS + 200);
    expect(b.lessons.director.frame.line).toBe(COPY.lessons.puppets);
    expect(b.shown().line).toBe(COPY.controller.puppets);
    // Hands again: the hands' words.
    b.hands.controllers = false;
    b.run(32);
    expect(b.shown().line).toBe(COPY.lessons.puppets);
  });

  it("ends the Stuck? line when the player takes a hint from the hint lantern", () => {
    const b = bench();
    b.lessons.start("l1", { step: 3 });
    b.run(40_200);
    expect(b.shown().line).toBe(COPY.lessons.stuck);
    emit({ type: "hint", lock: 1, level: 1 });
    b.run(32);
    expect(b.shown().line).toBe(COPY.lessons.turnNearFar);
  });

  it("explains the hint lantern's glow while lesson 1 waits for the lantern: Stuck? with the glow", () => {
    const b = bench();
    b.lessons.start("l1");
    b.run(FORM_MS + 500);
    expect(b.shown().line).toBe(COPY.lessons.pickUp);
    b.session.stuck = true;
    b.run(32);
    expect(b.shown().line).toBe(COPY.lessons.stuck);
  });

  it("holds a lesson lock's idle clocks and the pause after a win while the headset is hidden", () => {
    const b = bench();
    b.lessons.start("l1", { step: 1 });
    b.run(8000);
    expect(b.lessons.director.frame.key).toBe("goal");
    // Thirty seconds hidden count nothing: no nudge, no last resort.
    b.env.presenting = false;
    b.run(30_000);
    expect([b.lessons.director.frame.key, b.lessons.director.showing]).toEqual(["goal", false]);
    // Seen again, the 12 s nudge comes 4 s on (the first frame back counts at most 0.1 s).
    b.env.presenting = true;
    b.run(3800);
    expect(b.lessons.director.frame.key).toBe("goal");
    b.run(400);
    expect(b.lessons.director.frame.key).toBe("moveIdle");
    // The pause after the first win holds too.
    b.open.add(0);
    b.run(32);
    expect([b.lessons.director.frame.key, b.lessons.director.showing]).toEqual(["lockOpen", false]);
    b.env.presenting = false;
    b.run(10_000);
    b.env.presenting = true;
    b.run(1000);
    expect([b.lessons.director.frame.key, b.lessons.director.showing]).toEqual(["lockOpen", false]);
    b.run(1700);
    expect(b.lessons.director.showing).toBe(true);
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

  it("keeps a lesson's own line over the session's controller line outside a turn, and its example's always", () => {
    const b = bench();
    b.hands.controllers = true;
    b.lessons.start("l2");
    b.play.view.coachLine = "controllerFinger";
    // Lesson 2's puppets: the crown is short from the start (its lantern on the spot), but the player is asked for a
    // hand in the box first, the controllers' way.
    b.run(FORM_MS + 500);
    expect(b.shown().line).toBe(COPY.controller.puppets);
    expect(b.lessons.director.frame.key).toBe("puppets");
    // An example's lines always win.
    b.lessons.start("l1", { step: 2 });
    b.run(500);
    expect(b.lessons.director.showing).toBe(true);
    expect(b.shown().line).toBe(b.lessons.director.frame.line);
    // Out of the lessons, a box's finger lock: the session's line, as before.
    b.lessons.stop();
    b.play.game.play({ kind: "box", n: 7 });
    b.run(32);
    expect(b.shown().line).toBe(COPY.game.controllerFinger);
  });

  it("lets the controller line win over a lesson's own line in lesson 2's turn once that has had its 3 s, and says so", () => {
    const b = bench();
    b.hands.controllers = true;
    b.lessons.start("l2", { step: 2 });
    // The session asks from the turn's start (the lock is short and controllers are in hand)...
    b.play.view.coachLine = "controllerFinger";
    b.run(FORM_MS + 200);
    expect(b.lessons.director.step).toBe(2);
    // ...but the turn's own line (the controllers' way) keeps the chip for its first 3 s: no flash of it.
    expect(b.shown().line).toBe(COPY.controller.turnFinger);
    expect(b.lessons.director.frame.key).toBe("turnFinger");
    b.run(1000);
    // Then the session's line, and the director says it is the one showing.
    expect(b.shown().line).toBe(COPY.game.controllerFinger);
    expect(b.lessons.director.frame.key).toBe("game.controllerFinger");
    expect(b.lessons.director.frame.line).toBe(COPY.game.controllerFinger);
    // Hands again: once the session's line has gone (held 1.2 s), the lesson's own line is back.
    b.play.view.coachLine = null;
    b.hands.controllers = false;
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

  it("stops a tip's demo when the player does what the tip says, or the box changes", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 2 });
    b.run(500);
    expect(b.lessons.director.tipping).toBe(true);
    // Decoys: any lock opened past them is the tip done.
    b.open.add(0);
    b.run(32);
    expect(b.lessons.director.tipping).toBe(false);
    const c = bench();
    c.play.game.play({ kind: "box", n: 2 });
    c.run(500);
    c.play.game.play({ kind: "box", n: 7 });
    c.run(32);
    expect(c.lessons.director.tipping).toBe(false);
  });

  it("waits for the box to be shown before a tip's demo, and never plays a tip worked out for another box", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 2 });
    b.session.revealed = false;
    b.run(500);
    expect(b.lessons.director.tipping).toBe(false);
    b.session.revealed = true;
    b.run(32);
    expect(b.lessons.director.tipping).toBe(true);
    // A box arrives while the session's own line holds the coach line (so the tip is not worked out again): the old
    // box's tip does not play on it.
    const c = bench();
    c.play.game.play({ kind: "box", n: 7 });
    c.run(32);
    c.play.view.coachLine = "controllerFinger";
    c.play.game.play({ kind: "box", n: 2 });
    c.run(500);
    expect(c.lessons.director.tipping).toBe(false);
  });

  it("replays a tip's own demo from the Lessons menu on a fresh practice copy of its box, then puts back what was in play", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 7 });
    b.profile.tipsSeen = ["decoys"];
    expect(b.lessons.replayTip!("decoys")).toBe(true);
    expect(b.plays.at(-1)).toEqual({ spec: { kind: "box", n: 2 }, snap: null, practice: true });
    expect(b.lessons.running).toBe(true);
    b.run(500);
    expect(b.lessons.director.tipping).toBe(true);
    expect(b.shown().line).toBe(COPY.lessons.tips.decoys);
    b.run(8000);
    expect(b.lessons.director.tipping).toBe(false);
    expect(b.plays.at(-1)!.spec).toEqual({ kind: "box", n: 7 });
    expect(b.lessons.running).toBe(false);
    expect(b.profile.tipsSeen).toEqual(["decoys"]);
    // Over an opened box nothing is put back: Home, where Continue offers the next box.
    const c = bench();
    c.play.game.play({ kind: "box", n: 7 });
    c.session.stage = "offered";
    c.lessons.replayTip!("decoys");
    const n = c.plays.length;
    c.run(9000);
    expect(c.plays.length).toBe(n);
    expect(currentScreen()).toBe("home");
    // The drawer has no box of its own: lesson 2's example teaches it.
    const d = bench();
    expect(d.lessons.replayTip!("drawer")).toBe(true);
    expect(d.lessons.director.replaying).toBe("finger");
  });

  it("lets a replay's kept box go when another window moved that box's save on: the replay ends on Home, nothing put back", () => {
    const snapOf = (key: string) => ({ key, lantern: [0, 0, 1], open: [0], crystal: [], elapsedMs: 1234, hints: 0, hintLevel: {} }) as BoxSnapshot;
    const box7: BoxSpec = { kind: "box", n: 7 }, daily: BoxSpec = { kind: "daily", day: "2026-11-08" };
    /** The other window solved box 7 and started box 8. */
    const solved7 = (p: Profile) => {
      p.nextBox = 8;
      p.current = snapOf("shadow-locks/8");
    };
    const cases: { name: string; spec: BoxSpec; practice: boolean; tip: boolean; other: (p: Profile) => void; back: boolean }[] = [
      { name: "an example over box 7, solved there", spec: box7, practice: false, tip: false, other: solved7, back: false },
      { name: "a tip over box 7, solved there", spec: box7, practice: false, tip: true, other: solved7, back: false },
      {
        name: "an example over the Daily Box, solved there",
        spec: daily,
        practice: false,
        tip: false,
        other: (p) => (p.daily = { ...p.daily, streak: 1, best: 1, lastDay: "2026-11-08", current: null }),
        back: false,
      },
      // Its own save did not move (the other window played the Daily Box): box 7 comes back.
      { name: "an example over box 7, the Daily played there", spec: box7, practice: false, tip: false, other: (p) => (p.daily.streak = 4), back: true },
      // A practice box saves nowhere, so nothing it puts back can roll a save back: it comes back.
      { name: "a tip over practice box 7, box 7 solved there", spec: box7, practice: true, tip: true, other: solved7, back: true },
    ];
    for (const c of cases) {
      const b = bench();
      b.play.game.play(c.spec, null, c.practice);
      // As the lifecycle saved it (a practice box never is).
      if (!c.practice && c.spec.kind === "box") b.profile.current = snapOf("shadow-locks/7");
      if (c.spec.kind === "daily") b.profile.daily.current = snapOf("shadow-locks/daily/2026-11-08");
      b.profile.tipsSeen = ["decoys"];
      expect(c.tip ? b.lessons.replayTip!("decoys") : b.lessons.replay("move"), c.name).toBe(true);
      b.run(500);
      const n = b.plays.length;
      b.adopt(c.other);
      b.run(40_000);
      expect([b.lessons.running, b.lessons.director.replaying], c.name).toEqual([false, null]);
      if (c.back) {
        expect(b.plays.length, c.name).toBe(n + 1);
        expect(b.plays.at(-1), c.name).toMatchObject({ spec: c.spec, practice: c.practice });
        expect(currentScreen(), c.name).toBe("play");
      } else {
        expect(b.plays.length, c.name).toBe(n);
        expect(currentScreen(), c.name).toBe("home");
      }
    }
  });

  it("refuses \"Show me\" during a tip replay: the player ends back on the real box, never a practice copy", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 7 });
    b.lessons.replayTip!("decoys");
    b.run(500);
    expect(b.lessons.director.tipping).toBe(true);
    expect(b.lessons.replay("near-far")).toBe(false);
    b.run(9000);
    expect(b.lessons.director.replaying).toBeNull();
    expect(b.plays.at(-1)).toMatchObject({ spec: { kind: "box", n: 7 }, practice: false });
    expect(b.session.practice).toBe(false);
  });

  it("keeps the drawer shut through a tip replay, and lets it go with the demo when the player takes the lantern", () => {
    const b = bench();
    b.play.game.play({ kind: "box", n: 7 });
    expect(b.lessons.drawerAllowed).toBe(true);
    b.lessons.replayTip!("decoys");
    expect(b.lessons.drawerAllowed).toBe(false);
    b.run(500);
    expect([b.lessons.director.tipping, b.lessons.drawerAllowed]).toEqual([true, false]);
    // A hand takes the lantern: the demo stops, as in play, and the real box comes back.
    b.lantern.grab.holder = "right";
    b.run(64);
    expect(b.lessons.director.tipping).toBe(false);
    expect(b.plays.at(-1)).toMatchObject({ spec: { kind: "box", n: 7 }, practice: false });
    expect(b.lessons.drawerAllowed).toBe(true);
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

  it("gives a real lesson 1's end to a shared link's box in place of lesson 2; a practice lesson 1 never asks", () => {
    /** Lesson 1's end, as the director calls it when its last step is done. */
    const finish = (b: ReturnType<typeof bench>) => (b.lessons as unknown as { finished(id: "l1"): void }).finished("l1");
    // The link takes it: no lesson 2, and lesson 1 is saved as done.
    const took = vi.fn(() => true);
    const a = bench({ afterFirst: took });
    a.lessons.start("l1");
    finish(a);
    expect(took).toHaveBeenCalledTimes(1);
    expect(a.plays.map((p) => p.spec)).toEqual([{ kind: "lesson", id: "l1" }]);
    expect(a.profile.lessons).toMatchObject({ l1: true, step: null });
    // The link waits for nothing (false): lesson 2 as usual.
    const none = bench({ afterFirst: () => false });
    none.lessons.start("l1");
    finish(none);
    expect(none.plays.at(-1)).toMatchObject({ spec: { kind: "lesson", id: "l2" }, practice: false });
    // A practice replay of lesson 1 (`?lesson=l1`): the link is never asked, lesson 2 follows as practice too.
    const asked = vi.fn(() => true);
    const practice = bench({ afterFirst: asked });
    practice.lessons.start("l1", { practice: true });
    finish(practice);
    expect(asked).not.toHaveBeenCalled();
    expect(practice.plays.at(-1)).toMatchObject({ spec: { kind: "lesson", id: "l2" }, practice: true });
    expect(practice.profile.lessons.l1).toBe(false);
    // No hook at all: lesson 2.
    const plain = bench();
    plain.lessons.start("l1");
    finish(plain);
    expect(plain.plays.at(-1)!.spec).toEqual({ kind: "lesson", id: "l2" });
  });
});
