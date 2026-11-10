// The active language: one accessor (`copy()`) gives its table, `setLang` swaps it and tells whoever paints text
// that is already on screen (`onLangChange`), so panels and canvas labels repaint once, on the change. Counts,
// numbers and dates go through `Intl` in the active language, with each formatter made once per language.
// Reading the table allocates nothing; formatting does, so it happens when a screen is painted, never per frame.
import { COPY, fill } from "../ui/copy";
import { DE } from "./de";
import { ES } from "./es";
import { FR } from "./fr";
import { JA } from "./ja";
import { LANG_TAGS, type Lang, type LanguageSetting, resolveLang } from "./langs";
import { PT_BR } from "./pt-br";
import { type Copy, NBSP, type PluralForms } from "./types";

export * from "./langs";
export { type Copy, NBSP, type PluralForms } from "./types";

const TABLES: Readonly<Record<Lang, Copy>> = { en: COPY, es: ES, fr: FR, de: DE, "pt-BR": PT_BR, ja: JA };

let current: Lang = "en";
let table: Copy = COPY;
const listeners = new Set<(l: Lang) => void>();

/** A language's table. */
export function tableFor(l: Lang): Copy {
  return TABLES[l];
}

/** The active language's table: every player-facing string. */
export function copy(): Copy {
  return table;
}

/** The active language. */
export function lang(): Lang {
  return current;
}

/** Make `l` the active language; listeners hear of it only when it changes. */
export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  table = TABLES[l];
  tell();
}

/** Ask everything showing text to paint it again in the language shown (a font it draws with has arrived). */
export function repaintText(): void {
  tell();
}

function tell(): void {
  const l = current;
  for (const fn of [...listeners]) {
    try {
      fn(l);
    } catch (err) {
      console.error("language listener failed", err);
    }
  }
}

/** The headset's preferred languages, where there is a browser. */
function headset(): readonly string[] | undefined {
  return (globalThis as { navigator?: { languages?: readonly string[] } }).navigator?.languages;
}

/** Apply the Language setting: its language, or for "auto" the headset's. Returns the language now shown. */
export function applyLanguage(setting: LanguageSetting, prefs: readonly string[] | undefined = headset()): Lang {
  setLang(resolveLang(setting, prefs));
  return current;
}

/**
 * Told after every change of language, and when a font text is drawn with arrives (repaint the text you show).
 * Returns a function that stops it.
 */
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Intl, one formatter of each kind per language, made when first used.
const rules = new Map<Lang, Intl.PluralRules>();
const numbers = new Map<Lang, Intl.NumberFormat>();
const percents = new Map<Lang, Intl.NumberFormat>();
const cms = new Map<Lang, Intl.NumberFormat>();
const days = new Map<Lang, Intl.DateTimeFormat>();

function made<T>(cache: Map<Lang, T>, l: Lang, make: (tag: string) => T): T {
  let f = cache.get(l);
  if (!f) {
    f = make(LANG_TAGS[l]);
    cache.set(l, f);
  }
  return f;
}

/** Intl's narrow no-break space (French, and some units) is not in every font: the plain no-break space is. */
const narrow = (s: string) => s.replace(/ /g, NBSP);

/** The plural form for `n` (not filled in): "one" where the language says so, else "other". */
export function plural(n: number, forms: PluralForms, l: Lang = current): string {
  return made(rules, l, (t) => new Intl.PluralRules(t)).select(n) === "one" ? forms.one : forms.other;
}

/** A count in its plural form with {n} filled in, in the language's digits: "3 rewards", "1.200 Fundstücke". */
export function count(n: number, forms: PluralForms, l: Lang = current): string {
  return fill(plural(n, forms, l), { n: formatNumber(n, l) });
}

export function formatNumber(n: number, l: Lang = current): string {
  return narrow(made(numbers, l, (t) => new Intl.NumberFormat(t)).format(n));
}

/** A share 0..1 as a whole percent: "70%", "70 %". */
export function formatPercent(v: number, l: Lang = current): string {
  return narrow(made(percents, l, (t) => new Intl.NumberFormat(t, { style: "percent", maximumFractionDigits: 0 })).format(v));
}

/** A length in whole centimetres: "24 cm". */
export function formatCm(cm: number, l: Lang = current): string {
  return narrow(
    made(cms, l, (t) => new Intl.NumberFormat(t, { style: "unit", unit: "centimeter", unitDisplay: "short", maximumFractionDigits: 0 })).format(cm),
  );
}

/** A day key (YYYY-MM-DD, a local calendar day) as a short date: "Nov 2", "2. Nov.", "11月2日". Else as given. */
export function formatDay(dayKey: string, l: Lang = current): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  // Noon UTC on that day, shown in UTC: the same calendar day in every time zone.
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return narrow(made(days, l, (t) => new Intl.DateTimeFormat(t, { month: "short", day: "numeric", timeZone: "UTC" })).format(at));
}

/** The notices the game raises in English (they travel the bus and wait for a screen as words). */
const NOTICES: readonly ((c: Copy) => string)[] = [(c) => c.notice.notSaved, (c) => c.notice.updated, (c) => c.menus.home.reset];

/** A notice raised in English, in the language shown when it is put on screen (any other text as given). */
export function localNotice(text: string, l: Lang = current): string {
  for (const words of NOTICES) if (words(COPY) === text) return words(TABLES[l]);
  return text;
}

/** Each language's coach lines by their English words, made when first asked for. */
const lines = new Map<Lang, Map<string, string>>();

/** Pair every string under `en` (by key, so a table's own order does not matter) with its words in `to`. */
function pairLines(en: unknown, to: unknown, out: Map<string, string>): void {
  if (typeof en === "string") {
    if (typeof to === "string" && !out.has(en)) out.set(en, to);
  } else if (en && typeof en === "object" && to && typeof to === "object") {
    for (const k of Object.keys(en)) pairLines((en as Record<string, unknown>)[k], (to as Record<string, unknown>)[k], out);
  }
}

/**
 * A coach line in the language shown: a lesson's line, a tip or the session's suggestion, which the lessons and the
 * session give in English (COPY.lessons, COPY.game, and a phone's or a controller's wording of them, COPY.phone and
 * COPY.controller). A line the tables lack stays as given; null stays null. Read every frame: a map lookup, nothing
 * allocated once the language's map is made.
 */
export function localLine(en: string | null, l: Lang = current): string | null {
  if (en === null || l === "en") return en;
  let m = lines.get(l);
  if (!m) {
    m = new Map();
    pairLines(COPY.lessons, TABLES[l].lessons, m);
    pairLines(COPY.game, TABLES[l].game, m);
    pairLines(COPY.phone, TABLES[l].phone, m);
    pairLines(COPY.controller, TABLES[l].controller, m);
    lines.set(l, m);
  }
  return m.get(en) ?? en;
}

/** A saved reward's owner (stored in English) in the active language; words the game no longer has stay as given. */
export function storyOwner(en: string, c: Copy = table): string {
  const i = COPY.story.owners.indexOf(en as (typeof COPY.story.owners)[number]);
  return i < 0 ? en : (c.story.owners[i] ?? en);
}

/** A saved reward's loot (stored in English) in the active language. */
export function storyLoot(en: string, c: Copy = table): string {
  const i = COPY.story.loot.indexOf(en as (typeof COPY.story.loot)[number]);
  return i < 0 ? en : (c.story.loot[i] ?? en);
}
