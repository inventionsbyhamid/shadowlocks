import { describe, expect, it } from "vitest";
import { COPY } from "../../src/ui/copy";
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
    // The film's end card: a tagline sentence, short fact chips.
    expect(COPY.film.tagline).toMatch(/^[A-Z].*\.$/);
    for (const s of COPY.film.facts) {
      expect(s).not.toMatch(/\.$/);
      expect(s.length).toBeLessThanOrEqual(16);
    }
  });
});
