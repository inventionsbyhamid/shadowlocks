// The compiler is the first check on a table: these lines must fail to type-check (tsc runs over tests too), or
// `@ts-expect-error` itself is the error. Vitest only runs them.
import { describe, expect, it } from "vitest";
import type { Copy } from "../../src/i18n";
import { ES } from "../../src/i18n/es";

describe("a table's type", () => {
  it("rejects a missing key, an extra key and a list of the wrong length", () => {
    const missing: Copy = {
      ...ES,
      // @ts-expect-error: startupFailed is missing
      page: { enterFailed: "x", noXr: "y" },
    };
    const extra: Copy = {
      ...ES,
      page: {
        ...ES.page,
        // @ts-expect-error: not an English key
        tooMuch: "z",
      },
    };
    const short: Copy = {
      ...ES,
      // @ts-expect-error: one owner short
      story: { ...ES.story, owners: ES.story.owners.slice(1) },
    };
    expect([missing, extra, short].length).toBe(3);
  });
});
