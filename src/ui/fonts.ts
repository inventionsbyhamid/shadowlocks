// Fonts for every UIKit panel, served from our own origin as MSDF atlases built by scripts/fonts (licences:
// public/fonts/OFL-*.txt, THIRD_PARTY_NOTICES.md). The look pick's faces: Josefin Sans Bold (our copy is named
// Shadow Locks Sans) for titles and key legends, tracked 0.1em, with all of Latin-1; Limelight (Shadow Locks
// Display) for the wordmark and the big box number, printable ASCII only. Inter Medium and Bold set the small text.
// Noto Sans JP Bold, subset to the Japanese the game shows, stands in for all of them in Japanese, untracked.
// The "names" family (the Language row) is always the Japanese font: it has every language's own name.
// Setting font families on a root replaces UIKit's defaults, so Inter is listed again.
import type { Lang } from "../i18n/langs";
import { INTER_BOLD, INTER_MEDIUM } from "./inter-fonts";

const SANS = `${import.meta.env.BASE_URL}fonts/josefin-bd.json`;
const DISPLAY = `${import.meta.env.BASE_URL}fonts/limelight.json`;
const NOTO_JP = `${import.meta.env.BASE_URL}fonts/noto-jp.json`;

export const FONT_FAMILIES = {
  inter: { medium: INTER_MEDIUM, "semi-bold": INTER_BOLD, bold: INTER_BOLD },
  sans: { bold: SANS },
  display: { normal: DISPLAY },
  names: { bold: NOTO_JP },
};

const JAPANESE_FAMILIES: typeof FONT_FAMILIES = {
  inter: { medium: NOTO_JP, "semi-bold": NOTO_JP, bold: NOTO_JP },
  sans: { bold: NOTO_JP },
  display: { normal: NOTO_JP },
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

/** How far apart the interface face's letters are set (the look pick: tracked 0.1em), in ems. */
export const SANS_TRACKING_EM = 0.1;

/**
 * Classes set in the interface face, each with its font size in the stylesheet (scripts/ui/ui_common.py and the
 * home panel's own classes; UIKit takes letter spacing in the panel's units, so it is worked out from the size, and
 * tests/unit/brand-fonts.test.ts checks these sizes against the stylesheet). An element takes the first of these it
 * carries: the Continue key's legend is larger than the other keys'. UIKitML only accepts its bundled family names in
 * a stylesheet, so the families are applied in code (at load, and again when the language changes).
 */
export const SANS_CLASSES = [
  ["home-cta-label", 15],
  ["title", 18],
  ["label-cta", 13],
  ["label-sm", 11],
  ["label", 16],
] as const;

/** Classes set in the display face: the wordmark and the Continue key's box number (its atlas is printable ASCII). */
export const DISPLAY_CLASSES = ["wordmark", "home-cta-no"] as const;

interface Classed {
  classList?: { contains(c: string): boolean };
  setProperties?(p: Record<string, unknown>): void;
  traverse(fn: (o: unknown) => void): void;
}

/**
 * Give the brand faces to every element of `root` with one of their classes: the display face, or the interface face
 * tracked SANS_TRACKING_EM (untracked in Japanese, whose font stands in for both). Returns how many.
 */
export function applyBrandFonts(root: Classed, l: Lang): number {
  const track = l === "ja" ? 0 : SANS_TRACKING_EM;
  let n = 0;
  root.traverse((o) => {
    const el = o as Classed;
    const cl = el.classList;
    if (!cl || !el.setProperties) return;
    if (DISPLAY_CLASSES.some((c) => cl.contains(c))) {
      el.setProperties({ fontFamily: "display" });
      n++;
      return;
    }
    const hit = SANS_CLASSES.find(([c]) => cl.contains(c));
    if (hit) {
      el.setProperties({ fontFamily: "sans", letterSpacing: track * hit[1] });
      n++;
    }
  });
  return n;
}

/** Classes drawn in the "names" family: the Language key's value and the language Automatic picked. */
export const NAMES_CLASSES = ["lang-value", "lang-name"] as const;

/** Give the "names" family (every language's letters) to every element of `root` with a names class. */
export function applyNames(root: Classed): number {
  return applyFamily(root, NAMES_CLASSES, "names");
}

function applyFamily(root: Classed, classes: readonly string[], family: string): number {
  let n = 0;
  root.traverse((o) => {
    const el = o as Classed;
    if (!el.classList || !el.setProperties) return;
    for (const c of classes) {
      if (el.classList.contains(c)) {
        el.setProperties({ fontFamily: family });
        n++;
        return;
      }
    }
  });
  return n;
}
