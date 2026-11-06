// The lessons' ghost hand and ghost lantern: pale blue and see-through, so nobody takes them for their own hand or
// the real lantern. Each is a set of capsules drawn as instances of one small mesh, in two passes over the same
// geometry: depth first (no colour), then a fresnel colour pass that keeps only the front-most surface, so where
// capsules overlap (the palm, the knuckles) the ghost never stacks up brighter. The rim glows; the body is faint.
//
// The hand's poses (open, pinch, point, relaxed) are IWER's, exported once into src/lessons/poses.json (scripts/
// export-poses.mjs): 25 joints in the wrist's frame of a left hand, fingers toward -z, palm toward -y. A right hand
// is the mirror image (x negated). setPose blends two poses joint by joint; setWorld puts the wrist in the world;
// place() works out that matrix so the pinch point, the index fingertip or the wrist lands on a point with the
// fingers and palm turned as asked. `world` holds the joints in the world for whatever casts the ghost's shadow.
//
// The ghost lantern lives in the box root (box units) like the real one: a cage of thin capsules round a glowing
// core, and a soft glow. Both fade by opacity alone (reduced motion keeps them). No allocation per frame.
import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LessEqualDepth,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "@iwsdk/core";
import type { V3 } from "../core/types";
import { HAND_JOINTS, JOINT_COUNT } from "../input/hand-joints";
import POSES from "../lessons/poses.json";
import { radialTexture } from "./lantern-view";
import { COLORS } from "./theme";

export type GhostPose = "open" | "pinch" | "point" | "relaxed";
/** The point of the hand that place() puts on its target. */
export type GhostAnchor = "grasp" | "tip" | "wrist";

export const GHOST_LOOK = {
  color: COLORS.ghost,
  /** The faint body and the glowing rim (alpha), how fast the rim falls off, and how bright it glows. */
  bodyAlpha: 0.14,
  rimAlpha: 0.92,
  rimPower: 2.2,
  rimGlow: 1.35,
  /** Capsule radii (m): the palm's from the wrist to each knuckle, and the knuckles' bar. */
  palmRadius: 0.016,
  knuckleRadius: 0.011,
  /** A finger bone is this much of its joints' mean radius: a ghost is a little slimmer than a hand. */
  fingerScale: 0.9,
  /** Drawn after the box and its glass (the depth pass just before the colour pass). */
  renderOrder: 996,
  /** The ghost lantern's glow sprite (box units) and its opacity at full. */
  glowSize: 0.36,
  glowAlpha: 0.55,
} as const;

interface PoseFile {
  joints: string[];
  radius: number[];
  poses: Record<GhostPose, number[]>;
}
const DATA = POSES as PoseFile;
export const GHOST_POSES: readonly GhostPose[] = ["open", "pinch", "point", "relaxed"];

const J = (name: XRHandJoint): number => HAND_JOINTS.indexOf(name);
const WRIST = J("wrist"), THUMB_TIP = J("thumb-tip"), INDEX_TIP = J("index-finger-tip"), INDEX_MID = J("index-finger-phalanx-intermediate");

/** A ghost bone: a capsule between two joints. */
export interface GhostBone {
  a: number;
  b: number;
  r: number;
}

function bones(): GhostBone[] {
  const R = DATA.radius, s = GHOST_LOOK.fingerScale;
  const finger = (a: XRHandJoint, b: XRHandJoint): GhostBone => ({ a: J(a), b: J(b), r: ((R[J(a)]! + R[J(b)]!) / 2) * s });
  const palm = (b: XRHandJoint): GhostBone => ({ a: WRIST, b: J(b), r: GHOST_LOOK.palmRadius });
  const digit = (n: "index" | "middle" | "ring" | "pinky"): GhostBone[] => [
    finger(`${n}-finger-phalanx-proximal`, `${n}-finger-phalanx-intermediate`),
    finger(`${n}-finger-phalanx-intermediate`, `${n}-finger-phalanx-distal`),
    finger(`${n}-finger-phalanx-distal`, `${n}-finger-tip`),
  ];
  return [
    palm("index-finger-phalanx-proximal"),
    palm("middle-finger-phalanx-proximal"),
    palm("ring-finger-phalanx-proximal"),
    palm("pinky-finger-phalanx-proximal"),
    { a: J("index-finger-phalanx-proximal"), b: J("pinky-finger-phalanx-proximal"), r: GHOST_LOOK.knuckleRadius },
    finger("thumb-metacarpal", "thumb-phalanx-proximal"),
    finger("thumb-phalanx-proximal", "thumb-phalanx-distal"),
    finger("thumb-phalanx-distal", "thumb-tip"),
    ...digit("index"),
    ...digit("middle"),
    ...digit("ring"),
    ...digit("pinky"),
  ];
}

/** The hand's capsules: the palm (four from the wrist and the knuckles' bar), the thumb and every finger bone. */
export const GHOST_BONES: readonly GhostBone[] = bones();

/**
 * A unit sphere cut at its middle, for a capsule drawn as an instance: `aTop` is 0 on the half at the capsule's
 * start and 1 on the half at its end; the middle ring is there twice, once per half, and the band between them is
 * the capsule's side once the shader moves the halves apart. Faces wind outward.
 */
export function capsuleGeometry(radial = 10, cap = 3): InstancedBufferGeometry {
  const rings: [number, number, number][] = [];
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    rings.push([Math.sin(a), Math.cos(a), 0]);
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    rings.push([Math.sin(a), Math.cos(a), 1]);
  }
  const pos = new Float32Array(rings.length * radial * 3), top = new Float32Array(rings.length * radial);
  rings.forEach(([y, r, t], k) => {
    for (let j = 0; j < radial; j++) {
      const p = (j / radial) * Math.PI * 2, o = k * radial + j;
      // A pole is one point: its ring has no radius.
      pos[o * 3] = r < 1e-9 ? 0 : r * Math.sin(p);
      pos[o * 3 + 1] = y;
      pos[o * 3 + 2] = r < 1e-9 ? 0 : r * Math.cos(p);
      top[o] = t;
    }
  });
  const idx: number[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < radial; j++) {
      const a = k * radial + j, b = k * radial + ((j + 1) % radial), c = (k + 1) * radial + ((j + 1) % radial), d = (k + 1) * radial + j;
      // Around (j) then up (k): outward is around x up. Pole rings would make one of the two triangles a sliver.
      if (rings[k]![1] > 1e-9) idx.push(a, b, c);
      if (rings[k + 1]![1] > 1e-9) idx.push(a, c, d);
    }
  }
  const g = new InstancedBufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aTop", new BufferAttribute(top, 1));
  return g;
}

const VERTEX = /* glsl */ `
attribute float aTop;
attribute vec3 iA;
attribute vec3 iB;
attribute float iR;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 ax = iB - iA;
  float len = length(ax);
  vec3 d = len > 1e-6 ? ax / len : vec3(0.0, 1.0, 0.0);
  vec3 h = abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  // A right-handed frame with y along the bone, so the sphere's faces keep their winding.
  vec3 u = normalize(cross(h, d));
  vec3 w = cross(u, d);
  vec3 n = u * position.x + d * position.y + w * position.z;
  vec4 wp = modelMatrix * vec4(mix(iA, iB, aTop) + n * iR, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBodyAlpha;
uniform float uRimAlpha;
uniform float uRimPower;
uniform float uRimGlow;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), uRimPower);
  gl_FragColor = vec4(uColor * mix(0.7, uRimGlow, rim), mix(uBodyAlpha, uRimAlpha, rim) * uOpacity);
  #include <colorspace_fragment>
}
`;

const DEPTH_FRAGMENT = /* glsl */ `
void main() {
  gl_FragColor = vec4(0.0);
}
`;

/** n capsules as instances of one geometry, drawn by a depth pass and a fresnel colour pass. */
class CapsuleSet {
  readonly depth: Mesh;
  readonly color: Mesh;
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  private readonly r: InstancedBufferAttribute;
  private readonly uniforms: { uOpacity: { value: number } } & Record<string, { value: unknown }>;

  constructor(n: number, name: string) {
    const g = capsuleGeometry();
    g.instanceCount = n;
    const attr = (size: number) => new InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(DynamicDrawUsage);
    this.a = attr(3);
    this.b = attr(3);
    this.r = attr(1);
    g.setAttribute("iA", this.a);
    g.setAttribute("iB", this.b);
    g.setAttribute("iR", this.r);
    const L = GHOST_LOOK;
    this.uniforms = {
      uColor: { value: new Color(L.color) },
      uOpacity: { value: 1 },
      uBodyAlpha: { value: L.bodyAlpha },
      uRimAlpha: { value: L.rimAlpha },
      uRimPower: { value: L.rimPower },
      uRimGlow: { value: L.rimGlow },
    };
    const depth = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: DEPTH_FRAGMENT, colorWrite: false, depthWrite: true, side: FrontSide });
    const color = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthFunc: LessEqualDepth,
      side: FrontSide,
      toneMapped: false,
    });
    this.depth = new Mesh(g, depth);
    this.color = new Mesh(g, color);
    this.depth.name = name + " Depth";
    this.color.name = name;
    this.depth.renderOrder = L.renderOrder;
    this.color.renderOrder = L.renderOrder + 1;
    // The geometry's bounds are the unit sphere's, not the capsules'.
    this.depth.frustumCulled = false;
    this.color.frustumCulled = false;
  }

  /** Capsule i from a to b (the parent's units), radius r. */
  set(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): void {
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array, o = i * 3;
    A[o] = ax;
    A[o + 1] = ay;
    A[o + 2] = az;
    B[o] = bx;
    B[o + 1] = by;
    B[o + 2] = bz;
    (this.r.array as Float32Array)[i] = r;
  }

  /** Upload what set() wrote. */
  commit(): void {
    this.a.needsUpdate = true;
    this.b.needsUpdate = true;
    this.r.needsUpdate = true;
  }

  set opacity(v: number) {
    this.uniforms.uOpacity.value = v;
  }
}

/** A blend of two poses at t (0: a, 1: b), side sign applied to x, into out. */
function blend(a: GhostPose, b: GhostPose, t: number, sign: number, out: Float32Array): void {
  const A = DATA.poses[a], B = DATA.poses[b];
  if (!A || !B) throw new Error(`GhostHand: no pose "${!A ? a : b}"`);
  for (let i = 0; i < out.length; i++) {
    const v = A[i]! + (B[i]! - A[i]!) * t;
    out[i] = i % 3 === 0 ? v * sign : v;
  }
}

export class GhostHand {
  /** Add to the scene at the top level: its matrix is the wrist's frame in the world (metres). */
  readonly object = new Group();
  /** The pose shown: each joint in the wrist's frame (m), this hand's side. */
  readonly local = new Float32Array(JOINT_COUNT * 3);
  /** The same joints in the world, after setPose and setWorld. */
  readonly world = new Float32Array(JOINT_COUNT * 3);
  private readonly caps: CapsuleSet;
  private sign: 1 | -1;
  private poseA: GhostPose = "relaxed";
  private poseB: GhostPose = "relaxed";
  private poseT = 0;
  private wanted = true;
  private alpha = 1;
  private readonly v = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  private readonly mA = new Matrix4();
  private readonly mB = new Matrix4();

  constructor(side: "left" | "right" = "right") {
    this.sign = side === "right" ? -1 : 1;
    this.caps = new CapsuleSet(GHOST_BONES.length, "Ghost Hand");
    this.object.name = "Ghost Hand";
    this.object.matrixAutoUpdate = false;
    this.object.add(this.caps.depth, this.caps.color);
    this.setPose("relaxed", "relaxed", 0);
  }

  get side(): "left" | "right" {
    return this.sign === -1 ? "right" : "left";
  }

  set side(s: "left" | "right") {
    const sign = s === "right" ? -1 : 1;
    if (sign === this.sign) return;
    this.sign = sign;
    this.setPose(this.poseA, this.poseB, this.poseT);
  }

  /** Show pose a blended toward pose b by t (0..1). Throws for a pose poses.json lacks. */
  setPose(a: string, b: string, t: number): void {
    blend(a as GhostPose, b as GhostPose, t, this.sign, this.local);
    this.poseA = a as GhostPose;
    this.poseB = b as GhostPose;
    this.poseT = t;
    const L = this.local;
    for (let i = 0; i < GHOST_BONES.length; i++) {
      const { a: ja, b: jb, r } = GHOST_BONES[i]!;
      this.caps.set(i, L[ja * 3]!, L[ja * 3 + 1]!, L[ja * 3 + 2]!, L[jb * 3]!, L[jb * 3 + 1]!, L[jb * 3 + 2]!, r);
    }
    this.caps.commit();
    this.toWorld();
  }

  /** The wrist's frame in the world (position and turn; no scale). */
  setWorld(m: Readonly<Matrix4>): void {
    this.object.matrix.copy(m);
    this.object.matrixWorldNeedsUpdate = true;
    this.toWorld();
  }

  /**
   * Put the hand so its anchor (the pinch point, the index fingertip or the wrist) is at `at` (world), its fingers
   * pointing along `fingers` (for "tip", the index finger's last two bones) and its palm facing `palm` as near as
   * can be. Call after setPose: the anchor depends on the pose.
   */
  place(anchor: GhostAnchor, at: Readonly<Vector3>, fingers: Readonly<Vector3>, palm: Readonly<Vector3>): void {
    const [e1, e2, e3, E1, E2, E3, p] = this.v as [Vector3, Vector3, Vector3, Vector3, Vector3, Vector3, Vector3];
    const L = this.local;
    // The hand's own frame: along the fingers, then the palm square to them.
    if (anchor === "tip") {
      e1.set(L[INDEX_TIP * 3]! - L[INDEX_MID * 3]!, L[INDEX_TIP * 3 + 1]! - L[INDEX_MID * 3 + 1]!, L[INDEX_TIP * 3 + 2]! - L[INDEX_MID * 3 + 2]!);
      e1.normalize();
    } else e1.set(0, 0, -1);
    square(e2.set(0, -1, 0), e1);
    e3.crossVectors(e1, e2);
    E1.copy(fingers).normalize();
    square(E2.copy(palm), E1);
    E3.crossVectors(E1, E2);
    // Turn: the world frame times the hand frame's inverse (its transpose).
    this.mA.makeBasis(E1, E2, E3).multiply(this.mB.makeBasis(e1, e2, e3).transpose());
    if (anchor === "grasp") {
      p.set(
        (L[THUMB_TIP * 3]! + L[INDEX_TIP * 3]!) / 2,
        (L[THUMB_TIP * 3 + 1]! + L[INDEX_TIP * 3 + 1]!) / 2,
        (L[THUMB_TIP * 3 + 2]! + L[INDEX_TIP * 3 + 2]!) / 2,
      );
    } else if (anchor === "tip") p.set(L[INDEX_TIP * 3]!, L[INDEX_TIP * 3 + 1]!, L[INDEX_TIP * 3 + 2]!);
    else p.set(0, 0, 0);
    p.applyMatrix4(this.mA);
    this.mA.setPosition(at.x - p.x, at.y - p.y, at.z - p.z);
    this.setWorld(this.mA);
  }

  /** Joint j in the world, into out. */
  joint(j: number, out: Vector3): Vector3 {
    return out.set(this.world[j * 3]!, this.world[j * 3 + 1]!, this.world[j * 3 + 2]!);
  }

  get visible(): boolean {
    return this.wanted;
  }

  set visible(v: boolean) {
    this.wanted = v;
    this.object.visible = v && this.alpha > 0;
  }

  get opacity(): number {
    return this.alpha;
  }

  /** 0 draws nothing. */
  set opacity(v: number) {
    this.alpha = v;
    this.caps.opacity = v;
    this.object.visible = this.wanted && v > 0;
  }

  private toWorld(): void {
    const e = this.object.matrix.elements, L = this.local, W = this.world;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const o = j * 3, x = L[o]!, y = L[o + 1]!, z = L[o + 2]!;
      W[o] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      W[o + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      W[o + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
  }
}

/** v made square to the unit vector n and unit (any square direction when v runs along n). */
function square(v: Vector3, n: Readonly<Vector3>): Vector3 {
  v.addScaledVector(n, -v.dot(n));
  if (v.lengthSq() < 1e-12) {
    v.set(n.y, -n.x, 0);
    if (v.lengthSq() < 1e-12) v.set(0, n.z, -n.y);
  }
  return v.normalize();
}

/** The ghost lantern's capsules: eight fins, a ring above and below them, the spire, its handle loop and the core. */
function lanternCapsules(): [V3, V3, number][] {
  const out: [V3, V3, number][] = [];
  const oct = (r: number, y: number, i: number): V3 => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let i = 0; i < 8; i++) out.push([oct(0.041, -0.058, i), oct(0.041, 0.058, i), 0.0035]);
  for (let i = 0; i < 8; i++) out.push([oct(0.05, 0.064, i), oct(0.05, 0.064, i + 1), 0.004]);
  for (let i = 0; i < 8; i++) out.push([oct(0.052, -0.062, i), oct(0.052, -0.062, i + 1), 0.004]);
  out.push([[0, 0.07, 0], [0, 0.135, 0], 0.006]);
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    out.push([[Math.cos(a0) * 0.016, 0.155 + Math.sin(a0) * 0.016, 0], [Math.cos(a1) * 0.016, 0.155 + Math.sin(a1) * 0.016, 0], 0.003]);
  }
  out.push([[0, -0.03, 0], [0, 0.03, 0], 0.03]);
  return out;
}
const LANTERN_PARTS = lanternCapsules();
export const GHOST_LANTERN_CAPSULES = LANTERN_PARTS.length;

export class GhostLantern {
  /** Add to the box root: box units, its origin the light. */
  readonly object = new Group();
  private readonly caps: CapsuleSet;
  private readonly glow: Sprite;
  private alpha = 1;

  constructor() {
    this.caps = new CapsuleSet(LANTERN_PARTS.length, "Ghost Lantern");
    LANTERN_PARTS.forEach(([a, b, r], i) => this.caps.set(i, a[0], a[1], a[2], b[0], b[1], b[2], r));
    this.caps.commit();
    this.glow = new Sprite(
      new SpriteMaterial({ map: radialTexture(64, false), color: GHOST_LOOK.color, blending: AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
    );
    this.glow.scale.setScalar(GHOST_LOOK.glowSize);
    this.glow.renderOrder = GHOST_LOOK.renderOrder + 2;
    this.glow.name = "Ghost Lantern Glow";
    this.object.name = "Ghost Lantern";
    this.object.add(this.caps.depth, this.caps.color, this.glow);
  }

  /** Where it is, in box units. */
  setPos(p: Readonly<V3>): void {
    this.object.position.set(p[0], p[1], p[2]);
  }

  get opacity(): number {
    return this.alpha;
  }

  /** 0 draws nothing. */
  set opacity(v: number) {
    this.alpha = v;
    this.caps.opacity = v;
    this.glow.material.opacity = v * GHOST_LOOK.glowAlpha;
    this.object.visible = v > 0;
  }
}
