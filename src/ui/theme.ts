// Menu colours: Ebony and Gold, the owner's look pick (plan/lookdev/shadow-locks/pick.md): black
// lacquer panels with a gold-leaf bezel, gold foil primary keys with black legends, black glass keys
// with a double gold hairline, and a bright gold glow on hover. Token names stay as other modules
// read them: `graphiteKey` is the plain (black glass) key, `putty` the lit or main (gold foil) key,
// `capOff` a key at the end of its range, `glow` the hover glow and the ray cursor. The same values
// are written in scripts/ui/ui_common.py (generated UIKitML); code uses these for states it switches.

export const UI = {
  /** The panel body: black lacquer (the slab mesh and the root). */
  slab: "#1C191D",
  /** A recessed plate on a panel (readouts, cards). */
  plate: "#121016",
  /** Gold leaf: the bezel and the hairlines. */
  bezel: "#B08732",
  text: "#EFE6D2",
  textDim: "#CDB27A",
  textFaint: "#9A8A6A",
  /** Dim text on a plain key (subs, toggle notes). */
  textOnGraphiteDim: "#CDB27A",
  /** Legends on gold keys. */
  ink: "#1C191D",
  inkSoft: "#5A4520",
  /** Lit or main keys: gold foil. */
  putty: "#E2BD62",
  /** The call to action: bright gold. */
  signal: "#FFD36A",
  /** A key that cannot be undone (Reset): oxblood. */
  danger: "#7A2E28",
  /** Plain keys: black glass. */
  graphiteKey: "#2A2529",
  /** A key at the end of its range, or locked: a darker cap with dimmer marks. */
  capOff: "#1A171B",
  capOffLit: "#221E22",
  stepperOff: "#7D6E52",
  /** Hover glow and the ray cursor: bright gold. */
  glow: "#FFD36A",
  ledOn: "#FFD36A",
  ledOff: "#3A3236",
  /** The lessons' mark: the ghost hand's icy blue. */
  ghost: "#7FDCFF",
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
