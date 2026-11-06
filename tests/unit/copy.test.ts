import { describe, expect, it } from "vitest";
import { COPY, fill } from "../../src/ui/copy";
import { expectCleanCopy } from "./helpers/ui";

describe("copy", () => {
  it("has no em or en dashes anywhere", () => {
    expectCleanCopy(COPY);
  });

  it("is short and plain: sentences end with a full stop, labels do not", () => {
    for (const s of Object.values(COPY.page)) expect(s).toMatch(/^[A-Z].*\.$/);
    for (const s of Object.values(COPY.notice)) expect(s).toMatch(/^[A-Z].*\.$/);
    for (const s of Object.values(COPY.settings)) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(12);
    }
    for (const s of Object.values(COPY.captions)) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(16);
    }
    // The box in play: short labels; the story line and "one piece short" are sentences.
    for (const s of [COPY.game.boxNo, COPY.game.daily, COPY.game.next, COPY.game.hint, COPY.game.showMe]) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(12);
    }
    for (const s of [COPY.game.storyOwner, COPY.game.storyLoot, COPY.game.short]) expect(s).toMatch(/^[A-Z].*\.$/);
    expect(fill(COPY.game.boxNo, { n: 12 })).toBe("Box No. 12");
    expect(fill(COPY.game.storyOwner, { owner: "the Clockmaker" })).toBe("Off the desk of the Clockmaker.");
    expect(fill("{a} {b}", { a: 1 })).toBe("1 {b}");
    // The film's end card: a tagline sentence, short fact chips.
    expect(COPY.film.tagline).toMatch(/^[A-Z].*\.$/);
    for (const s of COPY.film.facts) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(16);
    }
  });

  it("menus: key lines are short labels, messages are sentences", () => {
    const m = COPY.menus;
    // Second lines on keys fit a key: short, no full stop.
    for (const [k, s] of Object.entries(m.home)) {
      if (k === "reset") expect(s).toMatch(/^[A-Z].*\.$/);
      else {
        expect(s, k).not.toMatch(/\.$/);
        expect(s.length, k).toBeLessThanOrEqual(18);
      }
    }
    for (const s of Object.values(m.lessons)) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(16);
    }
    expect(m.collection.page).toBe("{from} to {to} of {n}");
    for (const k of ["over", "bought", "failed"] as const) expect(m.trial[k]).toMatch(/^[A-Z].*\.$/);
    expect(m.trial.daysLeft).toBe("Your trial: {n} days left");
    expect(m.trial.unlock).toBe("Unlock the full game");
  });

  it("the landing page: one button, a tagline sentence", () => {
    expect(COPY.landing.open).toBe("Open the box");
    expect(COPY.landing.tagline).toMatch(/^[A-Z].*\.$/);
  });
});
