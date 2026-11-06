// The store art's layout (tests/video/lib/store-art.ts): Meta's sizes, the title rules for branded
// art, and the camera maths the backdrop's glow relies on.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ART, artHtml, eyeBehind, PLATES, project, SCREENSHOT_COUNT, SCREENSHOT_SIZE, textSafe, TITLE, TITLE_FONT_FILE } from "../video/lib/store-art";

describe("store art", () => {
  it("makes every image the store asks for, at its size", () => {
    const sizes = ART.map((a) => `${a.width}x${a.height}`);
    for (const s of ["3000x900", "2560x1440", "1440x1440", "1008x1440", "1080x360", "512x512"]) expect(sizes).toContain(s);
    const logo = ART.find((a) => a.file.startsWith("logo"))!;
    expect(logo.alpha).toBe(true);
    expect(logo.width).toBeLessThanOrEqual(9000);
    expect(logo.height).toBeLessThanOrEqual(1440);
    expect(SCREENSHOT_SIZE).toEqual({ width: 2560, height: 1440 });
    expect(SCREENSHOT_COUNT).toBeGreaterThanOrEqual(5);
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

  it("cuts each piece from a plate of the same shape", () => {
    for (const a of ART.filter((x) => x.plate)) {
      const p = PLATES.find((x) => x.name === a.plate)!;
      expect(p, a.file).toBeDefined();
      expect(p.width / p.height).toBeCloseTo(a.width / a.height, 3);
      expect(p.width).toBeGreaterThanOrEqual(a.width);
    }
  });

  it("keeps the title centre of each layout inside the middle 60%", () => {
    for (const a of ART.filter((x) => x.title && !x.alpha)) {
      const t = a.title!;
      // The text's own height is about 1.12 of its size: its box must stay in the safe band too.
      const half = (t.size * 1.12) / 2;
      expect(t.y - half, a.file).toBeGreaterThanOrEqual(0.2);
      expect(t.y + half, a.file).toBeLessThanOrEqual(0.8);
    }
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
    // A point on the top edge of a 60 degree view.
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
    expect(artHtml(ART.find((a) => a.file.startsWith("icon"))!, { fontDataUrl: "x" })).not.toContain(TITLE);
  });
});
