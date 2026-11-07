// The lantern the player holds: a stepped octagonal deco lantern (gold fins and steps over an ivory
// glass core on a black lacquer foot), one point light at its core, and a soft glow sprite. Lives in
// the box root in box units, so it scales with the box. Brightness follows the hand (Task 11), a
// flare marks a grab and a ripple a settle. Two draw calls, ripple or not (the body in one mesh, the
// glow carrying the ripple's ring); one while it waits quiet in a lesson's cradle. No allocation per frame.
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  LinearFilter,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PointLight,
  RGBAFormat,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
} from "@iwsdk/core";
import type { V3 } from "../core/types";
import { clamp01, outCubic } from "./fx/ease";
import { FlashBudget } from "./fx/flash-budget";
import { LIGHT_BLEND } from "./light-blend";
import { mergeColored } from "./merge";
import { COLORS, LANTERN_GLOW, LIGHTS, MATERIALS } from "./theme";

/** The body's parts by vertex colour (linear): the lacquer foot, the gold, and the core's mask (blue: it glows). */
const LACQUER = new Color(COLORS.frame);
const GOLD = new Color(COLORS.metal);
const CORE_MASK = new Color(0, 0, 1);

/** A soft round glow (alpha falls from the middle), or a thin ring for the ripple. */
export function radialTexture(size: number, ring: boolean): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5, r = Math.hypot(dx, dy) * 2;
      let a: number;
      if (ring) a = Math.max(0, 1 - Math.abs(r - 0.85) / 0.1) * (r < 1 ? 1 : 0);
      else a = r >= 1 ? 0 : r < 0.18 ? 0.95 - r * 3.05 : r < 0.5 ? 0.4 - (r - 0.18) * 1.0 : 0.08 * (1 - (r - 0.5) / 0.5);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

const at = (g: BufferGeometry, x: number, y: number, z: number, ry = 0) => g.applyMatrix4(new Matrix4().makeRotationY(ry).setPosition(x, y, z));

export class LanternView {
  /** The lantern (box units); its origin is the light. */
  readonly group = new Group();
  readonly light: PointLight;
  private readonly glow: Sprite;
  /** The body's material: its emissive is the core's glow. */
  private readonly bodyMat: MeshStandardMaterial;
  /** The ripple's ring in the glow's shader: x the ring texture's scale in the sprite's uv, y its opacity (0: none). */
  private readonly ring = { value: new Vector2(0, 0) };
  private readonly coreColor = new Color(COLORS.lampCore);
  private readonly hotColor = new Color(COLORS.goldHot);
  private brightness = 0;
  /** Waiting in a lesson's cradle: no glow, no ripple (two draw calls the example needs more). */
  private quiet = false;
  private flareT = 1e9;
  private rippleT = 1e9;
  private sizeM = 0.24;
  /** Put away (a menu is up): its parts hidden, its light dark but still in the scene. */
  private shown = true;
  /** The parts that hide when it is put away (the glow and ripple follow it in apply, with the cradle's quiet). */
  private readonly parts: Object3D[];
  private readonly budget: FlashBudget;
  /** The budget is this view's own (it steps it), not the box's shared one. */
  private readonly ownBudget: boolean;

  /**
   * `mats`: the box's materials; the body takes the gold's environment (its warm studio) for its reflections, in a
   * material of its own (one program) that draws the foot, the gold and the core in one call. `budget`: the box's one
   * flash budget (its owner steps it), so flares and crystallises share the three-a-second cap; without one, a budget
   * of its own.
   */
  constructor(mats: { lacquer: Material; gold: Material }, budget?: FlashBudget) {
    this.budget = budget ?? new FlashBudget();
    this.ownBudget = !budget;
    this.group.name = "Lantern";
    // One body for the lacquer foot, the gold (a band on the foot, eight fins round the core, three steps, a spire
    // and the ring to hold it by) and the ivory glass core: one draw call. Its material tells the parts apart by
    // vertex colour: gold is metal, the core glows by itself (its colour is the body's emissive, so it brightens with
    // the hand), the foot is dark lacquer. It reflects the gold's warm studio, as the gold did.
    const gold: [BufferGeometry, Color][] = [[at(new CylinderGeometry(0.0525, 0.0525, 0.004, 8), 0, -0.06, 0), GOLD]];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      gold.push([at(new BoxGeometry(0.005, 0.118, 0.014), Math.cos(a) * 0.041, 0, Math.sin(a) * 0.041, -a), GOLD]);
    }
    for (const [r, y] of [[0.05, 0.064], [0.039, 0.078], [0.027, 0.092]] as const) gold.push([at(new CylinderGeometry(r, r, 0.014, 8), 0, y, 0), GOLD]);
    gold.push([at(new ConeGeometry(0.012, 0.045, 8), 0, 0.121, 0), GOLD], [at(new TorusGeometry(0.016, 0.0028, 6, 20), 0, 0.155, 0), GOLD]);
    const geometry = mergeColored([
      [at(new CylinderGeometry(0.052, 0.058, 0.026, 8), 0, -0.074, 0), LACQUER],
      ...gold,
      [new CylinderGeometry(0.039, 0.039, 0.112, 8), CORE_MASK],
    ]);
    const g = mats.gold as Partial<MeshStandardMaterial>;
    this.bodyMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: MATERIALS.gold.roughness,
      metalness: 1,
      envMap: g.envMap ?? null,
      envMapIntensity: g.envMapIntensity ?? 1,
      emissive: this.coreColor.clone(),
      emissiveIntensity: 1,
    });
    this.bodyMat.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader
        .replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * step( 0.5, vColor.b );")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - step( 0.5, vColor.b );")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= smoothstep( 0.18, 0.6, vColor.r );");
    };
    this.bodyMat.customProgramCacheKey = () => "sl-lantern-body";
    const body = new Mesh(geometry, this.bodyMat);
    body.name = "Lantern Body";
    // The glow, carrying the settle ripple's gold ring in the same sprite (one draw call, ripple or not).
    const glowMat = new SpriteMaterial({ map: radialTexture(64, false), color: COLORS.lamp, ...LIGHT_BLEND, depthWrite: false, transparent: true, toneMapped: false });
    const ringMap = radialTexture(64, true), ringColor = new Color(COLORS.gold), ring = this.ring;
    glowMat.onBeforeCompile = (s) => {
      s.uniforms.ringMap = { value: ringMap };
      s.uniforms.ringColor = { value: ringColor };
      s.uniforms.ring = ring;
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D ringMap;\nuniform vec3 ringColor;\nuniform vec2 ring;")
        .replace(
          "#include <map_fragment>",
          "#include <map_fragment>\nfloat ringA = ring.y > 0.0 ? texture2D( ringMap, 0.5 + ( vMapUv - 0.5 ) * ring.x ).a * ring.y : 0.0;",
        )
        // Added as the two light sprites were: each term in output colour (the XR target takes sRGB-encoded colour,
        // and the encoding is steep near black, so encoding the sum would brighten the faint halo several times).
        // Alpha 1: the light blend adds the colour as it is and leaves the page's alpha.
        .replace(
          "#include <colorspace_fragment>",
          "#include <colorspace_fragment>\n" +
            "gl_FragColor = vec4( gl_FragColor.rgb * gl_FragColor.a + linearToOutputTexel( vec4( ringColor, 1.0 ) ).rgb * ringA, 1.0 );",
        );
    };
    glowMat.customProgramCacheKey = () => "sl-lantern-glow";
    this.glow = new Sprite(glowMat);
    this.glow.name = "Lantern Glow";
    this.light = new PointLight(COLORS.lamp, LIGHTS.lantern.intensity, LIGHTS.lantern.range, LIGHTS.lantern.decay);
    this.group.add(body, this.glow, this.light);
    this.parts = [body];
    this.setBrightness(0);
  }

  /** The settle ripple's ring opacity now (0: no ripple); it is drawn in the glow's sprite. */
  get ringOpacity(): number {
    return this.ring.value.y;
  }

  /**
   * Shown, or put away while a menu is up. Put away, its parts hide but its light stays in the scene, dark: three
   * builds each lit shader for the number of visible lights, so hiding the light would make every lit material in the
   * box compile again the first time it showed lit after a menu, and the shaders compiled ahead (on the session's
   * first frame, home menu up) would not be the ones play uses.
   */
  setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    for (const p of this.parts) p.visible = shown;
    this.apply();
  }

  /** Where the lantern is, in box units. */
  setPos(p: V3): void {
    this.group.position.set(p[0], p[1], p[2]);
  }

  /** Where the lantern is, in box units, written into `out` (read every frame: no allocation). */
  getPos(out: V3): V3 {
    const p = this.group.position;
    out[0] = p.x;
    out[1] = p.y;
    out[2] = p.z;
    return out;
  }

  /** 0 (no hand near) to 1 (hand on it): the glow and core brighten; the light always lights the panel. */
  setBrightness(v: number): void {
    this.brightness = clamp01(v);
    this.apply();
  }

  /** Quiet (true) while it waits in a lesson's cradle: its glow and ripple are not drawn; the lantern itself is. */
  setQuiet(on: boolean): void {
    if (on === this.quiet) return;
    this.quiet = on;
    this.apply();
  }

  /** A short bloom (on grab). Never more than three flashes a second. */
  flare(): void {
    if (this.budget.take()) this.flareT = 0;
  }

  /** A gold ring spreads from the lantern and fades (on settle). */
  ripple(): void {
    this.rippleT = 0;
  }

  /** The box size in metres: the light keeps the same look at every size (its numbers are in box units). */
  setBoxSize(sizeM: number): void {
    this.sizeM = sizeM;
    this.apply();
  }

  /** Advance flare and ripple by `dt` seconds. */
  update(dt: number): void {
    if (this.ownBudget) this.budget.step(dt);
    const busy = this.flareT < LANTERN_GLOW.flareS || this.rippleT < LANTERN_GLOW.rippleS;
    if (!busy) return;
    this.flareT += dt;
    this.rippleT += dt;
    this.apply();
  }

  private apply(): void {
    const g = LANTERN_GLOW, b = this.brightness;
    const flare = this.flareT < g.flareS ? 1 - outCubic(this.flareT / g.flareS) : 0;
    const k = g.lightFloor + (1 - g.lightFloor) * b;
    // Physical point light: intensity scales with area (size squared), range with size. Dark while put away.
    this.light.intensity = this.shown ? LIGHTS.lantern.intensity * k * (1 + 0.3 * flare) * this.sizeM * this.sizeM : 0;
    this.light.distance = LIGHTS.lantern.range * this.sizeM;
    const s = g.size * (0.85 + 0.15 * b) * (1 + g.flareGain * flare);
    this.glow.scale.set(s, s, 1);
    (this.glow.material as SpriteMaterial).opacity = Math.min(1, g.opacity[0] + (g.opacity[1] - g.opacity[0]) * b + 0.4 * flare);
    // The glow and ripple show only while the lantern is shown (no menu has put it away) and not quiet in a cradle.
    this.glow.visible = this.shown && !this.quiet;
    this.bodyMat.emissive.copy(this.coreColor).lerp(this.hotColor, Math.min(1, 0.4 * b + flare));
    // The ring grows to 2 * rippleRadius across (always inside the glow's sprite) and fades: in the sprite's uv, the
    // ring texture is sampled this many times faster than the sprite is wide.
    const ring = this.ring.value;
    if (this.rippleT < g.rippleS && !this.quiet) {
      const q = this.rippleT / g.rippleS, r = 2 * g.rippleRadius * outCubic(q);
      ring.set(r > 1e-4 ? s / r : 0, r > 1e-4 ? 1 - q : 0);
    } else ring.set(0, 0);
  }
}
