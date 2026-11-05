// Fonts for every UIKit panel: Inter (UIKit's own, for small text) and Archivo Expanded ExtraBold
// for titles and key legends (wide, sturdy lettering; the look pick may swap it). Archivo is OFL
// (public/fonts/OFL.txt) and served from our own origin as an MSDF atlas (scripts/fonts).
// Setting font families on a root replaces UIKit's defaults, so Inter is listed again.

const inter = (w: "medium" | "semi-bold" | "bold") => () => import("@pmndrs/msdfonts/inter").then((m) => m.inter[w]);

export const FONT_FAMILIES = {
  inter: { medium: inter("medium"), "semi-bold": inter("semi-bold"), bold: inter("bold") },
  archivo: { "extra-bold": `${import.meta.env.BASE_URL}fonts/archivo-xb.json` },
};

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
