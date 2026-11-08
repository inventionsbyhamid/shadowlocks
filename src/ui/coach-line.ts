// The coach line: one short line at a time (a lesson's "Watch.", "Your turn.", a tip), on a dark lacquer chip with a
// gold edge that floats by the box, readable at 55 cm. A new line fades the old one out, then is painted once and
// fades in; the canvas is repainted only when the line changes, never per frame. A line replaced before it was ever
// shown is never painted. Fades are opacity only, so reduced motion keeps them as they are.
//
// CoachLine is the pure part (what is shown, how faded; it hands the painter the wrapped lines); CoachLineView
// paints a canvas texture on a plane sized in metres (it cancels the box's scale when parented to the box root).
// The chip letters in the shipped fonts of the language shown and wraps by measured width, so Japanese (no spaces)
// breaks between characters by the kinsoku rules; the lessons hand it lines already in that language (`localLine`).
import { CanvasTexture, LinearFilter, Mesh, type MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "@iwsdk/core";
import type { Lang } from "../i18n";
import { breakUnits, labelFont, labelMaterial, type Measure, wrapLabel } from "../render/label";

export const COACH = {
  /** The old line fades out over this long (ms), the new one in over this long. */
  fadeOutMs: 250,
  fadeInMs: 300,
  /** A line asked for and then not stays this long (ms), so one asked for on and off never flickers. */
  holdMs: 1200,
  /** Lettering (mm): bigger than a sound caption's 11 mm, for one line read at 55 cm. */
  fontMm: 13,
  lineGapMm: 4,
  padXMm: 12,
  padYMm: 8,
  borderMm: 1.2,
  /** The widest line (mm), and at most this many lines. */
  maxWidthMm: 280,
  maxLines: 2,
  /** The serif's mean width per character, in ems (estimate for wrapping). */
  emPerChar: 0.55,
  /** The plane the chip is painted on (mm), and the canvas's pixels per mm. */
  planeMm: [300, 70] as const,
  pxPerMm: 4,
  /** Ebony and Gold: black lacquer chip, gold leaf edge, ivory lettering. */
  chip: "rgba(28, 25, 29, 0.86)",
  edge: "#b08732",
  ink: "#efe8da",
  /** Drawn after the box, before the ghost. */
  renderOrder: 995,
} as const;

/** Characters that fit across the coach line. */
export function coachChars(): number {
  return Math.floor(COACH.maxWidthMm / (COACH.fontMm * COACH.emPerChar));
}

/**
 * `text` in lines of at most `maxChars`: whole if it fits, else two lines, broken between sentences where both
 * halves fit, else where the two come out most even. A text no break can fit is filled greedily (still at most
 * COACH.maxLines lines; the last one takes the rest).
 */
export function wrapCoach(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  let best = -1, bestScore = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    if (a.length > maxChars || b.length > maxChars) continue;
    const score = Math.max(a.length, b.length) - (/[.?!]$/.test(a) ? 1000 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best > 0) return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
  const lines: string[] = [];
  for (const w of words) {
    const last = lines.length - 1;
    if (last >= 0 && (lines[last]!.length + 1 + w.length <= maxChars || lines.length === COACH.maxLines)) lines[last] += " " + w;
    else lines.push(w);
  }
  return lines;
}

/** A break after this ends a sentence (the best place), or a clause (a better one). */
const SENTENCE_END = /[.?!。？！]$/;
const CLAUSE_END = /[,;:、，；：]$/;

/**
 * `text` in lines no wider than `room` as `width` measures them: whole if it fits, else two, broken only where a line
 * may break (between words; between Japanese characters by the kinsoku rules, a Latin word kept whole), after a
 * sentence where both halves fit, else where the two come out most even (a clause's end a little preferred). A text
 * no break can fit is filled line by line instead, at most COACH.maxLines lines (the last takes the rest).
 */
export function coachWrap(text: string, width: (s: string) => number, room: number): string[] {
  if (width(text) <= room) return [text];
  const units = breakUnits(text);
  let best: string[] | null = null, bestScore = Number.POSITIVE_INFINITY;
  for (let k = 1; k < units.length; k++) {
    const a = units.slice(0, k).join("").replace(/ +$/, ""), b = units.slice(k).join("").replace(/^ +| +$/g, "");
    const wa = width(a), wb = width(b);
    if (wa > room || wb > room) continue;
    const score = Math.max(wa, wb) - (SENTENCE_END.test(a) ? 1e9 : CLAUSE_END.test(a) ? room * 0.15 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best ?? wrapLabel({ font: "", measureText: (s) => ({ width: width(s) }) as TextMetrics }, text, room, COACH.maxLines);
}

/**
 * How `text` sits on the coach chip in language `l` (canvas px): its one size (13 mm, the shipped serif, or the
 * Japanese font), its lines, and whether it is too long for two lines at that size (the layout check fails on it;
 * the chip would condense it).
 */
export function coachLayout(g: Measure, text: string, l?: Lang): { size: number; lines: string[]; squeezed: boolean } {
  const size = COACH.fontMm * COACH.pxPerMm, room = COACH.maxWidthMm * COACH.pxPerMm;
  g.font = labelFont("bold", size, l);
  const lines = coachWrap(text, (s) => g.measureText(s).width, room);
  return { size, lines, squeezed: lines.length > COACH.maxLines || lines.some((x) => g.measureText(x).width > room) };
}

/**
 * A line that comes and goes as play does (the session's "set a controller down" while a finger lock is short): shown
 * as soon as it is asked for, kept until it has not been asked for COACH.holdMs, so a condition crossing its
 * threshold back and forth never flickers it. Another line takes over at once.
 */
export class LineHold {
  private line: string | null = null;
  private offMs = 0;

  /** This frame's line (null: none asked for), `dtMs` since the last; returns the line to show. */
  update(want: string | null, dtMs: number): string | null {
    if (want !== null) {
      this.line = want;
      this.offMs = 0;
    } else if (this.line !== null && (this.offMs += Math.max(0, dtMs)) >= COACH.holdMs) this.line = null;
    return this.line;
  }
}

export interface CoachPainter {
  /** Paint these lines (the line shown changed). */
  paint(lines: readonly string[]): void;
  /** `text` in lines as this painter measures them; without it, lines are estimated by characters (`wrapCoach`). */
  wrap?(text: string): readonly string[];
}

export class CoachLine {
  private shown: string | null = null;
  private target: string | null = null;
  private alpha = 0;
  private reletter = false;

  constructor(private readonly painter: CoachPainter) {}

  /** The line to show (null: none). Cheap to call every frame with the same line. */
  show(text: string | null): void {
    this.target = text;
  }

  /**
   * The lettering changed (a new language, a font arriving): at the next update the line up is painted again if it
   * is still the line asked for. A line in the new language replaces it instead and is painted once, as itself.
   */
  relettered(): void {
    this.reletter = true;
  }

  /** Advance the fades by dtMs; paints when a new line takes over. */
  update(dtMs: number): void {
    if (this.reletter) {
      this.reletter = false;
      if (this.target === this.shown) this.repaint();
    }
    const dt = Math.max(0, dtMs);
    if (this.target !== this.shown) {
      if (this.shown !== null && this.alpha > 0) {
        this.alpha = Math.max(0, this.alpha - dt / COACH.fadeOutMs);
        if (this.alpha > 0) return;
      }
      this.shown = this.target;
      this.alpha = 0;
      this.repaint();
      return;
    }
    this.alpha = this.shown === null ? 0 : Math.min(1, this.alpha + dt / COACH.fadeInMs);
  }

  /** Paint the line shown again (a font it is drawn with has arrived). Never per frame. */
  repaint(): void {
    const t = this.shown;
    if (t === null) return;
    this.painter.paint(this.painter.wrap ? this.painter.wrap(t) : wrapCoach(t, coachChars()));
  }

  /** The line painted now (it may be fading out), or null. */
  get text(): string | null {
    return this.shown;
  }

  get opacity(): number {
    return this.alpha;
  }
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A rounded rectangle path. */
function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The coach line's chip: a canvas texture on a plane, sized in metres. */
export class CoachLineView implements CoachPainter {
  readonly object: Mesh;
  private readonly g: Ctx | null;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly w: number;
  private readonly h: number;

  constructor() {
    const C = COACH;
    this.w = C.planeMm[0] * C.pxPerMm;
    this.h = C.planeMm[1] * C.pxPerMm;
    const canvas =
      typeof document !== "undefined"
        ? Object.assign(document.createElement("canvas"), { width: this.w, height: this.h })
        : typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(this.w, this.h)
          : null;
    this.g = (canvas?.getContext("2d") as Ctx | null | undefined) ?? null;
    this.texture = new CanvasTexture((canvas ?? { width: this.w, height: this.h }) as HTMLCanvasElement);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    // Premultiplied, as every painted face (render/label.ts): the canvas's transparent black round the chip must not
    // filter a dark rim into its edge over passthrough.
    this.texture.premultiplyAlpha = true;
    this.material = labelMaterial(this.texture, { depthWrite: false, opacity: 0 });
    this.object = new Mesh(new PlaneGeometry(C.planeMm[0] / 1000, C.planeMm[1] / 1000), this.material);
    this.object.name = "Coach Line";
    this.object.renderOrder = C.renderOrder;
    this.object.visible = false;
  }

  /** `text` in lines measured in the font the chip paints with (the language shown); by characters without a canvas. */
  wrap(text: string): readonly string[] {
    return this.g ? coachLayout(this.g, text).lines : wrapCoach(text, coachChars());
  }

  paint(lines: readonly string[]): void {
    const g = this.g;
    if (!g) return;
    const C = COACH, k = C.pxPerMm, font = C.fontMm * k, gap = C.lineGapMm * k;
    g.clearRect(0, 0, this.w, this.h);
    // The shipped serif in the Latin languages, the Japanese font in Japanese (the layout check measures the same).
    g.font = labelFont("bold", font);
    let wide = 0;
    for (const l of lines) wide = Math.max(wide, g.measureText(l).width);
    const cw = Math.min(this.w - 4, wide + 2 * C.padXMm * k), ch = Math.min(this.h - 4, lines.length * font + (lines.length - 1) * gap + 2 * C.padYMm * k);
    const x = (this.w - cw) / 2, y = (this.h - ch) / 2;
    roundRect(g, x, y, cw, ch, Math.min(ch / 2, 10 * k));
    g.fillStyle = C.chip;
    g.fill();
    g.lineWidth = C.borderMm * k;
    g.strokeStyle = C.edge;
    g.stroke();
    g.fillStyle = C.ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const top = this.h / 2 - ((lines.length - 1) * (font + gap)) / 2;
    // A line wider than the room (the layout check fails on one) is condensed into it rather than cut at the edge.
    lines.forEach((l, i) => g.fillText(l, this.w / 2, top + i * (font + gap), C.maxWidthMm * k));
    this.texture.needsUpdate = true;
  }

  /**
   * 0 draws nothing. Premultiplied, the colour fades with the alpha (the blend adds the texel's colour as it is). The
   * blend works on display values, so the tint is `v` as a display value (sRGB, made linear here): the letters fade
   * with the chip, not ahead of it (a linear `v` left them at about 0.66 against an alpha of 0.5).
   */
  set opacity(v: number) {
    this.material.opacity = v;
    this.material.color.setRGB(v, v, v, SRGBColorSpace);
    this.object.visible = v > 0;
  }

  /** Parented to the box root (box units): keep the chip its size in metres whatever the box size. */
  setBoxSize(sizeM: number): void {
    this.object.scale.setScalar(1 / sizeM);
  }
}
