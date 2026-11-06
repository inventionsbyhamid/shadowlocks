// The store art's layout (tests/video/lib/store-art.ts): Meta's sizes, the title rules for branded art, the title's
// clear space from the box, the key scene and the icon, and the camera maths behind them.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import {
  ART,
  artHtml,
  boxBoundsFor,
  clearOf,
  eyeBehind,
  ICON_LAYOUT,
  KEY_SCENE,
  keyLantern,
  keySilhouette,
  PLATES,
  project,
  SCREENSHOT_COUNT,
  SCREENSHOT_SIZE,
  textSafe,
  TITLE,
  TITLE_FONT_FILE,
  titleBound,
  toPixels,
} from "../video/lib/store-art";

const fmt = (r: { left: number; top: number; right: number; bottom: number } | null) =>
  r ? `[${r.left.toFixed(3)}, ${r.top.toFixed(3)}, ${r.right.toFixed(3)}, ${r.bottom.toFixed(3)}]` : "null";

describe("store art", () => {
  it("makes every image the store asks for, at its size", () => {
    const sizes = ART.map((a) => `${a.width}x${a.height}`);
    for (const s of ["3000x900", "2560x1440", "1440x1440", "1008x1440", "1080x360", "512x512"]) expect(sizes).toContain(s);
    const logo = ART.find((a) => a.file.startsWith("logo"))!;
    expect(logo.alpha).toBe(true);
    expect(logo.width).toBeLessThanOrEqual(9000);
    expect(logo.height).toBeLessThanOrEqual(1440);
    expect(SCREENSHOT_SIZE).toEqual({ width: 2560, height: 1440 });
    expect(SCREENSHOT_COUNT).toBe(5);
    expect(new Set(ART.map((a) => a.file)).size).toBe(ART.length);
  });

  it("puts the title on every branded image and none on the icon", () => {
    for (const a of ART) {
      if (a.file.startsWith("icon")) expect(a.title, a.file).toBeUndefined();
      else expect(a.title, a.file).toBeDefined();
    }
    expect(TITLE).toBe("Shadow Locks");
  });

  it("only has 24-bit art apart from the transparent logo", () => {
    expect(ART.filter((a) => a.alpha).map((a) => a.file)).toEqual(["logo-3000x800.png"]);
  });

  it("cuts each cover from a plate of the same shape, at least as large", () => {
    for (const a of ART.filter((x) => x.plate && !x.icon)) {
      const p = PLATES.find((x) => x.name === a.plate)!;
      expect(p, a.file).toBeDefined();
      expect(p.width / p.height).toBeCloseTo(a.width / a.height, 3);
      expect(p.width).toBeGreaterThanOrEqual(a.width);
    }
  });

  it("keeps every title's box inside the middle 60% and off the sides", () => {
    for (const a of ART.filter((x) => x.title && !x.alpha)) {
      const r = toPixels(titleBound(a.title!), a.width, a.height);
      expect(textSafe(r, a.width, a.height), a.file).toBeNull();
    }
  });

  it("shows the whole box and its lantern on every cover, and keeps the title clear of them", () => {
    const lantern = keyLantern();
    expect(lantern).toBeDefined();
    for (const a of ART.filter((x) => x.plate && x.title)) {
      const p = PLATES.find((x) => x.name === a.plate)!;
      const box = boxBoundsFor(p.view!, lantern, p.width, p.height);
      expect(box, `${a.file}: box behind the eye`).not.toBeNull();
      const where = `${a.file}: box ${fmt(box)}, title ${fmt(titleBound(a.title!))}`;
      expect(box!.left, where).toBeGreaterThanOrEqual(0.02);
      expect(box!.right, where).toBeLessThanOrEqual(0.98);
      expect(box!.top, where).toBeGreaterThanOrEqual(0.02);
      expect(box!.bottom, where).toBeLessThanOrEqual(0.98);
      const margin = 0.03 * Math.min(a.width, a.height);
      expect(clearOf(toPixels(titleBound(a.title!), a.width, a.height), toPixels(box!, a.width, a.height), margin), where).toBeNull();
    }
  });

  it("finds a title that runs into the box", () => {
    const title = { left: 100, top: 300, right: 900, bottom: 600 };
    expect(clearOf(title, { left: 950, top: 100, right: 1400, bottom: 800 }, 20)).toBeNull();
    expect(clearOf(title, { left: 910, top: 100, right: 1400, bottom: 800 }, 20)).toMatch(/runs into the box/);
    expect(clearOf(title, { left: 800, top: 500, right: 1400, bottom: 800 }, 0)).toMatch(/runs into the box/);
  });

  it("stages the covers on one clean lock: box 1, few decoys, the lock filling gold under its lantern", () => {
    const box = generateBox({ kind: "box", n: KEY_SCENE.box });
    expect(box.locks).toHaveLength(1);
    expect(box.elements.filter((e) => e.kind === "decoy").length).toBeLessThanOrEqual(3);
    expect(KEY_SCENE.lock).toBe(0);
    expect(KEY_SCENE.open).toEqual([0]);
    expect(box.locks[0]!.finger).toBe(false);
  });

  it("makes the icon from the lantern and the key lock's own shape, filling most of the square", () => {
    const shape = keySilhouette();
    expect(shape.length).toBeGreaterThan(0);
    for (const poly of shape) for (const [x, y] of poly) for (const v of [x, y]) expect(v).toBeGreaterThanOrEqual(-1e-9), expect(v).toBeLessThanOrEqual(1 + 1e-9);
    expect(ICON_LAYOUT.shape.size).toBeGreaterThanOrEqual(0.6);
    for (const part of [ICON_LAYOUT.shape, ICON_LAYOUT.lantern]) {
      expect(part.x + part.size).toBeLessThanOrEqual(1.0001);
      expect(part.y + part.size).toBeLessThanOrEqual(1.0001);
    }
    const icon = ART.find((a) => a.icon)!;
    expect(PLATES.find((p) => p.name === icon.plate)!.lanternView).toBeDefined();
    const html = artHtml(icon, { plate: "data:image/png;base64,AA", fontDataUrl: "x", silhouette: shape });
    expect(html).toContain("<polygon");
    expect(html).not.toContain(TITLE);
  });

  it("refuses text in the top or bottom 20% or against a side", () => {
    expect(textSafe({ left: 200, top: 300, right: 900, bottom: 600 }, 3000, 900)).toBeNull();
    expect(textSafe({ left: 200, top: 150, right: 900, bottom: 600 }, 3000, 900)).toMatch(/top 20%/);
    expect(textSafe({ left: 200, top: 300, right: 900, bottom: 760 }, 3000, 900)).toMatch(/bottom 20%/);
    expect(textSafe({ left: 20, top: 300, right: 900, bottom: 600 }, 3000, 900)).toMatch(/side/);
  });

  it("projects like a camera: centre straight ahead, right is right, up is up, behind is null", () => {
    const eye = [0, 0, 0] as const;
    const at = [0, 0, -1] as const;
    expect(project([0, 0, -2], eye, at, 60, 1600, 900)).toEqual([0.5, 0.5]);
    const [x, y] = project([0.5, 0.3, -2], eye, at, 60, 1600, 900)!;
    expect(x).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(0.5);
    expect(project([0, Math.tan(Math.PI / 6) * 2, -2], eye, at, 60, 1600, 900)![1]).toBeCloseTo(0, 6);
    expect(project([0, 0, 1], eye, at, 60, 1600, 900)).toBeNull();
  });

  it("keeps the eye behind the lantern", () => {
    expect(eyeBehind([0.5, 0.3, 3], 1.4)).toEqual([0.5, 0.3, 3]);
    expect(eyeBehind([0.5, 0.3, 2], 1.6)[2]).toBeCloseTo(2.5, 9);
  });

  it("sets the title in the bundled Limelight and nothing else but the title", () => {
    expect(fs.existsSync(TITLE_FONT_FILE)).toBe(true);
    expect(fs.existsSync("tests/video/assets/fonts/OFL-Limelight.txt")).toBe(true);
    const html = artHtml(ART[0]!, { plate: "data:image/png;base64,AA", fontDataUrl: "data:font/ttf;base64,AA" });
    const text = html.replace(/<style[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, "").trim();
    expect(text).toBe(TITLE);
    expect(html).toContain("font-family: Limelight");
  });
});
