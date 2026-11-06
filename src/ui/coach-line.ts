// The coach line: one short line at a time (a lesson's "Watch.", "Your turn.", a tip), on a dark lacquer chip with a
// gold edge that floats by the box, readable at 55 cm. A new line fades the old one out, then is painted once and
// fades in; the canvas is repainted only when the line changes, never per frame. A line replaced before it was ever
// shown is never painted. Fades are opacity only, so reduced motion keeps them as they are.
//
// CoachLine is the pure part (what is shown, how faded; it hands the painter the wrapped lines); CoachLineView
// paints a canvas texture on a plane sized in metres (it cancels the box's scale when parented to the box root).
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "@iwsdk/core";

export const COACH = {
  /** The old line fades out over this long (ms), the new one in over this long. */
  fadeOutMs: 250,
  fadeInMs: 300,
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
  font: "Georgia, 'Times New Roman', serif",
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

export interface CoachPainter {
  /** Paint these lines (the line shown changed). */
  paint(lines: readonly string[]): void;
}

export class CoachLine {
  private shown: string | null = null;
  private target: string | null = null;
  private alpha = 0;

  constructor(private readonly painter: CoachPainter) {}

  /** The line to show (null: none). Cheap to call every frame with the same line. */
  show(text: string | null): void {
    this.target = text;
  }

  /** Advance the fades by dtMs; paints when a new line takes over. */
  update(dtMs: number): void {
    const dt = Math.max(0, dtMs);
    if (this.target !== this.shown) {
      if (this.shown !== null && this.alpha > 0) {
        this.alpha = Math.max(0, this.alpha - dt / COACH.fadeOutMs);
        if (this.alpha > 0) return;
      }
      this.shown = this.target;
      this.alpha = 0;
      if (this.shown !== null) this.painter.paint(wrapCoach(this.shown, coachChars()));
      return;
    }
    this.alpha = this.shown === null ? 0 : Math.min(1, this.alpha + dt / COACH.fadeInMs);
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
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
    this.object = new Mesh(new PlaneGeometry(C.planeMm[0] / 1000, C.planeMm[1] / 1000), this.material);
    this.object.name = "Coach Line";
    this.object.renderOrder = C.renderOrder;
    this.object.visible = false;
  }

  paint(lines: readonly string[]): void {
    const g = this.g;
    if (!g) return;
    const C = COACH, k = C.pxPerMm, font = C.fontMm * k, gap = C.lineGapMm * k;
    g.clearRect(0, 0, this.w, this.h);
    g.font = `600 ${font}px ${C.font}`;
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
    lines.forEach((l, i) => g.fillText(l, this.w / 2, top + i * (font + gap)));
    this.texture.needsUpdate = true;
  }

  /** 0 draws nothing. */
  set opacity(v: number) {
    this.material.opacity = v;
    this.object.visible = v > 0;
  }

  /** Parented to the box root (box units): keep the chip its size in metres whatever the box size. */
  setBoxSize(sizeM: number): void {
    this.object.scale.setScalar(1 / sizeM);
  }
}
