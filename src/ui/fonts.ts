// Fonts for every UIKit panel, served from our own origin as MSDF atlases built by scripts/fonts (licences:
// public/fonts/OFL-*.txt, THIRD_PARTY_NOTICES.md): Inter Medium and Bold for small text, Archivo Expanded
// ExtraBold for titles and key legends (wide, sturdy lettering; the look pick may swap it), both with all of
// Latin-1; and Noto Sans JP Bold, subset to the Japanese the game shows, which stands in for both in Japanese.
// The "names" family (the Language row) is always the Japanese font: it has every language's own name.
// Setting font families on a root replaces UIKit's defaults, so Inter is listed again.
import type { Lang } from "../i18n/langs";
import { INTER_BOLD, INTER_MEDIUM } from "./inter-fonts";

const ARCHIVO = `${import.meta.env.BASE_URL}fonts/archivo-xb.json`;
const NOTO_JP = `${import.meta.env.BASE_URL}fonts/noto-jp.json`;

export const FONT_FAMILIES = {
  inter: { medium: INTER_MEDIUM, "semi-bold": INTER_BOLD, bold: INTER_BOLD },
  archivo: { "extra-bold": ARCHIVO },
  names: { bold: NOTO_JP },
};

const JAPANESE_FAMILIES: typeof FONT_FAMILIES = {
  inter: { medium: NOTO_JP, "semi-bold": NOTO_JP, bold: NOTO_JP },
  archivo: { "extra-bold": NOTO_JP },
  names: { bold: NOTO_JP },
};

/** The families a panel root takes for language `l` (set again when the language changes). */
export function fontFamiliesFor(l: Lang): typeof FONT_FAMILIES {
  return l === "ja" ? JAPANESE_FAMILIES : FONT_FAMILIES;
}

/** The Japanese font for canvas lettering (plate, keys, coach line, story card), as a CSS family. */
export const JA_CANVAS_FAMILY = "Shadow Locks JP";
const JA_CANVAS_URL = `${import.meta.env.BASE_URL}fonts/noto-jp.woff2`;
let jaCanvas: Promise<boolean> | null = null;

/**
 * Load the Japanese canvas font once (a canvas draws with what is loaded, so Japanese canvases repaint after
 * this). Resolves false where there is no FontFace (unit tests) or the file failed.
 */
export function loadJapaneseCanvasFont(): Promise<boolean> {
  if (!jaCanvas) {
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (typeof FontFace === "undefined" || !fonts) return Promise.resolve(false);
    const face = new FontFace(JA_CANVAS_FAMILY, `url(${JA_CANVAS_URL})`, { weight: "100 900" });
    jaCanvas = face.load().then(
      (f) => {
        fonts.add(f);
        return true;
      },
      (err) => {
        console.error("Japanese canvas font failed to load", err);
        jaCanvas = null;
        return false;
      },
    );
  }
  return jaCanvas;
}

/**
 * Classes set in Archivo. UIKitML only accepts its bundled family names in a stylesheet, so the
 * family is applied in code to every element carrying one of these classes (once, at load).
 */
export const ARCHIVO_CLASSES = ["title", "label", "label-sm", "label-cta"] as const;

interface Classed {
  classList?: { contains(c: string): boolean };
  setProperties?(p: Record<string, unknown>): void;
  traverse(fn: (o: unknown) => void): void;
}

/** Give Archivo to every element of `root` with an Archivo class. Returns how many. */
export function applyArchivo(root: Classed): number {
  let n = 0;
  root.traverse((o) => {
    const el = o as Classed;
    if (!el.classList || !el.setProperties) return;
    for (const c of ARCHIVO_CLASSES) {
      if (el.classList.contains(c)) {
        el.setProperties({ fontFamily: "archivo" });
        n++;
        return;
      }
    }
  });
  return n;
}
