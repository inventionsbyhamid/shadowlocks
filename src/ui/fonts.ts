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

/**
 * The canvas lettering's fonts (plate, keys, coach line, story card), as CSS families: Noto Serif Bold and Italic for
 * the Latin languages, Noto Sans JP Bold for Japanese. Each face claims a weight range, so the browser never fakes
 * a bolder or lighter cut of it.
 */
export const SERIF_CANVAS_FAMILY = "Shadow Locks Serif";
export const JA_CANVAS_FAMILY = "Shadow Locks JP";
const FACES = {
  serif: [
    [SERIF_CANVAS_FAMILY, "noto-serif-bd.woff2", { weight: "500 900" }],
    [SERIF_CANVAS_FAMILY, "noto-serif-it.woff2", { weight: "100 900", style: "italic" }],
  ],
  ja: [[JA_CANVAS_FAMILY, "noto-jp.woff2", { weight: "100 900" }]],
} as const;
const loading: Partial<Record<keyof typeof FACES, Promise<boolean>>> = {};

function loadFaces(which: keyof typeof FACES): Promise<boolean> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (typeof FontFace === "undefined" || !fonts) return Promise.resolve(false);
  let p = loading[which];
  if (!p) {
    p = Promise.all(
      FACES[which].map(([family, file, desc]) =>
        new FontFace(family, `url(${import.meta.env.BASE_URL}fonts/${file})`, desc).load().then((f) => fonts.add(f)),
      ),
    ).then(
      () => true,
      (err) => {
        console.error(`canvas font ${which} failed to load`, err);
        delete loading[which];
        return false;
      },
    );
    loading[which] = p;
  }
  return p;
}

/**
 * Load the canvas fonts language `l` draws with, once each (a canvas draws with what is loaded, so canvases repaint
 * after this resolves). Resolves false where there is no FontFace (unit tests) or a file failed.
 */
export function loadCanvasFonts(l: Lang): Promise<boolean> {
  // The serif always: the plate's latch numerals are Latin in every language.
  const serif = loadFaces("serif");
  return l === "ja" ? Promise.all([serif, loadFaces("ja")]).then(([a, b]) => a && b) : serif;
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
