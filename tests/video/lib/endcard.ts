// The film's end card: the title, a tagline and short facts over a dimmed, blurred hold of the last
// frame. The card's text layer is drawn by the browser (Archivo, in the game's ebony and gold) as a
// transparent PNG at the edit's size; the edit holds the last frame, blurs it in and lays the card
// over it (mixdown.ts endCardFilter). The font is Archivo (OFL, tests/video/assets/fonts/OFL.txt),
// the variable font the game's Archivo Expanded ExtraBold atlas is cut from.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export interface EndCard {
  title: string;
  tagline: string;
  /** Short facts, one chip each (the first in the accent colour). */
  facts: string[];
  /** The hosted link, once there is one; its line is kept free until then. */
  link?: string;
  /** Seconds the card holds once it is in. */
  holdSec: number;
  /** The blur and the card fade in over this long (ms). */
  fadeMs?: number;
}

/** The game's Ebony and Gold palette (plan/lookdev/shadow-locks/pick.md). */
const LACQUER = "#1C191D";
const TEXT = "#EFE6D2";
const TEXT_DIM = "#CDB27A";
const BRASS = "#E2BD62";
const GOLD = "#FFD36A";

export const FONT_FILE = path.join("tests", "video", "assets", "fonts", "Archivo-Variable.ttf");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The card as a page: everything sized from the frame height, so drafts and finals match. */
export function endCardHtml(card: EndCard, width: number, height: number, fontDataUrl: string): string {
  const h = (k: number) => `${(k * height).toFixed(2)}px`;
  const facts = card.facts.map((t, i) => `<span class="chip${i === 0 ? " accent" : ""}">${esc(t)}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Archivo; src: url(${fontDataUrl}) format("truetype"); font-weight: 100 900; font-stretch: 62% 125%; }
html, body { margin: 0; width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
.dim { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 46%, rgba(28,25,29,0.55) 0%, rgba(28,25,29,0.78) 100%); }
.card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: Archivo; font-stretch: 125%; color: ${TEXT}; text-align: center; }
.bar { width: ${h(0.07)}; height: ${h(0.009)}; border-radius: ${h(0.005)}; background: ${BRASS}; margin-bottom: ${h(0.04)}; }
.title { font-size: ${h(0.1)}; font-weight: 800; line-height: 1; letter-spacing: ${h(0.001)}; }
.tagline { margin-top: ${h(0.032)}; font-size: ${h(0.042)}; font-weight: 500; font-stretch: 112%; color: ${TEXT_DIM}; }
.facts { margin-top: ${h(0.075)}; display: flex; gap: ${h(0.024)}; }
.chip { font-size: ${h(0.03)}; font-weight: 800; padding: ${h(0.016)} ${h(0.034)}; border-radius: ${h(0.05)};
  border: ${h(0.0035)} solid ${BRASS}; color: ${TEXT}; }
.chip.accent { background: ${BRASS}; border-color: ${BRASS}; color: ${LACQUER}; }
.link { margin-top: ${h(0.045)}; height: ${h(0.04)}; font-size: ${h(0.03)}; font-weight: 700; font-stretch: 100%; color: ${GOLD}; }
</style></head><body><div class="dim"></div><div class="card">
<div class="bar"></div>
<div class="title">${esc(card.title)}</div>
<div class="tagline">${esc(card.tagline)}</div>
<div class="facts">${facts}</div>
<div class="link">${card.link ? esc(card.link) : ""}</div>
</div></body></html>`;
}

/** Draw the card's layer (transparent where the hold shows through) to `out`, a PNG at width x height. */
export async function renderEndCard(page: Page, card: EndCard, size: { width: number; height: number }, root: string, out: string): Promise<void> {
  const font = fs.readFileSync(path.join(root, FONT_FILE)).toString("base64");
  await page.setViewportSize(size);
  await page.setContent(endCardHtml(card, size.width, size.height, `data:font/ttf;base64,${font}`));
  const ok = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check(`800 20px Archivo`);
  });
  if (!ok) throw new Error("end card: the Archivo font did not load");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, fullPage: false });
}
