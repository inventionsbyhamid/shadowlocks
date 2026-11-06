// The puzzle box in the lap: a black lacquer frame with gold pinstripes and stepped gold corners,
// smoked glass sides and lid, a velvet floor, the ivory frosted back panel, the gold scraps on their
// threads, the sight rings, and the lantern. Everything is in box units under one root ("Box") whose
// matrix is the placement, so a new placement or box size moves and scales it all around the panel.
//
// The frame has no rail across the top of the open front: from a seated eye the box's lid is seen
// from above, and a rail there would cut across the panel. Draw calls: frame, trim, floor, glass,
// panel, shadows, scraps, threads, rings, and four for the lantern; thirteen for any box, plus one
// for each crystallised piece (three more while one forms). The panel shader and the shadows live in
// panel.ts and shadow-mesh.ts. The hands' shadows and the crystallised pieces' join the box's own in
// the one shadow mesh, after them.
import {
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  type Entity,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  type InstancedMesh,
  type Material,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Shape,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
  type World,
} from "@iwsdk/core";
import { ENVELOPE } from "../core/envelope";
import type { Box, V2, V3 } from "../core/types";
import { Crystals } from "./fx/crystallise";
import { FlashBudget } from "./fx/flash-budget";
import { LanternView } from "./lantern-view";
import { mergeParts } from "./merge";
import { BOX_ROOT_NAME, DEFAULT_BOX_CM } from "./placement";
import { Panel } from "./panel";
import { type ScrapHandle, Scraps, slotOf } from "./scraps";
import { BoxShadows, MAX_EXTRAS, penumbra } from "./shadow-mesh";
import { COLORS, ENV, LIGHTS, MATERIALS } from "./theme";

/** Frame bars: thickness and edge radius (box units). The radius gives the clearcoat a rim to catch light. */
const BAR = 0.05;
const BAR_R = 0.008;
/** The back panel sits just in front of the back slab; its shadows lie exactly on it. */
const PANEL_Z = 0.002;
/**
 * The panel draws after everything opaque at the default order (the scraps and frame in front of it
 * hide it by depth, since it writes none), and its shadows right after it, darkening it by MIN blending.
 */
const PANEL_ORDER = 1;
/** Glass lid height (threads hang just under it). */
const LID_Y = 0.49;
/** Plinth under the box: height, depth (to just past the front), centre. */
const PLINTH = { w: 1.1, h: 0.12, d: 1.09, y: -0.585, z: 0.485 };
/** Gold pinstripe width and depth; stepped corner squares (side, lift). */
const STRIPE = { w: 0.008, d: 0.002 };
const STEPS: readonly (readonly [number, number])[] = [[0.062, 0.006], [0.046, 0.012], [0.03, 0.018]];

/** A rounded, bevelled slab w x h, d deep along z, centred on the origin. */
function slab(w: number, h: number, d: number, r: number): BufferGeometry {
  const b = Math.min(r, w / 4, h / 4, d / 4);
  const iw = w - 2 * b, ih = h - 2 * b, rr = Math.max(0.0005, Math.min(r - b, iw / 2, ih / 2));
  const s = new Shape();
  s.moveTo(-iw / 2 + rr, -ih / 2);
  s.lineTo(iw / 2 - rr, -ih / 2);
  s.quadraticCurveTo(iw / 2, -ih / 2, iw / 2, -ih / 2 + rr);
  s.lineTo(iw / 2, ih / 2 - rr);
  s.quadraticCurveTo(iw / 2, ih / 2, iw / 2 - rr, ih / 2);
  s.lineTo(-iw / 2 + rr, ih / 2);
  s.quadraticCurveTo(-iw / 2, ih / 2, -iw / 2, ih / 2 - rr);
  s.lineTo(-iw / 2, -ih / 2 + rr);
  s.quadraticCurveTo(-iw / 2, -ih / 2, -iw / 2 + rr, -ih / 2);
  const depth = Math.max(0.001, d - 2 * b);
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -depth / 2);
  return g;
}

type Axis = "x" | "y" | "z";
/** A geometry laid along an axis (built along z) and moved to p. */
function along(g: BufferGeometry, axis: Axis, p: V3): BufferGeometry {
  if (axis === "x") g.rotateY(Math.PI / 2);
  else if (axis === "y") g.rotateX(Math.PI / 2);
  return g.translate(p[0], p[1], p[2]);
}
const bar = (len: number, axis: Axis, p: V3) => along(slab(BAR, BAR, len, BAR_R), axis, p);
const stripe = (len: number, axis: Axis, p: V3, face: Axis) => {
  // A thin gold strip on a bar's face: `face` is the axis the face looks along.
  const w = STRIPE.w, d = STRIPE.d;
  const size: V3 = axis === "x" ? [len, w, w] : axis === "y" ? [w, len, w] : [w, w, len];
  size[face === "x" ? 0 : face === "y" ? 1 : 2] = d;
  return new BoxGeometry(size[0], size[1], size[2]).translate(p[0], p[1], p[2]);
};

function frameGeometry(): BufferGeometry {
  const H = 0.5, parts: BufferGeometry[] = [];
  // Four bars front to back along the edges.
  for (const x of [-H, H]) for (const y of [-H, H]) parts.push(bar(1 + BAR, "z", [x, y, 0.5]));
  // The back ring around the panel.
  for (const y of [-H, H]) parts.push(bar(1 - BAR, "x", [0, y, 0]));
  for (const x of [-H, H]) parts.push(bar(1 - BAR, "y", [x, 0, 0]));
  // The front: two posts and the sill; no rail across the top (it would cut across the panel).
  parts.push(bar(1 - BAR, "x", [0, -H, 1]));
  for (const x of [-H, H]) parts.push(bar(1 - BAR, "y", [x, 0, 1]));
  parts.push(slab(1 + BAR, 1 + BAR, 0.035, 0.012).translate(0, 0, -0.045));
  parts.push(slab(PLINTH.w, PLINTH.h, PLINTH.d, 0.02).translate(0, PLINTH.y, PLINTH.z));
  return mergeParts(parts);
}

/** Gold pinstripes along the frame's edges and stepped gold corners, so black lacquer never vanishes in the dark. */
function trimGeometry(): BufferGeometry {
  const H = 0.5, F = 1 + BAR / 2 + 0.001, B = BAR / 2 + 0.001, T = H + BAR / 2 + 0.001, L = 1 - BAR - 0.02, parts: BufferGeometry[] = [];
  // Round the panel (the back ring's front faces).
  for (const y of [-H, H]) parts.push(stripe(L, "x", [0, y, B], "z"));
  for (const x of [-H, H]) parts.push(stripe(L, "y", [x, 0, B], "z"));
  // The front posts and sill.
  parts.push(stripe(L, "x", [0, -H, F], "z"));
  for (const x of [-H, H]) parts.push(stripe(L, "y", [x, 0, F], "z"));
  // Along the top edges (seen from a seated eye above the lid).
  for (const x of [-H, H]) parts.push(stripe(1 + BAR - 0.04, "z", [x, T, 0.5], "y"));
  // The plinth's front.
  const pf = PLINTH.z + PLINTH.d / 2 + 0.001;
  for (const dy of [-0.04, 0.04]) parts.push(stripe(PLINTH.w - 0.04, "x", [0, PLINTH.y + dy, pf], "z"));
  // Stepped corners at the eight corners, facing the player.
  for (const z of [F, B]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      for (const [s, lift] of STEPS) parts.push(new BoxGeometry(s, s, 0.006).translate(sx * H, sy * H, z + lift - 0.003));
    }
  }
  return mergeParts(parts);
}

function glassGeometry(): BufferGeometry {
  const s = 1 - BAR;
  return mergeParts([
    new PlaneGeometry(s, s).rotateY(Math.PI / 2).translate(-0.5, 0, 0.5),
    new PlaneGeometry(s, s).rotateY(-Math.PI / 2).translate(0.5, 0, 0.5),
    new PlaneGeometry(s, s).rotateX(Math.PI / 2).translate(0, LID_Y, 0.5),
  ]);
}

/** Soft studio reflections for the lacquer and gold, rendered once. Null where it cannot be made. */
function studioEnvironment(renderer: WebGLRenderer): Texture | null {
  const scene = new Scene();
  scene.add(new Mesh(new SphereGeometry(10, 16, 8), new MeshBasicMaterial({ color: ENV.base, side: BackSide })));
  for (const p of ENV.panels) {
    const m = new Mesh(new PlaneGeometry(p.w, p.h), new MeshBasicMaterial({ color: new Color(p.color).multiplyScalar(p.k), side: DoubleSide }));
    m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    m.lookAt(0, 0, 0);
    scene.add(m);
  }
  let tex: Texture | null = null;
  try {
    const pmrem = new PMREMGenerator(renderer);
    tex = pmrem.fromScene(scene, 0.04).texture;
    pmrem.dispose();
  } catch (err) {
    console.warn("box reflections unavailable", err);
  }
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as Material).dispose();
    }
  });
  return tex;
}

function directional(c: string, k: number, from: readonly [number, number, number], root: Object3D): DirectionalLight {
  const l = new DirectionalLight(c, k);
  l.position.set(from[0], from[1], from[2]);
  const target = new Object3D();
  target.position.set(0, 0, 0.5);
  root.add(target);
  l.target = target;
  return l;
}

/** Draw calls and triangles a part of the scene adds (counted from what it draws, per view). */
export interface DrawStats {
  calls: number;
  triangles: number;
  parts: string[];
}

export class BoxScene {
  /** The box root ("Box"): origin at the back panel's centre, +z out of the open front, 1 unit = the box size. */
  readonly root = new Group();
  readonly entity: Entity;
  /** The frosted back panel (z = 0, 1 x 1), drawn by the panel shader. */
  readonly panel: Mesh;
  /** The panel's look: light pool, etching, and each lock's warmth (setWarmth) and opening (setOpen). */
  readonly panelArt: Panel;
  /** Every scrap's, decoy's and ring's shadow on the panel: one draw call. */
  readonly shadows: BoxShadows;
  readonly lantern: LanternView;
  readonly scraps: Scraps;
  /** Finger locks' crystallised pieces (fx/crystallise.ts). */
  readonly crystals: Crystals;
  /**
   * The one flash budget of everything in the box that brightens (the lantern's flares, crystallises): never more
   * than three flashes a second between them. Stepped once a frame here.
   */
  readonly flashes = new FlashBudget();
  private current: Box | null = null;
  private readonly lanternAt: V3 = [0, 0, 0];
  /** This frame's extra shadows (crystallised pieces, then hands) and their softness. */
  private readonly extras: V2[][] = Array.from({ length: MAX_EXTRAS }, (): V2[] => []);
  private readonly extraSoft = new Float32Array(MAX_EXTRAS);
  /** The hands' outlines and depths as the hand system last gave them. */
  private handOutlines: readonly V2[][] = [];
  private handCount = 0;
  private handDepth: Float32Array = new Float32Array(0);
  /** The crystals' version at the last cast (a piece made, growing or gone since recasts). */
  private castCrystals = -1;

  constructor(world: World) {
    this.root.name = BOX_ROOT_NAME;
    const env = studioEnvironment(world.renderer);
    const lacquer = new MeshPhysicalMaterial({ color: COLORS.frame, ...MATERIALS.lacquer, envMap: env });
    const gold = new MeshStandardMaterial({ color: COLORS.metal, ...MATERIALS.gold, envMap: env });
    const frame = new Mesh(frameGeometry(), lacquer);
    frame.name = "Box Frame";
    const trim = new Mesh(trimGeometry(), gold);
    trim.name = "Box Trim";
    const floor = new Mesh(
      new PlaneGeometry(1 - BAR, 1).rotateX(-Math.PI / 2).translate(0, -0.5 + BAR / 2 + 0.001, 0.5),
      new MeshStandardMaterial({ color: COLORS.lining, ...MATERIALS.lining, envMap: env }),
    );
    floor.name = "Box Floor";
    const glass = new Mesh(
      glassGeometry(),
      new MeshPhysicalMaterial({
        color: COLORS.glass,
        roughness: MATERIALS.glass.roughness,
        metalness: MATERIALS.glass.metalness,
        envMapIntensity: MATERIALS.glass.envMapIntensity,
        envMap: env,
        transparent: true,
        opacity: MATERIALS.glass.opacity,
        depthWrite: false,
        side: DoubleSide,
        // One pass for both faces (three draws a transparent double-sided mesh twice otherwise).
        forceSinglePass: true,
      }),
    );
    glass.name = "Box Glass";
    glass.renderOrder = 2;
    // The panel draws after everything opaque in front of it (it writes no depth), then the shadows on it.
    this.panelArt = new Panel();
    this.panel = new Mesh(new PlaneGeometry(1, 1).translate(0, 0, PANEL_Z), this.panelArt.material);
    this.panel.name = "Box Panel";
    this.panel.renderOrder = PANEL_ORDER;
    this.scraps = new Scraps(env);
    const slots = this.scraps.slots;
    this.shadows = new BoxShadows((p) => slots[slotOf(p.lock, p.piece) * 2 + 1]! > 0.5);
    const shadowMesh = this.shadows.mesh.mesh;
    shadowMesh.material = this.panelArt.shadowMaterial;
    shadowMesh.position.z = PANEL_Z;
    shadowMesh.renderOrder = PANEL_ORDER + 1;
    this.lantern = new LanternView({ lacquer, gold }, this.flashes);
    this.crystals = new Crystals(env, this.flashes);
    this.root.add(frame, trim, floor, glass, this.panel, shadowMesh, this.scraps.mesh, this.scraps.threads, this.scraps.rings, this.lantern.group);
    this.root.add(this.crystals.group);
    this.root.add(directional(LIGHTS.key.color, LIGHTS.key.intensity, LIGHTS.key.from, this.root));
    this.root.add(directional(LIGHTS.fill.color, LIGHTS.fill.intensity, LIGHTS.fill.from, this.root));
    // A hemisphere light reads "up" from its world position, so it stays at the scene's top level.
    const hemi = new HemisphereLight(LIGHTS.hemi.sky, LIGHTS.hemi.ground, LIGHTS.hemi.intensity);
    hemi.name = "Box Hemisphere";
    world.scene.add(hemi);
    const s = DEFAULT_BOX_CM / 100;
    this.root.scale.set(s, s, s);
    this.entity = world.createTransformEntity(this.root, { persistent: true });
    this.setBox(null);
  }

  /** The box shown (its scraps, threads, rings, etching and shadows; the lantern goes to its start), or none. */
  setBox(box: Box | null): void {
    this.current = box;
    this.scraps.setBox(box);
    this.crystals.setBox(box);
    this.panelArt.setBox(box);
    this.shadows.setBox(box);
    // The hands' outlines were for the last box; the hand system gives this box's on the next frame.
    this.handCount = 0;
    const s = box ? box.start : ENVELOPE.START;
    this.lantern.setPos([s[0], s[1], s[2]]);
    this.syncShadows();
  }

  /**
   * The hands' shadows this frame: outlines on the panel (box units, a fixed corner count each) in
   * outlines[0..n), each one's depth (box z) for its softness. The hand system gives them every frame
   * before the box updates; they are drawn after the crystallised pieces'.
   */
  setHandShadows(outlines: readonly V2[][], n: number, depth: Float32Array): void {
    this.handOutlines = outlines;
    this.handCount = n;
    this.handDepth = depth;
  }

  /**
   * Cast the shadows and move the light pool if anything changed since the last time; true when it
   * did. Every frame calls it; so can whoever moves the lantern. The extra shadows (crystallised
   * pieces, then the hands) go with the box's in one refresh, which casts if the lantern moved, a scrap
   * appeared or went or the extras' count changed, and here also whenever hands are in the beam (they
   * move) or a piece changed. Allocation-free.
   */
  syncShadows(): boolean {
    const L = this.lantern.getPos(this.lanternAt);
    const extras = this.extras, soft = this.extraSoft;
    let n = this.crystals.castShadows(L, extras, soft);
    const hands = Math.min(this.handCount, MAX_EXTRAS - n);
    for (let i = 0; i < hands; i++) {
      extras[n] = this.handOutlines[i]!;
      soft[n] = penumbra(this.handDepth[i]!, L[2]);
      n++;
    }
    const changed = hands > 0 || this.crystals.version !== this.castCrystals;
    if (!this.shadows.refresh(L, extras, n, soft, changed)) return false;
    this.castCrystals = this.crystals.version;
    this.panelArt.setLantern(L);
    return true;
  }

  get box(): Box | null {
    return this.current;
  }

  /** Box units to world: put the root there (position, turn and uniform scale). */
  setPlacement(m: Readonly<Matrix4>): void {
    m.decompose(this.root.position, this.root.quaternion, this.root.scale);
    this.root.updateMatrixWorld(true);
    this.lantern.setBoxSize(this.root.scale.x);
    // The reflections turn with the box, so its look is the same whichever way the player sits.
    const e = m.elements, yaw = Math.atan2(e[8]!, e[10]!);
    this.root.traverse((o) => {
      const mat = (o as Mesh).material as MeshStandardMaterial | undefined;
      if (mat && "envMapRotation" in mat && mat.envMap) mat.envMapRotation.set(0, yaw, 0);
    });
  }

  /** The box edge in metres. */
  get size(): number {
    return this.root.scale.x;
  }

  /** One lock piece's glow and visibility (a finger lock's missing piece starts hidden). */
  scrapMesh(lock: number, piece: number): ScrapHandle {
    return this.scraps.handle(lock, piece);
  }

  /**
   * Per frame: the lantern's flare and ripple, any crystallise running, the shadows when anything
   * moved (the hands' among them), the panel's warmth and opening.
   */
  update(dt: number): void {
    this.flashes.step(dt);
    this.lantern.update(dt);
    this.crystals.update(dt);
    this.syncShadows();
    this.panelArt.update(dt);
  }

  /** What the box draws now: one call per visible part (two for a transparent double-sided one). */
  drawStats(): DrawStats {
    const out: DrawStats = { calls: 0, triangles: 0, parts: [] };
    if (!this.root.visible) return out;
    this.root.traverseVisible((o) => {
      const m = o as Mesh;
      if (!m.isMesh && !(o as { isLine?: boolean }).isLine && !(o as { isSprite?: boolean }).isSprite) return;
      const g = m.geometry, mat = m.material as Material;
      if ((o as { isSprite?: boolean }).isSprite) {
        out.calls++;
        out.triangles += 2;
        out.parts.push(o.name);
        return;
      }
      const inst = (o as InstancedMesh).isInstancedMesh ? (o as InstancedMesh).count : 1;
      const n = Math.min(g.drawRange.count, g.index ? g.index.count : g.getAttribute("position").count);
      if (n === 0 || inst === 0) return;
      out.calls += mat.transparent && mat.side === DoubleSide && !mat.forceSinglePass ? 2 : 1;
      if (m.isMesh) out.triangles += (n / 3) * inst;
      out.parts.push(o.name);
    });
    return out;
  }
}
