// The menu layout check's two rules that read the text itself, not only its box: a line breaks only at a space (a
// word too long for its box is otherwise cut anywhere by UIKit, "24" over "cm"), and two texts side by side keep a
// gap between their letters ("Tamanho24 cm").
import { Matrix4, Object3D } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { brokenWord, crowded, panelRect } from "../../src/ui/panel-fits";

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

  it("finds two texts side by side closer than the least gap, and leaves stacked or spaced ones alone", () => {
    // [left, right, bottom, top] in mm.
    const label = { id: "box-label", r: [0, 36.5, 20, 24] as const };
    const value = { id: "box-value", r: [36.6, 64.5, 19.5, 24.5] as const };
    expect(crowded([label, value], 2)).toEqual([["box-label", "box-value"]]);
    // Overlapping letters are crowded too.
    expect(crowded([label, { id: "x", r: [30, 50, 20, 24] as const }], 2)).toEqual([["box-label", "x"]]);
    // A gap of 3 mm is enough.
    expect(crowded([label, { id: "v", r: [39.5, 60, 20, 24] as const }], 2)).toEqual([]);
    // One above the other: not side by side.
    expect(crowded([label, { id: "sub", r: [0, 40, 14, 19] as const }], 2)).toEqual([]);
  });
});
