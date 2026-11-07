// The look pick's faces on the menus: Josefin Sans Bold for titles and key legends, tracked 0.1em (untracked in
// Japanese, whose font stands in), and Limelight for the wordmark and the Continue key's box number. Our copies are
// cut down, so they go by new names: both fonts reserve theirs (public/fonts/OFL-limelight.txt, OFL-josefinsans.txt).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyBrandFonts, DISPLAY_CLASSES, SANS_CLASSES, SANS_TRACKING_EM } from "../../src/ui/fonts";
import { woff2Names } from "./helpers/woff2";

interface Fake {
  classList: { contains(c: string): boolean };
  setProperties(p: Record<string, unknown>): void;
  got: Record<string, unknown>;
}
const el = (classes: string): Fake => {
  const list = classes.split(" ");
  const f: Fake = { classList: { contains: (c) => list.includes(c) }, setProperties: (p) => Object.assign(f.got, p), got: {} };
  return f;
};
const tree = (els: Fake[]) => ({ traverse: (fn: (o: unknown) => void) => els.forEach(fn) });

describe("brand faces on the menus", () => {
  it("sets the wordmark and box number in the display face, titles and legends in the tracked interface face", () => {
    const wordmark = el("title wordmark"), number = el("label home-cta-no"), cta = el("label-cta home-cta-label");
    const key = el("label-sm"), title = el("title"), small = el("sub ink-soft");
    expect(applyBrandFonts(tree([wordmark, number, cta, key, title, small]), "de")).toBe(5);
    expect(wordmark.got).toEqual({ fontFamily: "display" });
    expect(number.got).toEqual({ fontFamily: "display" });
    // 0.1em of each class's own size: the Continue legend is 15 mm, a key's 11 mm, a title 18 mm.
    expect(cta.got.fontFamily).toBe("sans");
    expect(cta.got.letterSpacing).toBeCloseTo(1.5, 6);
    expect(key.got.letterSpacing).toBeCloseTo(1.1, 6);
    expect(title.got.letterSpacing).toBeCloseTo(1.8, 6);
    expect(small.got).toEqual({});
  });

  it("sets Japanese untracked (the Japanese font stands in for the interface face)", () => {
    const key = el("label-sm");
    applyBrandFonts(tree([key]), "ja");
    expect(key.got).toEqual({ fontFamily: "sans", letterSpacing: 0 });
    applyBrandFonts(tree([key]), "fr");
    expect(key.got.letterSpacing).toBeCloseTo(11 * SANS_TRACKING_EM, 6);
  });

  it("knows each interface class's size as the stylesheet sets it", () => {
    const css = readFileSync("public/ui/home.uikitml", "utf8").split("</style>")[0] ?? "";
    for (const [cls, size] of SANS_CLASSES) {
      const rule = new RegExp(`\\.${cls} \\{[^}]*font-size: ([0-9.]+);`).exec(css);
      expect(rule, cls).not.toBeNull();
      expect(Number(rule![1]), cls).toBe(size);
    }
    // The display classes are on the home panel's wordmark and box number.
    const home = readFileSync("public/ui/home.uikitml", "utf8");
    expect(home).toContain('id="home-title" class="title wordmark"');
    for (const c of DISPLAY_CLASSES) expect(home).toMatch(new RegExp(`class="[^"]*\\b${c}\\b`));
  });

  it("our cut-down copies do not go by the reserved names, and keep the copyright", () => {
    for (const [file, reserved, ours] of [
      ["limelight.woff2", /limelight/i, "Shadow Locks Display"],
      ["josefin-bd.woff2", /josefin/i, "Shadow Locks Sans"],
    ] as const) {
      const names = woff2Names(readFileSync(`public/fonts/${file}`));
      // Family, unique ID, full name, PostScript name, typographic family.
      for (const id of [1, 3, 4, 6, 16]) for (const s of names.get(id) ?? []) expect(s, `${file} name ${id}`).not.toMatch(reserved);
      expect(names.get(1), file).toContain(ours);
      expect((names.get(0) ?? []).join(" "), `${file} copyright`).toMatch(reserved);
    }
    for (const [atlas, reserved] of [
      ["limelight.json", /limelight/i],
      ["josefin-bd.json", /josefin/i],
    ] as const) {
      const face = (JSON.parse(readFileSync(`public/fonts/${atlas}`, "utf8")) as { info: { face: string } }).info.face;
      expect(face, atlas).not.toMatch(reserved);
    }
  });
});
