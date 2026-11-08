// The landing page in the language shown: it starts in the headset's language (the page's lang, every word, the
// meta description, the status), and its status line is kept as which line it is, so a new language paints it again
// and "is the failure still up?" holds in any language.
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ENTER_FAILED, Landing, LOADING, noticeLine, startLanguage } from "../../src/app/landing";
import { NOT_SAVED_NOTICE } from "../../src/app/profile-store";
import { LANGS, setLang, tableFor } from "../../src/i18n";
import { COPY } from "../../src/ui/copy";

afterEach(() => setLang("en"));

/** The parts of the page the landing paints, as the static index.html leaves them. */
function fakeDoc() {
  const el = (text: string) => ({ textContent: text });
  const els: Record<string, { textContent: string }> = {
    enter: el("Open the box"),
    tagline: el(COPY.landing.tagline),
    facts: el(COPY.landing.facts),
    status: el("Loading"),
  };
  const meta = { content: COPY.landing.description as string, setAttribute(k: string, v: string) { if (k === "content") this.content = v; } };
  return {
    documentElement: { lang: "en" },
    getElementById: (id: string) => els[id] ?? null,
    querySelector: (s: string) => (s === 'meta[name="description"]' ? meta : null),
    els,
    meta,
  };
}

describe("the landing page", () => {
  it("starts in the headset's language: the page's lang, every word, the meta description and the status", () => {
    const d = fakeDoc();
    expect(startLanguage(d, ["ja-JP", "en"])).toBe("ja");
    expect(d.documentElement.lang).toBe("ja");
    const page = new Landing(d);
    const ja = tableFor("ja").landing;
    expect([d.els.enter!.textContent, d.els.tagline!.textContent, d.els.facts!.textContent]).toEqual([ja.open, ja.tagline, ja.facts]);
    expect(d.meta.content).toBe(ja.description);
    expect(d.els.status!.textContent).toBe(ja.loading);
    expect(page.line).toBe(LOADING);
  });

  it("paints its status line again in a new language, and clears it by which line it is, in any language", () => {
    const d = fakeDoc();
    const page = new Landing(d);
    page.say(ENTER_FAILED);
    expect(d.els.status!.textContent).toBe(COPY.page.enterFailed);
    setLang("de");
    expect(d.els.status!.textContent).toBe(tableFor("de").page.enterFailed);
    expect(d.meta.content).toBe(tableFor("de").landing.description);
    // The session starts after the language changed: the failure is still recognised, and goes.
    page.clear(ENTER_FAILED);
    expect(d.els.status!.textContent).toBe("");
    // A notice raised in English follows the language too; clearing another line leaves it.
    page.say(noticeLine(NOT_SAVED_NOTICE));
    setLang("fr");
    expect(d.els.status!.textContent).toBe(tableFor("fr").notice.notSaved);
    page.clear(ENTER_FAILED);
    expect(d.els.status!.textContent).toBe(tableFor("fr").notice.notSaved);
  });

  it("shows a brief line only over nothing, and takes it away after its time unless another line came", () => {
    const d = fakeDoc();
    const page = new Landing(d);
    page.say(null);
    const later: (() => void)[] = [];
    page.sayBriefly(noticeLine(COPY.notice.updated), 6000, (fn) => later.push(fn));
    expect(d.els.status!.textContent).toBe(COPY.notice.updated);
    setLang("es");
    expect(d.els.status!.textContent).toBe(tableFor("es").notice.updated);
    later[0]!();
    expect(d.els.status!.textContent).toBe("");
    // Over another line: not shown.
    page.say(ENTER_FAILED);
    page.sayBriefly(noticeLine(COPY.notice.updated), 6000, (fn) => later.push(fn));
    expect(d.els.status!.textContent).toBe(tableFor("es").page.enterFailed);
  });

  it("names Touch controllers beside hands, in every language (the store app declares both; the store's Website opens this page)", () => {
    const controller: Record<string, RegExp> = { en: /controllers/, es: /controladores/, fr: /manettes/, de: /Controllern/, "pt-BR": /controles/, ja: /コントローラー/ };
    for (const l of LANGS) {
      const { facts, description } = tableFor(l).landing;
      for (const line of [facts, description]) {
        expect(line, `${l}: ${line}`).toMatch(controller[l]!);
        expect(line, `${l}: ${line}`).not.toMatch(/hands only|solo con las manos|juste avec les mains|nur mit den händen|só com as mãos|手だけ/i);
      }
    }
    // The static page says the same as the English table until the script paints it.
    expect(fs.readFileSync("index.html", "utf8")).toContain(`<p id="facts" class="facts">${COPY.landing.facts}</p>`);
  });
});
