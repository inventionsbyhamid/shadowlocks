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
    for (const s of [COPY.game.storyOwner, COPY.game.storyLoot, COPY.game.short, COPY.game.controllerFinger]) expect(s).toMatch(/^[A-Z].*\.$/);
    expect(COPY.game.controllerFinger).toBe("Or set a controller down and use your finger.");
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
});
