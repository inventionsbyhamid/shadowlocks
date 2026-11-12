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

/**
 * A small corner label over the footage ("Emulator footage"), so a viewer knows what they see: a transparent layer
 * at the edit's size, the words in a dark pill in the top left corner, sized from the frame height.
 */
export function cornerLabelHtml(text: string, width: number, height: number, fontDataUrl: string): string {
  const h = (k: number) => `${(k * height).toFixed(2)}px`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Archivo; src: url(${fontDataUrl}) format("truetype"); font-weight: 100 900; font-stretch: 62% 125%; }
html, body { margin: 0; width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
.label { position: absolute; left: ${h(0.035)}; top: ${h(0.035)}; font-family: Archivo; font-stretch: 112%; font-weight: 600;
  font-size: ${h(0.024)}; letter-spacing: ${h(0.0008)}; color: ${TEXT}; background: rgba(28,25,29,0.62);
  padding: ${h(0.01)} ${h(0.02)}; border-radius: ${h(0.03)}; }
</style></head><body><div class="label">${esc(text)}</div></body></html>`;
}

/** The caption face: the game's own serif for painted lettering (the coach line, the plate), Noto Serif Bold (OFL). */
export const CAPTION_FONT_FILE = path.join("public", "fonts", "noto-serif-bd.woff2");

/**
 * A caption in the lower third: the words in the game's serif, cream, large enough for a phone (a line is 5.6% of the
 * frame height), centred, with a soft dark shadow so they read over the brass, under a short brass rule.
 */
export function captionHtml(text: string, width: number, height: number, fontDataUrl: string): string {
  const h = (k: number) => `${(k * height).toFixed(2)}px`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Caption; src: url(${fontDataUrl}) format("woff2"); font-weight: 500 900; }
html, body { margin: 0; width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
.cap { position: absolute; left: 6%; right: 6%; top: ${h(0.78)}; display: flex; flex-direction: column; align-items: center;
  font-family: Caption; font-weight: 700; font-size: ${h(0.056)}; line-height: 1.18; color: ${TEXT}; text-align: center;
  text-shadow: 0 ${h(0.003)} ${h(0.012)} rgba(0,0,0,0.9), 0 0 ${h(0.03)} rgba(0,0,0,0.65); }
.rule { width: ${h(0.06)}; height: ${h(0.006)}; border-radius: ${h(0.003)}; background: ${BRASS}; margin-bottom: ${h(0.022)};
  box-shadow: 0 0 ${h(0.012)} rgba(0,0,0,0.8); }
</style></head><body><div class="cap"><div class="rule"></div><div>${esc(text)}</div></div></body></html>`;
}

/** Draw a caption's layer to `out`, a PNG at width x height, transparent but for the words. */
export async function renderCaption(page: Page, text: string, size: { width: number; height: number }, root: string, out: string): Promise<void> {
  if (/[\u2013\u2014]/.test(text)) throw new Error(`caption "${text}": no en or em dashes`);
  const font = fs.readFileSync(path.join(root, CAPTION_FONT_FILE)).toString("base64");
  await page.setViewportSize(size);
  await page.setContent(captionHtml(text, size.width, size.height, `data:font/woff2;base64,${font}`));
  const ok = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check(`700 20px Caption`);
  });
  if (!ok) throw new Error("caption: the serif did not load");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, fullPage: false });
}

/** Draw the corner label's layer to `out`, a PNG at width x height, transparent but for the label. */
export async function renderCornerLabel(page: Page, text: string, size: { width: number; height: number }, root: string, out: string): Promise<void> {
  const font = fs.readFileSync(path.join(root, FONT_FILE)).toString("base64");
  await page.setViewportSize(size);
  await page.setContent(cornerLabelHtml(text, size.width, size.height, `data:font/ttf;base64,${font}`));
  const ok = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check(`600 20px Archivo`);
  });
  if (!ok) throw new Error("corner label: the Archivo font did not load");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, fullPage: false });
}
