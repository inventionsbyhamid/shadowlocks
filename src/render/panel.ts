// The frosted ivory back panel: the lantern's pool of light, the shadows on it, and the gold-leaf
// etching (Ebony and Gold). One shader, two materials sharing its uniforms: the panel plane (no
// shadow) and the shadow mesh (shadow strength per vertex), drawn after the panel with MIN blending.
// Shadow only ever darkens the panel, so the darker fragment is always the stronger shadow: where
// shadows overlap the panel shows the strongest one, never two multiplied, and a soft skirt over a
// neighbour's solid interior changes nothing.
//
// The etching is drawn once per box: the albedo (1024 px: frosted ivory, outlines, numerals, sight
// marks, the deco border), two masks at half that (red: inside every outline, for the open lock's gold
// fill; green: a crisp band along every outline, for warmth and opening) and the band's soft halo
// (128 px, blurred). The gold lines glint even in shadow; the shader finds them in the albedo by their
// warm colour, so they need no mask. Warmth and opening are per lock: the shader picks the lock whose
// centre is nearest (locks sit far apart). A hidden lock's warmth lights its dotted frame instead of
// its outline, which would give the shape away.
//
// The etching is CPU canvas drawing clipped to each lock, done a small step a frame (see Panel), so a
// new box never stalls a frame.
//
// Colour maths runs in display values, as the lookdev's canvas did (theme.ts, PANEL_LIGHT), and is
// handed to three as linear at the end, so the panel looks as it did there. Sunbursts and glitter
// belong to the celebration, not here.
import {
  CanvasTexture,
  CustomBlending,
  DoubleSide,
  LinearMipmapLinearFilter,
  MinEquation,
  NoColorSpace,
  OneFactor,
  ShaderMaterial,
  type Texture,
  Vector3,
} from "@iwsdk/core";
import { rng32 } from "../core/geom";
import type { Box, Lock, V2, V3 } from "../core/types";
import { outlineEdges } from "./outline";
import { COLORS, FOIL, PANEL_LIGHT } from "./theme";

/** The albedo canvas: the panel's 1 x 1 box units at this many pixels. */
export const ETCH_PX = 1024;
/** The masks' canvas (a fill and a soft glow need less). */
export const MASK_PX = 512;
/** The glow's soft halo is blurred at this size, then scaled up onto the masks (a blur costs by area). */
export const HALO_PX = 128;
/** Texture anisotropy: the panel is seen at a slant from the seated eye. */
export const PANEL_ANISOTROPY = 4;
/** Warmth eases toward its target with this time constant (s), so the glow never flickers. */
export const WARMTH_EASE_S = 0.12;
/** An opening lock's gold fill comes up over this long (s). */
export const OPEN_FILL_S = 0.4;
/** Locks the shader knows about. */
const LOCKS = 3;
/** Where an absent lock's centre goes: never the nearest. */
const FAR = 1e3;

/**
 * The etching, from the lookdev's Ebony panel: sizes in albedo pixels at ETCH_PX (1 px = 1/1024 of
 * the panel), radii of marks in box units.
 */
const ART = {
  /** Two stepped deco borders: inset, line width, opacity; the corner step. */
  border: [
    { inset: 44, width: 3, alpha: 0.85 },
    { inset: 56, width: 1.5, alpha: 0.55 },
  ],
  borderStep: 34,
  /** A fan crest at the top centre, left out when a sight mark sits near it. */
  crest: { y: 108, r: 40, rays: 12, alpha: 0.75, clear: 0.13 },
  /** A faint fan of rays and a ring behind every lock, as shares of its size. */
  fan: { rays: 40, r0: 0.3, r1: 0.66, ring: 0.68, alpha: 0.22, ringAlpha: 0.36 },
  /** Inside an etched outline: a whisper of gold. */
  tint: 0.08,
  /** The gold-leaf outline, 0..4 px outside; the inner parallel line, 8..10 px inside. */
  outline: 4,
  inner: [8, 10] as const,
  innerAlpha: 0.65,
  /** The warmth and opening glow: a band 6 px either side of the outline, and its blur. */
  glowBand: 6,
  glowBlur: 34,
  /** Room round a lock's outline for its etched bands (px). */
  margin: 16,
  /**
   * Roman numerals (drawn as deco strokes, no font needed): cap height (px); placed at a corner of the
   * lock (these shares of its size from its centre), upper left first, the first one clear of every
   * sight mark (the ring shadows land there) and inside the border.
   */
  numeral: { h: 30, dx: 0.6, dy: 0.53, clear: 0.1, inside: 0.43 },
  /**
   * The rings' mark: a diamond whose tips sit in the lit gap between the nested ring shadows (0.024 to
   * 0.032 from the spot), a dot in the deep ring's hole, and ticks just outside the shallow ring.
   */
  mark: { tip: 0.028, line: 2.6, dot: 0.0045, tick: [0.062, 0.076] as const, tickLine: 2 },
  /** A hidden lock's dotted frame: the outline's reach plus a margin, dots this far apart. */
  dots: { margin: 0.03, gap: 0.018, r: 0.0028 },
  /** The frosted glass: soft blotches, speckles and darker edges. */
  frost: { blotches: 70, speckles: 16000, edge: 74, edgeAlpha: 0.26 },
} as const;

/** How the shader reads the etching and draws shadows and an open lock. */
export const LOOK = {
  /**
   * The gold lines, by how far the albedo's warmth runs from ivory (0) to the etch gold (1), eased from lineFrom to
   * lineTo. A line laid at alpha a over ivory reads about 0.06 at the inside tint (a 0.08), 0.17 for a fan ray
   * (0.22), 0.29 for a fan's ring (0.36), 0.47 for the faint border (0.55), 0.58 for the inner line (0.65) and 1 for
   * the outline, numerals, marks and dots: the first three drop out, the rest keep most of their sheen.
   */
  lineFrom: 0.35,
  lineTo: 0.75,
  /**
   * The outer share of a shadow's skirt left clear: its half-shadow line sits 0.35 of the penumbra past the scrap's
   * edge instead of 0.5, so a lock filled from its spot overhangs its outline by 30% less.
   */
  skirtClear: 0.3,
  /** How much of an open lock's colour is its gold foil (over its shadows, which fill it at its spot). */
  openFoil: 0.85,
  /** How much of the open outline's hot burn is held back inside the shape, so the foil's bands show. */
  openBurnInside: 0.75,
} as const;

/** Display-space RGB of a #rrggbb colour (no colour management: the shader works in display values). */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const vec3 = (hex: string) => new Vector3(...rgb(hex));
const glsl3 = ([r, g, b]: readonly number[]) => `vec3(${r!.toFixed(4)}, ${g!.toFixed(4)}, ${b!.toFixed(4)})`;
/** How warm a colour is, whatever its brightness: (red - blue) / red. Ivory is barely warm, the etch gold very. */
const warmthOf = (hex: string) => {
  const [r, , b] = rgb(hex);
  return (r - b) / r;
};

/** The banded gold foil of an open lock, along a diagonal across it (the lookdev's stops). */
function foilGlsl(): string {
  let s = `vec3 foil(float t) {\n  t = clamp(t, 0.0, 1.0);\n  vec3 c = ${glsl3(rgb(FOIL[0]![1]))};\n`;
  for (let i = 1; i < FOIL.length; i++) {
    const [t0] = FOIL[i - 1]!, [t1, hex] = FOIL[i]!;
    s += `  c = mix(c, ${glsl3(rgb(hex))}, clamp((t - ${t0.toFixed(3)}) / ${(t1 - t0).toFixed(3)}, 0.0, 1.0));\n`;
  }
  return `${s}  return c;\n}\n`;
}

const VERTEX = /* glsl */ `
#ifdef SHADOW
attribute float aAlpha;
#endif
varying vec2 vP;
varying float vCov;
void main() {
  vP = position.xy;
#ifdef SHADOW
  vCov = aAlpha;
#else
  vCov = 0.0;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uAlbedo;
uniform sampler2D uMasks;
// The glow band's soft halo, in alpha (a small canvas, blurred).
uniform sampler2D uHalo;
uniform vec3 uLantern;
uniform float uWarmth[3];
uniform float uOpen[3];
uniform vec2 uLockCenter[3];
// Per lock: its size, its dotted frame's half-width, 1 when hidden.
uniform vec3 uLockShape[3];
// Pool tightness, 1 / sigma^2, gain; how much light a full shadow takes.
uniform vec4 uPool;
uniform vec3 uLit;
uniform vec3 uAmbient;
uniform vec3 uEtch;
uniform vec3 uGold;
uniform vec3 uGoldHot;
uniform float uSheen;
varying vec2 vP;
varying float vCov;
// How warm the ivory and the etch gold are ((red - blue) / red), to find the gold lines in the albedo.
const float IVORY_WARM = ${warmthOf(COLORS.panel).toFixed(4)};
const float ETCH_WARM = ${warmthOf(COLORS.etch).toFixed(4)};
const float LINE_FROM = ${LOOK.lineFrom.toFixed(3)};
const float LINE_TO = ${LOOK.lineTo.toFixed(3)};
const float SKIRT_CLEAR = ${LOOK.skirtClear.toFixed(3)};
const float OPEN_FOIL = ${LOOK.openFoil.toFixed(3)};
const float OPEN_BURN_INSIDE = ${LOOK.openBurnInside.toFixed(3)};
${foilGlsl()}
void main() {
#ifdef SHADOW
  // Shadows fall on the panel only.
  if (abs(vP.x) > 0.5 || abs(vP.y) > 0.5) discard;
  // The skirt runs from full shadow at the scrap's edge (1) to none at the penumbra's reach (0); its outer part
  // stays clear, so a shape filled from its spot overhangs its outline by less, and soft and crisp pieces step less.
  float cov = smoothstep(SKIRT_CLEAR, 1.0, vCov);
#else
  float cov = 0.0;
#endif
  vec2 uv = vP + 0.5;
  vec3 albedo = texture2D(uAlbedo, uv).rgb;
  vec2 m = texture2D(uMasks, uv).rg;
  // The glow band: crisp along the outline, a soft halo round it.
  float band = min(1.0, m.g + texture2D(uHalo, uv).a);
  // The gold lines: where the albedo is as warm as the etch gold (frost and shading change brightness, not warmth).
  // Only the strong gold leaf counts (outlines, inner lines, numerals, marks, dots, the border): the whisper of gold
  // inside an outline and the faint fan and ring behind a lock neither glint in shadow nor light up with warmth.
  float line = smoothstep(LINE_FROM, LINE_TO, clamp(((albedo.r - albedo.b) / max(albedo.r, 0.01) - IVORY_WARM) / (ETCH_WARM - IVORY_WARM), 0.0, 1.0));
  // The lantern's pool: inverse square and cosine falloff, gathered toward the spot under it.
  vec2 d = vP - uLantern.xy;
  float r2 = dot(d, d), z2 = uLantern.z * uLantern.z, q = z2 / (r2 + z2);
  float E = q * sqrt(q) * (1.0 - uPool.x + uPool.x * exp(-r2 * uPool.y));
  vec3 light = 1.0 - exp(-uPool.z * E * uLit);
  vec3 c = albedo * (uAmbient + light * (1.0 - uPool.w * cov)) + uSheen * line * uEtch;
  // This point's lock: the nearest centre.
  float d0 = distance(vP, uLockCenter[0]), d1 = distance(vP, uLockCenter[1]), d2 = distance(vP, uLockCenter[2]);
  float w = uWarmth[0], o = uOpen[0];
  vec2 lc = uLockCenter[0];
  vec3 sh = uLockShape[0];
  if (d1 < d0) { w = uWarmth[1]; o = uOpen[1]; lc = uLockCenter[1]; sh = uLockShape[1]; d0 = d1; }
  if (d2 < d0) { w = uWarmth[2]; o = uOpen[2]; lc = uLockCenter[2]; sh = uLockShape[2]; }
  vec2 rel = vP - lc;
  // Warmth: gold light on the outline, or on a hidden lock's dotted frame.
  float inFrame = 1.0 - smoothstep(sh.y + 0.01, sh.y + 0.03, max(abs(rel.x), abs(rel.y)));
  float glow = mix(band, line * inFrame, sh.z);
  c += clamp(1.2 * w, 0.0, 1.0) * glow * uGold;
  // Open: banded gold foil fills the shape, over its shadows (the outline fills with light), the etching showing
  // through it as engraving, and its outline burns bright. The burn is the band's, mostly outside the shape: inside
  // a small shape the band's soft halo would wash the foil's bands out to white.
  if (o > 0.0) {
    float f = m.r * o;
    c = mix(c, foil(0.5 + (rel.x - rel.y) / (2.2 * sh.x)), OPEN_FOIL * f);
    c *= mix(vec3(1.0), albedo, 0.85 * f);
    c += 0.55 * o * band * (1.0 - OPEN_BURN_INSIDE * m.r) * uGoldHot;
  }
  gl_FragColor = sRGBTransferEOTF(vec4(clamp(c, 0.0, 1.0), 1.0));
  #include <colorspace_fragment>
}
`;

export interface PanelUniforms {
  [name: string]: { value: unknown };
  uAlbedo: { value: Texture | null };
  uMasks: { value: Texture | null };
  uHalo: { value: Texture | null };
  uLantern: { value: Vector3 };
  uWarmth: { value: Float32Array };
  uOpen: { value: Float32Array };
  uLockCenter: { value: Float32Array };
  uLockShape: { value: Float32Array };
  uPool: { value: Float32Array };
  uLit: { value: Vector3 };
  uAmbient: { value: Vector3 };
  uEtch: { value: Vector3 };
  uGold: { value: Vector3 };
  uGoldHot: { value: Vector3 };
  uSheen: { value: number };
}

/** The panel shader's uniforms (one set, shared by the panel and the shadows), with no box yet. */
export function panelUniforms(): PanelUniforms {
  const P = PANEL_LIGHT;
  const centers = new Float32Array(LOCKS * 2).fill(FAR);
  return {
    uAlbedo: { value: null },
    uMasks: { value: null },
    uHalo: { value: null },
    uLantern: { value: new Vector3(0.35, -0.3, 1.35) },
    uWarmth: { value: new Float32Array(LOCKS) },
    uOpen: { value: new Float32Array(LOCKS) },
    uLockCenter: { value: centers },
    uLockShape: { value: new Float32Array(LOCKS * 3).fill(1) },
    uPool: { value: new Float32Array([P.tightness, 1 / (P.sigma * P.sigma), P.gain, P.shadowDepth]) },
    uLit: { value: new Vector3(...P.lit) },
    uAmbient: { value: vec3(COLORS.panelShadow) },
    uEtch: { value: vec3(COLORS.etch) },
    uGold: { value: vec3(COLORS.gold) },
    uGoldHot: { value: vec3(COLORS.goldHot) },
    uSheen: { value: P.sheen },
  };
}

/**
 * The panel's material and the shadows' (same shader and uniforms). The panel writes no depth, so the
 * shadow mesh can lie exactly in its plane; it must draw after the panel (a higher renderOrder).
 */
export function panelMaterials(u: PanelUniforms): { panel: ShaderMaterial; shadow: ShaderMaterial } {
  const panel = new ShaderMaterial({ uniforms: u, vertexShader: VERTEX, fragmentShader: FRAGMENT, depthWrite: false, toneMapped: false });
  panel.name = "Panel";
  const shadow = new ShaderMaterial({
    uniforms: u,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { SHADOW: "" },
    depthWrite: false,
    toneMapped: false,
    // Polygons wind either way (Diamond clockwise, a mirrored box flips all).
    side: DoubleSide,
    // The darker of panel and shadow: overlapping shadows never darken twice.
    blending: CustomBlending,
    blendEquation: MinEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
  });
  shadow.name = "Panel Shadows";
  return { panel, shadow };
}

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface Surface {
  c: Canvas;
  g: Ctx;
}

/**
 * A canvas drawn on the CPU (`willReadFrequently`): its drawing costs what it costs on the main thread,
 * where it can be measured and spread over frames, rather than a GPU round trip per call.
 */
function surface(size: number): Surface {
  const c: Canvas =
    typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: size, height: size }) : new OffscreenCanvas(size, size);
  const g = c.getContext("2d", { willReadFrequently: true }) as Ctx | null;
  if (!g) throw new Error("panel: no 2D canvas");
  return { c, g };
}

/** Panel box units to albedo pixels (y down). */
const X = (x: number) => (x + 0.5) * ETCH_PX;
const Y = (y: number) => (0.5 - y) * ETCH_PX;
const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
};
/** The opaque colour of `over` laid at alpha `a` on `under`, as the canvas composites it. */
const mixHex = (under: string, over: string, a: number) => {
  const u = rgb(under), o = rgb(over);
  return `rgb(${u.map((v, i) => Math.round((v + (o[i]! - v) * a) * 255)).join(",")})`;
};
const signedArea = (p: V2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!, r = p[(i + 1) % p.length]!;
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a;
};

/** Every piece as a subpath wound the same way (added to the current path), so a nonzero fill is their union. */
function addPieces(g: Ctx, polys: V2[][]): void {
  for (const p of polys) {
    const n = p.length, ccw = signedArea(p) > 0;
    for (let i = 0; i < n; i++) {
      const v = p[ccw ? i : n - 1 - i]!;
      if (i) g.lineTo(X(v[0]), Y(v[1]));
      else g.moveTo(X(v[0]), Y(v[1]));
    }
    g.closePath();
  }
}

/** The union of the pieces as a new path. */
function unionPath(g: Ctx, polys: V2[][]): void {
  g.beginPath();
  addPieces(g, polys);
}

/** The outline's edges as a new path (stroked as one shape, so overlapping caps never add up). */
function edgePath(g: Ctx, edges: [V2, V2][]): void {
  g.beginPath();
  for (const [p, q] of edges) {
    g.moveTo(X(p[0]), Y(p[1]));
    g.lineTo(X(q[0]), Y(q[1]));
  }
}

/** A lock's bounding box in albedo pixels, grown by ART.margin: [x, y, w, h]. */
function lockRect(l: Lock): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of l.target) {
    for (const v of p) {
      x0 = Math.min(x0, X(v[0]));
      x1 = Math.max(x1, X(v[0]));
      y0 = Math.min(y0, Y(v[1]));
      y1 = Math.max(y1, Y(v[1]));
    }
  }
  const m = ART.margin;
  return [x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m];
}

type Col = (a: number) => string;

/** The two stepped deco borders. */
function decoBorder(g: Ctx, col: Col): void {
  const S = ETCH_PX, s = ART.borderStep;
  for (const b of ART.border) {
    const x0 = b.inset, y0 = b.inset, x1 = S - b.inset, y1 = S - b.inset;
    g.strokeStyle = col(b.alpha);
    g.lineWidth = b.width;
    g.beginPath();
    g.moveTo(x0 + s, y0);
    g.lineTo(x1 - s, y0);
    g.lineTo(x1 - s, y0 + s / 2);
    g.lineTo(x1 - s / 2, y0 + s / 2);
    g.lineTo(x1 - s / 2, y0 + s);
    g.lineTo(x1, y0 + s);
    g.lineTo(x1, y1 - s);
    g.lineTo(x1 - s / 2, y1 - s);
    g.lineTo(x1 - s / 2, y1 - s / 2);
    g.lineTo(x1 - s, y1 - s / 2);
    g.lineTo(x1 - s, y1);
    g.lineTo(x0 + s, y1);
    g.lineTo(x0 + s, y1 - s / 2);
    g.lineTo(x0 + s / 2, y1 - s / 2);
    g.lineTo(x0 + s / 2, y1 - s);
    g.lineTo(x0, y1 - s);
    g.lineTo(x0, y0 + s);
    g.lineTo(x0 + s / 2, y0 + s);
    g.lineTo(x0 + s / 2, y0 + s / 2);
    g.lineTo(x0 + s, y0 + s / 2);
    g.closePath();
    g.stroke();
  }
}

/** A half sunburst fan with its arcs and baseline. */
function fanCrest(g: Ctx, col: Col, x: number, y: number, r: number, n: number, a: number): void {
  g.strokeStyle = col(a);
  g.lineWidth = 1.5;
  g.beginPath();
  for (let k = 0; k <= n; k++) {
    const t = Math.PI + (k / n) * Math.PI;
    g.moveTo(x + Math.cos(t) * r * 0.22, y + Math.sin(t) * r * 0.22);
    g.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
  }
  g.moveTo(x + r, y);
  g.arc(x, y, r, 0, Math.PI, true);
  g.moveTo(x + r * 0.22, y);
  g.arc(x, y, r * 0.22, 0, Math.PI, true);
  g.moveTo(x - r * 1.5, y);
  g.lineTo(x + r * 1.5, y);
  g.stroke();
}

/** Roman numeral n (1-3) as deco strokes: stems with serifs, centred on (x, y). */
function numeral(g: Ctx, col: Col, n: number, x: number, y: number): void {
  const h = ART.numeral.h, stem = 0.2 * h, serif = 0.62 * h, bar = 0.11 * h, gap = 0.1 * h;
  let x0 = x - (n * serif + (n - 1) * gap) / 2;
  g.fillStyle = col(1);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    g.rect(x0 + (serif - stem) / 2, y - h / 2, stem, h);
    g.rect(x0, y - h / 2, serif, bar);
    g.rect(x0, y + h / 2 - bar, serif, bar);
    x0 += serif + gap;
  }
  g.fill();
}

/** The sight rings' mark: a diamond, a dot and four ticks. */
function sightMark(g: Ctx, col: Col, m: V2): void {
  const M = ART.mark, S = ETCH_PX, x = X(m[0]), y = Y(m[1]), t = M.tip * S;
  g.strokeStyle = col(1);
  g.lineWidth = M.line;
  g.beginPath();
  g.moveTo(x, y - t);
  g.lineTo(x + t, y);
  g.lineTo(x, y + t);
  g.lineTo(x - t, y);
  g.closePath();
  g.stroke();
  g.lineWidth = M.tickLine;
  g.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    g.moveTo(x + dx * M.tick[0] * S, y + dy * M.tick[0] * S);
    g.lineTo(x + dx * M.tick[1] * S, y + dy * M.tick[1] * S);
  }
  g.stroke();
  g.fillStyle = col(1);
  g.beginPath();
  g.arc(x, y, M.dot * S, 0, Math.PI * 2);
  g.fill();
}

/** Where lock l's numeral goes (box units): see ART.numeral. */
function numeralAt(l: Lock, locks: readonly Lock[]): V2 {
  const N = ART.numeral;
  const spots = ([[-1, 1], [1, 1], [-1, -1], [1, -1]] as const).map(
    ([sx, sy]): V2 => [l.center[0] + sx * N.dx * l.size, l.center[1] + sy * N.dy * l.size],
  );
  const ok = (p: V2) =>
    Math.abs(p[0]) <= N.inside &&
    Math.abs(p[1]) <= N.inside &&
    locks.every((o) => !o.mark || Math.hypot(o.mark[0] - p[0], o.mark[1] - p[1]) >= N.clear);
  return spots.find(ok) ?? spots[0]!;
}

/** A hidden lock's half-width of reach from its centre (box units), for its dotted frame. */
function frameHalf(l: Lock): number {
  let h = 0;
  for (const p of l.target) for (const v of p) h = Math.max(h, Math.abs(v[0] - l.center[0]), Math.abs(v[1] - l.center[1]));
  return h + ART.dots.margin;
}

/** A dotted square round a hidden lock, small diamonds at its corners. */
function dottedFrame(g: Ctx, col: Col, l: Lock): void {
  const S = ETCH_PX, h = frameHalf(l), D = ART.dots, cx = l.center[0], cy = l.center[1];
  const n = Math.max(2, Math.round((2 * h) / D.gap));
  g.fillStyle = col(0.9);
  g.beginPath();
  for (let k = 1; k < n; k++) {
    const t = -h + (2 * h * k) / n;
    for (const [x, y] of [[cx + t, cy - h], [cx + t, cy + h], [cx - h, cy + t], [cx + h, cy + t]] as const) {
      g.moveTo(X(x) + D.r * S, Y(y));
      g.arc(X(x), Y(y), D.r * S, 0, Math.PI * 2);
    }
  }
  const r = D.r * S * 2;
  for (const [x, y] of [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]] as const) {
    g.moveTo(X(x), Y(y) - r);
    g.lineTo(X(x) + r, Y(y));
    g.lineTo(X(x), Y(y) + r);
    g.lineTo(X(x) - r, Y(y));
    g.closePath();
  }
  g.fill();
}

/**
 * A shown lock's etching: clean ivory with a whisper of gold inside, a gold-leaf inner line 8..10 px
 * inside the outline, the gold-leaf outline 0..4 px outside. Clipped to the lock, along the union's
 * boundary only, so seams between pieces are never etched.
 */
function etchOutline(g: Ctx, l: Lock, edges: [V2, V2][]): void {
  const gold = COLORS.etch, inside = mixHex(COLORS.panel, gold, ART.tint), [rx, ry, rw, rh] = lockRect(l);
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  // Inside: fill, then the 0..10 px band in gold, then 0..8 px back to the fill, leaving the 8..10 line.
  unionPath(g, l.target);
  g.clip();
  g.fillStyle = inside;
  g.fillRect(rx, ry, rw, rh);
  edgePath(g, edges);
  g.strokeStyle = rgba(gold, ART.innerAlpha);
  g.lineWidth = 2 * ART.inner[1];
  g.stroke();
  g.strokeStyle = inside;
  g.lineWidth = 2 * ART.inner[0];
  g.stroke();
  g.restore();
  // Outside: the lock's box less its shape, then the outline's 0..4 px band.
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.rect(rx, ry, rw, rh);
  addPieces(g, l.target);
  g.clip("evenodd");
  edgePath(g, edges);
  g.strokeStyle = gold;
  g.lineWidth = 2 * ART.outline;
  g.stroke();
  g.restore();
}

/**
 * The back panel's look: its two textures (etched once per box), its materials, and the per-lock
 * warmth and opening. `update(dt)` eases warmth and opening each frame and does one step of a new
 * box's etching (finishEtch does the rest at once); nothing allocates per frame.
 *
 * A new box's etching goes in small steps, one a frame: the frosted base (a quarter at a time), the
 * border, each lock's fan, numeral and mark, each lock's outline, the masks (each lock's in turn), the
 * glow's halo, and the uploads (masks and halo, then the albedo). The textures show the previous etching until the new one is uploaded, so a
 * half-drawn panel is never seen; a box transition can wait for `etched`.
 */
export class Panel {
  readonly uniforms = panelUniforms();
  /** For the panel plane. */
  readonly material: ShaderMaterial;
  /** For the shadow mesh (draw it after the panel). */
  readonly shadowMaterial: ShaderMaterial;
  private readonly base = surface(ETCH_PX);
  private readonly albedo = surface(ETCH_PX);
  private readonly masks = surface(MASK_PX);
  private readonly halo = surface(HALO_PX);
  private readonly albedoTex: CanvasTexture;
  private readonly masksTex: CanvasTexture;
  private readonly haloTex: CanvasTexture;
  private readonly warmTarget = new Float32Array(LOCKS);
  private readonly openTarget = new Float32Array(LOCKS);
  private steps: (() => void)[] = [];
  private stepAt = 0;

  constructor(anisotropy = PANEL_ANISOTROPY) {
    const m = panelMaterials(this.uniforms);
    this.material = m.panel;
    this.shadowMaterial = m.shadow;
    this.albedoTex = this.texture(this.albedo.c, anisotropy);
    this.masksTex = this.texture(this.masks.c, anisotropy);
    this.haloTex = this.texture(this.halo.c, 1);
    this.uniforms.uAlbedo.value = this.albedoTex;
    this.uniforms.uMasks.value = this.masksTex;
    this.uniforms.uHalo.value = this.haloTex;
    this.drawBase();
    // Until a box is etched the panel is plain frosted ivory (the textures' first upload).
    this.albedo.g.drawImage(this.base.c, 0, 0);
    this.masks.g.fillStyle = "#000";
    this.masks.g.fillRect(0, 0, MASK_PX, MASK_PX);
  }

  /** The last box's etching is done and queued for upload. */
  get etched(): boolean {
    return this.stepAt >= this.steps.length;
  }

  /** Steps the etching takes for the box set last. */
  get etchSteps(): number {
    return this.steps.length;
  }

  /** Do the next step of the etching; true while steps remain after it. */
  etchStep(): boolean {
    if (this.stepAt >= this.steps.length) return false;
    this.steps[this.stepAt++]!();
    return this.stepAt < this.steps.length;
  }

  /** Do every remaining step of the etching now (boot, tests). */
  finishEtch(): void {
    while (this.etchStep());
  }

  /** Start etching this box's locks (or none), and reset warmth and opening. Once per box. */
  setBox(box: Box | null): void {
    const u = this.uniforms, c = u.uLockCenter.value, s = u.uLockShape.value;
    c.fill(FAR);
    s.fill(1);
    for (const l of box?.locks ?? []) {
      if (l.i >= LOCKS) continue;
      c[l.i * 2] = l.center[0];
      c[l.i * 2 + 1] = l.center[1];
      s[l.i * 3] = l.size;
      s[l.i * 3 + 1] = frameHalf(l);
      s[l.i * 3 + 2] = l.hidden ? 1 : 0;
    }
    u.uWarmth.value.fill(0);
    u.uOpen.value.fill(0);
    this.warmTarget.fill(0);
    this.openTarget.fill(0);
    this.steps = this.etchPlan(box);
    this.stepAt = 0;
  }

  /** Where the lantern is (box units): its pool of light follows. */
  setLantern(L: V3): void {
    // Written field by field: no float crosses a call (Vector3.set would take three, boxed when not inlined).
    const u = this.uniforms.uLantern.value;
    u.x = L[0];
    u.y = L[1];
    u.z = L[2];
  }

  /** How warm lock `lock` is (0..1, unsmoothed); the glow eases toward it. */
  setWarmth(lock: number, w: number): void {
    if (lock >= 0 && lock < LOCKS) this.warmTarget[lock] = w > 0 ? (w < 1 ? w : 1) : 0;
  }

  /** Lock `lock` opened (its shape fills with gold), or closed again (a fresh box, a reset). */
  setOpen(lock: number, open = true): void {
    if (lock >= 0 && lock < LOCKS) this.openTarget[lock] = open ? 1 : 0;
  }

  /** Ease warmth (WARMTH_EASE_S) and opening (OPEN_FILL_S) by `dt` seconds, and do one step of etching. */
  update(dt: number): void {
    this.etchStep();
    const w = this.uniforms.uWarmth.value, o = this.uniforms.uOpen.value;
    const k = dt > 0 ? 1 - Math.exp(-dt / WARMTH_EASE_S) : 0, step = dt / OPEN_FILL_S;
    for (let i = 0; i < LOCKS; i++) {
      const tw = this.warmTarget[i]!, to = this.openTarget[i]!;
      w[i] = Math.abs(tw - w[i]!) < 1e-4 ? tw : w[i]! + (tw - w[i]!) * k;
      const oi = o[i]!;
      o[i] = oi < to ? Math.min(to, oi + step) : Math.max(to, oi - step);
    }
  }

  private texture(c: Canvas, anisotropy: number): CanvasTexture {
    const t = new CanvasTexture(c as HTMLCanvasElement);
    // The shader works in display values: no decoding.
    t.colorSpace = NoColorSpace;
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = anisotropy;
    return t;
  }

  /** Frosted ivory, drawn once: soft blotches, fine speckles and darker edges. */
  private drawBase(): void {
    const g = this.base.g, S = ETCH_PX, F = ART.frost, r = rng32(1234);
    g.fillStyle = COLORS.panel;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < F.blotches; i++) {
      const x = r() * S, y = r() * S, rad = 40 + r() * 160, dark = r() < 0.5;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, dark ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.05)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad);
    }
    for (let i = 0; i < F.speckles; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.04 + r() * 0.05})` : `rgba(0,0,0,${0.03 + r() * 0.04})`;
      g.fillRect(r() * S, r() * S, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    const w = F.edge, a = F.edgeAlpha;
    const sides: [number, number, number, number, number, number, number, number][] = [
      [0, 0, S, w, 0, 0, 0, w],
      [0, S - w, S, w, 0, S, 0, S - w],
      [0, 0, w, S, 0, 0, w, 0],
      [S - w, 0, w, S, S, 0, S - w, 0],
    ];
    for (const [x, y, ww, hh, x0, y0, x1, y1] of sides) {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, `rgba(0,0,0,${a})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x, y, ww, hh);
    }
  }

  /**
   * The steps that etch a box (or none): the albedo (base and border, then per lock its fan, numeral
   * and mark, then per lock its outline or dotted frame), the masks (red inside every outline, a crisp
   * green band along it), the green band's soft halo, then the masks' upload and the albedo's.
   */
  private etchPlan(box: Box | null): (() => void)[] {
    const S = ETCH_PX, gold = COLORS.etch, g = this.albedo.g, m = this.masks.g;
    const col: Col = (a) => rgba(gold, a);
    const locks = box?.locks ?? [];
    const edges = locks.map((l) => outlineEdges(l.target));
    const steps: (() => void)[] = [];
    // The frosted base, a quarter of its rows a step. It is opaque, so drawing it over replaces those rows
    // ("copy" would clear the rest of the canvas).
    for (let q = 0; q < 4; q++) {
      steps.push(() => {
        const y = (q * S) / 4, h = S / 4;
        g.globalCompositeOperation = "source-over";
        g.drawImage(this.base.c, 0, y, S, h, 0, y, S, h);
      });
    }
    steps.push(() => {
      decoBorder(g, col);
      const crestY = 0.5 - ART.crest.y / S;
      if (!locks.some((l) => l.mark && Math.hypot(l.mark[0], l.mark[1] - crestY) < ART.crest.clear)) {
        fanCrest(g, col, S / 2, ART.crest.y, ART.crest.r, ART.crest.rays, ART.crest.alpha);
      }
    });
    for (const l of locks) {
      steps.push(() => {
        // A faint fan and ring behind the lock, its numeral and its sight mark.
        const cx = X(l.center[0]), cy = Y(l.center[1]), R = l.size * S, F = ART.fan;
        g.strokeStyle = col(F.alpha);
        g.lineWidth = 1.6;
        g.beginPath();
        for (let r = 0; r < F.rays; r++) {
          const a = (r / F.rays) * Math.PI * 2;
          g.moveTo(cx + Math.cos(a) * R * F.r0, cy + Math.sin(a) * R * F.r0);
          g.lineTo(cx + Math.cos(a) * R * F.r1, cy + Math.sin(a) * R * F.r1);
        }
        g.stroke();
        g.strokeStyle = col(F.ringAlpha);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx, cy, R * F.ring, 0, Math.PI * 2);
        g.stroke();
        const at = numeralAt(l, locks);
        numeral(g, col, l.i + 1, X(at[0]), Y(at[1]));
        if (l.mark) sightMark(g, col, l.mark);
      });
    }
    locks.forEach((l, i) => steps.push(() => (l.hidden ? dottedFrame(g, col, l) : etchOutline(g, l, edges[i]!))));
    steps.push(() => {
      // The masks: black, then per lock (a step each) red inside its outline and a crisp green band along it.
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.globalCompositeOperation = "source-over";
      m.fillStyle = "#000";
      m.fillRect(0, 0, MASK_PX, MASK_PX);
    });
    locks.forEach((l, i) => {
      steps.push(() => {
        const k = MASK_PX / S;
        m.setTransform(k, 0, 0, k, 0, 0);
        m.globalCompositeOperation = "lighter";
        m.lineCap = "round";
        m.lineJoin = "round";
        m.fillStyle = "#ff0000";
        unionPath(m, l.target);
        m.fill();
        m.strokeStyle = "#00ff00";
        m.lineWidth = 2 * ART.glowBand;
        edgePath(m, edges[i]!);
        m.stroke();
        m.setTransform(1, 0, 0, 1, 0, 0);
      });
    });
    steps.push(() => {
      // The band's soft halo, blurred on its own small texture (a blur costs by area).
      const h = this.halo.g, k = HALO_PX / S;
      h.setTransform(1, 0, 0, 1, 0, 0);
      h.clearRect(0, 0, HALO_PX, HALO_PX);
      h.setTransform(k, 0, 0, k, 0, 0);
      h.lineCap = "round";
      h.lineJoin = "round";
      h.strokeStyle = "#00ff00";
      h.lineWidth = 2 * ART.glowBand;
      h.shadowColor = "#00ff00";
      h.shadowBlur = ART.glowBlur * k;
      for (const e of edges) {
        edgePath(h, e);
        h.stroke();
      }
    });
    // One upload a frame: the masks and halo first (unused until a lock warms or opens), then the albedo.
    steps.push(() => {
      this.masksTex.needsUpdate = true;
      this.haloTex.needsUpdate = true;
    });
    steps.push(() => {
      this.albedoTex.needsUpdate = true;
    });
    return steps;
  }
}
