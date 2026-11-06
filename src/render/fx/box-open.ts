// The box opening (every lock open): the biggest sunburst fills the panel and a ring of gold light sweeps out from the
// box (one flash; the room's light coming back up is the theatre's, on the `box-open` event), then the glass walls
// and lid hinge open at their back edges and a brass drawer slides out of the plinth on the side away from the
// lantern, where the reward rises (render/reward.ts). Timed with the sound's box opening (scheduleBoxOpen): walls at
// +0.7 s, drawer at +1.3 s, the reward with the tune at +1.7 s. Reduced motion: the light fades in place (no sweep, no
// growth); the walls and drawer still move, slowly. Lives in the box root (box units); `reset` closes everything for
// the next box. While running: five draw calls (burst, sweep, three panes; the box's side glass and smoked lid hide)
// plus the drawer. The hinged lid wears the smoked lid's look and fades as it lifts, so it never stands upright
// behind the plate as a dark pane.
// Per frame it allocates nothing.
import {
  BoxGeometry,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  RingGeometry,
} from "@iwsdk/core";
import type { V3 } from "../../core/types";
import { LIGHT_BLEND } from "../light-blend";
import { COLORS } from "../theme";
import { clamp01, inOutCubic, outCubic, smoothstep } from "./ease";
import type { FlashBudget } from "./flash-budget";
import { sunburstGeometry } from "./lock-open";

export const BOX_OPEN_FX = {
  /** The panel's sunburst and the sweep (s). */
  lightS: 1.6,
  burstRays: 32,
  burstReach: 0.78,
  burstPeak: 0.9,
  /** The sweep ring grows from this scale to this one (box units) as it fades. */
  sweepFrom: 0.25,
  sweepTo: 2.6,
  sweepPeak: 0.7,
  /** The walls and lid start to hinge at this time, over this long, to this angle (radians). */
  wallsAtS: 0.7,
  wallsS: 0.9,
  wallAngle: (100 * Math.PI) / 180,
  /** The drawer slides out at this time, over this long, this far (box units). */
  drawerAtS: 1.3,
  drawerS: 0.6,
  drawerOut: 0.55,
  /** Reduced motion: the walls and drawer take this much longer. */
  reducedSlow: 1.5,
  /** The lid fades out between these shares of its swing (gone well before it stands upright behind the plate). */
  lidFade: [0.15, 0.7] as const,
  /** Half strength when the flash budget refuses. */
  refused: 0.5,
} as const;

/** The glass panes: side (1 - frame bar) and the lid's height, as the box scene builds them. */
const PANE = 0.95;
const LID_Y = 0.49;
/** The drawer: size, its height (the plinth's centre), and its centre's z closed (inside the plinth). */
const DRAWER = { w: 0.42, h: 0.07, d: 0.5, y: -0.585, z: 0.72 } as const;
/** The drawer sits this far from the box centre, toward the side away from the lantern. */
export const DRAWER_X = 0.22;

export class BoxOpenFx {
  readonly group = new Group();
  private readonly burst: Mesh;
  private readonly burstMat: MeshBasicMaterial;
  private readonly sweep: Mesh;
  private readonly sweepMat: MeshBasicMaterial;
  private readonly left = new Group();
  private readonly right = new Group();
  private readonly lid = new Group();
  private readonly drawer: Mesh;
  private readonly glass: Object3D | null;
  private readonly lidGlass: Object3D | null;
  private readonly lidMat: Material;
  private readonly lidOpacity: number;
  private t = 1e9;
  private strength = 1;
  private side = 1;

  constructor(root: Object3D, private readonly budget: FlashBudget) {
    this.group.name = "Box Open";
    this.burstMat = new MeshBasicMaterial({
      color: COLORS.gold,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      ...LIGHT_BLEND,
      depthWrite: false,
      toneMapped: false,
    });
    this.burst =new Mesh(sunburstGeometry(BOX_OPEN_FX.burstRays, 0.3, 0.1), this.burstMat);
    this.burst.name = "Box Burst";
    this.burst.position.set(0, 0, 0.005);
    this.burst.renderOrder = 3;
    this.sweepMat = new MeshBasicMaterial({
      color: COLORS.goldHot,
      transparent: true,
      opacity: 0,
      ...LIGHT_BLEND,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    this.sweep = new Mesh(new RingGeometry(0.9, 1, 64), this.sweepMat);
    this.sweep.name = "Box Sweep";
    this.sweep.position.set(0, 0, 0.012);
    this.sweep.renderOrder = 3;
    // The walls share the side glass's material (one program); the box's own glass and lid hide while they show. The
    // hinged lid takes the smoked lid's look on a copy of its material, so it can fade as it lifts: swung open it
    // would stand behind the plate as a large dark pane.
    this.glass = root.getObjectByName("Box Glass") ?? null;
    this.lidGlass = root.getObjectByName("Box Lid") ?? null;
    const glassMat = ((this.glass as Mesh | null)?.material as Material | undefined) ?? new MeshBasicMaterial({ color: COLORS.glass, transparent: true, opacity: 0.11 });
    const lidMat = ((this.lidGlass as Mesh | null)?.material as Material | undefined)?.clone() ?? glassMat.clone();
    this.lidMat = lidMat;
    this.lidOpacity = lidMat.opacity;
    const pane = (name: string, rx: number, ry: number, mat: Material) => {
      const m = new Mesh(new PlaneGeometry(PANE, PANE), mat);
      m.name = name;
      m.position.set(0, 0, 0.5);
      m.rotation.set(rx, ry, 0);
      m.renderOrder = 2;
      return m;
    };
    this.left.position.set(-0.5, 0, 0);
    this.left.add(pane("Box Wall Left", 0, Math.PI / 2, glassMat));
    this.right.position.set(0.5, 0, 0);
    this.right.add(pane("Box Wall Right", 0, -Math.PI / 2, glassMat));
    this.lid.position.set(0, LID_Y, 0);
    this.lid.add(pane("Box Lid Open", Math.PI / 2, 0, lidMat));
    const trim = root.getObjectByName("Box Trim") as Mesh | undefined;
    const brass = (trim?.material as Material | undefined) ?? new MeshBasicMaterial({ color: COLORS.metal });
    this.drawer = new Mesh(new BoxGeometry(DRAWER.w, DRAWER.h, DRAWER.d), brass);
    this.drawer.name = "Box Drawer";
    this.group.add(this.burst, this.sweep, this.left, this.right, this.lid, this.drawer);
    root.add(this.group);
    this.reset();
  }

  /** Everything closed and put away (a new box). */
  reset(): void {
    this.t = 1e9;
    this.group.visible = false;
    if (this.glass) this.glass.visible = true;
    if (this.lidGlass) this.lidGlass.visible = true;
    this.left.rotation.y = 0;
    this.right.rotation.y = 0;
    this.lid.rotation.x = 0;
    this.lid.visible = true;
    this.lidMat.opacity = this.lidOpacity;
  }

  /** The box opens; the drawer comes out on side `side` (+1 right, -1 left). */
  start(side: number): void {
    this.side = side < 0 ? -1 : 1;
    this.strength = this.budget.take() ? 1 : BOX_OPEN_FX.refused;
    this.t = 0;
    this.group.visible = true;
    if (this.glass) this.glass.visible = false;
    if (this.lidGlass) this.lidGlass.visible = false;
    this.apply(false);
  }

  /** Where the open drawer's top middle is (box units): the reward rises from there. */
  drawerTop(out: V3): V3 {
    out[0] = this.side * DRAWER_X;
    out[1] = DRAWER.y + DRAWER.h / 2;
    out[2] = DRAWER.z + BOX_OPEN_FX.drawerOut;
    return out;
  }

  get running(): boolean {
    return this.group.visible;
  }

  /** Advance by `dt` seconds. */
  update(dt: number, reduced: boolean): void {
    if (!this.group.visible) return;
    const F = BOX_OPEN_FX, end = (F.drawerAtS + F.drawerS) * F.reducedSlow;
    if (this.t > end && this.t > F.lightS) return;
    this.t += dt > 0 ? dt : 0;
    this.apply(reduced);
  }

  private apply(reduced: boolean): void {
    const F = BOX_OPEN_FX, t = this.t, s = this.strength;
    // The light: in quickly, out slowly; the sweep grows past the box as it fades.
    const k = clamp01(t / F.lightS);
    const env = k < 0.12 ? k / 0.12 : 1 - outCubic((k - 0.12) / 0.88);
    this.burst.visible = k < 1;
    this.burstMat.opacity = F.burstPeak * s * env;
    const b = F.burstReach * (reduced ? 1 : 0.6 + 0.4 * outCubic(k));
    this.burst.scale.set(b, b, 1);
    this.sweep.visible = !reduced && k < 1;
    this.sweepMat.opacity = F.sweepPeak * s * (1 - k);
    const r = F.sweepFrom + (F.sweepTo - F.sweepFrom) * outCubic(k);
    this.sweep.scale.set(r, r, 1);
    // The walls and lid swing out at their back edges; the drawer slides toward the player.
    const slow = reduced ? F.reducedSlow : 1;
    const swing = inOutCubic(clamp01((t - F.wallsAtS) / (F.wallsS * slow))), w = swing * F.wallAngle;
    this.left.rotation.y = -w;
    this.right.rotation.y = w;
    this.lid.rotation.x = -w;
    // The lid lifts away: it fades as it swings, gone before it would stand upright behind the plate.
    const lidFade = 1 - smoothstep(F.lidFade[0], F.lidFade[1], swing);
    this.lidMat.opacity = this.lidOpacity * lidFade;
    this.lid.visible = lidFade > 0;
    const d = outCubic(clamp01((t - F.drawerAtS) / (F.drawerS * slow)));
    this.drawer.visible = t >= F.drawerAtS;
    this.drawer.position.set(this.side * DRAWER_X, DRAWER.y, DRAWER.z + F.drawerOut * d);
  }
}
