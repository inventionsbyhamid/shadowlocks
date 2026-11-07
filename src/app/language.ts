// The game's language at runtime: the Language setting applied at boot and whenever it changes ("auto" follows the
// headset's preferred languages), the page told which language it is in, and the canvas fonts that language draws
// with loaded; once they arrive, everything showing text paints it again (canvases draw with what is loaded).
import { applyLanguage, LANG_TAGS, type Lang, repaintText } from "../i18n";
import type { Settings } from "../core/profile";
import { loadCanvasFonts } from "../ui/fonts";

/** What the language needs of the settings. */
export interface LanguageSettings {
  get(): Readonly<Settings>;
  subscribe(fn: (s: Readonly<Settings>) => void): () => void;
}

/** Apply the saved language now and on every change; returns a function that stops following the setting. */
export function followLanguage(settings: LanguageSettings, doc: Pick<Document, "documentElement"> | null = typeof document !== "undefined" ? document : null): () => void {
  let shown: Lang | null = null;
  const apply = (s: Readonly<Settings>) => {
    const l = applyLanguage(s.language);
    if (l === shown) return;
    shown = l;
    if (doc) doc.documentElement.lang = LANG_TAGS[l];
    loadCanvasFonts(l).then(
      (ok) => {
        if (ok && shown === l) repaintText();
      },
      () => {},
    );
  };
  apply(settings.get());
  return settings.subscribe(apply);
}
