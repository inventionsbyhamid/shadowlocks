// The Language row in Settings: "Automatic" (follow the headset) or a language, stepped with the row's two keys
// and round again. Automatic shows, under it, the language it picked. A language is named in its own words
// whatever language the menu is in, so the row's value is drawn in the font that has every script (the Japanese
// one, which carries the Latin letters too). Pure view model.
import { type Copy, LANG_NAMES, LANGUAGE_SETTINGS, type Lang, type LanguageSetting } from "../../i18n";

/** The next setting along (`dir` 1) or the one before (-1), wrapping round. */
export function stepLanguage(s: LanguageSetting, dir: 1 | -1): LanguageSetting {
  const n = LANGUAGE_SETTINGS.length;
  const i = Math.max(0, LANGUAGE_SETTINGS.indexOf(s));
  return LANGUAGE_SETTINGS[(i + dir + n) % n] as LanguageSetting;
}

export interface LanguageRowView {
  label: string;
  /** "Automatic" in the menu's language, or the chosen language in its own. */
  value: string;
  /** Under Automatic: the language it shows. Empty otherwise. */
  sub: string;
}

/** The row for setting `s`, showing language `shown`, with the menu in table `c`. */
export function languageRow(s: LanguageSetting, shown: Lang, c: Copy): LanguageRowView {
  return {
    label: c.settings.language,
    value: s === "auto" ? c.settings.languageAuto : LANG_NAMES[s],
    sub: s === "auto" ? LANG_NAMES[shown] : "",
  };
}
