// Japanese on the menu panels: UIKit breaks a line only at a plain space, so in Japanese the panels put one (which
// the Japanese atlas draws with no width) wherever a line may break by the kinsoku rules.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tableFor } from "../../src/i18n";
import { japaneseBreaks } from "../../src/ui/panel-ui";

describe("Japanese panel text", () => {
  it("can break between characters, never before a closing mark or small kana, never inside a Latin word", () => {
    expect(japaneseBreaks("中身：金庫室のスケジュール。")).toBe("中 身： 金 庫 室 の ス ケ ジュー ル。");
    const store = japaneseBreaks(tableFor("ja").panels.trial.store);
    expect(store.startsWith("Meta Horizon Store ")).toBe(true);
    for (const s of ["夜勤の受付係の机から。", "「箱を開ける」", "ハロラン医師"]) {
      const t = japaneseBreaks(s);
      expect(t.replace(/ /g, "")).toBe(s);
      expect(t).not.toMatch(/ [。、」ーュっ]/);
      expect(t).not.toMatch(/「 /);
    }
  });

  it("the Japanese atlas draws a plain space with no width and a no-break space with the space's width", () => {
    const f = JSON.parse(readFileSync("public/fonts/noto-jp.json", "utf8")) as { chars: { char: string; xadvance: number }[] };
    const space = f.chars.find((c) => c.char === " "), nbsp = f.chars.find((c) => c.char === " ");
    expect(space?.xadvance).toBe(0);
    expect(nbsp?.xadvance).toBeGreaterThan(0);
  });
});
