// The box's own lettering in every language: the canvas font each language draws with, how a label is fitted (full
// size, smaller down to a floor, never below it), the captions, and the plate, keys and story card repainted in the
// language now shown. Without a renderer: canvases are absent, so this checks what each view would paint.
import { afterEach, describe, expect, it } from "vitest";
import { Group } from "@iwsdk/core";
import { followLanguage } from "../../src/app/language";
import { generateBox } from "../../src/core/generator";
import { BOX_SIZE_CM, defaultSettings } from "../../src/core/profile";
import { type LanguageSetting, lang, setLang, tableFor } from "../../src/i18n";
import { breakUnits, fitLabel, labelFont, wrapLabel } from "../../src/render/label";
import { Reward } from "../../src/render/reward";
import { captionFor } from "../../src/ui/captions";
import { HintLantern } from "../../src/ui/hint-lantern";
import { PLATE, Plate } from "../../src/ui/plate";

afterEach(() => setLang("en"));

/** A 2D context stand-in: each character half its font size wide. */
function fakeCtx() {
  const g = {
    font: "",
    measureText: (s: string) => ({ width: [...s].length * Number(/(\d+(?:\.\d+)?)px/.exec(g.font)?.[1] ?? 0) * 0.5 }),
  };
  return g as unknown as CanvasRenderingContext2D;
}

describe("canvas lettering per language", () => {
  it("draws Latin languages in the shipped serif and Japanese in the shipped Japanese font, never in italic", () => {
    expect(labelFont("bold", 40, "en")).toBe("bold 40px 'Shadow Locks Serif', Georgia, serif");
    expect(labelFont("italic", 30, "de")).toBe("italic 30px 'Shadow Locks Serif', Georgia, serif");
    expect(labelFont("bold", 40, "ja")).toBe("bold 40px 'Shadow Locks JP', sans-serif");
    // Japanese has no italic: the story card stands upright.
    expect(labelFont("italic", 30, "ja")).toBe("normal 30px 'Shadow Locks JP', sans-serif");
  });

  it("fits a label at full size where it can, smaller in steps down to the floor, never below it", () => {
    const g = fakeCtx();
    // 4 characters at 40 px: 80 px, in 100: full size.
    expect(fitLabel(g, "abcd", "bold", 40, 20, 100)).toMatchObject({ size: 40, squeezed: false });
    // 6 characters: 40 px would be 120; 32 px is 96.
    expect(fitLabel(g, "abcdef", "bold", 40, 20, 100)).toMatchObject({ size: 32, squeezed: false });
    // 20 characters: even the floor (20 px, 200) is too wide: it stays at the floor and is squeezed into the room.
    const f = fitLabel(g, "a".repeat(20), "bold", 40, 20, 100);
    expect(f.size).toBe(20);
    expect(f.squeezed).toBe(true);
    // A floor that is not a whole step away is never crossed.
    expect(fitLabel(g, "a".repeat(20), "bold", 40, 21, 100).size).toBeGreaterThanOrEqual(21);
  });

  it("breaks lines between words, never at a French no-break space, and between Japanese characters by the rules", () => {
    expect(breakUnits("Off the desk of the Clockmaker.")).toEqual(["Off ", "the ", "desk ", "of ", "the ", "Clockmaker."]);
    expect(breakUnits("Contenu : le registre")).toEqual(["Contenu : ", "le ", "registre"]);
    // A closing mark stays with the character before it; Latin words inside Japanese stay whole.
    expect(breakUnits("中身：港の台帳。")).toEqual(["中", "身：", "港", "の", "台", "帳。"]);
    expect(breakUnits("「箱を開ける」")).toEqual(["「箱", "を", "開", "け", "る」"]);
    expect(breakUnits("Meta Quest のブラウザ")).toEqual(["Meta ", "Quest ", "の", "ブ", "ラ", "ウ", "ザ"]);
    const g = fakeCtx();
    g.font = "bold 20px x";
    // 10 px a character, 100 px a line: ten characters, never a line starting with a closing mark or small kana.
    const lines = wrapLabel(g, "ピースがひとつ足りない。指で影を作れるよ。", 100, 4);
    expect(lines.join("")).toBe("ピースがひとつ足りない。指で影を作れるよ。");
    for (const l of lines) expect(l).not.toMatch(/^[、。ーっゃゅょ」]/);
    expect(wrapLabel(g, "Off the desk of the Clockmaker.", 100, 4)).toEqual(["Off the", "desk of", "the", "Clockmaker."]);
    // At most the lines asked for: the last takes the rest.
    expect(wrapLabel(g, "Off the desk of the Clockmaker.", 100, 2)).toEqual(["Off the", "desk of the Clockmaker."]);
  });

  it("captions a sound in the language now shown", () => {
    expect(captionFor("brass_clunk")).toBe("Lock opens");
    setLang("fr");
    expect(captionFor("brass_clunk")).toBe("Serrure ouverte");
    setLang("ja");
    expect(captionFor("ring_chime")).toBe("リングがそろった");
    expect(captionFor("lantern_pick")).toBeNull();
  });
});

describe("the language at runtime", () => {
  it("applies the saved language at boot and on every change, and tells the page", () => {
    let s = { ...defaultSettings(), language: "de" as LanguageSetting };
    const subs: ((x: typeof s) => void)[] = [];
    const doc = { documentElement: { lang: "en" } } as unknown as Pick<Document, "documentElement">;
    const stop = followLanguage({ get: () => s, subscribe: (fn) => (subs.push(fn), () => subs.splice(subs.indexOf(fn), 1)) }, doc);
    expect(lang()).toBe("de");
    expect(doc.documentElement.lang).toBe("de");
    s = { ...s, language: "pt-BR" };
    for (const fn of subs) fn(s);
    expect(lang()).toBe("pt-BR");
    expect(doc.documentElement.lang).toBe("pt-BR");
    stop();
    expect(subs).toHaveLength(0);
  });
});

describe("the box's labels follow the language", () => {
  const box = generateBox({ kind: "box", n: 3 });

  it("the plate names the box and offers the next one in the language now shown", () => {
    const p = new Plate(new Group());
    p.setBox(box, { kind: "box", n: 3 });
    expect(p.title).toBe("Box No. 3");
    expect(p.next.labelText).toBe("Next box");
    setLang("de");
    p.relabel();
    expect(p.title).toBe("Box Nr. 3");
    expect(p.next.labelText).toBe("Nächste");
    p.setBox(box, { kind: "daily", day: "2026-11-06" });
    expect(p.title).toBe("Tagesbox");
    // A practice box's cue follows the language too.
    p.setBox(box, { kind: "box", n: 4 }, true);
    expect(p.cueText).toBe("Übung");
    setLang("ja");
    p.relabel();
    expect([p.title, p.cueText]).toEqual(["第4の箱", "練習"]);
  });

  it("the hint lantern's choices", () => {
    const h = new HintLantern(new Group());
    setLang("es");
    h.relabel();
    expect([h.hint.labelText, h.showMe.labelText]).toEqual(["Pista", "Mostrar"]);
  });

  it("the plate, widened for the longest names, is still narrower than the smallest box", () => {
    expect(PLATE.w).toBeLessThan(BOX_SIZE_CM.min / 100);
  });

  it("the story card tells a saved reward's English words in the language now shown", () => {
    const r = new Reward(new Group());
    r.setBox(box);
    const en = r.story;
    expect(en[0]).toBe(`Off the desk of ${box.owner}.`);
    setLang("ja");
    r.relabel();
    expect(r.story[0]).toMatch(/の机から。$/);
    expect(r.story[1]).toMatch(/^中身：/);
    expect(r.story[0]).not.toContain(box.owner);
  });
});
