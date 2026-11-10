// The sharing words (COPY.share) in every language: plain, no dashes, each keeping the {names} its English line fills
// in, short enough for the result card's lines.
import { describe, expect, it } from "vitest";
import { LANGS, tableFor } from "../../src/i18n";
import { COPY } from "../../src/ui/copy";
import { expectCleanCopy } from "./helpers/ui";

/** Every string under `v` with its key path. */
function leaves(v: unknown, at = ""): [string, string][] {
  if (typeof v === "string") return [[at, v]];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, at ? `${at}.${k}` : k));
  return [];
}

const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the sharing words", () => {
  it("have no dashes in any language", () => {
    for (const l of LANGS) expectCleanCopy(tableFor(l).share);
  });

  it("keep every {name} the English line fills in, in every language", () => {
    const en = new Map(leaves(COPY.share));
    for (const l of LANGS) {
      for (const [k, s] of leaves(tableFor(l).share)) expect(names(s), `${l} share.${k}: ${s}`).toEqual(names(en.get(k)!));
    }
  });

  it("the result card's lines are short labels, no full stop", () => {
    for (const l of LANGS) {
      const t = tableFor(l).share;
      for (const s of [t.best, t.newBest]) {
        expect(s, `${l}: ${s}`).not.toMatch(/[.。]$/);
        expect(s.replace("{time}", "12:34").length, `${l}: ${s}`).toBeLessThanOrEqual(28);
      }
    }
  });
});
