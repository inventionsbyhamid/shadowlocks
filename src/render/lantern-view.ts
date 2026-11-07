// The lantern the player holds: a stepped octagonal deco lantern (gold fins and steps over an ivory
// glass core on a black lacquer foot), one point light at its core, and a soft glow sprite. Lives in
// the box root in box units, so it scales with the box. Brightness follows the hand (Task 11), a
// flare marks a grab and a ripple a settle. Four draw calls (five while a ripple runs); no allocation
// per frame.
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  LinearFilter,
  type Material,
  type Object3D,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  RGBAFormat,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  BoxGeometry,
} from "@iwsdk/core";
import type { V3 } from "../core/types";
import { clamp01, outCubic } from "./fx/ease";
import { FlashBudget } from "./fx/flash-budget";
import { grained } from "./lacquer";
import { LIGHT_BLEND } from "./light-blend";
import { mergeParts } from "./merge";
import { COLORS, LANTERN_GLOW, LIGHTS } from "./theme";

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
  private readonly rippleSprite: Sprite;
  private readonly core: MeshBasicMaterial;
  private readonly coreColor = new Color(COLORS.lampCore);
  private readonly hotColor = new Color(COLORS.goldHot);
  private brightness = 0;
  private flareT = 1e9;
  private rippleT = 1e9;
  private sizeM = 0.24;
  /** Put away (a menu is up): its parts hidden, its light dark but still in the scene. */
  private shown = true;
  /** The parts that hide when it is put away (the ripple follows its own timing). */
  private readonly parts: Object3D[];
  private readonly budget: FlashBudget;
  /** The budget is this view's own (it steps it), not the box's shared one. */
  private readonly ownBudget: boolean;

  /**
   * Built from the box's own lacquer and gold materials (one shader program each, shared with the frame and trim).
   * `budget`: the box's one flash budget (its owner steps it), so flares and crystallises share the three-a-second
   * cap; without one, a budget of its own.
   */
  constructor(mats: { lacquer: Material; gold: Material }, budget?: FlashBudget) {
    this.budget = budget ?? new FlashBudget();
    this.ownBudget = !budget;
    this.group.name = "Lantern";
    const { lacquer, gold } = mats;
    // Lacquer foot.
    // The frame's lacquer reads a grain direction from every mesh it draws: the foot's is zero (plain lacquer).
    const foot = new Mesh(grained(at(new CylinderGeometry(0.052, 0.058, 0.026, 8), 0, -0.074, 0), null), lacquer);
    // Gold: a band on the foot, eight fins round the core, three steps, a spire and the ring to hold it by.
    const parts: BufferGeometry[] = [at(new CylinderGeometry(0.0525, 0.0525, 0.004, 8), 0, -0.06, 0)];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      parts.push(at(new BoxGeometry(0.005, 0.118, 0.014), Math.cos(a) * 0.041, 0, Math.sin(a) * 0.041, -a));
    }
    for (const [r, y] of [[0.05, 0.064], [0.039, 0.078], [0.027, 0.092]] as const) parts.push(at(new CylinderGeometry(r, r, 0.014, 8), 0, y, 0));
    parts.push(at(new ConeGeometry(0.012, 0.045, 8), 0, 0.121, 0));
    parts.push(at(new TorusGeometry(0.016, 0.0028, 6, 20), 0, 0.155, 0));
    const fins = new Mesh(mergeParts(parts), gold);
    // The ivory glass core glows by itself.
    this.core = new MeshBasicMaterial({ color: this.coreColor.clone(), toneMapped: false });
    const core = new Mesh(new CylinderGeometry(0.039, 0.039, 0.112, 8), this.core);
    this.glow = new Sprite(
      new SpriteMaterial({ map: radialTexture(64, false), color: COLORS.lamp, ...LIGHT_BLEND, depthWrite: false, transparent: true, toneMapped: false }),
    );
    this.rippleSprite = new Sprite(
      new SpriteMaterial({ map: radialTexture(64, true), color: COLORS.gold, ...LIGHT_BLEND, depthWrite: false, transparent: true, toneMapped: false }),
    );
    this.rippleSprite.visible = false;
    this.light = new PointLight(COLORS.lamp, LIGHTS.lantern.intensity, LIGHTS.lantern.range, LIGHTS.lantern.decay);
    foot.name = "Lantern Foot";
    fins.name = "Lantern Gold";
    core.name = "Lantern Core";
    this.glow.name = "Lantern Glow";
    this.rippleSprite.name = "Lantern Ripple";
    this.group.add(foot, fins, core, this.glow, this.rippleSprite, this.light);
    this.parts = [foot, fins, core, this.glow];
    this.setBrightness(0);
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
    this.core.color.copy(this.coreColor).lerp(this.hotColor, Math.min(1, 0.4 * b + flare));
    const ripple = this.rippleT < g.rippleS;
    this.rippleSprite.visible = ripple && this.shown;
    if (ripple) {
      const q = this.rippleT / g.rippleS, r = 2 * g.rippleRadius * outCubic(q);
      this.rippleSprite.scale.set(r, r, 1);
      (this.rippleSprite.material as SpriteMaterial).opacity = 1 - q;
    }
  }
}
