// Text and small painted faces for things in the box (the plate, its keys, the hint lantern, the reward's story
// card): a 2D canvas as a texture, repainted only when what it shows changes (never per frame). The game's
// lettering on canvases is a serif in the brass-and-ivory look; Task 18's look pass may swap it.
import {
  CanvasTexture,
  CustomBlending,
  LinearFilter,
  MeshBasicMaterial,
  type MeshBasicMaterialParameters,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SRGBColorSpace,
  type Texture,
} from "@iwsdk/core";

/** The face for painted lettering (canvas fonts; UIKit panels have their own). */
export const LABEL_FONT = "Georgia, 'Times New Roman', serif";

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
    // Uploaded premultiplied (the canvas keeps it so): filtering then never mixes a transparent pixel's black into a
    // face's edge, the faint dark fringe round a key's rounded corners. Draw it with labelMaterial.
    this.texture.premultiplyAlpha = true;
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

/**
 * The material for a LabelCanvas face: its colour comes premultiplied from the upload, so it blends as
 * premultiplied (source times one, not times alpha again) and the shader leaves it as it is.
 */
export function labelMaterial(map: Texture, extra: MeshBasicMaterialParameters = {}): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    toneMapped: false,
    premultipliedAlpha: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    ...extra,
  });
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
