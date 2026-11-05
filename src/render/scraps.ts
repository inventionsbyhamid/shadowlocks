// The box's brass scraps, their threads and the sight rings, in three draw calls whatever the box:
// every scrap (and every thread's pin) in one merged mesh whose vertices carry a slot id, the threads
// as one LineSegments, the rings as one InstancedMesh. A slot holds a glow and a visibility, read by
// the shaders from one small uniform array, so lighting up a lock's scraps or showing a crystallised
// piece writes two floats, never a buffer. Buffers are sized once for the largest box; a new box
// rewrites them in place.
//
// Geometry rules: a scrap's front face looks toward the open front (+z) whatever its polygon's
// winding (Diamond pieces wind clockwise, and mirroring flips every polygon); each face is inset by a
// hair so pieces that meet edge to edge never share a face (no z-fighting); the scrap's thickness runs
// along the rays from its lock's lantern spot, so from the spot it still covers exactly its outline.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  type Texture,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "@iwsdk/core";
import type { Box, Element as BoxElement, Ring, V2, V3 } from "../core/types";
import { COLORS, MATERIALS } from "./theme";

/** Slot 0 holds decoys and rings (always shown, never glow); lock l's piece p is 1 + l * 16 + p. */
export const SLOTS_PER_LOCK = 16;
export const MAX_SLOTS = 1 + 3 * SLOTS_PER_LOCK;
export function slotOf(lock: number, piece: number): number {
  return 1 + lock * SLOTS_PER_LOCK + piece;
}

/** Scrap thickness in box units (2 mm at 24 cm), along the rays from the lantern spot. */
export const SCRAP_THICKNESS = 0.008;
/** Each scrap face is inset this much (box units) from its outline. */
export const SCRAP_GAP = 0.002;
/** Threads end here, just under the glass lid. */
export const THREAD_TOP_Y = 0.484;
/** Half-size of the gold pin where a thread meets the lid. */
const PIN_R = 0.006;
/** A pin is an octahedron: 8 triangles. */
const PIN_VERTS = 24;

/** Buffer sizes: 3 locks of up to 16 pieces of up to 16 corners, 20 decoys, 8 rings, a pin each. */
export const MAX_SCRAP_VERTS = 3 * 16 * (12 * 16 - 12 + PIN_VERTS) + 20 * (12 * 3 - 12 + PIN_VERTS) + 8 * PIN_VERTS;
export const MAX_THREAD_VERTS = (3 * 16 + 20 + 8) * 2;
export const MAX_RINGS = 8;
/** Ring torus resolution: around the ring, and around its wire. */
export const RING_SEGMENTS = 24;
export const RING_TUBE_SEGMENTS = 8;

export interface ScrapBuffers {
  position: Float32Array;
  normal: Float32Array;
  slot: Float32Array;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A convex outline, counter-clockwise, with each edge moved in by `g`. A sharp corner (a star's
 * point, a bird's beak) moves at most a third of the way to the centre, so a small piece never turns
 * inside out.
 */
export function insetOutline(p: V2[], g: number): V2[] {
  const n = p.length;
  let cx = 0, cy = 0;
  for (const v of p) {
    cx += v[0] / n;
    cy += v[1] / n;
  }
  return p.map((v, i) => {
    const a = p[(i + n - 1) % n]!, b = p[(i + 1) % n]!;
    const e1x = v[0] - a[0], e1y = v[1] - a[1], l1 = Math.hypot(e1x, e1y) || 1;
    const e2x = b[0] - v[0], e2y = b[1] - v[1], l2 = Math.hypot(e2x, e2y) || 1;
    // Inward normals of a counter-clockwise outline's edges: the edge direction turned left.
    const n1x = -e1y / l1, n1y = e1x / l1, n2x = -e2y / l2, n2y = e2x / l2;
    const k = g / Math.max(0.05, 1 + n1x * n2x + n1y * n2y);
    let dx = (n1x + n2x) * k, dy = (n1y + n2y) * k;
    const cap = Math.hypot(v[0] - cx, v[1] - cy) / 3, len = Math.hypot(dx, dy);
    if (len > cap) {
      dx *= cap / len;
      dy *= cap / len;
    }
    return [v[0] + dx, v[1] + dy];
  });
}

const signedArea = (p: V2[]) => p.reduce((s, v, i) => s + v[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * v[1], 0);

/**
 * A scrap's front face: its corners pulled in by the gap, front facing the lantern side. A piece is a
 * tilted plate whose corners sit at different depths on rays from its lock's spot, so its true outline
 * is the one seen from the spot (convex, the lock's own piece): the inset happens there, and each
 * corner goes back onto its ray at its own depth. A decoy (a flat-ish triangle) is inset straight on.
 */
function frontFace(verts: V3[], L: V3 | null, g: number): V3[] {
  if (!L) {
    let flat: V2[] = verts.map((v) => [v[0], v[1]]);
    const order = signedArea(flat) < 0 ? verts.map((_, i) => verts.length - 1 - i) : verts.map((_, i) => i);
    flat = order.map((i) => flat[i]!);
    return insetOutline(flat, g).map((q, j) => [q[0], q[1], verts[order[j]!]![2]]);
  }
  // Seen from the spot: S = L + (P - L) * Lz / (Lz - Pz); a scrap at depth z is (Lz - z) / Lz of its shadow's size.
  const k = verts.map((v) => (L[2] - v[2]) / L[2]);
  let seen: V2[] = verts.map((v, i) => [L[0] + (v[0] - L[0]) / k[i]!, L[1] + (v[1] - L[1]) / k[i]!]);
  const order = signedArea(seen) < 0 ? verts.map((_, i) => verts.length - 1 - i) : verts.map((_, i) => i);
  seen = order.map((i) => seen[i]!);
  const kMean = k.reduce((s, x) => s + x, 0) / k.length;
  return insetOutline(seen, g / kMean).map((q, j) => {
    const kk = k[order[j]!]!;
    return [L[0] + (q[0] - L[0]) * kk, L[1] + (q[1] - L[1]) * kk, verts[order[j]!]![2]];
  });
}

class Writer {
  n = 0;
  constructor(readonly out: ScrapBuffers) {}
  tri(a: V3, b: V3, c: V3, nrm: V3 | null, slot: number): void {
    const N = nrm ?? unit(cross(sub(b, a), sub(c, a)));
    for (const v of [a, b, c]) {
      const i = this.n++;
      this.out.position[i * 3] = v[0];
      this.out.position[i * 3 + 1] = v[1];
      this.out.position[i * 3 + 2] = v[2];
      this.out.normal[i * 3] = N[0];
      this.out.normal[i * 3 + 1] = N[1];
      this.out.normal[i * 3 + 2] = N[2];
      this.out.slot[i] = slot;
    }
  }
  /** A small gold octahedron (the thread's pin under the lid). */
  pin(c: V3, slot: number): void {
    const r = PIN_R;
    const X: V3[] = [[c[0] + r, c[1], c[2]], [c[0] - r, c[1], c[2]]];
    const Y: V3[] = [[c[0], c[1] + r, c[2]], [c[0], c[1] - r, c[2]]];
    const Z: V3[] = [[c[0], c[1], c[2] + r], [c[0], c[1], c[2] - r]];
    for (const x of X) for (const y of Y) for (const z of Z) {
      // Wind each face to face away from the centre.
      const nrm = unit([x[0] - c[0] + y[0] - c[0] + z[0] - c[0], x[1] - c[1] + y[1] - c[1] + z[1] - c[1], x[2] - c[2] + y[2] - c[2] + z[2] - c[2]]);
      const g = cross(sub(y, x), sub(z, x));
      if (g[0] * nrm[0] + g[1] * nrm[1] + g[2] * nrm[2] >= 0) this.tri(x, y, z, nrm, slot);
      else this.tri(x, z, y, nrm, slot);
    }
  }
}

function slotFor(e: BoxElement): number {
  return e.kind === "piece" ? slotOf(e.lock, e.piece) : 0;
}

/** Where an element's thread is tied: its highest corner, or the top of a ring. */
function threadAnchor(e: BoxElement): V3 {
  if (e.kind === "ring") return ringTop(e);
  let top = e.verts[0]!;
  for (const v of e.verts) if (v[1] > top[1]) top = v;
  return top;
}

function ringTop(r: Ring): V3 {
  // The ring's highest point: its centre plus the in-plane direction closest to up.
  const n = r.nrm, d = n[1];
  const u = unit([-d * n[0], 1 - d * n[1], -d * n[2]]);
  return [r.c[0] + u[0] * r.rOut, r.c[1] + u[1] * r.rOut, r.c[2] + u[2] * r.rOut];
}

/**
 * Writes every scrap (front, back and sides, flat shaded) and every thread's pin of `box` into `out`,
 * three vertices a triangle, in element order. Returns the vertex count.
 */
export function writeScraps(box: Box, out: ScrapBuffers): number {
  const w = new Writer(out);
  for (const e of box.elements) {
    const slot = slotFor(e);
    if (e.kind !== "ring") {
      const L = e.kind === "piece" ? box.locks[e.lock]!.L : null;
      const front = frontFace(e.verts, L, SCRAP_GAP);
      const back = front.map((v): V3 => {
        const d: V3 = L ? unit(sub(v, L)) : [0, 0, -1];
        return [v[0] + d[0] * SCRAP_THICKNESS, v[1] + d[1] * SCRAP_THICKNESS, v[2] + d[2] * SCRAP_THICKNESS];
      });
      // Flat shaded: every triangle keeps its own normal (a tilted plate's corners are not coplanar).
      const k = front.length;
      for (let i = 1; i < k - 1; i++) w.tri(front[0]!, front[i]!, front[i + 1]!, null, slot);
      for (let i = 1; i < k - 1; i++) w.tri(back[0]!, back[i + 1]!, back[i]!, null, slot);
      for (let i = 0; i < k; i++) {
        const j = (i + 1) % k;
        const side = unit(cross(sub(back[i]!, front[i]!), sub(back[j]!, front[i]!)));
        w.tri(front[i]!, back[i]!, back[j]!, side, slot);
        w.tri(front[i]!, back[j]!, front[j]!, side, slot);
      }
    }
    const a = threadAnchor(e);
    w.pin([a[0], THREAD_TOP_Y, a[2]], slot);
  }
  return w.n;
}

/** One thread per element, from where it is tied up to the lid. Returns the vertex count. */
export function writeThreads(box: Box, out: { position: Float32Array; slot: Float32Array }): number {
  let n = 0;
  for (const e of box.elements) {
    const a = threadAnchor(e), slot = slotFor(e);
    for (const y of [a[1], THREAD_TOP_Y]) {
      out.position[n * 3] = a[0];
      out.position[n * 3 + 1] = y;
      out.position[n * 3 + 2] = a[2];
      out.slot[n] = slot;
      n++;
    }
  }
  return n;
}

/** A ring as a torus: the radius of its wire's centre line, and the wire's radius. */
export function ringRadii(r: Ring): [number, number] {
  return [(r.rOut + r.rIn) / 2, (r.rOut - r.rIn) / 2];
}

/** One scrap's glow and visibility. */
export interface ScrapHandle {
  setGlow(v: number): void;
  setVisible(v: boolean): void;
}

const SLOT_VERTEX = /* glsl */ `
attribute float aSlot;
uniform vec2 uSlots[${MAX_SLOTS}];
varying float vGlow;
varying float vShow;
`;
const SLOT_BEGIN = /* glsl */ `
#include <begin_vertex>
vec2 slotState = uSlots[int(aSlot + 0.5)];
vGlow = slotState.x;
vShow = slotState.y;
if (slotState.y < 0.5) transformed = vec3(0.0);
`;
const SLOT_FRAGMENT = /* glsl */ `
uniform vec3 uGlowColor;
varying float vGlow;
varying float vShow;
`;

/**
 * Lets a material read the slot uniforms: hidden slots collapse to a point (their triangles have no area, so nothing
 * draws), and glow adds light. Lines are also discarded when hidden, since a collapsed line may still draw a dot; the
 * scrap mesh never discards, which would cost the early depth test on the headset's GPU.
 */
function withSlots(slots: Float32Array, glow: Color, lit: boolean, discardHidden: boolean) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uSlots = { value: slots };
    shader.uniforms.uGlowColor = { value: glow };
    shader.vertexShader = SLOT_VERTEX + shader.vertexShader.replace("#include <begin_vertex>", SLOT_BEGIN);
    let frag = SLOT_FRAGMENT + shader.fragmentShader;
    if (discardHidden) {
      frag = frag.replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n  if (vShow < 0.5) discard;");
    }
    frag = lit
      ? frag.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGlowColor * vGlow;")
      : frag.replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb += uGlowColor * vGlow;");
    shader.fragmentShader = frag;
  };
}

const TORUS_VERTEX = /* glsl */ `
attribute vec4 aTorus;
attribute vec2 aRadii;
`;
const TORUS_BEGIN = /* glsl */ `
vec3 transformed = vec3((aRadii.x + aRadii.y * aTorus.z) * aTorus.xy, aRadii.y * aTorus.w);
`;

/** A unit torus in the XY plane: each vertex keeps (cos u, sin u, cos v, sin v); the shader sizes it per ring. */
function torusGeometry(): BufferGeometry {
  const U = RING_SEGMENTS, V = RING_TUBE_SEGMENTS;
  const torus = new Float32Array((U + 1) * (V + 1) * 4), pos = new Float32Array((U + 1) * (V + 1) * 3), nrm = new Float32Array(pos.length);
  const idx: number[] = [];
  for (let i = 0; i <= U; i++) {
    for (let j = 0; j <= V; j++) {
      const u = (i / U) * Math.PI * 2, v = (j / V) * Math.PI * 2, k = i * (V + 1) + j;
      const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
      torus.set([cu, su, cv, sv], k * 4);
      // Positions only bound the shape (the shader replaces them): a ring up to 0.06 across.
      pos.set([(0.05 + 0.01 * cv) * cu, (0.05 + 0.01 * cv) * su, 0.01 * sv], k * 3);
      nrm.set([cv * cu, cv * su, sv], k * 3);
    }
  }
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j, b = (i + 1) * (V + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("normal", new BufferAttribute(nrm, 3));
  g.setAttribute("aTorus", new BufferAttribute(torus, 4));
  return g;
}

const Z_AXIS = new Vector3(0, 0, 1);

/** The box's scraps, threads and rings: three draw calls. */
export class Scraps {
  /** Every scrap and every thread's pin. */
  readonly mesh: Mesh;
  readonly threads: LineSegments;
  readonly rings: InstancedMesh;
  /** Per slot: glow (0..1), then visible (0 or 1). */
  readonly slots = new Float32Array(MAX_SLOTS * 2);
  private readonly buffers: ScrapBuffers;
  private readonly threadBuffers: { position: Float32Array; slot: Float32Array };
  private readonly radii: InstancedBufferAttribute;
  private readonly handles: ScrapHandle[] = [];
  private readonly tmpM = new Matrix4();
  private readonly tmpQ = new Quaternion();
  private readonly tmpV = new Vector3();
  private readonly tmpN = new Vector3();
  private readonly tmpS = new Vector3(1, 1, 1);

  constructor(env: Texture | null) {
    const glow = new Color(COLORS.gold);
    this.buffers = {
      position: new Float32Array(MAX_SCRAP_VERTS * 3),
      normal: new Float32Array(MAX_SCRAP_VERTS * 3),
      slot: new Float32Array(MAX_SCRAP_VERTS),
    };
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(this.buffers.position, 3).setUsage(DynamicDrawUsage));
    g.setAttribute("normal", new BufferAttribute(this.buffers.normal, 3).setUsage(DynamicDrawUsage));
    g.setAttribute("aSlot", new BufferAttribute(this.buffers.slot, 1).setUsage(DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const gold = new MeshStandardMaterial({ color: COLORS.metal, ...MATERIALS.gold, envMap: env });
    gold.onBeforeCompile = withSlots(this.slots, glow, true, false);
    gold.customProgramCacheKey = () => "sl-scraps";
    this.mesh = new Mesh(g, gold);
    this.mesh.name = "Scraps";

    this.threadBuffers = { position: new Float32Array(MAX_THREAD_VERTS * 3), slot: new Float32Array(MAX_THREAD_VERTS) };
    const tg = new BufferGeometry();
    tg.setAttribute("position", new BufferAttribute(this.threadBuffers.position, 3).setUsage(DynamicDrawUsage));
    tg.setAttribute("aSlot", new BufferAttribute(this.threadBuffers.slot, 1).setUsage(DynamicDrawUsage));
    tg.setDrawRange(0, 0);
    const thread = new LineBasicMaterial({ color: COLORS.thread, transparent: true, opacity: MATERIALS.threadOpacity, depthWrite: false });
    thread.onBeforeCompile = withSlots(this.slots, glow, false, true);
    thread.customProgramCacheKey = () => "sl-threads";
    this.threads = new LineSegments(tg, thread);
    this.threads.name = "Threads";

    const rg = torusGeometry();
    this.radii = new InstancedBufferAttribute(new Float32Array(MAX_RINGS * 2), 2);
    rg.setAttribute("aRadii", this.radii);
    const ringMat = new MeshStandardMaterial({ color: COLORS.metal, ...MATERIALS.gold, envMap: env });
    ringMat.onBeforeCompile = (shader) => {
      shader.vertexShader = TORUS_VERTEX + shader.vertexShader.replace("#include <begin_vertex>", TORUS_BEGIN);
    };
    ringMat.customProgramCacheKey = () => "sl-rings";
    this.rings = new InstancedMesh(rg, ringMat, MAX_RINGS);
    this.rings.name = "Rings";
    this.rings.count = 0;

    // Everything stays inside the box, which is always in view: skip culling (bounds would go stale).
    for (const o of [this.mesh, this.threads, this.rings]) o.frustumCulled = false;
    for (let s = 0; s < MAX_SLOTS; s++) {
      this.slots[s * 2 + 1] = 1;
      this.handles.push({
        setGlow: (v: number) => {
          this.slots[s * 2] = v;
        },
        setVisible: (v: boolean) => {
          this.slots[s * 2 + 1] = v ? 1 : 0;
        },
      });
    }
  }

  /** Draw this box's scraps (a finger lock's missing piece starts hidden), or none. */
  setBox(box: Box | null): void {
    this.slots.fill(0);
    for (let s = 0; s < MAX_SLOTS; s++) this.slots[s * 2 + 1] = 1;
    const g = this.mesh.geometry, tg = this.threads.geometry;
    if (!box) {
      g.setDrawRange(0, 0);
      tg.setDrawRange(0, 0);
      this.rings.count = 0;
      return;
    }
    const n = writeScraps(box, this.buffers);
    g.setDrawRange(0, n);
    for (const name of ["position", "normal", "aSlot"]) {
      const a = g.getAttribute(name) as BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    const tn = writeThreads(box, this.threadBuffers);
    tg.setDrawRange(0, tn);
    for (const name of ["position", "aSlot"]) {
      const a = tg.getAttribute(name) as BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, tn * a.itemSize);
      a.needsUpdate = true;
    }
    let r = 0;
    for (const e of box.elements) {
      if (e.kind === "piece" && e.missing) this.slots[slotOf(e.lock, e.piece) * 2 + 1] = 0;
      if (e.kind !== "ring" || r >= MAX_RINGS) continue;
      const [R, tube] = ringRadii(e);
      this.radii.setXY(r, R, tube);
      this.tmpQ.setFromUnitVectors(Z_AXIS, this.tmpN.set(e.nrm[0], e.nrm[1], e.nrm[2]).normalize());
      this.rings.setMatrixAt(r, this.tmpM.compose(this.tmpV.set(e.c[0], e.c[1], e.c[2]), this.tmpQ, this.tmpS));
      r++;
    }
    this.rings.count = r;
    this.rings.instanceMatrix.needsUpdate = true;
    this.radii.needsUpdate = true;
  }

  /** A lock piece's glow and visibility (the same handle every call). */
  handle(lock: number, piece: number): ScrapHandle {
    return this.handles[slotOf(lock, piece)]!;
  }
}
