// A finger lock completing: the finger has held the gap, so gold fills its shadow (the missing piece's outline on
// the panel) over 300 ms, then a brass piece forms where the finger is: at depth fingerZ on the rays from the lock's
// spot through the gap, so from the spot it casts exactly the missing outline. 700 ms in all. The piece stays (the
// lock is open) until the box changes; the hand can leave. Its shadow goes into the panel's shadow mesh with the
// hands' (castShadows: its front face as it is now, from wherever the lantern is).
//
// Comfort: the whole moment is one brightening (the fill rises, then hands its gold to the piece and both fade), and
// a crystallise starting within a third of a second of another flash fills at half strength instead of flashing
// again. Reduced motion: no glitter and no growth; still the fill and the piece.
//
// Everything is made once per lock slot (up to three locks) and lives in the box root, in box units. Starting a
// crystallise writes the piece's geometry once; a frame only moves opacities, the piece's glow and scale, and the
// glitter: no allocation per frame.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  Points,
  PointsMaterial,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from "@iwsdk/core";
import type { Box, Lock, V2, V3 } from "../../core/types";
import type { BoxScene } from "../box-scene";
import { LIGHT_BLEND } from "../light-blend";
import { SCRAP_THICKNESS } from "../scraps";
import { penumbra } from "../shadow-mesh";
import { COLORS, FOIL, MATERIALS } from "../theme";
import { clamp01, outBack, outCubic, smoothstep } from "./ease";
import { FlashBudget } from "./flash-budget";

/** The gold fill of the finger's shadow, then the piece: 700 ms in all. */
export const CRYSTAL_FILL_MS = 300;
export const CRYSTAL_MS = 700;
/** The fill lies this far in front of the panel, over the shadows on it (box units). */
const FILL_Z = 0.005;
/** Corners a piece can have (as the scrap buffers allow), and the vertices its plate needs (flat shaded). */
const MAX_CORNERS = 16;
const MAX_PIECE_VERTS = 12 * MAX_CORNERS - 12;
/** The piece's glow (emissive intensity) as it takes the gold over; it grows from this share of its size. */
const GLOW = 1.4;
const GROW_FROM = 0.55;
const GROW_MS = 260;
const GROW_OVERSHOOT = 1.2;
/** A crystallise the flash budget refuses fills at this strength. */
const DIM = 0.5;
/** Glitter: sparks flying this far out from the piece (box units), this big (metres, on screen). */
const SPARKS = 14;
const SPARK_REACH = 0.09;
const SPARK_SIZE = 0.006;
const MAX_LOCKS = 3;

export interface CrystalOptions {
  reducedMotion?: boolean;
}

/** One lock's crystal: what it draws. */
export interface CrystalSlot {
  readonly group: Group;
  /** The gold fill on the panel. */
  readonly fill: Mesh;
  /** The brass piece. */
  readonly piece: Mesh;
  readonly glitter: Points;
}

/** A crystallised piece as the game and tests read it (a copy). */
export interface CrystalPiece {
  /** Its depth: the finger's, when it formed. */
  z: number;
  /** Its front corners (box units). */
  verts: V3[];
  /** Done forming (700 ms after it started). */
  formed: boolean;
  /** Frame time since it started (ms; CRYSTAL_MS once formed). */
  ms: number;
  /** The brass piece is drawn (from CRYSTAL_FILL_MS on). */
  shown: boolean;
}

interface State {
  lock: Lock | null;
  z: number;
  /** Front corners, x y z each (box units); `corners` of them. */
  readonly front: Float64Array;
  corners: number;
  /** The piece's shadow on the panel: `corners` points, from a pool of MAX_CORNERS. */
  readonly shadow: V2[];
  readonly pool: V2[];
  t: number;
  running: boolean;
  formed: boolean;
  reduced: boolean;
  /** 1 for a full flash, DIM when the budget refused one. */
  peak: number;
  resolve: (() => void) | null;
}

/** Fibonacci sphere: SPARKS directions spread evenly, the same every run. */
function sparkDirections(): Float32Array {
  const d = new Float32Array(SPARKS * 3), g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < SPARKS; i++) {
    const y = 1 - (2 * (i + 0.5)) / SPARKS, r = Math.sqrt(1 - y * y), a = g * i;
    d[i * 3] = r * Math.cos(a);
    d[i * 3 + 1] = y;
    d[i * 3 + 2] = Math.abs(r * Math.sin(a)) * 0.6;
  }
  return d;
}
const SPARK_DIRS = sparkDirections();

/** The fill's colour over its foil (white: the foil as it is). */
const FILL_TINT = "#ffffff";
/** The foil is lifted this far toward gold hot: the gap fills with light, a little brighter than an open lock's foil. */
const FILL_LIFT = 0.25;

/** The banded gold foil (theme.ts FOIL, in display values as the panel blends it) as a 64 x 1 texture along u. */
function foilTexture(): DataTexture {
  const W = 64, data = new Uint8Array(W * 4), hot = new Color().setStyle(COLORS.goldHot, NoColorSpace), a = new Color(), b = new Color();
  for (let x = 0; x < W; x++) {
    const t = x / (W - 1);
    let k = 1;
    while (k < FOIL.length - 1 && FOIL[k]![0] < t) k++;
    const [t0, h0] = FOIL[k - 1]!, [t1, h1] = FOIL[k]!;
    a.setStyle(h0, NoColorSpace).lerp(b.setStyle(h1, NoColorSpace), Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
    a.lerp(b.copy(hot), FILL_LIFT);
    data.set([Math.round(a.r * 255), Math.round(a.g * 255), Math.round(a.b * 255), 255], x * 4);
  }
  const tex = new DataTexture(data, W, 1, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function triNormal(p: Float32Array, i: number, out: Float32Array): void {
  const ax = p[i + 3]! - p[i]!, ay = p[i + 4]! - p[i + 1]!, az = p[i + 5]! - p[i + 2]!;
  const bx = p[i + 6]! - p[i]!, by = p[i + 7]! - p[i + 1]!, bz = p[i + 8]! - p[i + 2]!;
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  for (let k = 0; k < 9; k += 3) {
    out[i + k] = nx;
    out[i + k + 1] = ny;
    out[i + k + 2] = nz;
  }
}

/** The crystallised pieces of the box shown, one slot per lock. Lives in the box root (BoxScene.crystals). */
export class Crystals {
  readonly group = new Group();
  readonly slots: CrystalSlot[] = [];
  /** Goes up whenever a piece's shadow may have changed (a piece made, growing, formed or gone). */
  version = 0;
  private readonly states: State[] = [];
  private readonly budget: FlashBudget;
  /** The budget is this object's own (it steps it), not the box's shared one. */
  private readonly ownBudget: boolean;

  /**
   * `budget`: the one flash budget everything in the box brightens through (the box scene's, which steps it each
   * frame), so the three-a-second cap holds across the lantern's flares and crystallises; without one, a budget of
   * its own, stepped by update.
   */
  constructor(env: Texture | null, budget?: FlashBudget) {
    this.budget = budget ?? new FlashBudget();
    this.ownBudget = !budget;
    this.group.name = "Crystals";
    const foil = foilTexture();
    // The fill's triangles: a fan from corner 0 (pieces are convex), the same for any corner count.
    const fan = new Uint16Array((MAX_CORNERS - 2) * 3);
    for (let i = 0; i < MAX_CORNERS - 2; i++) fan.set([0, i + 1, i + 2], i * 3);
    for (let s = 0; s < MAX_LOCKS; s++) {
      const fg = new BufferGeometry();
      fg.setAttribute("position", new BufferAttribute(new Float32Array(MAX_CORNERS * 3), 3).setUsage(DynamicDrawUsage));
      fg.setAttribute("uv", new BufferAttribute(new Float32Array(MAX_CORNERS * 2), 2).setUsage(DynamicDrawUsage));
      fg.setIndex(new BufferAttribute(fan, 1));
      // Banded gold foil across the gap, as an open lock fills (theme.ts FOIL), lifted toward gold hot.
      const fill = new Mesh(
        fg,
        new MeshBasicMaterial({
          color: FILL_TINT,
          map: foil,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          toneMapped: false,
          side: DoubleSide,
        }),
      );
      fill.name = "Crystal Fill";
      fill.renderOrder = 5;

      const pg = new BufferGeometry();
      pg.setAttribute("position", new BufferAttribute(new Float32Array(MAX_PIECE_VERTS * 3), 3).setUsage(DynamicDrawUsage));
      pg.setAttribute("normal", new BufferAttribute(new Float32Array(MAX_PIECE_VERTS * 3), 3).setUsage(DynamicDrawUsage));
      const piece = new Mesh(
        pg,
        new MeshStandardMaterial({ color: COLORS.metal, ...MATERIALS.gold, envMap: env, emissive: COLORS.gold, emissiveIntensity: 0 }),
      );
      piece.name = "Crystal Piece";

      const gg = new BufferGeometry();
      gg.setAttribute("position", new BufferAttribute(new Float32Array(SPARKS * 3), 3).setUsage(DynamicDrawUsage));
      const glitter = new Points(
        gg,
        new PointsMaterial({
          color: COLORS.goldHot,
          size: SPARK_SIZE,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          ...LIGHT_BLEND,
          toneMapped: false,
        }),
      );
      glitter.name = "Crystal Glitter";
      glitter.renderOrder = 6;

      const group = new Group();
      group.add(fill, piece, glitter);
      for (const o of [fill, piece, glitter]) {
        // They stay inside the box, which is always in view; their bounds change with every piece.
        o.frustumCulled = false;
        o.visible = false;
      }
      this.group.add(group);
      this.slots.push({ group, fill, piece, glitter });
      this.states.push({
        lock: null,
        z: 0,
        front: new Float64Array(MAX_CORNERS * 3),
        corners: 0,
        shadow: [],
        pool: Array.from({ length: MAX_CORNERS }, (): V2 => [0, 0]),
        t: 0,
        running: false,
        formed: false,
        reduced: false,
        peak: 1,
        resolve: null,
      });
    }
  }

  /** Flashes started so far (each full-strength crystallise is one). */
  get flashes(): number {
    return this.budget.started;
  }

  /** A new box (or none): every piece goes, and a crystallise still running is settled at once. */
  setBox(_box: Box | null): void {
    for (let s = 0; s < MAX_LOCKS; s++) this.clear(s);
  }

  /**
   * Crystallise `lock`'s missing piece at depth `fingerZ` (box units): gold fills the gap for 300 ms, then the piece
   * forms; resolves 700 ms in (in frame time). Nothing happens, and it resolves at once, for a lock with no missing
   * piece.
   */
  form(lock: Lock, fingerZ: number, o: CrystalOptions = {}): Promise<void> {
    if (!this.build(lock, fingerZ)) return Promise.resolve();
    const st = this.states[lock.i]!, slot = this.slots[lock.i]!;
    st.t = 0;
    st.running = true;
    st.formed = false;
    st.reduced = !!o.reducedMotion;
    st.peak = this.budget.take() ? 1 : DIM;
    (slot.fill.material as MeshBasicMaterial).opacity = 0;
    slot.fill.visible = true;
    slot.piece.visible = false;
    slot.glitter.visible = false;
    return new Promise((resolve) => {
      st.resolve = resolve;
    });
  }

  /** Show `lock`'s piece at depth `fingerZ` at once, formed (a box resumed with its crystallised pieces). */
  place(lock: Lock, fingerZ: number): void {
    if (!this.build(lock, fingerZ)) return;
    this.finish(lock.i);
  }

  /** The piece of lock `i` (a copy), or null when it has none. */
  piece(i: number): CrystalPiece | null {
    const st = this.states[i];
    if (!st?.lock) return null;
    const verts: V3[] = [];
    for (let k = 0; k < st.corners; k++) verts.push([st.front[k * 3]!, st.front[k * 3 + 1]!, st.front[k * 3 + 2]!]);
    return { z: st.z, verts, formed: st.formed, ms: st.formed ? CRYSTAL_MS : st.t, shown: this.slots[i]!.piece.visible };
  }

  /**
   * Every piece shown, its shadow on the panel with the lantern at L (box units): its front face as it is now
   * (growing or formed) projected from L, into out[0..n) with each one's softness (penumbra at its depth) in
   * soft[0..n). Returns n. Each piece's outline keeps its corner count. Allocation-free.
   */
  castShadows(L: Readonly<V3>, out: V2[][], soft: Float32Array): number {
    let n = 0;
    for (let s = 0; s < MAX_LOCKS; s++) {
      const st = this.states[s]!, piece = this.slots[s]!.piece;
      if (!st.lock || !piece.visible || !(L[2] > st.z)) continue;
      const g = piece.scale.x, cx = piece.position.x, cy = piece.position.y, k = L[2] / (L[2] - st.z);
      const f = st.front, poly = st.shadow;
      for (let i = 0; i < poly.length; i++) {
        const x = cx + (f[i * 3]! - cx) * g, y = cy + (f[i * 3 + 1]! - cy) * g;
        const p = poly[i]!;
        p[0] = L[0] + (x - L[0]) * k;
        p[1] = L[1] + (y - L[1]) * k;
      }
      out[n] = poly;
      soft[n] = penumbra(st.z, L[2]);
      n++;
    }
    return n;
  }

  /** Per frame (seconds). */
  update(dt: number): void {
    if (this.ownBudget) this.budget.step(dt);
    for (let s = 0; s < MAX_LOCKS; s++) {
      const st = this.states[s]!;
      if (!st.running) continue;
      this.version++;
      st.t += dt * 1000;
      const t = st.t;
      if (t >= CRYSTAL_MS) {
        this.finish(s);
        continue;
      }
      const slot = this.slots[s]!;
      // The fill rises to full by 300 ms, then hands its gold over to the piece and fades out by 700.
      const fade = 1 - smoothstep(CRYSTAL_FILL_MS, CRYSTAL_MS, t);
      (slot.fill.material as MeshBasicMaterial).opacity = st.peak * outCubic(clamp01(t / CRYSTAL_FILL_MS)) * fade;
      if (t < CRYSTAL_FILL_MS) continue;
      const piece = slot.piece;
      piece.visible = true;
      (piece.material as MeshStandardMaterial).emissiveIntensity = GLOW * st.peak * fade;
      const k = clamp01((t - CRYSTAL_FILL_MS) / GROW_MS);
      const g = st.reduced ? 1 : GROW_FROM + (1 - GROW_FROM) * outBack(k, GROW_OVERSHOOT);
      piece.scale.set(g, g, g);
      if (st.reduced) continue;
      // Glitter: sparks fly out from the piece and fade.
      const q = clamp01((t - CRYSTAL_FILL_MS) / (CRYSTAL_MS - CRYSTAL_FILL_MS));
      const reach = SPARK_REACH * outCubic(q);
      const attr = slot.glitter.geometry.getAttribute("position") as BufferAttribute;
      const pos = attr.array as Float32Array;
      for (let i = 0; i < SPARKS * 3; i++) pos[i] = SPARK_DIRS[i]! * reach;
      attr.needsUpdate = true;
      (slot.glitter.material as PointsMaterial).opacity = st.peak * (1 - q) * (1 - q);
      slot.glitter.visible = true;
    }
  }

  /** Write lock's fill and piece for depth z. False when the lock has no missing piece. */
  private build(lock: Lock, z: number): boolean {
    const outline = lock.missing >= 0 ? lock.target[lock.missing] : undefined;
    const s = lock.i;
    if (!outline || s < 0 || s >= MAX_LOCKS) return false;
    this.clear(s);
    const st = this.states[s]!, slot = this.slots[s]!, L = lock.L;
    const c = Math.min(outline.length, MAX_CORNERS);
    st.lock = lock;
    st.z = z;
    st.corners = c;
    st.shadow.length = 0;
    for (let i = 0; i < c; i++) st.shadow.push(st.pool[i]!);
    this.version++;

    // The fill: the outline itself, just in front of the panel, its foil banded along a diagonal across it.
    const fillAttr = slot.fill.geometry.getAttribute("position") as BufferAttribute;
    const uvAttr = slot.fill.geometry.getAttribute("uv") as BufferAttribute;
    const fp = fillAttr.array as Float32Array, fu = uvAttr.array as Float32Array;
    let ox = 0, oy = 0, reach = 1e-6;
    for (let i = 0; i < c; i++) {
      ox += outline[i]![0] / c;
      oy += outline[i]![1] / c;
    }
    for (let i = 0; i < c; i++) reach = Math.max(reach, Math.abs(outline[i]![0] - ox - (outline[i]![1] - oy)));
    for (let i = 0; i < c; i++) {
      fp[i * 3] = outline[i]![0];
      fp[i * 3 + 1] = outline[i]![1];
      fp[i * 3 + 2] = FILL_Z;
      fu[i * 2] = 0.5 + (outline[i]![0] - ox - (outline[i]![1] - oy)) / (2.2 * reach);
      fu[i * 2 + 1] = 0.5;
    }
    fillAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    slot.fill.geometry.setDrawRange(0, (c - 2) * 3);

    // The piece's front corners: on the rays from the spot through the outline's, at depth z. Counter-clockwise
    // seen from the front, so its front face looks at the lantern.
    let area = 0;
    for (let i = 0; i < c; i++) {
      const a = outline[i]!, b = outline[(i + 1) % c]!;
      area += a[0] * b[1] - b[0] * a[1];
    }
    const k = (L[2] - z) / L[2], f = st.front;
    let cx = 0, cy = 0;
    for (let i = 0; i < c; i++) {
      const v = outline[area >= 0 ? i : c - 1 - i]!;
      f[i * 3] = L[0] + (v[0] - L[0]) * k;
      f[i * 3 + 1] = L[1] + (v[1] - L[1]) * k;
      f[i * 3 + 2] = z;
      cx += f[i * 3]! / c;
      cy += f[i * 3 + 1]! / c;
    }
    // The plate: its front, its back (SCRAP_THICKNESS further along the rays, so it casts the same shadow) and its
    // sides, flat shaded, around its middle so it can grow in place.
    const posAttr = slot.piece.geometry.getAttribute("position") as BufferAttribute;
    const nrmAttr = slot.piece.geometry.getAttribute("normal") as BufferAttribute;
    const p = posAttr.array as Float32Array, nrm = nrmAttr.array as Float32Array;
    let n = 0;
    const put = (i: number, back: boolean) => {
      let x = f[i * 3]!, y = f[i * 3 + 1]!, zz = f[i * 3 + 2]!;
      if (back) {
        const dx = x - L[0], dy = y - L[1], dz = zz - L[2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        x += (dx / l) * SCRAP_THICKNESS;
        y += (dy / l) * SCRAP_THICKNESS;
        zz += (dz / l) * SCRAP_THICKNESS;
      }
      p[n * 3] = x - cx;
      p[n * 3 + 1] = y - cy;
      p[n * 3 + 2] = zz - z;
      n++;
    };
    const tri = (i: number, ib: boolean, j: number, jb: boolean, m: number, mb: boolean) => {
      put(i, ib);
      put(j, jb);
      put(m, mb);
      triNormal(p, (n - 3) * 3, nrm);
    };
    for (let i = 1; i < c - 1; i++) tri(0, false, i, false, i + 1, false);
    for (let i = 1; i < c - 1; i++) tri(0, true, i + 1, true, i, true);
    for (let i = 0; i < c; i++) {
      const j = (i + 1) % c;
      tri(i, false, i, true, j, true);
      tri(i, false, j, true, j, false);
    }
    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
    slot.piece.geometry.setDrawRange(0, n);
    slot.piece.position.set(cx, cy, z);
    slot.piece.scale.set(1, 1, 1);
    slot.glitter.position.set(cx, cy, z);
    return true;
  }

  /** Lock slot s formed: the piece at full size and unlit, the fill and glitter gone, the run settled. */
  private finish(s: number): void {
    const st = this.states[s]!, slot = this.slots[s]!;
    this.version++;
    st.running = false;
    st.formed = true;
    slot.fill.visible = false;
    slot.glitter.visible = false;
    slot.piece.visible = true;
    slot.piece.scale.set(1, 1, 1);
    (slot.piece.material as MeshStandardMaterial).emissiveIntensity = 0;
    const r = st.resolve;
    st.resolve = null;
    r?.();
  }

  /** Slot s holds nothing; a run still going is settled. */
  private clear(s: number): void {
    const st = this.states[s]!, slot = this.slots[s]!;
    if (st.lock) this.version++;
    st.lock = null;
    st.running = false;
    st.formed = false;
    st.corners = 0;
    slot.fill.visible = false;
    slot.piece.visible = false;
    slot.glitter.visible = false;
    const r = st.resolve;
    st.resolve = null;
    r?.();
  }
}

/**
 * The finger lock's signature moment in the box scene: gold fills the finger's shadow for 300 ms, then the missing
 * piece forms at depth `fingerZ` along the rays from the lock's spot, casting the same shadow; 700 ms in all. After it
 * the piece stays and the lock stays open. The box session decides when this runs.
 */
export function crystallise(scene: BoxScene, lock: Lock, fingerZ: number, o: CrystalOptions = {}): Promise<void> {
  return scene.crystals.form(lock, fingerZ, o);
}
