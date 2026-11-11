// Every shadow on the back panel in one draw call. Each scrap's shadow is its polygon projected from
// the lantern: an opaque interior (a fan, or triangles worked out once for a concave polygon) and a
// soft skirt around it, offset outward by the penumbra and fading from full shadow to none. Depth
// shows as softness: a scrap near the panel casts a crisp edge, one near the lantern a soft one.
//
// The skirt is a true offset: a strip `soft` wide along every edge, a rounded cap round every convex
// corner (so a sharp point never throws a spike past its penumbra) and a miter into every reflex one.
// Nothing it draws is further than `soft` from its polygon.
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
// After the shapes laid out come extra shadows (a hand's bones in the beam), as fans; adding or removing
// them lays out only that tail, never the shapes' slots. What a box casts, and when, is BoxShadows's
// (box-shadows.ts); this file only turns shadow polygons into the one soft-edged mesh.
//
// Buffers are made once (the largest box and both hands); a new box rewrites the index once, and a
// frame writes only positions, and only for the slots whose polygon changed (the caller says which did not). No
// allocation per frame.
import { BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial } from "@iwsdk/core";
import type { V2 } from "../core/types";
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
/** A reflex corner's miter reaches at most this many skirt widths from it (a deep notch). */
export const REFLEX_MITER_LIMIT = 2;

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

/** Vertices and indices a slot of c corners uses: a polygon (c corners, 3 skirt points each), or a ring. */
const vertsFor = (c: number, ring: boolean) => (ring ? 2 * c : 4 * c);
const indicesFor = (c: number, ring: boolean) => (ring ? 9 * c : 15 * c - 6);

/**
 * The panel's shadows as one mesh, in box units on the panel plane. A polygon slot of `c` corners uses
 * 4c vertices (its corners at full shadow, then three skirt points per corner at none: along the edge
 * coming in, round the corner, along the edge going out) and 15c - 6 indices. A ring of c = 2k corners
 * uses 4k vertices (outer, hole edge, the hole's skirt edge, outer skirt) and 18k indices. The vertex
 * attribute `aAlpha` is the shadow's strength.
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
  /** 1 for a slot whose positions were written since it was last laid out. */
  private readonly fresh: Uint8Array;
  /** Slots whose positions the last update wrote. */
  private wrote = 0;
  /** Slots laid out, from 0. */
  private laid = 0;
  /** The vertices and indices the slots drawn now use. */
  private nVerts = 0;
  private nIndex = 0;

  constructor(
    readonly maxPolys: number,
    readonly maxVertsPerPoly: number,
  ) {
    const V = vertsFor(maxVertsPerPoly, false) * maxPolys, I = indicesFor(maxVertsPerPoly, false) * maxPolys;
    this.positions = new Float32Array(V * 3);
    this.alphas = new Float32Array(V);
    this.indices = V > 0xffff ? new Uint32Array(I) : new Uint16Array(I);
    this.vStart = new Int32Array(maxPolys);
    this.iStart = new Int32Array(maxPolys);
    this.counts = new Int32Array(maxPolys);
    this.rings = new Uint8Array(maxPolys);
    this.fresh = new Uint8Array(maxPolys);
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

  /** How many slots the last update wrote (the rest it kept): for tests. */
  get written(): number {
    return this.wrote;
  }

  /** Where slot i lives in the buffers. Allocates: for tests. */
  slot(i: number): ShadowSlot {
    const c = this.counts[i]!, r = this.rings[i] === 1;
    return { v0: this.vStart[i]!, vCount: vertsFor(c, r), i0: this.iStart[i]!, iCount: indicesFor(c, r) };
  }

  /**
   * Lay out slots [0, n) (once per box, or when the box's casters change): indices and strengths.
   * Allocation-free.
   */
  setShapes(shapes: readonly ShadowShape[], n: number): void {
    if (n > this.maxPolys) throw new Error(`ShadowMesh: ${n} polygons, room for ${this.maxPolys}`);
    for (let i = 0; i < n; i++) {
      const s = shapes[i]!;
      this.place(i, s.count, s.tris, s.ring);
    }
    this.laid = n;
    this.commitLayout(n);
    this.setDrawn(n);
  }

  /**
   * Write the shadows: polygon i's corners `polys[i]` (box units on the panel), its skirt `soft[i]`
   * wide. Slots keep their layout while their corner counts match; from the first that does not (or
   * past the last laid out: extra shadows after the box's), the rest are laid out again as fans, so the
   * slots before it, rings and concave shapes among them, are never touched. `same[i]` 1: polygon i and
   * its softness are exactly what this slot was last written with, so it is kept as it is (unless it was
   * laid out since: then it is written). Allocation-free.
   */
  update(polys: readonly V2[][], n: number, soft: Float32Array, same?: Uint8Array): void {
    if (n > this.maxPolys) throw new Error(`ShadowMesh: ${n} polygons, room for ${this.maxPolys}`);
    let k = 0;
    while (k < n && k < this.laid && polys[k]!.length === this.counts[k]) k++;
    if (k < n) {
      for (let i = k; i < n; i++) this.place(i, polys[i]!.length, null, false);
      this.laid = n;
      this.commitLayout(n);
    }
    this.setDrawn(n);
    // The skirt widths go as the array and an index, never as a float argument: a float crossing a call the engine
    // did not inline is boxed, once per shadow per frame.
    const fresh = this.fresh;
    let wrote = 0;
    for (let i = 0; i < n; i++) {
      if (same !== undefined && same[i] === 1 && fresh[i] === 1) continue;
      const poly = polys[i]!, c = poly.length, v = this.vStart[i]!;
      if (this.rings[i]) {
        const h = c >> 1;
        this.ringEdge(poly, 0, h, soft, i, v, v + 3 * h, h);
        this.ringEdge(poly, h, h, soft, i, v + h, v + 2 * h, 0);
      } else this.roundEdge(poly, c, soft, i, v);
      fresh[i] = 1;
      wrote++;
    }
    this.wrote = wrote;
    // Uploaded as before, written or kept: the GPU gets the same bytes at the same moments.
    this.posAttr.commit(this.nVerts);
  }

  /** Draw slots [0, n). */
  private setDrawn(n: number): void {
    const last = n - 1;
    this.nVerts = n ? this.vStart[last]! + vertsFor(this.counts[last]!, this.rings[last] === 1) : 0;
    this.nIndex = n ? this.iStart[last]! + indicesFor(this.counts[last]!, this.rings[last] === 1) : 0;
    this.mesh.geometry.setDrawRange(0, this.nIndex);
  }

  /** Upload the layout of slots [0, n). */
  private commitLayout(n: number): void {
    const last = n - 1;
    this.alphaAttr.commit(n ? this.vStart[last]! + vertsFor(this.counts[last]!, this.rings[last] === 1) : 0);
    this.indexAttr.commit(n ? this.iStart[last]! + indicesFor(this.counts[last]!, this.rings[last] === 1) : 0);
  }

  /** Lay out slot i with c corners right after slot i - 1. */
  private place(i: number, c: number, tris: Uint16Array | null, ring: boolean): void {
    if (c > this.maxVertsPerPoly) throw new Error(`ShadowMesh: a ${c}-corner polygon, room for ${this.maxVertsPerPoly}`);
    if (c < 3) throw new Error(`ShadowMesh: a ${c}-corner polygon`);
    const prev = i - 1;
    const v = i ? this.vStart[prev]! + vertsFor(this.counts[prev]!, this.rings[prev] === 1) : 0;
    let ix = i ? this.iStart[prev]! + indicesFor(this.counts[prev]!, this.rings[prev] === 1) : 0;
    const A = this.alphas, I = this.indices;
    this.fresh[i] = 0;
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
      return;
    }
    // Vertices: P (the corners, full), then per corner three skirt points (none): in, round, out.
    const P = v, S = v + c;
    for (let j = 0; j < c; j++) A[P + j] = 1;
    for (let j = 0; j < 3 * c; j++) A[S + j] = 0;
    if (tris) {
      if (tris.length !== 3 * (c - 2)) throw new Error(`ShadowMesh: ${tris.length / 3} triangles for ${c} corners`);
      for (let t = 0; t < tris.length; t++) I[ix++] = P + tris[t]!;
    } else {
      for (let j = 1; j < c - 1; j++) {
        I[ix++] = P; I[ix++] = P + j; I[ix++] = P + j + 1;
      }
    }
    for (let j = 0; j < c; j++) {
      const n = (j + 1) % c, a = S + 3 * j, b = S + 3 * n;
      // The corner's cap (two triangles round it), then the strip along the edge to the next corner.
      I[ix++] = P + j; I[ix++] = a; I[ix++] = a + 1;
      I[ix++] = P + j; I[ix++] = a + 1; I[ix++] = a + 2;
      I[ix++] = P + j; I[ix++] = a + 2; I[ix++] = b;
      I[ix++] = P + j; I[ix++] = b; I[ix++] = P + n;
    }
  }

  /**
   * A polygon's corners to vertices from `at`, and its skirt s = soft[si] wide (outward by the polygon's
   * own winding, so either winding works) to the three skirt points of each corner from `at + c`. Along
   * each edge the skirt runs parallel to it exactly `s` away. A convex corner gets a rounded cap: its
   * three points sit `s` from it along the incoming edge's normal, the bisector and the outgoing edge's
   * normal. A reflex corner's three points all sit on the miter, where the two edges' offsets meet
   * (at most REFLEX_MITER_LIMIT skirt widths away).
   */
  private roundEdge(poly: readonly V2[], c: number, soft: Float32Array, si: number, at: number): void {
    const P = this.positions, o = this.orient(poly, 0, c), out = at + c, s = soft[si]!;
    // The edge into corner 0 (from the last corner): its direction and outward normal.
    let p = poly[c - 1]!, q = poly[0]!;
    let dx = q[0] - p[0], dy = q[1] - p[1], len = Math.sqrt(dx * dx + dy * dy);
    let pex = len > 1e-12 ? dx / len : 0, pey = len > 1e-12 ? dy / len : 0;
    let pnx = o * pey, pny = -o * pex;
    for (let j = 0; j < c; j++) {
      p = poly[j]!;
      q = poly[(j + 1) % c]!;
      dx = q[0] - p[0];
      dy = q[1] - p[1];
      len = Math.sqrt(dx * dx + dy * dy);
      let nex = pex, ney = pey;
      if (len > 1e-12) {
        nex = dx / len;
        ney = dy / len;
      }
      const nnx = o * ney, nny = -o * nex;
      const a = (at + j) * 3, b = (out + 3 * j) * 3;
      P[a] = p[0];
      P[a + 1] = p[1];
      if (o * (pnx * nny - pny * nnx) > 1e-12) {
        // Convex: a rounded cap from the incoming edge's normal to the outgoing one's.
        let mx = pnx + nnx, my = pny + nny;
        const ml = Math.sqrt(mx * mx + my * my);
        if (ml < 1e-6) {
          // A hairpin: the cap's middle points along the point.
          mx = pex;
          my = pey;
        } else {
          mx /= ml;
          my /= ml;
        }
        P[b] = p[0] + pnx * s;
        P[b + 1] = p[1] + pny * s;
        P[b + 3] = p[0] + mx * s;
        P[b + 4] = p[1] + my * s;
        P[b + 6] = p[0] + nnx * s;
        P[b + 7] = p[1] + nny * s;
      } else {
        // Reflex (or straight): the miter, where both edges' offsets meet.
        let mx = pnx + nnx, my = pny + nny;
        const d = 1 + pnx * nnx + pny * nny;
        if (d < 1e-6) {
          mx = nnx;
          my = nny;
        } else {
          mx /= d;
          my /= d;
        }
        const ml2 = mx * mx + my * my;
        if (ml2 > REFLEX_MITER_LIMIT * REFLEX_MITER_LIMIT) {
          const k = REFLEX_MITER_LIMIT / Math.sqrt(ml2);
          mx *= k;
          my *= k;
        }
        const x = p[0] + mx * s, y = p[1] + my * s;
        P[b] = P[b + 3] = P[b + 6] = x;
        P[b + 1] = P[b + 4] = P[b + 7] = y;
      }
      pex = nex;
      pey = ney;
      pnx = nnx;
      pny = nny;
    }
  }

  /**
   * A ring's edge: corners poly[from, from + c) to vertices from `at`, and offset outward (by their own
   * winding) on the miter to vertices from `out`, s = soft[si] wide. A ring's corners turn only 360 /
   * RING_SIDES degrees, so the miter stays within 3% of `s`. Each offset is held to half the distance
   * from corner `pair + j` (the matching corner of the ring's other edge), so the body stays solid.
   */
  private ringEdge(poly: readonly V2[], from: number, c: number, soft: Float32Array, si: number, at: number, out: number, pair: number): void {
    const P = this.positions, s = soft[si]!;
    const o = this.orient(poly, from, c);
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
        mx = nnx;
        my = nny;
      } else {
        mx /= d;
        my /= d;
      }
      let w = s;
      const m = poly[pair + j]!;
      const ex = m[0] - p[0], ey = m[1] - p[1], d2 = ex * ex + ey * ey;
      if (4 * w * w > d2) w = 0.5 * Math.sqrt(d2);
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
