// The text the 2D page shares for a result: the game's name and the box, a square per lock and the time, the streak,
// and the link, in the sender's language. Spoiler free: it never names a shape.
import { afterEach, describe, expect, it } from "vitest";
import { newProfile } from "../../src/core/profile";
import type { BoxResult } from "../../src/core/result";
import { setLang } from "../../src/i18n";
import { shareOffer, todayOffer } from "../../src/ui/share-text";

afterEach(() => setLang("en"));

const today: BoxResult = {
  spec: { kind: "daily", day: "2026-11-10" },
  key: "shadow-locks/daily/2026-11-10",
  practice: false,
  recorded: true,
  timeMs: 252_700,
  hints: 1,
  levels: [0, 0, 2],
};

describe("the shared text", () => {
  it("today's Daily Box: name and day, a square per lock and the time, the streak, the link", () => {
    const p = newProfile(0, "test");
    p.daily.streak = 5;
    const o = shareOffer(today, p, "2026-11-10")!;
    expect(o.kind).toBe("today");
    expect(o.url).toBe("https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4");
    expect(o.text).toBe(["Shadow Locks · Daily Box Nov 10", "🟨🟨🟧 4:12", "Streak 5", "https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4"].join("\n"));
    // Never a shape's name.
    expect(o.text).not.toMatch(/Key|Star|Moon|Cat|Owl/);
  });

  it("is in the sender's language (the link is the same in every one)", () => {
    setLang("de");
    const p = newProfile(0, "test");
    p.daily.streak = 2;
    const o = shareOffer({ ...today, levels: [4] }, p, "2026-11-10")!;
    expect(o.text.split("\n")).toEqual(["Shadow Locks · Tagesbox vom 10. Nov.", "🟥 4:12", "Serie: 2", "https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4"]);
  });

  it("any other box is a challenge; the friend's own box sends theirs back; a lesson's box offers nothing", () => {
    const p = newProfile(0, "test");
    expect(shareOffer({ ...today, spec: { kind: "lesson", id: "l1" }, key: "lesson/l1" }, p, "2026-11-10")).toBeNull();
    const box: BoxResult = { spec: { kind: "box", n: 12 }, key: "shadow-locks/12", practice: false, recorded: true, timeMs: 178_000, hints: 0, levels: [0, 4] };
    const c = shareOffer(box, p, "2026-11-10")!;
    expect(c.kind).toBe("challenge");
    expect(c.text.split("\n")).toEqual(["Shadow Locks · Box No. 12", "🟨🟥 2:58", "Can you beat my time?", "https://shadowlocks.pages.dev/?box=12&t=178&h=0&g=4"]);
    // A friend's box (the shared link's), practice: "Send yours back", the same text.
    const back = shareOffer({ ...box, practice: true, recorded: false }, p, "2026-11-10", "shadow-locks/12")!;
    expect([back.kind, back.text]).toEqual(["reply", c.text]);
    // Another day's Daily Box (practice), or today's on a later day: a challenge, by its day.
    const past = shareOffer({ ...today, practice: true, recorded: false }, p, "2026-11-10")!;
    expect(past.kind).toBe("challenge");
    expect(past.url).toBe("https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4");
    expect(shareOffer(today, p, "2026-11-11")!.kind).toBe("challenge");
    // Built by an older generator version: the link says so.
    expect(shareOffer({ ...box, spec: { kind: "box", n: 12, gen: 3 } }, p, "2026-11-10")!.url).toBe("https://shadowlocks.pages.dev/?box=12&t=178&h=0&g=3");
  });

  it("is made again from the collection on a later visit (each lock's level kept), not from an older save without them", () => {
    const p = newProfile(0, "test");
    p.daily.streak = 3;
    const item = { key: "shadow-locks/daily/2026-11-10", owner: "the Clockmaker", loot: "a silver thimble", shapes: ["Key" as const], atMs: 0, timeMs: 252_700, hints: 1 };
    p.collection = [{ ...item, levels: [0, 0, 2] }];
    expect(todayOffer(p, "2026-11-10")!.text).toBe(
      ["Shadow Locks · Daily Box Nov 10", "🟨🟨🟧 4:12", "Streak 3", "https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4"].join("\n"),
    );
    expect(todayOffer(p, "2026-11-11")).toBeNull();
    p.collection = [item];
    expect(todayOffer(p, "2026-11-10")).toBeNull();
  });
});
