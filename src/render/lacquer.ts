// The frame's lacquer grain (the owner's pick: lacquer #1c191d with grain #2a2529): fine, faintly wavy streaks along
// each bar, as the lookdev's ebony had from its wood map: light ones toward the grain tone, dark ones below the
// lacquer, and the base layer's sheen following them (on a gloss black the grain reads in the reflections more than
// in the colour). The frame has no UVs (merged extrusions), so each part carries the direction its grain runs as a
// vertex attribute (`grain`, a unit axis; zero for none) and the lacquer's own shader draws the streaks: no texture,
// no extra draw call, a few noise lookups a fragment on the frame. The streaks fade out as they near a pixel's width,
// so the frame never shimmers in the headset. Every mesh drawn with this lacquer carries the attribute (today the
// frame alone; a plain part would carry a zero one, `grained(g, null)`, rather than lean on the GL's default attribute
// values). The lantern's foot is plain, in the lantern body's own material; the menu drawer's front takes the grain
// into its own material (grainShader).
import { BufferAttribute, type BufferGeometry, Color, type MeshPhysicalMaterial } from "@iwsdk/core";
import { COLORS } from "./theme";

export const LACQUER_GRAIN = {
  /** Streaks per box unit across a bar (about 3.5 mm apart on a 24 cm box). */
  streaksPerUnit: 70,
  /** How far the lightest streak goes toward the grain tone (1: all the way). */
  strength: 1,
  /** The darkest streak: the lacquer times this (the lookdev's ebony had dark lines as well as light). */
  dark: 0.55,
  /**
   * The base layer's roughness changes this much across the streaks (light ones glossier, dark ones duller), so the
   * grain shows a little in the lacquer's sheen; small, so the speculars never shimmer at grazing angles. The
   * clearcoat above stays mirror smooth.
   */
  roughness: 0.08,
} as const;

/** `g` with its grain running along `axis` (null: no grain), as the `grain` attribute mergeParts can keep. */
export function grained(g: BufferGeometry, axis: "x" | "y" | "z" | null): BufferGeometry {
  const n = g.getAttribute("position").count, a = new Float32Array(n * 3);
  const k = axis === "x" ? 0 : axis === "y" ? 1 : axis === "z" ? 2 : -1;
  if (k >= 0) for (let i = 0; i < n; i++) a[i * 3 + k] = 1;
  g.setAttribute("grain", new BufferAttribute(a, 3));
  return g;
}

const GLSL = /* glsl */ `
uniform vec3 grainColor;
varying vec3 vGrainAxis;
varying vec3 vGrainPos;
float grainHash(float n) { return fract(sin(n) * 43758.5453123); }
float grainNoise(float x) {
  float i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(grainHash(i), grainHash(i + 1.0), f);
}
// The grain here, -1 (a dark streak) to 1 (a light one), in soft-edged bands: streaks along the axis, wavering slowly
// along it, fading to 0 as they near a pixel's width.
float lacquerGrain(vec3 p, vec3 axis) {
  float along = dot(p, axis);
  vec3 q = p - axis * along;
  float w = (q.x + q.y + q.z) * ${LACQUER_GRAIN.streaksPerUnit.toFixed(1)} + grainNoise(along * 6.0) * 2.0 + grainNoise(along * 23.0) * 0.5;
  // The derivative before any branch: derivatives are undefined in non-uniform control flow.
  float fine = 1.0 - smoothstep(0.25, 0.75, fwidth(w));
  if (dot(axis, axis) < 0.5) return 0.0;
  float s = smoothstep(0.25, 0.75, grainNoise(w)) * 2.0 - 1.0;
  return s * fine;
}
vec3 lacquerTone(vec3 base, float k) {
  return k > 0.0 ? mix(base, grainColor, k * ${LACQUER_GRAIN.strength.toFixed(2)}) : base * (1.0 + k * ${(1 - LACQUER_GRAIN.dark).toFixed(2)});
}
`;

const GRAIN_COLOR = new Color(COLORS.frameGrain);

/** A shader as onBeforeCompile receives it (the parts the grain touches). */
export interface GrainShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

/**
 * The grain spliced into a lit (standard or physical) shader in onBeforeCompile: every material with the lacquer's
 * look takes it from here (the frame through withGrain, the menu drawer in its own hook).
 */
export function grainShader(s: GrainShader): void {
  s.uniforms.grainColor = { value: GRAIN_COLOR };
  s.vertexShader = s.vertexShader
    .replace("#include <common>", "#include <common>\nattribute vec3 grain;\nvarying vec3 vGrainAxis;\nvarying vec3 vGrainPos;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGrainAxis = grain;\nvGrainPos = position;");
  s.fragmentShader = s.fragmentShader
    .replace("#include <common>", `#include <common>\n${GLSL}`)
    .replace(
      "#include <color_fragment>",
      "#include <color_fragment>\nfloat grainK = lacquerGrain(vGrainPos, vGrainAxis);\ndiffuseColor.rgb = lacquerTone(diffuseColor.rgb, grainK);",
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor - grainK * ${LACQUER_GRAIN.roughness.toFixed(2)}, 0.04, 1.0);`,
    );
}

/** `m` (the frame's lacquer) drawing its grain. Call once, when the material is made. */
export function withGrain(m: MeshPhysicalMaterial): MeshPhysicalMaterial {
  m.onBeforeCompile = (s) => grainShader(s);
  m.customProgramCacheKey = () => "sl-lacquer-grain";
  return m;
}
