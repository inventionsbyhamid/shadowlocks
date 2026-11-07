// Japanese on the menu panels: UIKit breaks a line only at a plain space, so in Japanese the panels put one (which
// the Japanese atlas draws with no width) wherever a line may break by the kinsoku rules.
import { readFileSync } from "node:fs";
import type { UIKitMLAsset } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { tableFor } from "../../src/i18n";
import type { MenuSpec } from "../../src/ui/menus/types";
import { japaneseBreaks, PanelView } from "../../src/ui/panel-ui";

describe("Japanese panel text", () => {
  it("can break between characters, never before a closing mark or small kana, never inside a Latin word", () => {
    expect(japaneseBreaks("中身：金庫室のスケジュール。")).toBe("中 身： 金 庫 室 の ス ケ ジュー ル。");
    // A space the reader sees (a number and its unit from Intl) keeps its width and never breaks.
    expect(japaneseBreaks("24 cm")).toBe("24 cm");
    const store = japaneseBreaks(tableFor("ja").panels.trial.store);
    expect(store.startsWith("Meta Horizon Store ")).toBe(true);
    for (const s of ["夜勤の受付係の机から。", "「箱を開ける」", "ハロラン医師"]) {
      const t = japaneseBreaks(s);
      expect(t.replace(/ /g, "")).toBe(s);
      expect(t).not.toMatch(/ [。、」ーュっ]/);
      expect(t).not.toMatch(/「 /);
    }
  });

  it("writes a text again in its Japanese form when the panel turns Japanese, even when the words are the same", () => {
    // "24 cm" reads the same in Spanish and Japanese, but only the Japanese form keeps the number with its unit.
    const written: string[] = [];
    const el = { setProperties: (p: Record<string, unknown>) => typeof p.text === "string" && written.push(p.text) };
    const root = { setProperties() {}, traverse: (f: (o: unknown) => void) => f(root) };
    const asset = { document: { rootElement: root }, getElementById: () => el, assetId: "test" } as unknown as UIKitMLAsset;
    const view = new PanelView(asset, {} as MenuSpec);
    view.setLanguage("es");
    view.text("box-value", "24 cm");
    view.setLanguage("ja");
    view.text("box-value", "24 cm");
    // What it put on the element, for the layout check (a plain space it did not put there draws as nothing).
    expect(view.wrote("box-value")).toBe("24 cm");
    expect(view.wrote("never-written")).toBeNull();
    view.setLanguage("en");
    view.text("box-value", "24 cm");
    // Between two languages written alike, nothing is written again.
    view.setLanguage("fr");
    view.text("box-value", "24 cm");
    expect(written).toEqual(["24 cm", "24 cm", "24 cm"]);
  });

  it("the Japanese atlas draws a plain space with no width and a no-break space with the space's width", () => {
    const f = JSON.parse(readFileSync("public/fonts/noto-jp.json", "utf8")) as { chars: { char: string; xadvance: number }[] };
    const space = f.chars.find((c) => c.char === " "), nbsp = f.chars.find((c) => c.char === " ");
    expect(space?.xadvance).toBe(0);
    expect(nbsp?.xadvance).toBeGreaterThan(0);
  });
});
