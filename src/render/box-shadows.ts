// What a box casts on its back panel, frame by frame: every scrap, decoy and ring of the box, projected from the
// lantern into one ShadowMesh (shadow-mesh.ts draws them), then up to MAX_EXTRAS extra shadows after them (a
// crystallised piece, the hands' bones, a lesson's ghost hand). It decides when a cast is needed (the lantern moved,
// a piece appeared or went, the extras changed), keeps each element's slot, and follows a lesson's scraps when they
// are moved in place. Casters are made once per box; a frame allocates nothing.
//
// A cast redoes only what changed since the last one: the box's casters are projected again only when the lantern
// (bit for bit), their poses (moved()) or the layout changed, and the mesh rebuilds only the slots whose polygon or
// softness differs from what it drew there last (extra shadows are compared value by value). What it skips it would
// have rewritten with the very same numbers, so the mesh holds exactly what a full cast writes.
import { circlePts, projInto } from "../core/geom";
import { RING_SIDES } from "../core/solve";
import type { Box, Element as BoxElement, Piece, V2, V3 } from "../core/types";
import { LANTERN_RADIUS, PENUMBRA_MAX, SOFT_MIN, ShadowMesh, type ShadowShape, triangulate } from "./shadow-mesh";

/** Shadow casters in a box: 3 locks of up to 16 pieces, 20 decoys, 8 rings (as Scraps sizes them). */
export const MAX_CASTERS = 3 * 16 + 20 + 8;
/**
 * Extra shadows after the box's: crystallised pieces, then hands' bones as capsules (18 a hand): two hands and a
 * lesson's ghost hand.
 */
export const MAX_EXTRAS = 60;
/** Corners in one caster's polygon: a ring's outer and inner RING_SIDES-gons. */
export const MAX_CASTER_CORNERS = 2 * RING_SIDES;
/** Shadows are cast with the lantern at least this far from the panel (every scrap is nearer). */
const LZ_MIN = 0.85;
/**
 * SOFT_MIN, PENUMBRA_MAX and LANTERN_RADIUS as raw doubles, read once a cast. Imported constants are read as boxed
 * numbers, and a conditional between one and a computed float boxed the result: one heap number per shadow a frame.
 * The very same values.
 */
const K = Float64Array.of(SOFT_MIN, PENUMBRA_MAX, LANTERN_RADIUS);

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
const SLOTS = MAX_CASTERS + MAX_EXTRAS;

/**
 * circlePts (core/geom.ts) written into out[from..from + RING_SIDES): the same corners, made without allocating.
 */
function circleInto(c: Readonly<V3>, n: Readonly<V3>, r: number, out: V3[], from: number): void {
  // e1 = unit(n x helper), e2 = n x e1, the helper +y unless n runs near it.
  const hy = Math.abs(n[1]) < 0.9;
  let ax: number, ay: number, az: number;
  if (hy) {
    ax = -n[2];
    ay = 0;
    az = n[0];
  } else {
    ax = 0;
    ay = n[2];
    az = -n[1];
  }
  const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  ax /= l;
  ay /= l;
  az /= l;
  const bx = n[1] * az - n[2] * ay, by = n[2] * ax - n[0] * az, bz = n[0] * ay - n[1] * ax;
  for (let i = 0; i < RING_SIDES; i++) {
    const a = (i / RING_SIDES) * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r, p = out[from + i]!;
    p[0] = c[0] + ax * ca + bx * sa;
    p[1] = c[1] + ay * ca + by * sa;
    p[2] = c[2] + az * ca + bz * sa;
  }
}

/**
 * A box's shadows on the panel: every scrap, decoy and ring, cast from the lantern into a ShadowMesh,
 * then up to MAX_EXTRAS extra shadows (a hand's bones) after them. `shown(piece)` says whether a lock
 * piece is there (a finger lock's missing piece is not, until it crystallises); by default every piece
 * but the missing ones.
 */
export class BoxShadows {
  readonly mesh: ShadowMesh;
  private casters: Caster[] = [];
  private readonly polys: V2[][] = Array.from({ length: MAX_CASTERS + MAX_EXTRAS }, () => EMPTY);
  private readonly shapes: ShadowShape[] = Array.from({ length: MAX_CASTERS }, () => NO_SHAPE);
  private readonly soft = new Float32Array(MAX_CASTERS + MAX_EXTRAS);
  private n = 0;
  private dirty = true;
  /** Extra shadows drawn by the last cast. */
  private extras = 0;
  private readonly at: V3 = [0, 0, 0];
  private readonly last: V3 = [NaN, NaN, NaN];
  /** Where the box's casters were last projected from (the clamped lantern), NaN when they must be again. */
  private readonly castAt = new Float64Array([NaN, NaN, NaN]);
  /** Per mesh slot: 1 when the slot's polygon and softness are what the mesh drew there last (ShadowMesh.update). */
  private readonly same = new Uint8Array(SLOTS);
  /** What each slot after the box's last drew: its corners (x, y), corner count (-1: nothing known) and softness. */
  private readonly drawnXY = new Float64Array(SLOTS * MAX_CASTER_CORNERS * 2);
  private readonly drawnCount = new Int32Array(SLOTS).fill(-1);
  private readonly drawnSoft = new Float64Array(SLOTS);
  /** Whether the last cast projected the box's casters again: for tests. */
  private projectedBox = false;

  constructor(
    private readonly shown: (p: Piece) => boolean = (p) => !p.missing,
    mesh?: ShadowMesh,
  ) {
    this.mesh = mesh ?? new ShadowMesh(MAX_CASTERS + MAX_EXTRAS, MAX_CASTER_CORNERS);
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
    this.extras = 0;
    this.forget();
    this.mesh.mesh.visible = casters.length > 0;
    if (!casters.length) {
      this.n = 0;
      this.mesh.setShapes(this.shapes, 0);
    }
  }

  /**
   * The box's elements were moved in place (a lesson's scraps swinging): pieces cast from their own corners already,
   * rings' circles are made again here, and the next refresh casts. Allocation-free.
   */
  moved(): void {
    for (const c of this.casters) {
      const el = c.el;
      if (el.kind !== "ring") continue;
      c.z = el.c[2];
      circleInto(el.c, el.nrm, el.rOut, c.pts, 0);
      circleInto(el.c, el.nrm, el.rIn, c.pts, RING_SIDES);
    }
    this.last[0] = NaN;
    this.castAt[0] = NaN;
  }

  /**
   * Cast everything again on the next refresh, every slot rebuilt from scratch (a restored GPU context: what the mesh
   * holds is uploaded again anyway, this only makes sure of it). Allocation-free.
   */
  invalidate(): void {
    this.last[0] = NaN;
    this.forget();
  }

  /** Whether the last cast projected the box's casters again (the lantern, a pose or the layout changed). For tests. */
  get projected(): boolean {
    return this.projectedBox;
  }

  /** Nothing about the last cast is known any more: the next one projects and rebuilds every slot. */
  private forget(): void {
    this.castAt[0] = NaN;
    this.drawnCount.fill(-1);
  }

  /** The mesh slot an element's shadow is in now, or -1 (not cast, or not in this box). */
  slotOf(el: BoxElement): number {
    for (const c of this.casters) if (c.el === el) return c.on ? c.slot : -1;
    return -1;
  }

  /** How many slots the box's own shadows take now; extra shadows come after them. */
  get boxSlots(): number {
    return this.n;
  }

  /**
   * Cast with the lantern at L and `nExtra` extra shadows (none by default) only if the lantern moved, a
   * scrap appeared or went, the number of extras changed (so the last cast's extras go once they are
   * gone), or the caller says the extras themselves changed (`extraChanged`: a hand moved, a piece grew);
   * true when it cast. The one place that decides whether the shadows need casting.
   */
  refresh(L: V3, extra?: readonly V2[][], nExtra = 0, extraSoft?: Float32Array, extraChanged = false): boolean {
    const moved = L[0] !== this.last[0] || L[1] !== this.last[1] || L[2] !== this.last[2];
    if (!moved && !this.visibilityChanged() && nExtra === this.extras && !extraChanged) return false;
    // Visibility was brought up to date just above (or the lantern moved and cast's own check does it).
    this.cast(L, extra, nExtra, extraSoft);
    return true;
  }

  /**
   * Cast every shadow with the lantern at L (box units), then `nExtra` extra shadows: polygons on the
   * panel already (a hand's bones projected by the caller), filled as fans, `extraSoft[i]` soft. Adding
   * or removing extras lays out only the slots after the box's. Allocation-free.
   */
  cast(L: V3, extra?: readonly V2[][], nExtra = 0, extraSoft?: Float32Array): void {
    if (nExtra > MAX_EXTRAS) throw new Error(`BoxShadows: ${nExtra} extra shadows, room for ${MAX_EXTRAS}`);
    this.last[0] = L[0];
    this.last[1] = L[1];
    this.last[2] = L[2];
    const cs = this.casters;
    this.visibilityChanged();
    if (this.dirty) this.layout();
    const at = this.at, castAt = this.castAt, same = this.same;
    at[0] = L[0];
    at[1] = L[1];
    at[2] = L[2] > LZ_MIN ? L[2] : LZ_MIN;
    const soft = this.soft, Lz = at[2], k = this.n, softMin = K[0]!, penMax = K[1]!, radius = K[2]!;
    // The box's casters project to the same corners as last time when the clamped lantern is the same, bit for bit
    // (0 and -0 told apart: they can project to 0 and -0), and nothing else changed (moved(), the layout and a new
    // box clear castAt).
    const ax = at[0], ay = at[1], bx = castAt[0]!, by = castAt[1]!, bz = castAt[2]!;
    const still =
      ax === bx && ay === by && Lz === bz && (ax !== 0 || 1 / ax === 1 / bx) && (ay !== 0 || 1 / ay === 1 / by) && (Lz !== 0 || 1 / Lz === 1 / bz);
    this.projectedBox = !still;
    if (still) {
      for (let i = 0; i < k; i++) same[i] = 1;
    } else {
      let s = 0;
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]!;
        if (!c.on) continue;
        const pts = c.pts, poly = c.poly;
        for (let j = 0; j < pts.length; j++) projInto(pts[j]!, at, poly[j]!);
        // penumbra(c.z, Lz), written out: a float returned from a call the engine did not inline is boxed.
        const z = c.z, d = Lz - z;
        let pen = d > 0 ? (radius * z) / d : penMax;
        if (pen > penMax) pen = penMax;
        soft[s] = pen > softMin ? pen : softMin;
        same[s++] = 0;
      }
      castAt[0] = ax;
      castAt[1] = ay;
      castAt[2] = Lz;
    }
    const polys = this.polys, xy = this.drawnXY, counts = this.drawnCount, softs = this.drawnSoft;
    for (let e = 0; e < nExtra; e++) {
      const slot = k + e, poly = extra![e]!, c = poly.length;
      polys[slot] = poly;
      const s = extraSoft ? extraSoft[e]! : softMin;
      soft[slot] = s > softMin ? s : softMin;
      // Compared with what this slot last drew, value by value (0 and -0 told apart), as stored in the soft array.
      const sf = soft[slot]!, was = softs[slot]!;
      let eq = counts[slot] === c && sf === was && (sf !== 0 || 1 / sf === 1 / was);
      const o = slot * MAX_CASTER_CORNERS * 2;
      for (let j = 0; eq && j < c; j++) {
        const p = poly[j]!, x = p[0], y = p[1], px = xy[o + 2 * j]!, py = xy[o + 2 * j + 1]!;
        eq = x === px && y === py && (x !== 0 || 1 / x === 1 / px) && (y !== 0 || 1 / y === 1 / py);
      }
      same[slot] = eq ? 1 : 0;
      if (eq) continue;
      if (c > MAX_CASTER_CORNERS) {
        // The mesh refuses it (and says why); nothing to remember.
        counts[slot] = -1;
        continue;
      }
      counts[slot] = c;
      softs[slot] = sf;
      for (let j = 0; j < c; j++) {
        const p = poly[j]!;
        xy[o + 2 * j] = p[0];
        xy[o + 2 * j + 1] = p[1];
      }
    }
    this.extras = nExtra;
    if (k + nExtra) this.mesh.update(polys, k + nExtra, soft, same);
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
    // Every slot may hold another polygon now.
    this.forget();
  }
}
