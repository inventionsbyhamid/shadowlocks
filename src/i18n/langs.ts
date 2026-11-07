// The game's languages and how one is chosen. Pure: no tables, no Three, so the profile loader and the tests
// can use it. The player's choice is a setting ("auto" follows the headset); the language shown is a Lang.

/** Every language the game speaks, English first (the source). */
export const LANGS = ["en", "es", "fr", "de", "pt-BR", "ja"] as const;
export type Lang = (typeof LANGS)[number];

/** What the Language row can be set to: "auto" (the headset's language when it is one of ours) or a language. */
export type LanguageSetting = "auto" | Lang;
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ["auto", ...LANGS];

/**
 * Each language in its own name, as the Language row shows it. Drawn in the Japanese font, where a plain space is
 * only a place to break a line: the one space here is a no-break space.
 */
export const LANG_NAMES: Readonly<Record<Lang, string>> = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  ja: "日本語",
};

/** The BCP 47 tag `Intl` and `<html lang>` take for each language. */
export const LANG_TAGS: Readonly<Record<Lang, string>> = { en: "en", es: "es", fr: "fr", de: "de", "pt-BR": "pt-BR", ja: "ja" };

const BY_PRIMARY: Readonly<Record<string, Lang>> = { en: "en", es: "es", fr: "fr", de: "de", pt: "pt-BR", ja: "ja" };

/**
 * The language for the headset's preferred list (`navigator.languages`): the first entry whose primary tag is one
 * of ours (every `es-*` is Spanish, every `fr-*` French, `pt` and every `pt-*` Brazilian Portuguese), else English.
 */
export function detectLang(prefs: readonly string[] | null | undefined): Lang {
  if (!prefs) return "en";
  for (const tag of prefs) {
    if (typeof tag !== "string") continue;
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
    const lang = Object.hasOwn(BY_PRIMARY, primary) ? BY_PRIMARY[primary] : undefined;
    if (lang) return lang;
  }
  return "en";
}

/** The language a setting shows: its own, or for "auto" the headset's. */
export function resolveLang(setting: LanguageSetting, prefs: readonly string[] | null | undefined): Lang {
  return setting === "auto" ? detectLang(prefs) : setting;
}

/** A stored language setting, checked: one of ours (any letter case), else "auto". */
export function languageSettingFrom(v: unknown): LanguageSetting {
  if (typeof v !== "string") return "auto";
  const low = v.toLowerCase();
  for (const s of LANGUAGE_SETTINGS) if (s.toLowerCase() === low) return s;
  return "auto";
}
