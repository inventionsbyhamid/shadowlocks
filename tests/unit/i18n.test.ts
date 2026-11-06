import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Copy,
  copy,
  count,
  detectLang,
  formatCm,
  formatDay,
  formatNumber,
  formatPercent,
  LANG_NAMES,
  LANGS,
  type Lang,
  lang,
  languageSettingFrom,
  NBSP,
  onLangChange,
  plural,
  resolveLang,
  setLang,
  storyLoot,
  storyOwner,
  tableFor,
} from "../../src/i18n";
import { COPY } from "../../src/ui/copy";
import { expectCleanCopy } from "./helpers/ui";

/** Every leaf of a table as [path, text]. */
function leaves(v: unknown, path = ""): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [];
}

const EN = new Map(leaves(COPY));
const OTHERS = LANGS.filter((l) => l !== "en");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => setLang("en"));

describe("detecting the headset's language", () => {
  const cases: [readonly string[] | undefined | null, Lang][] = [
    [undefined, "en"],
    [null, "en"],
    [[], "en"],
    [[""], "en"],
    [["*"], "en"],
    [["en-US"], "en"],
    [["en-GB", "ja"], "en"],
    [["es"], "es"],
    [["es-ES"], "es"],
    [["es-MX"], "es"],
    [["es-419"], "es"],
    [["es_AR"], "es"],
    [["fr-FR"], "fr"],
    [["fr-CA"], "fr"],
    [["fr-BE", "en"], "fr"],
    [["de"], "de"],
    [["de-AT"], "de"],
    [["DE-ch"], "de"],
    [["pt"], "pt-BR"],
    [["pt-BR"], "pt-BR"],
    [["pt-PT"], "pt-BR"],
    [["ja"], "ja"],
    [["ja-JP"], "ja"],
    [["it-IT", "fr-FR", "de-DE"], "fr"],
    [["zh-CN", "ko-KR"], "en"],
    [["nl-NL", "pt-BR"], "pt-BR"],
  ];
  it.each(cases)("%j is %s", (prefs, want) => {
    expect(detectLang(prefs)).toBe(want);
  });

  it("follows the setting, or the headset for auto", () => {
    expect(resolveLang("auto", ["fr-FR"])).toBe("fr");
    expect(resolveLang("auto", ["sv-SE"])).toBe("en");
    expect(resolveLang("de", ["fr-FR"])).toBe("de");
    expect(resolveLang("ja", undefined)).toBe("ja");
  });

  it("reads a stored setting, any letter case, else auto", () => {
    expect(languageSettingFrom("pt-br")).toBe("pt-BR");
    expect(languageSettingFrom("JA")).toBe("ja");
    expect(languageSettingFrom("auto")).toBe("auto");
    expect(languageSettingFrom("it")).toBe("auto");
    expect(languageSettingFrom(3)).toBe("auto");
    expect(languageSettingFrom(undefined)).toBe("auto");
  });

  it("names each language in its own words", () => {
    expect(LANG_NAMES).toEqual({ en: "English", es: "Español", fr: "Français", de: "Deutsch", "pt-BR": "Português (Brasil)", ja: "日本語" });
  });
});

describe("the tables", () => {
  it.each(OTHERS)("%s has every English key, nothing more, and no empty text", (l) => {
    const t = new Map(leaves(tableFor(l)));
    expect([...t.keys()].sort()).toEqual([...EN.keys()].sort());
    for (const [k, s] of t) expect(s.trim(), `${l} ${k}`).not.toBe("");
  });

  it.each(OTHERS)("%s keeps every placeholder of each English line", (l) => {
    for (const [k, s] of leaves(tableFor(l))) expect(placeholders(s), `${l} ${k}: ${s}`).toEqual(placeholders(EN.get(k) ?? ""));
  });

  it.each(LANGS)("%s has no em or en dashes", (l) => {
    expectCleanCopy(tableFor(l));
  });

  it.each(OTHERS)("%s ends a line the way English does (a sentence with its full stop or question mark, a label bare)", (l) => {
    const stop = l === "ja" ? /。$/ : /\.$/;
    const ask = l === "ja" ? /？$/ : /\?$/;
    for (const [k, s] of leaves(tableFor(l))) {
      const en = EN.get(k) ?? "";
      const why = `${l} ${k}: ${s}`;
      if (en.endsWith(".")) expect(s, why).toMatch(stop);
      else if (en.endsWith("?")) expect(s, why).toMatch(ask);
      else expect(s, why).not.toMatch(/[.。？]$/);
    }
  });

  it("Japanese uses Japanese punctuation (no ASCII . , : ? ! in Japanese text)", () => {
    for (const [k, s] of leaves(tableFor("ja"))) expect(s, `ja ${k}`).not.toMatch(/[.,:?!]/);
  });

  it("French puts a no-break space before : ? ! ; and inside « », and never a plain one", () => {
    for (const [k, s] of leaves(tableFor("fr"))) {
      const why = `fr ${k}: ${s}`;
      expect(s, why).not.toMatch(/ [:?!;»]/);
      expect(s, why).not.toMatch(/« /);
      expect(s, why).not.toMatch(/[^ ][:?!;»]/);
      expect(s, why).not.toMatch(/«[^ ]/);
    }
  });

  it("Spanish opens every question and exclamation", () => {
    for (const [k, s] of leaves(tableFor("es"))) {
      expect(s.split("?").length, `es ${k}`).toBe(s.split("¿").length);
      expect(s.split("!").length, `es ${k}`).toBe(s.split("¡").length);
    }
  });

  it.each(OTHERS)("%s names the landing page's button, in its own words, where the page asks to tap it", (l) => {
    // The tables are written for the landing page's "Open the box" button; English still says "Enter" until
    // the landing page replaces that button, and then says the button's name too.
    const t = tableFor(l);
    expect(t.page.enterFailed).toContain(t.landing.open);
  });

  it.each(OTHERS)("%s says the same thing the same way: lines English writes alike are translated alike", (l) => {
    // Where English uses one word for two things, a language may need two.
    const apart = new Set(["settings.off|settings.muted"]);
    const byEn = new Map<string, string[]>();
    for (const [k, s] of EN) byEn.set(s, [...(byEn.get(s) ?? []), k]);
    const t = new Map(leaves(tableFor(l)));
    for (const keys of byEn.values()) {
      for (let i = 1; i < keys.length; i++) {
        const a = keys[0] as string, b = keys[i] as string;
        if (apart.has(`${a}|${b}`) || apart.has(`${b}|${a}`)) continue;
        expect(t.get(b), `${l}: ${a} and ${b}`).toBe(t.get(a));
      }
    }
  });

  it.each(OTHERS)("%s has a distinct owner and loot line for every English one", (l) => {
    const s = tableFor(l).story;
    expect(s.owners).toHaveLength(COPY.story.owners.length);
    expect(s.loot).toHaveLength(COPY.story.loot.length);
    expect(new Set(s.owners).size).toBe(s.owners.length);
    expect(new Set(s.loot).size).toBe(s.loot.length);
  });
});

describe("the active language", () => {
  it("starts in English and swaps the whole table", () => {
    expect(lang()).toBe("en");
    expect(copy()).toBe(COPY);
    setLang("de");
    expect(lang()).toBe("de");
    expect(copy().game.daily).toBe("Tagesbox");
    // The same table every time: reading it allocates nothing.
    expect(copy()).toBe(copy());
  });

  it("tells listeners once per change and stops when asked", () => {
    const fn = vi.fn();
    const off = onLangChange(fn);
    setLang("fr");
    setLang("fr");
    setLang("ja");
    expect(fn.mock.calls).toEqual([["fr"], ["ja"]]);
    off();
    setLang("es");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps telling the others when one listener throws", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = onLangChange(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    const off = onLangChange(good);
    setLang("pt-BR");
    expect(good).toHaveBeenCalledWith("pt-BR");
    bad();
    off();
    err.mockRestore();
  });

  it("translates a saved reward's English words by place, and leaves words it does not know", () => {
    setLang("de");
    expect(storyOwner("the Clockmaker")).toBe("des Uhrmachers");
    expect(storyLoot("the stationmaster's whistle")).toBe("die Pfeife des Bahnhofsvorstehers");
    expect(storyOwner("Someone New")).toBe("Someone New");
    setLang("ja");
    expect(storyOwner("Madame Rook")).toBe("マダム・ルーク");
    setLang("en");
    expect(storyLoot("a silver thimble")).toBe("a silver thimble");
  });
});

describe("counts, numbers and dates", () => {
  const rewards = COPY.menus.collection.rewards;

  it("picks each language's plural form", () => {
    const pick = (l: Lang, n: number) => {
      setLang(l);
      return plural(n, { one: "one", other: "other" });
    };
    expect([0, 1, 2, 5].map((n) => pick("en", n))).toEqual(["other", "one", "other", "other"]);
    expect([0, 1, 2, 5].map((n) => pick("es", n))).toEqual(["other", "one", "other", "other"]);
    expect([0, 1, 2, 5].map((n) => pick("de", n))).toEqual(["other", "one", "other", "other"]);
    // French and Brazilian Portuguese count 0 with 1.
    expect([0, 1, 2, 5].map((n) => pick("fr", n))).toEqual(["one", "one", "other", "other"]);
    expect([0, 1, 2, 5].map((n) => pick("pt-BR", n))).toEqual(["one", "one", "other", "other"]);
    // Japanese has one form.
    expect([0, 1, 2, 5].map((n) => pick("ja", n))).toEqual(["other", "other", "other", "other"]);
    // A million takes the "many" form in Spanish, French and Portuguese: "other" stands in for it.
    for (const l of ["es", "fr", "pt-BR"] as const) expect(pick(l, 1_000_000)).toBe("other");
  });

  it("fills a count in with the language's digits", () => {
    expect(count(1, rewards)).toBe("1 reward");
    expect(count(1200, rewards)).toBe("1,200 rewards");
    setLang("es");
    expect(count(2, copy().menus.trial.daysLeft)).toBe("Tu prueba: quedan 2 días");
    expect(count(1, copy().menus.trial.daysLeft)).toBe("Tu prueba: queda 1 día");
    setLang("fr");
    expect(count(0, copy().menus.collection.rewards)).toBe("0 récompense");
    expect(count(1200, copy().menus.collection.rewards)).toBe(`1${NBSP}200 récompenses`);
    setLang("de");
    expect(count(1200, copy().menus.home.rewards)).toBe("1.200 Fundstücke");
    setLang("pt-BR");
    expect(count(1, copy().menus.trial.daysLeft)).toBe("Seu teste: falta 1 dia");
    setLang("ja");
    expect(count(3, copy().menus.home.rewards)).toBe("お宝 3個");
  });

  it("writes numbers, percents and centimetres the language's way, with only spaces the fonts have", () => {
    const narrow = / /;
    const all = (l: Lang) => [formatNumber(12345, l), formatPercent(0.7, l), formatCm(24, l)];
    expect(all("en")).toEqual(["12,345", "70%", "24 cm"]);
    expect(all("de")).toEqual(["12.345", `70${NBSP}%`, "24 cm"]);
    expect(all("fr")).toEqual([`12${NBSP}345`, `70${NBSP}%`, `24${NBSP}cm`]);
    for (const l of LANGS) for (const s of all(l)) expect(s, `${l} ${s}`).not.toMatch(narrow);
  });

  it("names a day the language's way", () => {
    expect(formatDay("2026-11-02", "en")).toBe("Nov 2");
    expect(formatDay("2026-11-02", "de")).toBe("2. Nov.");
    expect(formatDay("2026-11-02", "ja")).toBe("11月2日");
    expect(formatDay("2026-11-02", "fr")).toBe("2 nov.");
    for (const l of LANGS) expect(formatDay("2026-03-15", l)).toMatch(/15/);
    // Not a day key: as given.
    expect(formatDay("someday", "en")).toBe("someday");
  });

  it("every table reads as a Copy (compile check on the table types)", () => {
    const t: Copy = tableFor("es");
    expect(t).toBe(tableFor("es"));
  });
});
