// Light: a glow adds its colour to what is behind it and leaves the page's alpha as it was. The headset lays the page
// over passthrough by that alpha (premultiplied), so the light adds to the room just as it does to the box. three's
// AdditiveBlending adds the source alpha to the page's as well: over the room a glow then paints it instead of
// lighting it, and a ray whose colour fades to black (the sunbursts, the ring beam) lays dark stripes over the room.
// Every glow's material takes these blend settings: `new SpriteMaterial({ map, ...LIGHT_BLEND, ... })`.
import { AddEquation, CustomBlending, OneFactor, SrcAlphaFactor, ZeroFactor } from "@iwsdk/core";

export const LIGHT_BLEND = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: SrcAlphaFactor,
  blendDst: OneFactor,
  blendEquationAlpha: AddEquation,
  blendSrcAlpha: ZeroFactor,
  blendDstAlpha: OneFactor,
} as const;
