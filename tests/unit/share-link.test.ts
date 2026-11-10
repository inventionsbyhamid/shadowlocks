// Shared links: a query string on the public host naming a numbered box or a day, with the sender's time in whole
// seconds, their hints and the generator version (`?box=12&t=222&h=0&g=4`, `?day=2026-11-10&t=252&h=1&g=4`). Every
// value is checked on its own: a bad one is dropped and the box still opens; a link naming no box is no shared link.
import { describe, expect, it } from "vitest";
import { GENERATOR_VERSION } from "../../src/core/generator";
import type { BoxResult } from "../../src/core/result";
import { linkOf, MAX_LINK_HINTS, parseSharedLink, type SharedLink, sharedLinkUrl, squares, targetKey, webLaunchUrl } from "../../src/core/share";

const parse = (q: string) => parseSharedLink(q);

describe("a shared link", () => {
  it("names a numbered box or a day, with a time, hints and the generator version", () => {
    expect(parse("?box=12&t=222&h=0&g=4")).toEqual({ target: { kind: "box", n: 12 }, t: 222, h: 0, g: 4 });
    expect(parse("?day=2026-11-10&t=252&h=1&g=4")).toEqual({ target: { kind: "daily", day: "2026-11-10" }, t: 252, h: 1, g: 4 });
    // A day alone is a shared link; so is a box with any of the result's values (a bad one too: it still opens).
    expect(parse("?day=2026-11-10")).toEqual({ target: { kind: "daily", day: "2026-11-10" }, t: null, h: null, g: null });
    expect(parse("?box=3&t=abc")).toEqual({ target: { kind: "box", n: 3 }, t: null, h: null, g: null });
    // `?box=N` alone is the field flag (practice, Next is N+1), not a shared link; nor is a page with no box.
    expect(parse("?box=3")).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("?t=100&h=0")).toBeNull();
    expect(parse("?perf=1")).toBeNull();
  });

  it("round-trips through its address on the public host", () => {
    const links: SharedLink[] = [
      { target: { kind: "box", n: 12 }, t: 222, h: 0, g: 4 },
      { target: { kind: "daily", day: "2026-11-10" }, t: 252, h: 1, g: 4 },
      { target: { kind: "box", n: 999_999 }, t: 359_999, h: MAX_LINK_HINTS, g: 3 },
      { target: { kind: "daily", day: "2026-02-28" }, t: 1, h: null, g: null },
      { target: { kind: "box", n: 1 }, t: null, h: 2, g: null },
    ];
    expect(sharedLinkUrl(links[0]!)).toBe("https://shadowlocks.pages.dev/?box=12&t=222&h=0&g=4");
    expect(sharedLinkUrl(links[1]!)).toBe("https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4");
    for (const l of links) {
      const url = new URL(sharedLinkUrl(l));
      expect(url.origin).toBe("https://shadowlocks.pages.dev");
      expect(url.pathname).toBe("/");
      expect(parse(url.search)).toEqual(l);
    }
  });

  it("drops a malformed or out-of-range value, and never takes a value given twice", () => {
    const t = (q: string) => parse(`?box=5&${q}`);
    for (const bad of ["t=0", "t=-5", "t=360000", "t=1.5", "t=1e3", "t=+12", "t=012", "t=", "t=12&t=13"]) expect(t(bad)?.t, bad).toBeNull();
    for (const bad of ["h=-1", "h=13", "h=01", "h=1.0", "h=", "h=x", "h=0&h=1"]) expect(t(bad)?.h, bad).toBeNull();
    // Only a version the generator can still build: another would make a different box.
    for (const bad of ["g=2", "g=5", "g=04", "g=", "g=4&g=3"]) expect(t(bad)?.g, bad).toBeNull();
    expect(t("t=359999")?.t).toBe(359_999);
    expect(t("h=12")?.h).toBe(12);
    expect(t("g=3")?.g).toBe(3);
    // A box number as the field flag takes it (1 to 999999), and a real day from 2026 to 2099.
    for (const bad of ["box=0", "box=01", "box=1000000", "box=-3", "box=2.5", "box=1&box=2"]) expect(parse(`?${bad}&t=10`), bad).toBeNull();
    for (const bad of ["day=2026-02-30", "day=2026-13-01", "day=2025-12-31", "day=2100-01-01", "day=26-11-10", "day=2026-11-10x", "day=2026-11-10&day=2026-11-11"]) {
      expect(parse(`?${bad}&t=10`), bad).toBeNull();
    }
    // Both named: the box wins (the day is dropped).
    expect(parse("?box=4&day=2026-11-10&t=9")?.target).toEqual({ kind: "box", n: 4 });
    // Nothing in a link is ever a free word or another site: anything else in the address is left alone.
    expect(parse("?day=2026-11-10&t=9&name=Bob&url=https://evil.example")).toEqual({ target: { kind: "daily", day: "2026-11-10" }, t: 9, h: null, g: null });
  });

  it("is made from a box's result: its target, whole seconds, hints (at most the link's limit) and the version", () => {
    const r = (o: Partial<BoxResult>): BoxResult => ({ spec: { kind: "box", n: 12 }, key: "shadow-locks/12", practice: false, recorded: true, timeMs: 222_900, hints: 0, levels: [0, 0], ...o });
    expect(linkOf(r({}))).toEqual({ target: { kind: "box", n: 12 }, t: 222, h: 0, g: GENERATOR_VERSION });
    expect(linkOf(r({ spec: { kind: "daily", day: "2026-11-10" }, key: "shadow-locks/daily/2026-11-10", hints: 40 }))).toEqual({
      target: { kind: "daily", day: "2026-11-10" },
      t: 222,
      h: MAX_LINK_HINTS,
      g: GENERATOR_VERSION,
    });
    // A box rebuilt under an older version keeps it.
    expect(linkOf(r({ spec: { kind: "box", n: 2, gen: 3 } })).g).toBe(3);
    expect(targetKey({ kind: "box", n: 12 })).toBe("shadow-locks/12");
    expect(targetKey({ kind: "daily", day: "2026-11-10" })).toBe("shadow-locks/daily/2026-11-10");
  });

  it("goes to a headset by Meta's Web Launch, and its squares are the result's tiles", () => {
    expect(webLaunchUrl("https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4")).toBe(
      "https://www.oculus.com/open_url/?url=https%3A%2F%2Fshadowlocks.pages.dev%2F%3Fday%3D2026-11-10%26t%3D252%26h%3D1%26g%3D4",
    );
    expect(() => webLaunchUrl("http://shadowlocks.pages.dev/")).toThrow();
    expect(squares(["clear", "clear", "hinted"])).toBe("🟨🟨🟧");
    expect(squares(["shown"])).toBe("🟥");
  });
});
