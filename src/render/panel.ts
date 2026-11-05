// The frosted ivory back panel: the lantern's pool of light, the shadows on it, and the gold-leaf
// etching (Ebony and Gold). One shader, two materials sharing its uniforms: the panel plane (no
// shadow) and the shadow mesh (shadow strength per vertex), drawn after the panel with MIN blending.
// Shadow only ever darkens the panel, so the darker fragment is always the stronger shadow: where
// shadows overlap the panel shows the strongest one, never two multiplied, and a soft skirt over a
// neighbour's solid interior changes nothing.
//
// The etching is drawn once per box on two canvases: the albedo (frosted ivory, outlines, numerals,
// sight marks, the deco border) and three masks (red: inside every outline, for the open lock's gold
// fill; green: a glowing band round every outline, for warmth and opening; blue: the gold lines,
// which glint even in shadow). Warmth and opening are per lock: the shader picks the lock whose
// centre is nearest (locks sit far apart). A hidden lock's warmth lights its dotted frame instead of
// its outline, which would give the shape away.
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

/** Etch canvas size: the panel's 1 x 1 box units. */
export const ETCH_PX = 1024;
/** Warmth eases toward its target with this time constant (s), so the glow never flickers. */
export const WARMTH_EASE_S = 0.12;
/** An opening lock's gold fill comes up over this long (s). */
export const OPEN_FILL_S = 0.4;
/** Locks the shader knows about. */
const LOCKS = 3;
/** Where an absent lock's centre goes: never the nearest. */
const FAR = 1e3;

/**
 * The etching, from the lookdev's Ebony panel: sizes in canvas pixels at ETCH_PX (1 px = 1/1024 of
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
  /** The warmth and opening glow: a band 0..6 px outside the outline, and its blur. */
  glowBand: 6,
  glowBlur: 34,
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

/** Display-space RGB of a #rrggbb colour (no colour management: the shader works in display values). */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const vec3 = (hex: string) => new Vector3(...rgb(hex));
const glsl3 = ([r, g, b]: readonly number[]) => `vec3(${r!.toFixed(4)}, ${g!.toFixed(4)}, ${b!.toFixed(4)})`;

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
${foilGlsl()}
void main() {
#ifdef SHADOW
  // Shadows fall on the panel only.
  if (abs(vP.x) > 0.5 || abs(vP.y) > 0.5) discard;
  float cov = smoothstep(0.0, 1.0, vCov);
#else
  float cov = 0.0;
#endif
  vec2 uv = vP + 0.5;
  vec3 albedo = texture2D(uAlbedo, uv).rgb;
  vec3 m = texture2D(uMasks, uv).rgb;
  // The lantern's pool: inverse square and cosine falloff, gathered toward the spot under it.
  vec2 d = vP - uLantern.xy;
  float r2 = dot(d, d), z2 = uLantern.z * uLantern.z, q = z2 / (r2 + z2);
  float E = q * sqrt(q) * (1.0 - uPool.x + uPool.x * exp(-r2 * uPool.y));
  vec3 light = 1.0 - exp(-uPool.z * E * uLit);
  vec3 c = albedo * (uAmbient + light * (1.0 - uPool.w * cov)) + uSheen * m.b * uEtch;
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
  float glow = mix(m.g, m.b * inFrame, sh.z);
  c += clamp(1.2 * w, 0.0, 1.0) * glow * uGold;
  // Open: banded gold foil fills the shape and its outline burns bright.
  if (o > 0.0) {
    float f = m.r * o;
    c = mix(c, foil(0.5 + (rel.x - rel.y) / (2.2 * sh.x)), 0.5 * f);
    c *= mix(vec3(1.0), albedo, 0.85 * f);
    c += 0.55 * o * m.g * uGoldHot;
  }
  gl_FragColor = sRGBTransferEOTF(vec4(clamp(c, 0.0, 1.0), 1.0));
  #include <colorspace_fragment>
}
`;

export interface PanelUniforms {
  [name: string]: { value: unknown };
  uAlbedo: { value: Texture | null };
  uMasks: { value: Texture | null };
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

function surface(): Surface {
  const S = ETCH_PX;
  const c: Canvas = typeof document !== "undefined" ? Object.assign(document.createElement("canvas"), { width: S, height: S }) : new OffscreenCanvas(S, S);
  const g = c.getContext("2d") as Ctx | null;
  if (!g) throw new Error("panel: no 2D canvas");
  return { c, g };
}

/** Panel box units to canvas pixels (y down). */
const X = (x: number) => (x + 0.5) * ETCH_PX;
const Y = (y: number) => (0.5 - y) * ETCH_PX;
const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
};
const signedArea = (p: V2[]) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!, r = p[(i + 1) % p.length]!;
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a;
};

/** Every piece as a subpath wound the same way, so a nonzero fill is their union, seams and all. */
function unionPath(g: Ctx, polys: V2[][]): void {
  g.beginPath();
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

/** One pen: where it draws, how (an opaque colour on the albedo, a channel added on the masks), in what colour. */
interface Pen {
  g: Ctx;
  op: GlobalCompositeOperation;
  col: (a: number) => string;
}

/** The two stepped deco borders. */
function decoBorder(p: Pen): void {
  const S = ETCH_PX, s = ART.borderStep, g = p.g;
  for (const b of ART.border) {
    const x0 = b.inset, y0 = b.inset, x1 = S - b.inset, y1 = S - b.inset;
    g.strokeStyle = p.col(b.alpha);
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
function fanCrest(p: Pen, x: number, y: number, r: number, n: number, a: number): void {
  const g = p.g;
  g.strokeStyle = p.col(a);
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
function numeral(p: Pen, n: number, x: number, y: number): void {
  const g = p.g, h = ART.numeral.h, stem = 0.2 * h, serif = 0.62 * h, bar = 0.11 * h, gap = 0.1 * h;
  let x0 = x - (n * serif + (n - 1) * gap) / 2;
  g.fillStyle = p.col(1);
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
function sightMark(p: Pen, m: V2): void {
  const g = p.g, M = ART.mark, S = ETCH_PX, x = X(m[0]), y = Y(m[1]), t = M.tip * S;
  g.strokeStyle = p.col(1);
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
  g.fillStyle = p.col(1);
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
function dottedFrame(p: Pen, l: Lock): void {
  const g = p.g, S = ETCH_PX, h = frameHalf(l), D = ART.dots, cx = l.center[0], cy = l.center[1];
  const n = Math.max(2, Math.round((2 * h) / D.gap));
  g.fillStyle = p.col(0.9);
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
 * The back panel's look: its two textures (drawn once per box), its materials, and the per-lock
 * warmth and opening. `update(dt)` eases warmth and opening each frame; nothing allocates per frame.
 */
export class Panel {
  readonly uniforms = panelUniforms();
  /** For the panel plane. */
  readonly material: ShaderMaterial;
  /** For the shadow mesh (draw it after the panel). */
  readonly shadowMaterial: ShaderMaterial;
  private readonly base = surface();
  private readonly albedo = surface();
  private readonly masks = surface();
  private readonly scratch = surface();
  private readonly tint = surface();
  private readonly albedoTex: CanvasTexture;
  private readonly masksTex: CanvasTexture;
  private readonly warmTarget = new Float32Array(LOCKS);
  private readonly openTarget = new Float32Array(LOCKS);

  constructor(anisotropy = 4) {
    const m = panelMaterials(this.uniforms);
    this.material = m.panel;
    this.shadowMaterial = m.shadow;
    this.albedoTex = this.texture(this.albedo.c, anisotropy);
    this.masksTex = this.texture(this.masks.c, anisotropy);
    this.uniforms.uAlbedo.value = this.albedoTex;
    this.uniforms.uMasks.value = this.masksTex;
    this.drawBase();
    this.setBox(null);
  }

  /** Etch this box's locks (or none) and reset warmth and opening. Once per box. */
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
    this.etch(box);
    this.albedoTex.needsUpdate = true;
    this.masksTex.needsUpdate = true;
  }

  /** Where the lantern is (box units): its pool of light follows. */
  setLantern(L: V3): void {
    this.uniforms.uLantern.value.set(L[0], L[1], L[2]);
  }

  /** How warm lock `lock` is (0..1, unsmoothed); the glow eases toward it. */
  setWarmth(lock: number, w: number): void {
    if (lock >= 0 && lock < LOCKS) this.warmTarget[lock] = w > 0 ? (w < 1 ? w : 1) : 0;
  }

  /** Lock `lock` opened (its shape fills with gold), or closed again (a fresh box, a reset). */
  setOpen(lock: number, open = true): void {
    if (lock >= 0 && lock < LOCKS) this.openTarget[lock] = open ? 1 : 0;
  }

  /** Ease warmth (WARMTH_EASE_S) and opening (OPEN_FILL_S) by `dt` seconds. */
  update(dt: number): void {
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

  /** A white band `a`..`b` px outside (or inside) the outline of `polys`, into the scratch canvas. */
  private band(polys: V2[][], edges: [V2, V2][], a: number, b: number, inside: boolean): Canvas {
    const s = this.scratch.g, S = ETCH_PX;
    s.save();
    s.globalCompositeOperation = "source-over";
    s.clearRect(0, 0, S, S);
    s.lineCap = "round";
    s.lineJoin = "round";
    s.strokeStyle = "#fff";
    s.fillStyle = "#fff";
    s.beginPath();
    for (const [p, q] of edges) {
      s.moveTo(X(p[0]), Y(p[1]));
      s.lineTo(X(q[0]), Y(q[1]));
    }
    s.lineWidth = 2 * b;
    s.stroke();
    if (a > 0) {
      s.globalCompositeOperation = "destination-out";
      s.lineWidth = 2 * a;
      s.stroke();
    }
    s.globalCompositeOperation = inside ? "destination-in" : "destination-out";
    unionPath(s, polys);
    s.fill();
    s.restore();
    return this.scratch.c;
  }

  /** Draw a white mask onto a pen's canvas in `color` (optionally with a soft glow of `blur` px). */
  private stamp(p: Pen, mask: Canvas, color: string, blur = 0): void {
    const t = this.tint.g, S = ETCH_PX;
    t.save();
    t.globalCompositeOperation = "copy";
    t.drawImage(mask, 0, 0);
    t.globalCompositeOperation = "source-in";
    t.fillStyle = color;
    t.fillRect(0, 0, S, S);
    t.restore();
    p.g.save();
    p.g.globalCompositeOperation = p.op;
    if (blur > 0) {
      p.g.shadowColor = color;
      p.g.shadowBlur = blur;
    }
    p.g.drawImage(this.tint.c, 0, 0);
    p.g.restore();
  }

  /** The box's etching onto the albedo and the masks. */
  private etch(box: Box | null): void {
    const S = ETCH_PX, gold = COLORS.etch, g = this.albedo.g, m = this.masks.g;
    g.globalCompositeOperation = "copy";
    g.drawImage(this.base.c, 0, 0);
    g.globalCompositeOperation = "source-over";
    m.globalCompositeOperation = "copy";
    m.fillStyle = "#000";
    m.fillRect(0, 0, S, S);
    m.globalCompositeOperation = "lighter";
    // The gold lines go on the albedo and, as glints that show in shadow, on the masks' blue channel.
    const leaf: Pen = { g, op: "source-over", col: (a) => rgba(gold, a) };
    const sheen: Pen = { g: m, op: "lighter", col: (a) => `rgba(0,0,255,${a})` };
    const both = (draw: (p: Pen) => void) => {
      for (const p of [leaf, sheen]) {
        p.g.save();
        p.g.globalCompositeOperation = p.op;
        draw(p);
        p.g.restore();
      }
    };
    both(decoBorder);
    const locks = box?.locks ?? [];
    const crestX = 0, crestY = 0.5 - ART.crest.y / S;
    if (!locks.some((l) => l.mark && Math.hypot(l.mark[0] - crestX, l.mark[1] - crestY) < ART.crest.clear)) {
      both((p) => fanCrest(p, S / 2, ART.crest.y, ART.crest.r, ART.crest.rays, ART.crest.alpha));
    }
    for (const l of locks) {
      const edges = outlineEdges(l.target), cx = X(l.center[0]), cy = Y(l.center[1]), R = l.size * S, F = ART.fan;
      // A faint fan and ring behind the lock (the albedo only).
      g.save();
      g.strokeStyle = rgba(gold, F.alpha);
      g.lineWidth = 1.6;
      g.beginPath();
      for (let k = 0; k < F.rays; k++) {
        const a = (k / F.rays) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a) * R * F.r0, cy + Math.sin(a) * R * F.r0);
        g.lineTo(cx + Math.cos(a) * R * F.r1, cy + Math.sin(a) * R * F.r1);
      }
      g.stroke();
      g.strokeStyle = rgba(gold, F.ringAlpha);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, R * F.ring, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      if (l.hidden) {
        both((p) => dottedFrame(p, l));
      } else {
        // Clean ivory inside the outline with a whisper of gold, the gold-leaf outline and its inner line.
        g.save();
        unionPath(g, l.target);
        g.fillStyle = COLORS.panel;
        g.fill();
        g.fillStyle = rgba(gold, ART.tint);
        g.fill();
        g.restore();
        const outer = this.band(l.target, edges, 0, ART.outline, false);
        this.stamp(leaf, outer, rgba(gold, 1));
        this.stamp(sheen, outer, "rgba(0,0,255,1)");
        const inner = this.band(l.target, edges, ART.inner[0], ART.inner[1], true);
        this.stamp(leaf, inner, rgba(gold, ART.innerAlpha));
        this.stamp(sheen, inner, `rgba(0,0,255,${ART.innerAlpha})`);
      }
      const at = numeralAt(l, locks);
      both((p) => numeral(p, l.i + 1, X(at[0]), Y(at[1])));
      if (l.mark) {
        const mk = l.mark;
        both((p) => sightMark(p, mk));
      }
      // Masks: red inside the outline, green the glowing band round it.
      m.save();
      m.globalCompositeOperation = "lighter";
      m.fillStyle = "#ff0000";
      unionPath(m, l.target);
      m.fill();
      m.restore();
      const glow = this.band(l.target, edges, 0, ART.glowBand, false);
      this.stamp({ g: m, op: "lighter", col: () => "#00ff00" }, glow, "#00ff00", ART.glowBlur);
    }
  }
}
