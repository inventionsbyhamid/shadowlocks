// Text on the menus: at least 4.5:1, and at least 3:1 for what is dimmed on purpose (keys at the
// end of their range). Pairs mirror scripts/ui/ui_common.py and the menus' painters.
import { describe, expect, it } from "vitest";
import { contrast, UI } from "../../src/ui/theme";

const TEXT: [string, string, string][] = [
  ["legend ink on brass keys", UI.ink, UI.putty],
  ["legend ink on the call to action", UI.ink, UI.signal],
  ["soft ink subs on brass keys", UI.inkSoft, UI.putty],
  ["light legends on walnut keys", UI.text, UI.graphiteKey],
  ["dim subs on walnut keys", UI.textOnGraphiteDim, UI.graphiteKey],
  ["panel text on the slab", UI.text, UI.slab],
  ["meta on the slab", UI.textDim, UI.slab],
  ["labels on a plate", UI.textDim, UI.plate],
  ["readout values on a plate", UI.glow, UI.plate],
];
const DIMMED: [string, string, string][] = [["stepper marks at a range end, on the off cap", UI.stepperOff, UI.capOffLit]];

describe("menu contrast", () => {
  it.each(TEXT)("%s is at least 4.5:1", (_name, fg, bg) => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
  it.each(DIMMED)("%s is at least 3:1", (_name, fg, bg) => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3));
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#16181C", "#D8D3C6")).toBeCloseTo(11.89, 1);
  });
});
