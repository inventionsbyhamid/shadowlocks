// The menu layout check's rules that read the text itself, not only its box: a line breaks only at a space (a word
// too long for its box is otherwise cut anywhere by UIKit, "24" over "cm"); two texts keep a gap between their letters,
// side by side ("Tamanho24 cm") or one above the other; letters keep clear of their key's frame; and on a Japanese
// panel a plain space (drawn with no width there) is only ever one PanelView put in.
import { Matrix4, Object3D } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { brokenWord, crowded, emBox, insideBy, panelRect, strayPlainSpace } from "../../src/ui/panel-fits";

describe("panel layout check", () => {
  it("reads an element's rectangle in the panel's units (UIKit's matrix is in pixelSize units, its size in pixels)", () => {
    const at = (x: number, y: number) => ({ peek: () => new Matrix4().makeTranslation(x, y, 0) });
    const c = Object.assign(new Object3D(), {
      size: { peek: () => [40, 10] as [number, number] },
      globalMatrix: at(0.1, 0.05),
      properties: { value: { pixelSize: 0.001 } },
    });
    expect(panelRect(c)!.map((v) => Math.round(v * 1000) / 1000)).toEqual([80, 120, 45, 55]);
    // A part of its width: the left quarter.
    expect(panelRect(c, -0.5, -0.25)!.map((v) => Math.round(v * 1000) / 1000)).toEqual([80, 90, 45, 55]);
  });

  it("finds a line break inside a word, and allows one at a space", () => {
    // "24 cm" with its no-break space, cut before or after it.
    expect(brokenWord("24 cm", 2)).toBe("24 cm");
    expect(brokenWord("24 cm", 3)).toBe("24 cm");
    expect(brokenWord("Tamanho", 4)).toBe("Tamanho");
    // At a space: the space ends the line before, or starts this one.
    expect(brokenWord("Moins d'animations", 6)).toBeNull();
    expect(brokenWord("Moins d'animations", 5)).toBeNull();
    // Japanese panel text: a plain space at every place a line may break.
    expect(brokenWord("中 身： 金 庫", 2)).toBeNull();
    // A cut word is named whole, between the spaces around it.
    expect(brokenWord("Sem quicar", 7)).toBe("quicar");
  });

  it("finds two texts side by side closer than the least gap, and leaves spaced ones alone", () => {
    // [left, right, bottom, top] in mm.
    const label = { id: "box-label", r: [0, 36.5, 20, 24] as const };
    const value = { id: "box-value", r: [36.6, 64.5, 19.5, 24.5] as const };
    expect(crowded([label, value], 2)).toEqual([{ a: "box-label", b: "box-value", how: "beside", apart: expect.closeTo(0.1, 5) }]);
    // Overlapping letters are crowded too.
    expect(crowded([label, { id: "x", r: [30, 50, 20, 24] as const }], 2)).toEqual([{ a: "box-label", b: "x", how: "beside", apart: -6.5 }]);
    // A gap of 3 mm is enough.
    expect(crowded([label, { id: "v", r: [39.5, 60, 20, 24] as const }], 2)).toEqual([]);
  });

  it("finds two texts one above the other closer than the least gap, and leaves spaced or apart ones alone", () => {
    const label = { id: "label", r: [0, 36.5, 20, 24] as const };
    // 1 mm under it, overlapping across: crowded.
    expect(crowded([label, { id: "sub", r: [0, 40, 14, 19] as const }], 2)).toEqual([{ a: "label", b: "sub", how: "above", apart: 1 }]);
    // 3 mm under it: fine.
    expect(crowded([label, { id: "sub", r: [0, 40, 12, 17] as const }], 2)).toEqual([]);
    // Under it but off to the side (no overlap across): not stacked.
    expect(crowded([label, { id: "far", r: [50, 70, 14, 19] as const }], 2)).toEqual([]);
  });

  it("measures letters by their em box: the line box less half the leading above and below", () => {
    // 10 mm lettering on UIKit's default 120% lines: 1 mm of leading off the top and the bottom.
    expect(emBox([0, 50, 0, 24], 10, "120%")).toEqual([0, 50, 1, 23]);
    // An absolute line height (mm).
    expect(emBox([0, 50, 0, 14], 10, 14)).toEqual([0, 50, 2, 12]);
    // Lines tighter than the lettering trim nothing.
    expect(emBox([0, 50, 0, 9], 10, "90%")).toEqual([0, 50, 0, 9]);
  });

  it("says how far inside a frame a rectangle sits (negative: outside)", () => {
    expect(insideBy([2, 8, 3, 7], [0, 10, 0, 10])).toBe(2);
    expect(insideBy([0.5, 9, 3, 7], [0, 10, 0, 10])).toBe(0.5);
    expect(insideBy([-1, 9, 3, 7], [0, 10, 0, 10])).toBe(-1);
  });

  it("on a Japanese panel, finds a plain space PanelView did not put in (it draws as nothing there)", () => {
    // "Shadow Locks" left as the generator wrote it: the Japanese atlas joins the words.
    expect(strayPlainSpace("Shadow Locks", true, null)).toBe(true);
    // Text PanelView wrote: its plain spaces are the places a line may break.
    expect(strayPlainSpace("中 身： 金 庫", true, "中 身： 金 庫")).toBe(false);
    // Written, but changed since by something else.
    expect(strayPlainSpace("Shadow Locks", true, "Shadow Locks")).toBe(true);
    // No plain space, or not Japanese: nothing to say.
    expect(strayPlainSpace("Shadow Locks", true, null)).toBe(false);
    expect(strayPlainSpace("Shadow Locks", false, null)).toBe(false);
  });
});
