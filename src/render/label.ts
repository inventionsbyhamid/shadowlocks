// Text and small painted faces for things in the box (the plate, its keys, the hint lantern, the reward's story
// card): a 2D canvas as a texture, repainted only when what it shows changes (never per frame). The game's
// lettering on canvases is a serif in the brass-and-ivory look (Task 18's look pass may swap it), shipped with the
// game so every device draws and measures the same letters; Japanese is drawn in the shipped Japanese font.
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "@iwsdk/core";
import { type Lang, lang } from "../i18n";
import { JA_CANVAS_FAMILY, SERIF_CANVAS_FAMILY } from "../ui/fonts";

const SERIF = `'${SERIF_CANVAS_FAMILY}', Georgia, serif`;
const JAPANESE = `'${JA_CANVAS_FAMILY}', sans-serif`;

/** The face for painted Latin lettering (canvas fonts; UIKit panels have their own). Use `labelFont` to draw. */
export const LABEL_FONT = SERIF;

/** How a canvas label is set: bold (keys, the plate), semi-bold (the coach line), italic (the story card). */
export type LabelStyle = "bold" | "600" | "italic";

/** A canvas font for `style` at `px` in language `l` (Japanese has no italic: it stands upright). */
export function labelFont(style: LabelStyle, px: number, l: Lang = lang()): string {
  return l === "ja" ? `${style === "italic" ? "normal" : style} ${px}px ${JAPANESE}` : `${style} ${px}px ${SERIF}`;
}

/** How a label fits its room: the size it is set at (px), its width there, the room, and whether it is squeezed. */
export interface LabelFit {
  size: number;
  width: number;
  room: number;
  /** Still wider than the room at the floor: drawn condensed into it (a layout to fix, never shrunk further). */
  squeezed: boolean;
}

type Measure = Pick<CanvasRenderingContext2D, "font" | "measureText">;

/**
 * Set `g`'s font for `text`: `max` px where it fits `room`, else smaller in 2 px steps but never below `floor` (the
 * readable minimum). Leaves the font set; the caller draws with `room` as fillText's maximum width, so a squeezed
 * label condenses instead of spilling.
 */
export function fitLabel(g: Measure, text: string, style: LabelStyle, max: number, floor: number, room: number, l: Lang = lang()): LabelFit {
  let size = Math.round(max);
  g.font = labelFont(style, size, l);
  let width = g.measureText(text).width;
  while (width > room && size - 2 >= floor) {
    size -= 2;
    g.font = labelFont(style, size, l);
    width = g.measureText(text).width;
  }
  return { size, width, room, squeezed: width > room };
}

/** Japanese characters a line may not start with (closing marks, small kana, the long vowel mark). */
const NO_START = new Set([..."、。，．・：；？！ー」』）］｝〕〉》】ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々〜»"]);
/** Japanese characters a line may not end with (opening marks; French « too). */
const NO_END = new Set([..."「『（［｛〔〈《【«"]);

/**
 * The places a line may break in `text`: between words where there are spaces, and between Japanese characters
 * (a run of Latin letters or digits stays whole), never before a closing mark or after an opening one. Returns the
 * pieces in order; joining them gives `text` back.
 */
export function breakUnits(text: string): string[] {
  const units: string[] = [];
  const re = /[A-Za-z0-9À-ÿŒœ.,'’:;!?%() -]+ ?| +|./gsu;
  for (const m of text.matchAll(re)) {
    const u = m[0];
    const last = units.length - 1;
    // Glue: a closing mark onto the unit before it, an opening mark onto the unit after it.
    if (last >= 0 && (NO_START.has(u[0] as string) || NO_END.has(units[last]!.at(-1) as string))) units[last] += u;
    else units.push(u);
  }
  return units;
}

/**
 * `text` in lines no wider than `room` at the font `g` has set, at most `maxLines` (the last takes what is left, so
 * it may be wider: the caller reports that). Breaks only where `breakUnits` allows; spaces at a break are dropped.
 */
export function wrapLabel(g: Measure, text: string, room: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const u of breakUnits(text)) {
    const next = line + u;
    if (line !== "" && g.measureText(next.trimEnd()).width > room && lines.length < maxLines - 1) {
      lines.push(line.trimEnd());
      line = u.trimStart();
    } else line = next;
  }
  lines.push(line.trimEnd());
  return lines;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class LabelCanvas {
  readonly texture: CanvasTexture;
  readonly g: Ctx | null;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas | null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.canvas =
      typeof document !== "undefined"
        ? Object.assign(document.createElement("canvas"), { width, height })
        : typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(width, height)
          : null;
    this.g = (this.canvas?.getContext("2d") as Ctx | null | undefined) ?? null;
    this.texture = new CanvasTexture((this.canvas ?? { width, height }) as HTMLCanvasElement);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
  }

  /** Repaint (clears first) and upload on the next render. Nothing where there is no 2D canvas (unit tests). */
  paint(draw: (g: Ctx, w: number, h: number) => void): void {
    const g = this.g;
    if (!g) return;
    g.clearRect(0, 0, this.width, this.height);
    draw(g, this.width, this.height);
    this.texture.needsUpdate = true;
  }
}

/** A rounded rectangle path. */
export function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A brushed brass face: a warm gradient with a darker rim, the plate and keys' look. */
export function brassFace(g: Ctx, w: number, h: number, lit = false): void {
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, lit ? "#fff0b8" : "#e8c877");
  grad.addColorStop(0.5, lit ? "#f2cf72" : "#c9a24a");
  grad.addColorStop(1, lit ? "#d9ae4f" : "#9c7424");
  roundRect(g, 2, 2, w - 4, h - 4, Math.min(w, h) * 0.18);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = Math.max(2, Math.min(w, h) * 0.04);
  g.strokeStyle = "#5e4512";
  g.stroke();
}
