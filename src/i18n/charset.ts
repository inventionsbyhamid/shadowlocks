// The characters each font must have, from the tables themselves and from what the formatters write (digits,
// separators, month names): the font build subsets to these (scripts/fonts) and the glyph tests check them
// (tests/unit/i18n-fonts.test.ts). Not imported by the game.
import { formatCm, formatDay, formatNumber, formatPercent, LANG_NAMES, LANGS, type Lang, tableFor } from "./index";

/** The panels' Latin fonts (UIKit MSDF atlases under public/): Inter Medium and Bold, and the interface face. */
export const LATIN_ATLASES = ["fonts/inter-md.json", "fonts/inter-bd.json", "fonts/josefin-bd.json"] as const;
/**
 * The panels' display face (the wordmark and the Continue key's box number), printable ASCII only: it sets only the
 * game's name and digits, the same in every Latin language (Japanese draws them with the Japanese font).
 */
export const DISPLAY_ATLAS = "fonts/limelight.json";

/** Every character the display face sets: the wordmark in each Latin language and the digits of a box number. */
export function displayChars(): string[] {
  return charsOf([...LATIN_LANGS.map((l) => tableFor(l).panels.home.title), "0123456789"]);
}
/** The Japanese font as an atlas for the panels, and as a WOFF2 for canvas lettering. */
export const JA_ATLAS = "fonts/noto-jp.json";
export const JA_CANVAS = "fonts/noto-jp.woff2";
/** The canvas lettering's Latin fonts (bold for the plate, keys and coach line; italic for the story card). */
export const SERIF_CANVAS = ["fonts/noto-serif-bd.woff2", "fonts/noto-serif-it.woff2"] as const;

const LATIN_LANGS: readonly Lang[] = LANGS.filter((l) => l !== "ja");

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** What the formatters write in `l`: every digit, separators, percents, centimetres, every month's name. */
function formatted(l: Lang): string[] {
  const out: string[] = [];
  for (let n = 0; n <= 9; n++) out.push(formatNumber(n, l));
  out.push(formatNumber(1_234_567, l), formatNumber(12_345.5, l));
  for (let v = 0; v <= 10; v++) out.push(formatPercent(v / 10, l));
  for (let cm = 18; cm <= 30; cm++) out.push(formatCm(cm, l));
  for (let m = 1; m <= 12; m++) for (const d of [1, 28]) out.push(formatDay(`2026-${pad(m)}-${pad(d)}`, l));
  return out;
}

const charsOf = (ss: readonly string[]) => [...new Set(ss.flatMap((s) => [...s]))].sort();

/** Every character English, Spanish, French, German and Portuguese show. */
export function latinChars(): string[] {
  return charsOf(LATIN_LANGS.flatMap((l) => [...strings(tableFor(l)), ...formatted(l)]));
}

/**
 * Every character Japanese shows, and what the Language row draws in the Japanese font whatever the language on
 * screen: each language's own name and each table's "Automatic".
 */
export function japaneseChars(): string[] {
  return charsOf([
    ...strings(tableFor("ja")),
    ...formatted("ja"),
    ...Object.values(LANG_NAMES),
    ...LANGS.map((l) => tableFor(l).settings.languageAuto),
  ]);
}

const ascii = () => Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));

/**
 * What the Latin atlases are built with: printable ASCII and Latin-1 (all of Western Europe's letters, in both
 * cases, so a later uppercase style still has them), the typographic quotes and marks, and anything the tables use.
 */
export function latinBuildSet(): string[] {
  const latin1 = Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i)).filter((c) => c !== "­");
  return charsOf([...ascii(), ...latin1, "ŒœŸ‘’‚“”„…•€", ...latinChars()]);
}

/** What the Japanese font is subset to: the Japanese characters and printable ASCII. */
export function japaneseBuildSet(): string[] {
  return charsOf([...ascii(), ...japaneseChars()]);
}
