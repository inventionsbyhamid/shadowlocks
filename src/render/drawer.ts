// The menu drawer in the front of the box's plinth: a black lacquer front with a gold-leaf inlay and
// a gold bar pull, and behind it a short velvet-lined drawer that shows as it slides out. One mesh,
// one draw call (vertex colours; the gold glows when a hand comes near, as the lantern does, so the
// handle says "pinch here"). The lacquer is the plinth's: its clearcoat and its grain (lacquer.ts). It lives in box units under the box root, so it follows the placement
// and the box size. The menu panels stand on its front edge when it is open (DRAWER_PANEL_ANCHOR).
// Per frame it allocates nothing.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshPhysicalMaterial,
  type Object3D,
  type Texture,
  type Vector3,
} from "@iwsdk/core";
import { MOTION, type SpringState, stepToward } from "../ui/motion";
import { grainShader } from "./lacquer";
import { mergeParts } from "./merge";
import { COLORS, MATERIALS } from "./theme";

/** The drawer in box units: its front's size and centre when shut, and how far it opens. */
export const DRAWER = {
  w: 0.34,
  h: 0.084,
  /** The front's thickness; it stands this proud of the plinth (front face at z0 + t). */
  t: 0.016,
  y: -0.585,
  /** The plinth's front face. */
  z0: 1.03,
  /** Open: slid out this far. */
  out: 0.22,
  /** The drawer body behind the front (seen once it slides out). */
  depth: 0.3,
} as const;

/** The pull: a bar across the front, on two posts. */
export const HANDLE = { w: 0.16, r: 0.007, stand: 0.026 } as const;

/** The handle's centre when the drawer is shut (box units). */
export const HANDLE_AT: readonly [number, number, number] = [0, DRAWER.y, DRAWER.z0 + DRAWER.t + HANDLE.stand];

/** Where an open drawer holds up the menu panels' bottom edge: its front's top, just in front (box units). */
export const DRAWER_PANEL_ANCHOR: readonly [number, number, number] = [0, DRAWER.y + DRAWER.h / 2 + 0.01, DRAWER.z0 + DRAWER.out + DRAWER.t + 0.01];

/** Gold glow at full nearness (emissive intensity on the gold parts). */
const GLOW_MAX = 0.55;

/** A part, its colour, and for a lacquer part the way its grain runs (lacquer.ts); gold and velvet have none. */
type Part = [BufferGeometry, string, ("x" | "z")?];

/** Parts merged into one geometry, each in its own colour and with its grain direction. Built once. */
function mergeColored(parts: Part[]): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const grn: number[] = [];
  const c = new Color();
  for (const [g, hex, grain] of parts) {
    const m = mergeParts([g]);
    const p = m.getAttribute("position");
    const n = m.getAttribute("normal");
    // Color.set takes the sRGB hex into the linear working space vertex colours are read in.
    c.set(hex);
    const gx = grain === "x" ? 1 : 0, gz = grain === "z" ? 1 : 0;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.r, c.g, c.b);
      grn.push(gx, 0, gz);
    }
    m.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  out.setAttribute("color", new Float32BufferAttribute(col, 3));
  out.setAttribute("grain", new Float32BufferAttribute(grn, 3));
  out.computeBoundingSphere();
  return out;
}

function drawerGeometry(): BufferGeometry {
  const { w, h, t, depth } = DRAWER;
  const zf = t / 2;
  const parts: Part[] = [
    // The front: lacquer, its grain across it as the plinth's.
    [new BoxGeometry(w, h, t).translate(0, 0, zf), COLORS.frame, "x"],
    // Its gold-leaf inlay: a thin frame just proud of the front.
    [new BoxGeometry(w - 0.03, 0.005, 0.002).translate(0, h / 2 - 0.014, t + 0.001), COLORS.etch],
    [new BoxGeometry(w - 0.03, 0.005, 0.002).translate(0, -h / 2 + 0.014, t + 0.001), COLORS.etch],
    [new BoxGeometry(0.005, h - 0.028, 0.002).translate(-w / 2 + 0.015, 0, t + 0.001), COLORS.etch],
    [new BoxGeometry(0.005, h - 0.028, 0.002).translate(w / 2 - 0.015, 0, t + 0.001), COLORS.etch],
    // The bar pull on two posts.
    [new CylinderGeometry(HANDLE.r, HANDLE.r, HANDLE.w, 10).rotateZ(Math.PI / 2).translate(0, 0, t + HANDLE.stand), COLORS.metal],
    [new CylinderGeometry(HANDLE.r * 0.7, HANDLE.r * 0.7, HANDLE.stand, 8).rotateX(Math.PI / 2).translate(-HANDLE.w / 2 + 0.01, 0, t + HANDLE.stand / 2), COLORS.metal],
    [new CylinderGeometry(HANDLE.r * 0.7, HANDLE.r * 0.7, HANDLE.stand, 8).rotateX(Math.PI / 2).translate(HANDLE.w / 2 - 0.01, 0, t + HANDLE.stand / 2), COLORS.metal],
    // The body: lacquer sides, a velvet floor and back.
    [new BoxGeometry(0.01, h - 0.012, depth).translate(-w / 2 + 0.015, 0, -depth / 2), COLORS.frame, "z"],
    [new BoxGeometry(0.01, h - 0.012, depth).translate(w / 2 - 0.015, 0, -depth / 2), COLORS.frame, "z"],
    [new BoxGeometry(w - 0.03, 0.008, depth).translate(0, -h / 2 + 0.01, -depth / 2), COLORS.lining],
    [new BoxGeometry(w - 0.03, h - 0.012, 0.008).translate(0, 0, -depth), COLORS.lining],
  ];
  return mergeColored(parts);
}

export class DrawerView {
  readonly mesh: Mesh;
  private readonly material: MeshPhysicalMaterial;
  /** How far out (box units), as a spring. */
  private readonly slide: SpringState = { x: 0, v: 0 };
  private target = 0;
  /** The drawer follows the hand exactly while it is pulled (no spring lag under the fingers). */
  private following = false;
  private glowV = -1;

  constructor(root: Object3D, envMap: Texture | null = null) {
    // The plinth's lacquer for the front (its clearcoat, and its grain through lacquer.ts) and gold for the inlay and
    // pull, in one material: still one program and one draw call.
    this.material = new MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.2,
      metalness: 1,
      clearcoat: MATERIALS.lacquer.clearcoat,
      clearcoatRoughness: MATERIALS.lacquer.clearcoatRoughness,
      envMap,
      envMapIntensity: 1.6,
      emissive: new Color(COLORS.gold),
      emissiveIntensity: 0,
    });
    // How gold a part is (its red channel: gold is bright, lacquer and velvet are near black) makes it metal and lets
    // it glow; the lacquer stays a dark gloss. The metal mask follows three's metalness chunk: onBeforeCompile sees
    // its #include, not the line inside it.
    this.material.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader
        .replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * smoothstep( 0.18, 0.6, vColor.r );")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor *= smoothstep( 0.18, 0.6, vColor.r );")
        // The clearcoat on the lacquer only (the parts with a grain direction): the velvet lining and the gold go bare.
        .replace(
          "#include <lights_physical_fragment>",
          "#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat *= step( 0.5, dot( vGrainAxis, vGrainAxis ) );\n#endif",
        );
      grainShader(s);
    };
    this.material.customProgramCacheKey = () => "sl-drawer-lacquer";
    this.mesh = new Mesh(drawerGeometry(), this.material);
    this.mesh.name = "Box Drawer Menu";
    this.mesh.position.set(0, DRAWER.y, DRAWER.z0);
    root.add(this.mesh);
  }

  /** How far out it is now (box units). */
  get out(): number {
    return this.slide.x;
  }

  /** Follow a pull: `units` out, at once. */
  follow(units: number): void {
    this.following = true;
    this.target = Math.min(DRAWER.out, Math.max(0, units));
    this.slide.x = this.target;
    this.slide.v = 0;
  }

  /** Spring open (true) or shut (false). */
  setOpen(open: boolean): void {
    this.following = false;
    this.target = open ? DRAWER.out : 0;
  }

  /** The gold's glow now, 0..1. */
  get glow(): number {
    return Math.max(0, this.glowV);
  }

  /** The gold's glow, 0..1 (a hand near the handle). Writes only a change. */
  setGlow(k: number): void {
    const v = Math.round(Math.min(1, Math.max(0, k)) * 100) / 100;
    if (v === this.glowV) return;
    this.glowV = v;
    this.material.emissiveIntensity = v * GLOW_MAX;
  }

  /** The handle's centre now (box units into `out`). */
  handle(out: Vector3): Vector3 {
    return out.set(HANDLE_AT[0], HANDLE_AT[1], HANDLE_AT[2] + this.slide.x);
  }

  /** Per frame: the slide's spring (a straight 40 ms move with reduced motion). */
  update(dt: number, reduced: boolean): void {
    if (this.following) return;
    const s = this.slide;
    if (s.x === this.target && s.v === 0) return;
    stepToward(s, this.target, this.target > 0 ? MOTION.panel.enter : MOTION.panel.exit, dt, reduced, DRAWER.out);
    if (Math.abs(s.x - this.target) < 1e-4 && Math.abs(s.v) < 1e-3) {
      s.x = this.target;
      s.v = 0;
    }
    this.mesh.position.z = DRAWER.z0 + s.x;
  }

  /** Keep the mesh where the slide is (after `follow`). */
  sync(): void {
    this.mesh.position.z = DRAWER.z0 + this.slide.x;
  }
}
