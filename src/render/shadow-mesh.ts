// Every shadow on the back panel in one draw call. Each scrap's shadow is its polygon projected from
// the lantern: an opaque interior (a fan, or triangles worked out once for a concave polygon) and a
// soft skirt around it, offset outward by the penumbra and fading from full shadow to none. Depth
// shows as softness: a scrap near the panel casts a crisp edge, one near the lantern a soft one.
//
// Seams: pieces meet edge to edge (and in T-junctions), so their interiors tile a lock's outline
// exactly; each piece's skirt also spills over its neighbours' interiors, so a crack the rasteriser
// leaves along a shared edge is still covered by a skirt at nearly full strength. Overlaps: the panel
// shader draws shadows with MIN blending (the darker of the two wins), so where shadows overlap the
// panel shows the strongest one, never two multiplied.
//
// Rings are annuli: the outer RING_SIDES-gon minus the inner one, so the sight rings' holes stay lit
// and their shadows nest as a bullseye. A ring's soft edges are held to half its width each, so its
// body stays solid and the gap between nested rings stays lit.
//
// Buffers are made once (the largest box); a new box rewrites the index once, and a frame writes only
// positions. No allocation per frame.
import { BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial } from "@iwsdk/core";
import { circlePts, projInto } from "../core/geom";
import { RING_SIDES } from "../core/solve";
import type { Box, Element as BoxElement, Piece, V2, V3 } from "../core/types";
import { LiveBufferAttribute } from "./live-attribute";
import { COLORS, PANEL_LIGHT } from "./theme";

/** The lantern's radius for the penumbra, in box units (Ebony's crisp shadows). */
export const LANTERN_RADIUS = PANEL_LIGHT.lanternRadius;
/** The widest penumbra. */
export const PENUMBRA_MAX = 0.03;
/**
 * The narrowest skirt: about a pixel on the headset at the default box size (1 box unit is roughly
 * 600 px there), so even the crispest edge is antialiased and covers rasterisation cracks.
 */
export const SOFT_MIN = 0.002;
/** A sharp corner's skirt reaches at most this many skirt widths from it (a star point, a beak). */
export const MITER_LIMIT = 4;
/** Shadow casters in a box: 3 locks of up to 16 pieces, 20 decoys, 8 rings (as Scraps sizes them). */
export const MAX_CASTERS = 3 * 16 + 20 + 8;
/** Corners in one caster's polygon: a ring's outer and inner RING_SIDES-gons. */
export const MAX_CASTER_CORNERS = 2 * RING_SIDES;
/** Shadows are cast with the lantern at least this far from the panel (every scrap is nearer). */
const LZ_MIN = 0.85;

/**
 * How far a scrap's shadow edge blurs (box units) with the scrap Pz and the lantern Lz from the
 * panel: LANTERN_RADIUS * Pz / (Lz - Pz), at most PENUMBRA_MAX.
 */
export function penumbra(Pz: number, Lz: number): number {
  const d = Lz - Pz;
  if (!(d > 0)) return PENUMBRA_MAX;
  return Math.min((LANTERN_RADIUS * Pz) / d, PENUMBRA_MAX);
}

const cross = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
const signedArea2 = (p: V2[]) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j]![0] * p[i]![1] - p[i]![0] * p[j]![1];
  return a;
};

/** p in triangle abc (inclusive), whichever way abc winds. */
function inTri(p: V2, a: V2, b: V2, c: V2): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Interior triangles of a polygon as corner indices (3 each), or null when it is convex and a fan from
 * corner 0 does. Ear clipping, either winding; run once per element, never per frame.
 */
export function triangulate(poly: V2[]): Uint16Array | null {
  const n = poly.length;
  const o = signedArea2(poly) < 0 ? -1 : 1;
  let convex = true;
  for (let i = 0; i < n && convex; i++) {
    if (o * cross(poly[(i + n - 1) % n]!, poly[i]!, poly[(i + 1) % n]!) < -1e-12) convex = false;
  }
  if (convex) return null;
  const idx = Array.from({ length: n }, (_, i) => i), out: number[] = [];
  while (idx.length > 3) {
    let cut = -1;
    for (let k = 0; k < idx.length && cut < 0; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length]!, i1 = idx[k]!, i2 = idx[(k + 1) % idx.length]!;
      const a = poly[i0]!, b = poly[i1]!, c = poly[i2]!;
      if (o * cross(a, b, c) <= 1e-14) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(poly[j]!, a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) cut = k;
    }
    if (cut < 0) throw new Error(`triangulate: no ear in a ${n}-corner polygon (it crosses itself)`);
    out.push(idx[(cut + idx.length - 1) % idx.length]!, idx[cut]!, idx[(cut + 1) % idx.length]!);
    idx.splice(cut, 1);
  }
  out.push(idx[0]!, idx[1]!, idx[2]!);
  return Uint16Array.from(out);
}

/** What a mesh slot holds: `count` corners, filled by `tris` (null: a fan), or a ring (outer corners, then inner). */
export interface ShadowShape {
  readonly count: number;
  readonly tris: Uint16Array | null;
  readonly ring: boolean;
}

/** One slot's vertices and indices in the buffers. */
export interface ShadowSlot {
  v0: number;
  vCount: number;
  i0: number;
  iCount: number;
}

/**
 * The panel's shadows as one mesh, in box units on the panel plane. A slot of `c` corners uses 2c
 * vertices (the corners at full shadow, then their skirt at none) and 9c - 6 indices; a ring of
 * c = 2k corners uses 4k vertices (outer, hole edge, the hole's inner skirt edge, outer skirt) and 18k
 * indices. The vertex attribute `aAlpha` is the shadow's strength.
 */
export class ShadowMesh {
  readonly mesh: Mesh;
  /** x, y, z per vertex (z stays 0; the mesh sits on the panel). */
  readonly positions: Float32Array;
  readonly alphas: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  private readonly posAttr: LiveBufferAttribute;
  private readonly alphaAttr: LiveBufferAttribute;
  private readonly indexAttr: LiveBufferAttribute;
  private readonly vStart: Int32Array;
  private readonly iStart: Int32Array;
  private readonly counts: Int32Array;
  private readonly rings: Uint8Array;
  private shapes = -1;
  private nVerts = 0;
  private nIndex = 0;
  /** The next free vertex and index while laying out. */
  private cv = 0;
  private cix = 0;

  constructor(
    readonly maxPolys: number,
    readonly maxVertsPerPoly: number,
  ) {
    const V = 2 * maxPolys * maxVertsPerPoly, I = 9 * maxPolys * maxVertsPerPoly;
    this.positions = new Float32Array(V * 3);
    this.alphas = new Float32Array(V);
    this.indices = V > 0xffff ? new Uint32Array(I) : new Uint16Array(I);
    this.vStart = new Int32Array(maxPolys);
    this.iStart = new Int32Array(maxPolys);
    this.counts = new Int32Array(maxPolys);
    this.rings = new Uint8Array(maxPolys);
    this.posAttr = new LiveBufferAttribute(this.positions, 3);
    this.alphaAttr = new LiveBufferAttribute(this.alphas, 1);
    this.indexAttr = new LiveBufferAttribute(this.indices, 1);
    const g = new BufferGeometry();
    g.setAttribute("position", this.posAttr);
    g.setAttribute("aAlpha", this.alphaAttr);
    g.setIndex(this.indexAttr);
    g.setDrawRange(0, 0);
    // A stand-in until the panel's shadow shader takes over (the box scene sets it).
    this.mesh = new Mesh(g, new MeshBasicMaterial({ color: COLORS.panelShadow, side: DoubleSide, depthWrite: false }));
    this.mesh.name = "Shadows";
    // It never leaves the panel, which is always in view; bounds would go stale every frame.
    this.mesh.frustumCulled = false;
  }

  get vertexCount(): number {
    return this.nVerts;
  }

  get indexCount(): number {
    return this.nIndex;
  }

  /** Where slot i lives in the buffers. Allocates: for tests. */
  slot(i: number): ShadowSlot {
    const c = this.counts[i]!;
    return { v0: this.vStart[i]!, vCount: 2 * c, i0: this.iStart[i]!, iCount: this.rings[i] ? 9 * c : 9 * c - 6 };
  }

  /**
   * Lay out slots [0, n) (once per box, or when the set of casters changes): indices and strengths.
   * Allocation-free.
   */
  setShapes(shapes: readonly ShadowShape[], n: number): void {
    if (n > this.maxPolys) throw new Error(`ShadowMesh: ${n} polygons, room for ${this.maxPolys}`);
    this.cv = 0;
    this.cix = 0;
    for (let i = 0; i < n; i++) {
      const s = shapes[i]!;
      this.place(i, s.count, s.tris, s.ring);
    }
    this.finish(n);
  }

  /**
   * Write the shadows: polygon i's corners `polys[i]` (box units on the panel), its skirt `soft[i]`
   * wide. Slots keep their shapes from setShapes; polygons that do not match them (or with no
   * setShapes yet) are laid out as fans first. Allocation-free.
   */
  update(polys: readonly V2[][], n: number, soft: Float32Array): void {
    if (!this.matches(polys, n)) {
      if (n > this.maxPolys) throw new Error(`ShadowMesh: ${n} polygons, room for ${this.maxPolys}`);
      this.cv = 0;
      this.cix = 0;
      for (let i = 0; i < n; i++) this.place(i, polys[i]!.length, null, false);
      this.finish(n);
    }
    for (let i = 0; i < n; i++) {
      const poly = polys[i]!, c = poly.length, s = soft[i]!, v = this.vStart[i]!;
      if (this.rings[i]) {
        const k = c >> 1;
        this.outline(poly, 0, k, s, v, v + 3 * k, k);
        this.outline(poly, k, k, s, v + k, v + 2 * k, 0);
      } else this.outline(poly, 0, c, s, v, v + c, -1);
    }
    this.posAttr.commit(this.nVerts);
  }

  private matches(polys: readonly V2[][], n: number): boolean {
    if (n !== this.shapes) return false;
    for (let i = 0; i < n; i++) if (polys[i]!.length !== this.counts[i]) return false;
    return true;
  }

  private finish(n: number): void {
    const v = this.cv, ix = this.cix;
    this.shapes = n;
    this.nVerts = v;
    this.nIndex = ix;
    this.mesh.geometry.setDrawRange(0, ix);
    this.alphaAttr.commit(v);
    this.indexAttr.commit(ix);
  }

  /** Lay out slot i with c corners at the next free vertex and index (cv, cix), and move them on. */
  private place(i: number, c: number, tris: Uint16Array | null, ring: boolean): void {
    const v = this.cv;
    let ix = this.cix;
    if (c > this.maxVertsPerPoly) throw new Error(`ShadowMesh: a ${c}-corner polygon, room for ${this.maxVertsPerPoly}`);
    const A = this.alphas, I = this.indices;
    this.vStart[i] = v;
    this.iStart[i] = ix;
    this.counts[i] = c;
    this.rings[i] = ring ? 1 : 0;
    if (ring) {
      if (c % 2) throw new Error("ShadowMesh: a ring needs as many inner corners as outer ones");
      // Vertices: O (outer, full), H (hole edge, none), B (the hole's skirt edge, full), S (outer skirt, none).
      const k = c >> 1, O = v, H = v + k, B = v + 2 * k, S = v + 3 * k;
      for (let j = 0; j < k; j++) {
        A[O + j] = 1;
        A[H + j] = 0;
        A[B + j] = 1;
        A[S + j] = 0;
      }
      for (let j = 0; j < k; j++) {
        const n = (j + 1) % k;
        // The solid body between the hole's skirt and the outer edge, the hole's skirt, the outer skirt.
        I[ix++] = B + j; I[ix++] = O + j; I[ix++] = O + n;
        I[ix++] = B + j; I[ix++] = O + n; I[ix++] = B + n;
        I[ix++] = H + j; I[ix++] = B + j; I[ix++] = B + n;
        I[ix++] = H + j; I[ix++] = B + n; I[ix++] = H + n;
        I[ix++] = O + j; I[ix++] = S + j; I[ix++] = S + n;
        I[ix++] = O + j; I[ix++] = S + n; I[ix++] = O + n;
      }
      this.cv = v + 2 * c;
      this.cix = ix;
      return;
    }
    const P = v, S = v + c;
    for (let j = 0; j < c; j++) {
      A[P + j] = 1;
      A[S + j] = 0;
    }
    if (tris) {
      if (tris.length !== 3 * (c - 2)) throw new Error(`ShadowMesh: ${tris.length / 3} triangles for ${c} corners`);
      for (let t = 0; t < tris.length; t++) I[ix++] = P + tris[t]!;
    } else {
      for (let j = 1; j < c - 1; j++) {
        I[ix++] = P; I[ix++] = P + j; I[ix++] = P + j + 1;
      }
    }
    for (let j = 0; j < c; j++) {
      const n = (j + 1) % c;
      I[ix++] = P + j; I[ix++] = S + j; I[ix++] = S + n;
      I[ix++] = P + j; I[ix++] = S + n; I[ix++] = P + n;
    }
    this.cv = v + 2 * c;
    this.cix = ix;
  }

  /**
   * Corners poly[from, from + c) go to vertices from `at`, and each again offset `s` outward (by the
   * polygon's own winding, so either winding works) to vertices from `out`. The offset is the miter of
   * the two edges' normals, so the skirt's outer edge runs parallel to each edge exactly `s` away (up to
   * MITER_LIMIT at sharp corners). With `pair` >= 0 (a ring), each corner's offset is held to half its
   * distance from corner `pair + j` (the matching corner of the ring's other edge).
   */
  private outline(poly: readonly V2[], from: number, c: number, s: number, at: number, out: number, pair: number): void {
    const P = this.positions;
    const o = this.orient(poly, from, c);
    // The normal of the edge into corner 0 (from the last corner).
    let p = poly[from + c - 1]!, q = poly[from]!;
    let dx = q[0] - p[0], dy = q[1] - p[1], len = Math.sqrt(dx * dx + dy * dy);
    let pnx = len > 1e-12 ? (o * dy) / len : 0, pny = len > 1e-12 ? (-o * dx) / len : 0;
    for (let j = 0; j < c; j++) {
      p = poly[from + j]!;
      q = poly[from + ((j + 1) % c)]!;
      dx = q[0] - p[0];
      dy = q[1] - p[1];
      len = Math.sqrt(dx * dx + dy * dy);
      let nnx = pnx, nny = pny;
      if (len > 1e-12) {
        nnx = (o * dy) / len;
        nny = (-o * dx) / len;
      }
      let mx = pnx + nnx, my = pny + nny;
      const d = 1 + pnx * nnx + pny * nny;
      if (d < 1e-6) {
        // A hairpin: go straight out along the edge.
        mx = nnx;
        my = nny;
      } else {
        mx /= d;
        my /= d;
      }
      const ml2 = mx * mx + my * my;
      if (ml2 > MITER_LIMIT * MITER_LIMIT) {
        const k = MITER_LIMIT / Math.sqrt(ml2);
        mx *= k;
        my *= k;
      }
      let w = s;
      if (pair >= 0) {
        // A ring's edge: at most half the ring's width here (outer corner j against inner corner j).
        const m = poly[pair + j]!;
        const ex = m[0] - p[0], ey = m[1] - p[1], d2 = ex * ex + ey * ey;
        if (4 * w * w > d2) w = 0.5 * Math.sqrt(d2);
      }
      const a = (at + j) * 3, b = (out + j) * 3;
      P[a] = p[0];
      P[a + 1] = p[1];
      P[b] = p[0] + mx * w;
      P[b + 1] = p[1] + my * w;
      pnx = nnx;
      pny = nny;
    }
  }

  /** 1 for counter-clockwise corners poly[from, from + c), -1 for clockwise. */
  private orient(poly: readonly V2[], from: number, c: number): number {
    let a = 0;
    for (let i = 0, j = c - 1; i < c; j = i++) {
      const pj = poly[from + j]!, pi = poly[from + i]!;
      a += pj[0] * pi[1] - pi[0] * pj[1];
    }
    return a < 0 ? -1 : 1;
  }
}

/** One element's shadow: its 3D corners, where their projection goes, and its slot's shape. */
interface Caster {
  el: BoxElement;
  /** The piece, for its visibility; null for decoys and rings. */
  piece: Piece | null;
  pts: V3[];
  poly: V2[];
  /** Depth for the penumbra: the average of its corners'. */
  z: number;
  shape: ShadowShape;
  on: boolean;
  slot: number;
}

const EMPTY: V2[] = [];
const NO_SHAPE: ShadowShape = { count: 0, tris: null, ring: false };

/**
 * A box's shadows on the panel: every scrap, decoy and ring, cast from the lantern into a ShadowMesh.
 * `shown(piece)` says whether a lock piece is there (a finger lock's missing piece is not, until it
 * crystallises); by default every piece but the missing ones.
 */
export class BoxShadows {
  readonly mesh: ShadowMesh;
  private casters: Caster[] = [];
  private readonly polys: V2[][] = Array.from({ length: MAX_CASTERS }, () => EMPTY);
  private readonly shapes: ShadowShape[] = Array.from({ length: MAX_CASTERS }, () => NO_SHAPE);
  private readonly soft = new Float32Array(MAX_CASTERS);
  private n = 0;
  private dirty = true;
  private readonly at: V3 = [0, 0, 0];
  private readonly last: V3 = [NaN, NaN, NaN];

  constructor(
    private readonly shown: (p: Piece) => boolean = (p) => !p.missing,
    mesh?: ShadowMesh,
  ) {
    this.mesh = mesh ?? new ShadowMesh(MAX_CASTERS, MAX_CASTER_CORNERS);
  }

  /** Make every element's caster (once per box); null for no box. */
  setBox(box: Box | null): void {
    const casters: Caster[] = [];
    for (const el of box?.elements ?? []) {
      if (el.kind === "ring") {
        const pts = [...circlePts(el.c, el.nrm, el.rOut, RING_SIDES), ...circlePts(el.c, el.nrm, el.rIn, RING_SIDES)];
        casters.push({
          el, piece: null, pts, poly: pts.map((): V2 => [0, 0]), z: el.c[2], on: true, slot: -1,
          shape: { count: pts.length, tris: null, ring: true },
        });
        continue;
      }
      // Concave or not is decided where the shadow is meant to be seen: a piece from its lock's spot
      // (its outline), a decoy straight on.
      const ref: V2[] = el.kind === "piece" ? box!.locks[el.lock]!.target[el.piece]! : el.verts.map(([x, y]): V2 => [x, y]);
      const z = el.verts.reduce((s, v) => s + v[2], 0) / el.verts.length;
      casters.push({
        el, piece: el.kind === "piece" ? el : null, pts: el.verts, poly: el.verts.map((): V2 => [0, 0]), z, on: true, slot: -1,
        shape: { count: el.verts.length, tris: triangulate(ref), ring: false },
      });
    }
    if (casters.length > MAX_CASTERS) throw new Error(`BoxShadows: ${casters.length} casters, room for ${MAX_CASTERS}`);
    for (const c of casters) {
      if (c.pts.length > MAX_CASTER_CORNERS) throw new Error(`BoxShadows: a ${c.pts.length}-corner scrap`);
    }
    this.casters = casters;
    this.dirty = true;
    this.last[0] = NaN;
    this.mesh.mesh.visible = casters.length > 0;
    if (!casters.length) this.mesh.setShapes(this.shapes, 0);
  }

  /** The mesh slot an element's shadow is in now, or -1 (not cast, or not in this box). */
  slotOf(el: BoxElement): number {
    for (const c of this.casters) if (c.el === el) return c.on ? c.slot : -1;
    return -1;
  }

  /** Cast with the lantern at L only if it moved or a scrap appeared or went; true when it cast. */
  refresh(L: V3): boolean {
    const moved = L[0] !== this.last[0] || L[1] !== this.last[1] || L[2] !== this.last[2];
    if (!moved && !this.visibilityChanged()) return false;
    this.cast(L);
    return true;
  }

  /** Cast every shadow with the lantern at L (box units). Allocation-free. */
  cast(L: V3): void {
    this.last[0] = L[0];
    this.last[1] = L[1];
    this.last[2] = L[2];
    const cs = this.casters;
    if (!cs.length) return;
    this.visibilityChanged();
    if (this.dirty) this.layout();
    const at = this.at;
    at[0] = L[0];
    at[1] = L[1];
    at[2] = L[2] > LZ_MIN ? L[2] : LZ_MIN;
    const soft = this.soft;
    let k = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!;
      if (!c.on) continue;
      const pts = c.pts, poly = c.poly;
      for (let j = 0; j < pts.length; j++) projInto(pts[j]!, at, poly[j]!);
      const pen = penumbra(c.z, at[2]);
      soft[k++] = pen > SOFT_MIN ? pen : SOFT_MIN;
    }
    this.mesh.update(this.polys, this.n, soft);
  }

  /** Updates each piece's `on` (a change marks the layout dirty); true when any changed. */
  private visibilityChanged(): boolean {
    const cs = this.casters;
    let changed = false;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!;
      if (!c.piece) continue;
      const on = this.shown(c.piece);
      if (on !== c.on) {
        c.on = on;
        changed = true;
      }
    }
    if (changed) this.dirty = true;
    return changed;
  }

  private layout(): void {
    const cs = this.casters;
    let n = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!;
      c.slot = c.on ? n : -1;
      if (!c.on) continue;
      this.polys[n] = c.poly;
      this.shapes[n] = c.shape;
      n++;
    }
    this.n = n;
    this.mesh.setShapes(this.shapes, n);
    this.dirty = false;
  }
}
