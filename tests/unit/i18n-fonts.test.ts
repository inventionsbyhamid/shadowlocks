// Every character a language shows is in every font it is drawn with: the Latin languages in the panels' Inter
// (medium and bold) and interface face atlases, the wordmark and box numbers in the display face's, Japanese in the
// Japanese atlas (panels) and the Japanese WOFF2 (canvas lettering). The Language row draws every language's name,
// and "Automatic" in every language, with the Japanese font, so those are in it too. A missing glyph shows as a box
// on the headset; here it fails.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANGS } from "../../src/i18n";
import {
  DISPLAY_ATLAS,
  displayChars,
  JA_ATLAS,
  JA_CANVAS,
  japaneseChars,
  LATIN_ATLASES,
  latinChars,
  SERIF_CANVAS,
} from "../../src/i18n/charset";
import { FONT_FAMILIES, fontFamiliesFor } from "../../src/ui/fonts";
import { inter } from "../../src/ui/inter-fonts";
import { woff2CodePoints } from "./helpers/woff2";

const atlasChars = (url: string) => {
  const f = JSON.parse(readFileSync(`public/${url}`, "utf8")) as { chars: { char: string; id: number }[]; pages: string[] };
  return { chars: new Set(f.chars.map((c) => c.char)), ids: new Set(f.chars.map((c) => c.id)), pages: f.pages };
};
const name = (ch: string) => `${JSON.stringify(ch)} U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

describe("font glyphs", () => {
  it("the Latin text is all Latin (the Japanese font draws the rest)", () => {
    for (const ch of latinChars()) expect(ch.codePointAt(0), name(ch)).toBeLessThan(0x2100);
  });

  it.each(LATIN_ATLASES)("%s has every character English, Spanish, French, German and Portuguese show", (url) => {
    const a = atlasChars(url);
    expect(a.pages).toHaveLength(1);
    const missing = latinChars().filter((ch) => !a.chars.has(ch));
    expect(missing.map(name)).toEqual([]);
  });

  it("the display face's atlas has the wordmark in every Latin language and every digit", () => {
    const a = atlasChars(DISPLAY_ATLAS);
    expect(a.pages).toHaveLength(1);
    expect(displayChars()).toEqual(expect.arrayContaining([..."0123456789", "S", "L"]));
    const missing = displayChars().filter((ch) => !a.chars.has(ch));
    expect(missing.map(name)).toEqual([]);
  });

  it("the Japanese atlas has every character Japanese shows, and every language's name", () => {
    const a = atlasChars(JA_ATLAS);
    expect(a.pages).toHaveLength(1);
    const missing = japaneseChars().filter((ch) => !a.chars.has(ch));
    expect(missing.map(name)).toEqual([]);
  });

  it.each(SERIF_CANVAS)("%s (canvas lettering) maps every character the Latin languages show", (url) => {
    const cps = woff2CodePoints(readFileSync(`public/${url}`));
    const missing = latinChars().filter((ch) => !cps.has(ch.codePointAt(0) ?? -1));
    expect(missing.map(name)).toEqual([]);
  });

  it("the Japanese canvas font maps every character Japanese shows", () => {
    const cps = woff2CodePoints(readFileSync(`public/${JA_CANVAS}`));
    const missing = japaneseChars().filter((ch) => !cps.has(ch.codePointAt(0) ?? -1));
    expect(missing.map(name)).toEqual([]);
  });

  it("every family points at an atlas that is there; Japanese swaps every family to the Japanese atlas", () => {
    const urls = (f: Record<string, Record<string, string>>) => Object.values(f).flatMap((w) => Object.values(w));
    const files = (f: Record<string, Record<string, string>>) => urls(f).map((u) => u.replace(/^.*?fonts\//, "fonts/"));
    for (const l of LANGS) for (const f of files(fontFamiliesFor(l))) expect(existsSync(`public/${f}`), f).toBe(true);
    for (const f of Object.values(inter)) expect(existsSync(`public/${f.replace(/^.*?fonts\//, "fonts/")}`), f).toBe(true);
    expect(new Set(files(fontFamiliesFor("ja")))).toEqual(new Set([JA_ATLAS]));
    expect(fontFamiliesFor("de")).toBe(FONT_FAMILIES);
    expect(new Set(files(FONT_FAMILIES))).toEqual(new Set([...LATIN_ATLASES, DISPLAY_ATLAS, JA_ATLAS]));
    expect(FONT_FAMILIES.names.bold).toMatch(/noto-jp\.json$/);
  });

  it("a Japanese line missing from the subset is caught", () => {
    const a = atlasChars(JA_ATLAS);
    // A rare character no line uses: the check above would name it.
    expect(a.chars.has("鬱")).toBe(false);
  });
});
