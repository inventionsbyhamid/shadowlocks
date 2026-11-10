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
  function flow(link: SharedLink, p: Profile) {
    const calls: string[] = [];
    const f = new ShareFlow({
      link,
      profiles: { profile: p },
      game: {
        play: (spec: BoxSpec, _snap, practice) => calls.push(`play ${JSON.stringify(spec)} ${practice}`),
        playDaily: (now) => calls.push(`daily ${now}`),
      },
      now: () => Date.UTC(2026, 10, 10, 9),
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
});
