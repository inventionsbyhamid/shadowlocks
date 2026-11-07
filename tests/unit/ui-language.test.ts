import { afterEach, describe, expect, it } from "vitest";
import { copy, LANGUAGE_SETTINGS, type LanguageSetting, setLang, tableFor } from "../../src/i18n";
import { languageRow, stepLanguage } from "../../src/ui/menus/language";

afterEach(() => setLang("en"));

describe("the Language row", () => {
  it("steps through Automatic and every language, and round again", () => {
    const seen: LanguageSetting[] = [];
    let s: LanguageSetting = "auto";
    for (let i = 0; i < LANGUAGE_SETTINGS.length; i++) {
      seen.push(s);
      s = stepLanguage(s, 1);
    }
    expect(seen).toEqual(["auto", "en", "es", "fr", "de", "pt-BR", "ja"]);
    expect(s).toBe("auto");
    expect(stepLanguage("auto", -1)).toBe("ja");
    expect(stepLanguage("es", -1)).toBe("en");
  });

  it("shows Automatic in the language on screen, with the language it picked under it", () => {
    expect(languageRow("auto", "fr", copy())).toEqual({ label: "Language", value: "Automatic", sub: "Français" });
    setLang("de");
    expect(languageRow("auto", "de", copy())).toEqual({ label: "Sprache", value: "Automatisch", sub: "Deutsch" });
  });

  it("names a chosen language in its own words, whatever language the menu is in", () => {
    setLang("ja");
    expect(languageRow("es", "es", tableFor("ja"))).toEqual({ label: "言語", value: "Español", sub: "" });
    expect(languageRow("ja", "ja", tableFor("en"))).toEqual({ label: "Language", value: "日本語", sub: "" });
  });
});
