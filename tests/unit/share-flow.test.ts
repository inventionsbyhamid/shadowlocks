// Where a shared link goes, and what it may change. Today's Daily Box counts as the player's own Daily Box once (the
// Daily Box open to them, not solved yet today): then it is their Daily Box, resumed from their save. Anything else
// plays as practice, which never touches progress, the streak or the collection.
import { describe, expect, it } from "vitest";
import { ShareFlow, sharedRoute } from "../../src/app/share-flow";
import { newProfile, type Profile } from "../../src/core/profile";
import type { SharedLink } from "../../src/core/share";
import type { BoxSpec } from "../../src/core/types";

const TODAY = "2026-11-10";
const dailyLink = (day: string, g: number | null = 4): SharedLink => ({ target: { kind: "daily", day }, t: 252, h: 1, g });

function player(o: Partial<Pick<Profile, "nextBox">> & { lastDay?: string | null } = {}): Profile {
  const p = newProfile(0, "test");
  p.nextBox = o.nextBox ?? 8;
  p.lessons = { l1: true, l2: true, step: null };
  p.daily = { ...p.daily, lastDay: o.lastDay ?? null };
  return p;
}

describe("a shared link's route", () => {
  it("today's Daily Box is the player's own, once: open to them and not solved today", () => {
    expect(sharedRoute(dailyLink(TODAY), player(), TODAY)).toEqual({ kind: "daily" });
    expect(sharedRoute(dailyLink(TODAY), player({ lastDay: "2026-11-09" }), TODAY)).toEqual({ kind: "daily" });
    // Solved today already: practice (its solve counted once).
    expect(sharedRoute(dailyLink(TODAY), player({ lastDay: TODAY }), TODAY)).toEqual({ kind: "practice", spec: { kind: "daily", day: TODAY } });
    // Not open yet (box 3 not solved): practice, so a friend's link never opens the Daily Box early.
    expect(sharedRoute(dailyLink(TODAY), player({ nextBox: 3 }), TODAY)).toEqual({ kind: "practice", spec: { kind: "daily", day: TODAY } });
    // A clock moved back below the last day solved: practice too (recordDailySolve would ignore it anyway).
    expect(sharedRoute(dailyLink(TODAY), player({ lastDay: "2026-11-12" }), TODAY)).toEqual({ kind: "practice", spec: { kind: "daily", day: TODAY } });
  });

  it("another day's Daily Box and a numbered box play as practice, built by the link's generator version", () => {
    expect(sharedRoute(dailyLink("2026-11-09"), player(), TODAY)).toEqual({ kind: "practice", spec: { kind: "daily", day: "2026-11-09" } });
    expect(sharedRoute(dailyLink("2026-11-11"), player(), TODAY)).toEqual({ kind: "practice", spec: { kind: "daily", day: "2026-11-11" } });
    expect(sharedRoute(dailyLink("2026-11-09", 3), player(), TODAY)).toEqual({ kind: "practice", spec: { kind: "daily", day: "2026-11-09", gen: 3 } });
    const box: SharedLink = { target: { kind: "box", n: 12 }, t: 222, h: 0, g: 4 };
    expect(sharedRoute(box, player(), TODAY)).toEqual({ kind: "practice", spec: { kind: "box", n: 12 } });
    expect(sharedRoute({ ...box, g: 3 }, player(), TODAY)).toEqual({ kind: "practice", spec: { kind: "box", n: 12, gen: 3 } });
    // Even the box in progress, or one solved before: practice (the player's own save is never touched).
    expect(sharedRoute(box, player({ nextBox: 12 }), TODAY)).toEqual({ kind: "practice", spec: { kind: "box", n: 12 } });
  });
});

describe("the shared link's start", () => {
  function flow(link: SharedLink, p: Profile, o: { lessonsFirst?: boolean } = {}) {
    const calls: string[] = [];
    const f = new ShareFlow({
      link,
      profiles: { profile: p },
      game: {
        play: (spec: BoxSpec, _snap, practice) => calls.push(`play ${JSON.stringify(spec)} ${practice}`),
        playDaily: (now) => calls.push(`daily ${now}`),
      },
      now: () => Date.UTC(2026, 10, 10, 9),
      lessons: { start: (id, opts) => calls.push(`lesson ${id} ${opts.step ?? 0}`) },
      lessonsFirst: () => o.lessonsFirst ?? true,
      after: () => calls.push("after"),
    });
    return { f, calls };
  }

  it("plays the player's own Daily Box (their save resumed) or the shared box as practice", () => {
    const own = flow(dailyLink("2026-11-10"), player());
    own.f.start();
    expect(own.calls).toEqual([`daily ${Date.UTC(2026, 10, 10, 9)}`]);
    expect(own.f.route).toEqual({ kind: "daily" });
    const other = flow(dailyLink("2026-11-09"), player());
    other.f.start();
    expect(other.calls).toEqual([`play {"kind":"daily","day":"2026-11-09"} true`]);
    expect(other.f.key).toBe("shadow-locks/daily/2026-11-09");
  });

  it("a new player does Lesson 1 first (resumed at its step), then gets the friend's box, once", () => {
    const box: SharedLink = { target: { kind: "box", n: 12 }, t: 222, h: 0, g: 4 };
    const p = newProfile(0, "test");
    p.lessons = { l1: false, l2: false, step: { id: "l1", index: 3 } };
    const { f, calls } = flow(box, p);
    f.start();
    expect(calls).toEqual(["lesson l1 3"]);
    expect([f.route, f.lessonFirst]).toEqual([null, true]);
    // Lesson 1 done: the friend's box instead of lesson 2.
    p.lessons = { l1: true, l2: false, step: null };
    expect(f.afterLesson()).toBe(true);
    expect(calls).toEqual(["lesson l1 3", `play {"kind":"box","n":12} true`]);
    expect(f.lessonFirst).toBe(false);
    // Lesson 1 again later (from the menus): nothing more of the link's.
    expect(f.afterLesson()).toBe(false);
    // Lessons kept away (a test build), or done already: the box at once.
    const skip = flow(box, newProfile(0, "test"), { lessonsFirst: false });
    skip.f.start();
    expect(skip.calls).toEqual([`play {"kind":"box","n":12} true`]);
  });

  it("the shared practice box's Next is the flow's (lesson 2 or Home), never another box; other boxes keep theirs", () => {
    const box: SharedLink = { target: { kind: "box", n: 12 }, t: 222, h: 0, g: 4 };
    const { f, calls } = flow(box, player());
    f.start();
    expect(f.next({ practice: true, box: { key: "shadow-locks/12" } })).toBe(true);
    expect(calls.at(-1)).toBe("after");
    expect(f.next({ practice: true, box: { key: "shadow-locks/13" } })).toBe(false);
    expect(f.next({ practice: false, box: { key: "shadow-locks/12" } })).toBe(false);
    expect(f.next({ practice: true, box: null })).toBe(false);
    // The friend's result, for that box only (none without a time).
    expect(f.friendFor("shadow-locks/12")).toEqual({ t: 222, h: 0 });
    expect(f.friendFor("shadow-locks/13")).toBeNull();
    expect(flow({ ...box, t: null }, player()).f.friendFor("shadow-locks/12")).toBeNull();
  });

  it("the landing's last line says what Open the box does, and nothing once the link's box has been played", () => {
    const box: SharedLink = { target: { kind: "box", n: 12 }, t: 222, h: 0, g: 4 };
    // Before the start: nothing yet. A numbered box: practice; today's own Daily Box: today; another day: that.
    const b = flow(box, player());
    expect(b.f.note()).toBeNull();
    b.f.start();
    expect(b.f.note()).toBe("practice");
    const own = flow(dailyLink(TODAY), player());
    own.f.start();
    expect(own.f.note()).toBe("today");
    const other = flow(dailyLink("2026-11-09"), player());
    other.f.start();
    expect(other.f.note()).toBe("otherDay");
    // Today's Daily Box once solved plays as practice, and is today's: practice, not another day.
    const solved = flow(dailyLink(TODAY), player({ lastDay: TODAY }));
    solved.f.start();
    expect(solved.f.note()).toBe("practice");
    // Another box's result changes nothing; the link's box played: no "your turn" left above "Send yours back".
    expect(b.f.played("shadow-locks/13")).toBe(false);
    expect(b.f.note()).toBe("practice");
    expect(b.f.played("shadow-locks/12")).toBe(true);
    expect(b.f.note()).toBeNull();
    expect(b.f.played("shadow-locks/12")).toBe(false);
    expect(own.f.played("shadow-locks/daily/2026-11-10")).toBe(true);
    expect(own.f.note()).toBeNull();
    // A new player: Lesson 1 first until it is done.
    const p = newProfile(0, "test");
    const fresh = flow(box, p);
    fresh.f.start();
    expect(fresh.f.note()).toBe("lessonFirst");
    p.lessons = { l1: true, l2: false, step: null };
    fresh.f.afterLesson();
    expect(fresh.f.note()).toBe("practice");
  });
});
