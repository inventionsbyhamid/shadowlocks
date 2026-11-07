// The owner's look pick (plan/lookdev/shadow-locks/pick.md: Ebony and Gold) is written in three places that cannot
// share code: the box's render theme (render/theme.ts), the menus' colours (ui/theme.ts, also written into the
// generated UIKitML) and the landing page's CSS (index.html). They must not drift apart: the menus and the landing
// use the box's own lacquer, gold leaf, polished gold and bright gold, and the lessons' ghosts the pick's icy blue.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GHOST_LOOK } from "../../src/render/ghost-hand";
import { COLORS } from "../../src/render/theme";
import { UI } from "../../src/ui/theme";

/** The pick's text colours (pick.md, Colours): ivory labels and their dim second lines. */
const PICK_TEXT = "#efe6d2";
const PICK_TEXT_DIM = "#cdb27a";

const lower = (hex: string) => hex.toLowerCase();

describe("the owner's look, everywhere", () => {
  it("the menus wear the box's colours", () => {
    expect(lower(UI.slab)).toBe(COLORS.frame);
    expect(lower(UI.plate)).toBe(COLORS.panelShadow);
    expect(lower(UI.bezel)).toBe(COLORS.etch);
    expect(lower(UI.putty)).toBe(COLORS.metal);
    expect(lower(UI.signal)).toBe(COLORS.gold);
    expect(lower(UI.glow)).toBe(COLORS.gold);
    expect(lower(UI.graphiteKey)).toBe(COLORS.frameGrain);
    expect(lower(UI.ink)).toBe(COLORS.frame);
    expect(lower(UI.ghost)).toBe(COLORS.ghost);
    expect(lower(UI.text)).toBe(PICK_TEXT);
    expect(lower(UI.textDim)).toBe(PICK_TEXT_DIM);
  });

  it("the landing page's CSS wears them too", () => {
    const html = readFileSync(join(__dirname, "../../index.html"), "utf8");
    const root = /:root\s*\{([^}]*)\}/.exec(html)?.[1] ?? "";
    const css = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(root)?.[1]?.toLowerCase();
    expect(css("lacquer")).toBe(COLORS.frame);
    expect(css("gold")).toBe(COLORS.metal);
    expect(css("gold-hot")).toBe(COLORS.gold);
    expect(css("gold-deep")).toBe(COLORS.goldDeep);
    expect(css("leaf")).toBe(COLORS.etch);
    expect(css("ivory")).toBe(PICK_TEXT);
    expect(css("dim")).toBe(PICK_TEXT_DIM);
  });

  it("the lessons' ghost hand and ghost lantern are the pick's icy blue", () => {
    expect(GHOST_LOOK.color).toBe(COLORS.ghost);
    expect(COLORS.ghost).toBe("#7fdcff");
  });
});
