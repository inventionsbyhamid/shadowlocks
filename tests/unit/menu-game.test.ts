// The menus over the game: what waits behind them, Continue and the Daily Box, lesson and tip replays, a
// first launch going straight into lesson 1, and a progress reset letting the box in play go.
import { describe, expect, it } from "vitest";
import { GameMenus, type MenuLessons, NO_LESSONS, REPLAYS_KEPT, TIP_EXAMPLE } from "../../src/app/menu-game";
import type { Stage } from "../../src/app/session-deps";
import { newProfile } from "../../src/core/profile";
import type { BoxSpec } from "../../src/core/types";
import type { ExampleKey } from "../../src/ui/menus/types";

function bench(o: { lessons?: MenuLessons; canPlayBox?: () => boolean } = {}) {
  const said: string[] = [];
  const session: { stage: Stage; spec: BoxSpec | null; rehand?: () => Promise<void> } = { stage: "idle", spec: null };
  const profile = newProfile(0, "1.0.0");
  const menus = new GameMenus({
    canPlayBox: o.canPlayBox ?? (() => true),
    toTrial: () => said.push("toTrial"),
    game: {
      play: (spec: BoxSpec) => {
        said.push(`play ${JSON.stringify(spec)}`);
        session.stage = "playing";
        session.spec = spec;
      },
      playNext: () => said.push("playNext"),
      playDaily: (now: number) => said.push(`playDaily ${now}`),
    },
    session,
    lessons: o.lessons ?? NO_LESSONS,
    toPlay: () => said.push("toPlay"),
    clearBox: () => said.push("clearBox"),
  });
  return { menus, said, session, profile };
}

/** Lessons that replay anything and say so. */
function fakeLessons(): { running: boolean; replays: ExampleKey[]; first: number; startFirst(): boolean; replay(ex: ExampleKey): boolean } {
  const l = {
    running: false,
    replays: [] as ExampleKey[],
    first: 0,
    startFirst: () => {
      l.first++;
      l.running = true;
      return true;
    },
    replay: (ex: ExampleKey) => {
      l.replays.push(ex);
      return true;
    },
  };
  return l;
}

describe("GameMenus", () => {
  it("nothing waits behind the menus until a box or a lesson is in the lap", () => {
    const b = bench();
    expect(b.menus.behind()).toBeNull();
    b.session.spec = { kind: "box", n: 4 };
    b.session.stage = "loading";
    expect(b.menus.behind()).toEqual({ kind: "box", n: 4 });
    b.session.stage = "playing";
    expect(b.menus.behind()).toEqual({ kind: "box", n: 4 });
    // Opened and offered: still that box (its Next waits on the plate).
    b.session.stage = "offered";
    expect(b.menus.behind()).toEqual({ kind: "box", n: 4 });
    b.session.spec = { kind: "daily", day: "2026-11-06" };
    expect(b.menus.behind()).toEqual({ kind: "daily" });
    const l = fakeLessons();
    const c = bench({ lessons: l });
    c.session.spec = { kind: "box", n: 2 };
    c.session.stage = "playing";
    l.running = true;
    expect(c.menus.behind()).toEqual({ kind: "lesson" });
  });

  it("Continue goes back to the box behind, or resumes the saved one, or starts the next", () => {
    const b = bench();
    b.session.spec = { kind: "box", n: 5 };
    b.session.stage = "playing";
    b.menus.playBox(5, true);
    expect(b.said).toEqual(["toPlay"]);
    b.menus.back();
    expect(b.said).toEqual(["toPlay", "toPlay"]);
    const c = bench();
    c.menus.playBox(3, true);
    c.menus.playBox(4, false);
    expect(c.said).toEqual(["playNext", 'play {"kind":"box","n":4}']);
  });

  it("the Daily Box goes back to today's when it is behind, else plays today's", () => {
    const b = bench();
    b.menus.playDaily(1234);
    expect(b.said).toEqual(["playDaily 1234"]);
    b.session.spec = { kind: "daily", day: "2026-11-06" };
    b.session.stage = "playing";
    b.menus.playDaily(Date.UTC(2026, 10, 6, 12));
    expect(b.said).toEqual(["playDaily 1234", "toPlay"]);
  });

  it("replays an example, or a tip through the example that teaches it, and goes to play only when it runs", () => {
    expect(TIP_EXAMPLE).toEqual({ decoys: "near-far", ringless: "move", hidden: "move", drawer: "finger" });
    const l = fakeLessons();
    const b = bench({ lessons: l });
    b.menus.replay({ key: "lesson-rings", label: "Sight the rings", kind: "example", id: "rings" });
    b.menus.replay({ key: "tip-0", label: "Decoys", kind: "tip", id: "decoys" });
    expect(l.replays).toEqual(["rings", "near-far"]);
    expect(b.said).toEqual(["toPlay", "toPlay"]);
    expect(b.menus.replays).toEqual([
      { kind: "example", id: "rings", ran: true },
      { kind: "tip", id: "decoys", ran: true },
    ]);
    // Without lessons wired, nothing runs and the menu stays.
    const c = bench();
    c.menus.replay({ key: "lesson-move", label: "Move the light", kind: "example", id: "move" });
    expect(c.said).toEqual([]);
    expect(c.menus.replays).toEqual([{ kind: "example", id: "move", ran: false }]);
  });

  it("a first launch goes straight into lesson 1 when the lessons can start it", () => {
    const l = fakeLessons();
    const b = bench({ lessons: l });
    expect(b.menus.startFirst()).toBe(true);
    expect(l.first).toBe(1);
    expect(b.said).toEqual(["toPlay"]);
    const c = bench();
    expect(c.menus.startFirst()).toBe(false);
    expect(c.said).toEqual([]);
  });

  it("a progress reset lets the box in play go: nothing waits behind until the next box", () => {
    const b = bench();
    b.session.spec = { kind: "box", n: 7 };
    b.session.stage = "playing";
    b.menus.dropped();
    expect(b.said).toEqual(["clearBox"]);
    expect(b.menus.behind()).toBeNull();
    // Box 7 is not behind any more: Continue starts it, it does not "go back" to it.
    b.menus.playBox(7, false);
    expect(b.said).toEqual(["clearBox", 'play {"kind":"box","n":7}']);
    expect(b.menus.behind()).toEqual({ kind: "box", n: 7 });
    // The same for a Daily Box let go: the Daily key plays today's afresh.
    const c = bench();
    c.session.spec = { kind: "daily", day: "2026-11-06" };
    c.session.stage = "playing";
    c.menus.dropped();
    c.menus.playDaily(Date.UTC(2026, 10, 6, 12));
    expect(c.said).toEqual(["clearBox", `playDaily ${Date.UTC(2026, 10, 6, 12)}`]);
  });

  it("endless boxes ask the entitlement: refused, Continue goes to the trial screen instead, even with a box behind", () => {
    let allowed = false;
    const b = bench({ canPlayBox: () => allowed });
    b.menus.playBox(3, false);
    b.menus.playBox(2, true);
    b.session.spec = { kind: "box", n: 4 };
    b.session.stage = "playing";
    b.menus.playBox(4, true);
    expect(b.said).toEqual(["toTrial", "toTrial", "toTrial"]);
    // The Daily Box stays open.
    b.menus.playDaily(5);
    expect(b.said.at(-1)).toBe("playDaily 5");
    allowed = true;
    b.menus.playBox(4, true);
    expect(b.said.at(-1)).toBe("toPlay");
  });

  it("a hand change re-mirrors the box behind, never one a reset let go", async () => {
    const b = bench();
    const asked: string[] = [];
    b.session.rehand = async () => {
      asked.push("rehand");
    };
    await b.menus.rehand();
    expect(asked).toEqual([]);
    b.session.spec = { kind: "box", n: 3 };
    b.session.stage = "playing";
    await b.menus.rehand();
    expect(asked).toEqual(["rehand"]);
    b.menus.dropped();
    await b.menus.rehand();
    expect(asked).toEqual(["rehand"]);
  });

  it("keeps only the last few replays asked for", () => {
    const b = bench();
    for (let i = 0; i < 40; i++) b.menus.replay({ key: "lesson-move", label: "Move the light", kind: "example", id: "move" });
    expect(b.menus.replays.length).toBe(REPLAYS_KEPT);
  });
});
