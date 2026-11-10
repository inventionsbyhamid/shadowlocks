// Lines raised in English and shown in the language up: the coach line (a lesson's line, a tip, the session's
// suggestion) through localLine, and the notices through localNotice. Each works by finding the English words among
// the copy, so every line any of them can raise must be a line of the copy (never words written in place), and each
// must come out as the same line of every table.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CoachLine } from "../../src/app/events";
import { NOT_SAVED_NOTICE } from "../../src/app/profile-store";
import { TIP_LINES } from "../../src/app/tips";
import { LANGS, localLine, localNotice, tableFor } from "../../src/i18n";
import { UPDATED_NOTICE } from "../../src/platform/offline";
import { coachLines } from "../../src/ui/box-text";
import { COPY } from "../../src/ui/copy";

const OTHERS = LANGS.filter((l) => l !== "en");

/**
 * Every key of COPY.lessons the lessons' director and scripts take a line from, read from their source: a line is
 * its copy key there (`show("goal", ...)`, `key: "watchMove"`, an example's `open:` and `turn:`), typed LessonLine.
 */
function lessonKeys(): Set<string> {
  const keys = new Set<string>();
  for (const f of ["src/app/lessons-director.ts", "src/app/lesson-scripts.ts"]) {
    const src = readFileSync(f, "utf8");
    // `C` is COPY.lessons wherever it is defined in these files.
    for (const m of src.matchAll(/const C = ([\w.]+)/g)) expect(m[1], f).toBe("COPY.lessons");
    // No line is written in place.
    expect(src, f).not.toMatch(/\bline\s*[:=]\s*["'`]/);
    for (const m of src.matchAll(/\b(?:COPY\.lessons|C)\.([A-Za-z]+)\b/g)) keys.add(m[1] as string);
    for (const m of src.matchAll(/\b(?:show\(|key: |open: |turn: )"([A-Za-z]+)"/g)) keys.add(m[1] as string);
  }
  return keys;
}

describe("coach lines in every language", () => {
  it("every line the coach chip shows comes out as the same line of every table", () => {
    const en = coachLines(COPY);
    // The lessons' 26 lines and 3 tips, the session's suggestion, a phone's ten and a controller's two.
    expect(en).toHaveLength(42);
    for (const l of OTHERS) {
      const there = coachLines(tableFor(l));
      en.forEach((s, i) => expect(localLine(s, l), `${l}: ${s}`).toBe(there[i]));
    }
  });

  it("the lessons take every line from COPY.lessons, and each is shown in every language", () => {
    const keys = lessonKeys();
    expect(keys.size).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      const en = (COPY.lessons as Record<string, unknown>)[k];
      expect(typeof en, k).toBe("string");
      for (const l of OTHERS) expect(localLine(en as string, l), `${l} ${k}`).toBe((tableFor(l).lessons as Record<string, unknown>)[k]);
    }
  });

  it("every tip line is a line of COPY.lessons, shown in every language", () => {
    for (const [id, en] of Object.entries(TIP_LINES)) {
      const where = id === "drawer" ? (c: typeof COPY) => c.lessons.drawer : (c: typeof COPY) => (c.lessons.tips as Record<string, string>)[id];
      expect(en, id).toBe(where(COPY));
      for (const l of OTHERS) expect(localLine(en, l), `${l} ${id}`).toBe(where(tableFor(l) as typeof COPY));
    }
  });

  it("a phone's and a controller's wording of a line are shown in every language", () => {
    for (const [k, en] of [...Object.entries(COPY.phone).map(([k, s]) => [`phone.${k}`, s]), ...Object.entries(COPY.controller).map(([k, s]) => [`controller.${k}`, s])]) {
      const [part, key] = k!.split(".") as ["phone" | "controller", string];
      for (const l of OTHERS) expect(localLine(en!, l), `${l} ${k}`).toBe((tableFor(l)[part] as Record<string, string>)[key]);
    }
  });

  it("every suggestion the session can make is a line of COPY.game, shown in every language", () => {
    // Every key of the session's suggestions (the compiler fails here when one is added and not listed).
    const all: Record<CoachLine, true> = { controllerFinger: true };
    for (const k of Object.keys(all) as CoachLine[]) {
      for (const l of OTHERS) expect(localLine(COPY.game[k], l), `${l} ${k}`).toBe(tableFor(l).game[k]);
    }
  });
});

describe("notices in every language", () => {
  it("every notice the game raises is a line of the copy, shown in every language", () => {
    const raised: [string, (c: typeof COPY) => string][] = [
      [NOT_SAVED_NOTICE, (c) => c.notice.notSaved],
      [UPDATED_NOTICE, (c) => c.notice.updated],
      [COPY.menus.home.reset, (c) => c.menus.home.reset],
    ];
    for (const [en, where] of raised) {
      expect(en).toBe(where(COPY));
      for (const l of OTHERS) expect(localNotice(en, l), `${l}: ${en}`).toBe(where(tableFor(l) as typeof COPY));
    }
  });

  it("the bus carries no notice written in place: each is one of those lines", () => {
    for (const f of ["src/app/profile-store.ts", "src/platform/offline.ts", "src/ui/menus/index.ts", "src/app/main.ts"]) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/type: "notice", text: ([^ }]+)/g)) expect(["NOT_SAVED_NOTICE", "UPDATED_NOTICE"], f).toContain(m[1]);
      for (const m of src.matchAll(/this\.note = ([^;]+);/g)) expect(["null", "pending", "COPY.menus.home.reset"], f).toContain(m[1]);
    }
  });
});
