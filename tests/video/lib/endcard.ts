// The film's end card: the title, a tagline and short facts over a dimmed, blurred hold of the last
// frame. The card's text layer is drawn by the browser (Archivo, in the game's ebony and gold) as a
// transparent PNG at the edit's size; the edit holds the last frame, blurs it in and lays the card
// over it (mixdown.ts endCardFilter). The font is Archivo (OFL, tests/video/assets/fonts/OFL.txt),
// the variable font the game's Archivo Expanded ExtraBold atlas is cut from.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { ffmpeg } from "./ffrun";

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
  /**
   * "centre" (default): the words centred over the dimmed hold. "side": the held frame stays sharp with the box left of
   * centre, and the words stand in the dark to its right, the title large in the game's display face (Limelight,
   * Shadow Locks Display), under a shade of their own.
   */
  layout?: "centre" | "side";
  /** How much the held frame blurs (Gaussian sigma at 960 px wide; default 14, 0: not blurred and not dimmed). */
  blurSigma?: number;
}

/** The game's Ebony and Gold palette (plan/lookdev/shadow-locks/pick.md). */
const LACQUER = "#1C191D";
const TEXT = "#EFE6D2";
const TEXT_DIM = "#CDB27A";
const BRASS = "#E2BD62";
const GOLD = "#FFD36A";

export const FONT_FILE = path.join("tests", "video", "assets", "fonts", "Archivo-Variable.ttf");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The game's display face, the wordmark's (Limelight, OFL: tests/video/assets/fonts/OFL-Limelight.txt). */
export const DISPLAY_FONT_FILE = path.join("tests", "video", "assets", "fonts", "Limelight-Regular.ttf");

/**
 * The "side" card: a shade from the middle of the frame to its right edge, and in the right part a column: a brass
 * rule, the title in two large lines of the display face, the tagline, the facts and the link.
 */
export function sideCardHtml(card: EndCard, width: number, height: number, fontDataUrl: string, displayDataUrl: string): string {
  const h = (k: number) => `${(k * height).toFixed(2)}px`;
  const facts = card.facts.map((t, i) => `<span class="chip${i === 0 ? " accent" : ""}">${esc(t)}</span>`).join("");
  const words = card.title.split(" ");
  const title = words.length === 2 ? `${esc(words[0] as string)}<br>${esc(words[1] as string)}` : esc(card.title);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Archivo; src: url(${fontDataUrl}) format("truetype"); font-weight: 100 900; font-stretch: 62% 125%; }
@font-face { font-family: Display; src: url(${displayDataUrl}) format("truetype"); }
html, body { margin: 0; width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
.shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(18,13,10,0) 40%, rgba(18,13,10,0.62) 58%, rgba(18,13,10,0.8) 100%); }
.col { position: absolute; left: 57%; right: 4%; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center;
  align-items: flex-start; font-family: Archivo; color: ${TEXT}; }
.bar { width: ${h(0.07)}; height: ${h(0.009)}; border-radius: ${h(0.005)}; background: ${BRASS}; margin-bottom: ${h(0.035)}; }
.title { font-family: Display; font-size: ${h(0.15)}; line-height: 0.98; color: ${GOLD};
  text-shadow: 0 0 ${h(0.03)} rgba(255,200,90,0.28), 0 ${h(0.004)} ${h(0.012)} rgba(0,0,0,0.7); }
.tagline { margin-top: ${h(0.04)}; font-size: ${h(0.037)}; font-weight: 500; font-stretch: 108%; line-height: 1.3; color: ${TEXT}; max-width: ${h(0.72)}; }
.facts { margin-top: ${h(0.05)}; display: flex; gap: ${h(0.02)}; }
.chip { font-size: ${h(0.027)}; font-weight: 800; font-stretch: 112%; padding: ${h(0.014)} ${h(0.028)}; border-radius: ${h(0.05)};
  border: ${h(0.0035)} solid ${BRASS}; color: ${TEXT}; }
.chip.accent { background: ${BRASS}; border-color: ${BRASS}; color: ${LACQUER}; }
.link { margin-top: ${h(0.045)}; font-size: ${h(0.03)}; font-weight: 600; font-stretch: 100%; letter-spacing: ${h(0.001)}; color: ${TEXT_DIM}; }
</style></head><body><div class="shade"></div><div class="col">
<div class="bar"></div>
<div class="title">${title}</div>
<div class="tagline">${esc(card.tagline)}</div>
<div class="facts">${facts}</div>
${card.link ? `<div class="link">${esc(card.link)}</div>` : ""}
</div></body></html>`;
}

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
  const side = card.layout === "side";
  const display = side ? fs.readFileSync(path.join(root, DISPLAY_FONT_FILE)).toString("base64") : "";
  await page.setContent(
    side
      ? sideCardHtml(card, size.width, size.height, `data:font/ttf;base64,${font}`, `data:font/ttf;base64,${display}`)
      : endCardHtml(card, size.width, size.height, `data:font/ttf;base64,${font}`),
  );
  const ok = await page.evaluate(async (needDisplay) => {
    await document.fonts.ready;
    return document.fonts.check(`800 20px Archivo`) && (!needDisplay || document.fonts.check(`20px Display`));
  }, side);
  if (!ok) throw new Error("end card: a font did not load");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (size.height <= 1080) {
    await page.screenshot({ path: out, omitBackground: true, fullPage: false });
    return;
  }
  // Chromium here refuses a whole 2560x1440 transparent capture ("Unable to capture screenshot", as the captions met):
  // the layer is captured in bands and stacked again, pixel for pixel.
  const BAND = 480;
  const bands: string[] = [];
  for (let y = 0; y < size.height; y += BAND) {
    const file = `${out}.band${bands.length}.png`;
    await page.screenshot({ path: file, omitBackground: true, fullPage: false, clip: { x: 0, y, width: size.width, height: Math.min(BAND, size.height - y) } });
    bands.push(file);
  }
  ffmpeg(["-y", "-hide_banner", "-loglevel", "error", ...bands.flatMap((b) => ["-i", b]), "-filter_complex", `${bands.map((_, i) => `[${i}:v]`).join("")}vstack=inputs=${bands.length},format=rgba[v]`, "-map", "[v]", "-frames:v", "1", out]);
  for (const b of bands) fs.rmSync(b, { force: true });
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
 * frame height), centred, with a soft dark shadow, under a short brass rule, over a soft dark scrim across the bottom
 * of the frame so they read over the brass and the pale system hand.
 */
export function captionHtml(text: string, width: number, height: number, fontDataUrl: string): string {
  const h = (k: number) => `${(k * height).toFixed(2)}px`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Caption; src: url(${fontDataUrl}) format("woff2"); font-weight: 500 900; }
html, body { margin: 0; width: ${width}px; height: ${height}px; background: transparent; overflow: hidden; }
.scrim { position: absolute; left: 0; right: 0; top: ${h(0.7)}; bottom: 0;
  background: linear-gradient(180deg, rgba(14,10,8,0) 0%, rgba(14,10,8,0.5) 45%, rgba(14,10,8,0.62) 100%); }
.cap { position: absolute; left: 6%; right: 6%; top: ${h(0.78)}; display: flex; flex-direction: column; align-items: center;
  font-family: Caption; font-weight: 700; font-size: ${h(0.056)}; line-height: 1.18; color: ${TEXT}; text-align: center;
  text-shadow: 0 ${h(0.003)} ${h(0.012)} rgba(0,0,0,0.9), 0 0 ${h(0.03)} rgba(0,0,0,0.65); }
.rule { width: ${h(0.06)}; height: ${h(0.006)}; border-radius: ${h(0.003)}; background: ${BRASS}; margin-bottom: ${h(0.022)};
  box-shadow: 0 0 ${h(0.012)} rgba(0,0,0,0.8); }
</style></head><body><div class="scrim"></div><div class="cap"><div class="rule"></div><div>${esc(text)}</div></div></body></html>`;
}

/** Where a caption's band starts, as a fraction of the frame height: the layer drawn is the band below it. */
export const CAPTION_TOP = 0.7;

/**
 * Draw a caption's band to `out`: a PNG `width` wide, from CAPTION_TOP of the frame to its foot, transparent but for the
 * words (laid at y = CAPTION_TOP x height). Only the band is captured: Chromium could not capture a whole 2560x1440
 * transparent page here ("Unable to capture screenshot").
 */
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
  const y = Math.round(CAPTION_TOP * size.height);
  await page.screenshot({ path: out, omitBackground: true, fullPage: false, clip: { x: 0, y, width: size.width, height: size.height - y } });
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
