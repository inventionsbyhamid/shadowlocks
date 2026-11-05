// Menu colours: a provisional walnut and brass set (warm workshop at night) until the look is
// picked (plan/lookdev; Task 18 applies the pick). Token names stay as other modules read them:
// `graphiteKey` is the plain key, `putty` the lit or main key, `capOff` a key at the end of its
// range, `glow` the lantern amber of hovers and the ray cursor. The same values are written in
// scripts/ui/ui_common.py (generated UIKitML); code uses these for states it switches.

export const UI = {
  /** The panel body (the slab placeholder, drawn flat). */
  slab: "#2B2018",
  /** A recessed plate on a panel (readouts, cards). */
  plate: "#1F1711",
  text: "#F1E6D2",
  textDim: "#C9B89E",
  textFaint: "#8E7D66",
  /** Dim text on a plain key (subs, toggle notes). */
  textOnGraphiteDim: "#D9C9AF",
  /** Legends on light keys. */
  ink: "#1E1610",
  inkSoft: "#4E3C2B",
  /** Lit or main keys: polished brass. */
  putty: "#D9B26A",
  /** The call to action: warm amber. */
  signal: "#E8913A",
  /** Plain keys: dark walnut. */
  graphiteKey: "#4A3A2C",
  /** A stepper key at the end of its range: a darker cap with dimmer marks. */
  capOff: "#3A2E24",
  capOffLit: "#4F4237",
  stepperOff: "#B3A38C",
  /** Hover glow and the ray cursor: lantern amber. */
  glow: "#FFB347",
  ledOn: "#FFB347",
  ledOff: "#3B2A1C",
} as const;

/** Relative luminance of a #RRGGBB colour (WCAG 2). */
export function luminance(hex: string): number {
  const c = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2);
}

/** WCAG contrast ratio between two #RRGGBB colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
