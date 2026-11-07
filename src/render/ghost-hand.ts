// The lessons' ghost hand and ghost lantern: pale blue and see-through, so nobody takes them for their own hand or
// the real lantern. Both are capsules drawn as instances of one small mesh in the world (GhostRig: one draw call for
// the two), in one fresnel colour pass that writes depth, so a capsule behind one already drawn is hidden rather than
// stacked brighter. Each capsule fades by its own opacity, and one at 0 draws nothing (its pixels are discarded, so
// it writes no depth either). The rim glows; the body is fainter still, so overlapping capsules read as outlines.
//
// The hand is built to read as a hand at a glance: fingers in real proportions (each joint's radius from the pose
// library's, 7 to 10 mm at the knuckles), each bone a tapered capsule so a finger narrows toward its tip; a flat palm
// (four flattened capsules along the metacarpals, side by side, and a flattened heel to the wrist) rather than round
// capsules the width of a fist; and a wrist that fades out up the forearm. A capsule can taper (a radius at each end)
// and be flattened square to a given direction (here the palm's normal).
//
// The hand's poses (open, pinch, point, relaxed) are IWER's, exported once into src/lessons/poses.json (scripts/
// export-poses.mjs): 25 joints in the wrist's frame of a left hand, fingers toward -z, palm toward -y; "hold" and
// "ready" take the thumb and index of one and the other fingers of another. A right hand is the mirror image (x
// negated). setPose blends two poses joint by joint; setWorld puts the wrist in the world;
// place() works out that matrix so the pinch point, the index fingertip or the wrist lands on a point with the
// fingers and palm turned as asked. `world` holds the joints in the world for whatever casts the ghost's shadow, and
// GHOST_SHADOW_BONES the bones it casts, the hand's own (so a slimmer hand casts a slimmer shadow).
//
// The ghost lantern is placed in box units like the real one (sync() puts it in the world through the box's
// matrix): a cage of capsules round a glowing pale-blue core, with no glow sprite of its own. The ghost holds it by
// its handle loop (GHOST_LANTERN_GRIP), as the real lantern's loop sits. Both fade by opacity alone (reduced motion
// keeps them). No allocation per frame.
import {
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
  Vector3,
} from "@iwsdk/core";
import type { V3 } from "../core/types";
import { HAND_JOINTS, JOINT_COUNT } from "../input/hand-joints";
import POSES from "../lessons/poses.json";
import type { ShadowBones } from "./hand-shadow";
import { COLORS } from "./theme";

/**
 * The library's poses (open, pinch, point, relaxed), and two made from them: "hold", the pinch's thumb and index with
 * the other fingers tucked into the palm as in the point (a lantern held by its loop, the pinch plain to see and
 * nothing reaching on into the box), and "ready", the relaxed thumb and index open to take it, the others tucked.
 */
export type GhostPose = "open" | "pinch" | "point" | "relaxed" | "hold" | "ready";
/** The point of the hand that place() puts on its target. */
export type GhostAnchor = "grasp" | "tip" | "wrist";

export const GHOST_LOOK = {
  color: COLORS.ghost,
  /** The hand's faint body and the glowing rim (alpha), how fast the rim falls off, and how bright it glows. */
  bodyAlpha: 0.07,
  rimAlpha: 1,
  rimPower: 1.8,
  rimGlow: 1.45,
  /** The ghost lantern's cage, a little more solid than the hand so it reads in the ghost's fingers... */
  lampBody: 0.42,
  lampBright: 1.2,
  /** ...round a glowing core: pale blue, never the real lantern's warm gold. */
  coreBody: 0.6,
  coreBright: 1.75,
  /**
   * A finger joint's radius is the pose library's times this (by the joint's place along the finger): about 7 to 10
   * mm at the knuckles, narrowing toward the tips. The thumb's base is its metacarpal joint, slimmed most (the pose
   * library's radius there is the ball of the thumb).
   */
  fingerScale: { metacarpal: 0.58, proximal: 0.85, intermediate: 0.85, distal: 0.82, tip: 0.7 },
  /** The palm's metacarpals: flattened capsules this wide (radius across the palm, m), this thick for their width. */
  palmWidth: 0.0125,
  palmFlat: 0.6,
  /** The heel of the hand and the wrist: as wide (m) and as flat; the forearm fades out this far past the wrist. */
  wristWidth: 0.022,
  wristFlat: 0.58,
  forearm: 0.05,
  forearmWidth: 0.024,
  /** Drawn after the box and its glass. */
  renderOrder: 996,
} as const;

type LibraryPose = "open" | "pinch" | "point" | "relaxed";
interface PoseFile {
  joints: string[];
  radius: number[];
  poses: Record<LibraryPose, number[]>;
}
const DATA = POSES as PoseFile;
/** The wrist, thumb and index finger are the first ten joints (WebXR order); the other three fingers follow. */
const THUMB_AND_INDEX = 10;
/** A pose with the wrist, thumb and index of `a` and the other fingers of `b`. */
const compose = (a: LibraryPose, b: LibraryPose): number[] => [...DATA.poses[a].slice(0, THUMB_AND_INDEX * 3), ...DATA.poses[b].slice(THUMB_AND_INDEX * 3)];
const POSE_DATA: Readonly<Record<GhostPose, number[]>> = { ...DATA.poses, hold: compose("pinch", "point"), ready: compose("relaxed", "point") };
export const GHOST_POSES: readonly GhostPose[] = ["open", "pinch", "point", "relaxed", "hold", "ready"];
/** Each pose's joints (wrist frame, a left hand), as setPose blends them. */
export const GHOST_POSE_DATA: Readonly<Record<GhostPose, readonly number[]>> = POSE_DATA;

const J = (name: XRHandJoint): number => HAND_JOINTS.indexOf(name);
const WRIST = J("wrist"), THUMB_TIP = J("thumb-tip"), INDEX_TIP = J("index-finger-tip"), INDEX_MID = J("index-finger-phalanx-intermediate");
/** A bone's far end that is no joint: the point up the forearm GHOST_LOOK.forearm from the wrist. */
export const FOREARM = -1;

/** A ghost bone: a capsule between two joints (or the wrist and FOREARM). */
export interface GhostBone {
  a: number;
  b: number;
  /** Radius (m) at a and at b (a finger tapers toward its tip); across the palm for a flattened bone. */
  ra: number;
  rb: number;
  /** Thickness for width: 1 round; under 1 flattened square to the palm (the palm, the heel and the wrist). */
  flat: number;
  /** Opacity at a and at b (the forearm fades out). */
  fadeA: number;
  fadeB: number;
}

/** A joint's radius on the ghost (m): the pose library's, scaled by the joint's place along its finger. */
export function ghostRadius(j: number): number {
  const name = HAND_JOINTS[j]!, s = GHOST_LOOK.fingerScale;
  const k = name.endsWith("-tip")
    ? s.tip
    : name.endsWith("-distal")
      ? s.distal
      : name.endsWith("-intermediate")
        ? s.intermediate
        : name.endsWith("-proximal")
          ? s.proximal
          : s.metacarpal;
  return DATA.radius[j]! * k;
}

function bones(): GhostBone[] {
  const L = GHOST_LOOK;
  const finger = (a: XRHandJoint, b: XRHandJoint): GhostBone => ({ a: J(a), b: J(b), ra: ghostRadius(J(a)), rb: ghostRadius(J(b)), flat: 1, fadeA: 1, fadeB: 1 });
  const flat = (a: number, b: number, ra: number, rb: number, k: number, fadeB = 1): GhostBone => ({ a, b, ra, rb, flat: k, fadeA: 1, fadeB });
  const metacarpal = (n: "index" | "middle" | "ring" | "pinky"): GhostBone =>
    flat(J(`${n}-finger-metacarpal`), J(`${n}-finger-phalanx-proximal`), L.palmWidth, L.palmWidth, L.palmFlat);
  const digit = (n: "index" | "middle" | "ring" | "pinky"): GhostBone[] => [
    finger(`${n}-finger-phalanx-proximal`, `${n}-finger-phalanx-intermediate`),
    finger(`${n}-finger-phalanx-intermediate`, `${n}-finger-phalanx-distal`),
    finger(`${n}-finger-phalanx-distal`, `${n}-finger-tip`),
  ];
  return [
    // The palm: the heel from the wrist to the middle of the metacarpals' bases, then the four metacarpals side by
    // side to the knuckles (overlapping a little, so they read as one plate).
    flat(WRIST, J("middle-finger-metacarpal"), L.wristWidth, L.wristWidth, L.wristFlat),
    metacarpal("index"),
    metacarpal("middle"),
    metacarpal("ring"),
    metacarpal("pinky"),
    // The wrist, fading out up the forearm.
    flat(WRIST, FOREARM, L.wristWidth, L.forearmWidth, L.wristFlat, 0),
    finger("thumb-metacarpal", "thumb-phalanx-proximal"),
    finger("thumb-phalanx-proximal", "thumb-phalanx-distal"),
    finger("thumb-phalanx-distal", "thumb-tip"),
    ...digit("index"),
    ...digit("middle"),
    ...digit("ring"),
    ...digit("pinky"),
  ];
}

/** The hand's capsules: the palm (heel and four metacarpals), the wrist, the thumb and every finger bone. */
export const GHOST_BONES: readonly GhostBone[] = bones();

/**
 * The bones the ghost hand's shadow is cast from (HandShadow's table): every bone between two joints at its drawn
 * radii (a flattened one at its width), the index finger's last two bones as the finger. The fading forearm casts
 * nothing.
 */
export const GHOST_SHADOW_BONES: ShadowBones = (() => {
  const cast = GHOST_BONES.filter((b) => b.b !== FOREARM);
  const fingerBones = [J("index-finger-phalanx-intermediate"), J("index-finger-phalanx-distal")];
  return {
    a: Int32Array.from(cast, (b) => b.a),
    b: Int32Array.from(cast, (b) => b.b),
    ra: Float64Array.from(cast, (b) => b.ra),
    rb: Float64Array.from(cast, (b) => b.rb),
    finger: Uint8Array.from(cast, (b) => (fingerBones.includes(b.a) ? 1 : 0)),
  };
})();

/**
 * A unit sphere cut at its middle, for a capsule drawn as an instance: `aTop` is 0 on the half at the capsule's
 * start and 1 on the half at its end; the middle ring is there twice, once per half, and the band between them is
 * the capsule's side once the shader moves the halves apart. Faces wind outward.
 */
export function capsuleGeometry(radial = 12, cap = 4): InstancedBufferGeometry {
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

// Per capsule: its ends (iA, iB), its radius at each (iR), its opacity (iO), the direction it is flattened square to
// and its thickness for its width (iF: xyz, w; w 1 is round), and its look (iL: opacity at a and at b, body alpha,
// brightness).
const VERTEX = /* glsl */ `
attribute float aTop;
attribute vec3 iA;
attribute vec3 iB;
attribute vec2 iR;
attribute float iO;
attribute vec4 iF;
attribute vec4 iL;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vO;
varying vec2 vLook;
void main() {
  vO = iO * mix(iL.x, iL.y, aTop);
  vLook = iL.zw;
  vec3 ax = iB - iA;
  float len = length(ax);
  vec3 d = len > 1e-6 ? ax / len : vec3(0.0, 1.0, 0.0);
  // A right-handed frame with y along the bone (so the sphere's faces keep their winding), z along the direction it
  // is flattened square to when it has one.
  vec3 fn = iF.xyz - d * dot(iF.xyz, d);
  vec3 u;
  vec3 w;
  if (dot(fn, fn) > 1e-8) {
    w = normalize(fn);
    u = cross(d, w);
  } else {
    vec3 h = abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    u = normalize(cross(h, d));
    w = cross(u, d);
  }
  float k = iF.w;
  float r = mix(iR.x, iR.y, aTop);
  vec3 off = u * position.x + d * position.y + w * (position.z * k);
  // An ellipsoid's normal: the flattened axis's component grows as the shape thins.
  vec3 n = u * position.x + d * position.y + w * (position.z / k);
  vec4 wp = modelMatrix * vec4(mix(iA, iB, aTop) + off * r, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uRimAlpha;
uniform float uRimPower;
uniform float uRimGlow;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vO;
varying vec2 vLook;
void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), uRimPower);
  float a = mix(vLook.x, uRimAlpha, rim) * vO;
  // A capsule faded out (or nearly) draws nothing and writes no depth.
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * mix(0.7, uRimGlow, rim) * vLook.y, a);
  #include <colorspace_fragment>
}
`;

/**
 * n capsules (in the world, metres) as instances of one geometry: one mesh, drawn in one fresnel colour pass that
 * writes depth. Each capsule has its own opacity; the mesh is hidden while every capsule is at 0.
 */
export class CapsuleSet {
  readonly mesh: Mesh;
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  private readonly r: InstancedBufferAttribute;
  private readonly o: InstancedBufferAttribute;
  private readonly f: InstancedBufferAttribute;
  private readonly l: InstancedBufferAttribute;

  constructor(
    readonly n: number,
    name: string,
  ) {
    const g = capsuleGeometry();
    g.instanceCount = n;
    const attr = (size: number) => new InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(DynamicDrawUsage);
    this.a = attr(3);
    this.b = attr(3);
    this.r = attr(2);
    this.o = attr(1);
    this.f = attr(4);
    this.l = attr(4);
    g.setAttribute("iA", this.a);
    g.setAttribute("iB", this.b);
    g.setAttribute("iR", this.r);
    g.setAttribute("iO", this.o);
    g.setAttribute("iF", this.f);
    g.setAttribute("iL", this.l);
    const L = GHOST_LOOK;
    // Every capsule round and at the hand's look until told otherwise.
    for (let i = 0; i < n; i++) this.look(i, 1, 1, 1, L.bodyAlpha, 1);
    const material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(L.color) },
        uRimAlpha: { value: L.rimAlpha },
        uRimPower: { value: L.rimPower },
        uRimGlow: { value: L.rimGlow },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: true,
      depthFunc: LessEqualDepth,
      side: FrontSide,
      toneMapped: false,
    });
    this.mesh = new Mesh(g, material);
    this.mesh.name = name;
    this.mesh.renderOrder = L.renderOrder;
    // The geometry's bounds are the unit sphere's, not the capsules'.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Capsules [from, to) at opacity v (0: they draw nothing). */
  fade(from: number, to: number, v: number): void {
    const O = this.o.array as Float32Array;
    for (let i = from; i < to; i++) O[i] = v;
    this.o.needsUpdate = true;
    let any = false;
    for (let i = 0; i < this.n && !any; i++) any = O[i]! > 0;
    this.mesh.visible = any;
  }

  /**
   * Capsule i's look, set once: its thickness for its width (1 round), its opacity at each end (times its fade), its
   * body's alpha (the rim's is GHOST_LOOK.rimAlpha) and its brightness.
   */
  look(i: number, flat: number, fadeA: number, fadeB: number, body: number, bright: number): void {
    const F = this.f.array as Float32Array, Lk = this.l.array as Float32Array, o = i * 4;
    F[o + 3] = flat;
    Lk[o] = fadeA;
    Lk[o + 1] = fadeB;
    Lk[o + 2] = body;
    Lk[o + 3] = bright;
    this.f.needsUpdate = true;
    this.l.needsUpdate = true;
  }

  /** Capsule i from a to b (metres, in the world), radius ra at a and rb at b. */
  set(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number): void {
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array, R = this.r.array as Float32Array, o = i * 3;
    A[o] = ax;
    A[o + 1] = ay;
    A[o + 2] = az;
    B[o] = bx;
    B[o + 1] = by;
    B[o + 2] = bz;
    R[i * 2] = ra;
    R[i * 2 + 1] = rb;
  }

  /** The direction capsule i is flattened square to (world; unused while it is round). */
  flatten(i: number, nx: number, ny: number, nz: number): void {
    const F = this.f.array as Float32Array, o = i * 4;
    F[o] = nx;
    F[o + 1] = ny;
    F[o + 2] = nz;
  }

  /** Upload what set() and flatten() wrote. */
  commit(): void {
    this.a.needsUpdate = true;
    this.b.needsUpdate = true;
    this.r.needsUpdate = true;
    this.f.needsUpdate = true;
  }
}

/** A blend of two poses at t (0: a, 1: b), side sign applied to x, into out. */
function blend(a: GhostPose, b: GhostPose, t: number, sign: number, out: Float32Array): void {
  const A = POSE_DATA[a], B = POSE_DATA[b];
  if (!A || !B) throw new Error(`GhostHand: no pose "${!A ? a : b}"`);
  for (let i = 0; i < out.length; i++) {
    const v = A[i]! + (B[i]! - A[i]!) * t;
    out[i] = i % 3 === 0 ? v * sign : v;
  }
}

export class GhostHand {
  /** The wrist's frame in the world (metres): its matrix (never drawn itself; the capsules are in the world). */
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
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();
  private readonly e3 = new Vector3();
  private readonly E1 = new Vector3();
  private readonly E2 = new Vector3();
  private readonly E3 = new Vector3();
  private readonly p = new Vector3();
  private readonly mA = new Matrix4();
  private readonly mB = new Matrix4();

  /** A hand drawn by capsules [from, from + GHOST_BONES.length) of `caps` (a set of its own when none is given). */
  constructor(
    side: "left" | "right" = "right",
    caps?: CapsuleSet,
    private readonly from = 0,
  ) {
    this.sign = side === "right" ? -1 : 1;
    this.caps = caps ?? new CapsuleSet(GHOST_BONES.length, "Ghost Hand");
    for (let i = 0; i < GHOST_BONES.length; i++) {
      const b = GHOST_BONES[i]!;
      this.caps.look(from + i, b.flat, b.fadeA, b.fadeB, GHOST_LOOK.bodyAlpha, 1);
    }
    this.object.name = "Ghost Hand";
    this.object.matrixAutoUpdate = false;
    this.setPose("relaxed", "relaxed", 0);
    this.fade();
  }

  /** The mesh that draws it (shared with the ghost lantern in a GhostRig): add it to the scene at the top level. */
  get mesh(): Mesh {
    return this.caps.mesh;
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
    const e1 = this.e1, e2 = this.e2, e3 = this.e3, E1 = this.E1, E2 = this.E2, E3 = this.E3, p = this.p;
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
    this.fade();
  }

  get opacity(): number {
    return this.alpha;
  }

  /** 0 draws nothing. */
  set opacity(v: number) {
    if (v === this.alpha) return;
    this.alpha = v;
    this.fade();
  }

  private fade(): void {
    this.caps.fade(this.from, this.from + GHOST_BONES.length, this.wanted ? this.alpha : 0);
  }

  /** The joints in the world, and each bone's capsule between its two (flattened square to the palm). */
  private toWorld(): void {
    const e = this.object.matrix.elements, L = this.local, W = this.world;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const o = j * 3, x = L[o]!, y = L[o + 1]!, z = L[o + 2]!;
      W[o] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      W[o + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      W[o + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    // The palm's normal is the wrist frame's y; the forearm runs up its z from the wrist.
    const nx = e[4]!, ny = e[5]!, nz = e[6]!, f = GHOST_LOOK.forearm, w = WRIST * 3;
    for (let i = 0; i < GHOST_BONES.length; i++) {
      const bone = GHOST_BONES[i]!, a = bone.a * 3, k = this.from + i;
      if (bone.b === FOREARM) {
        this.caps.set(k, W[a]!, W[a + 1]!, W[a + 2]!, W[w]! + e[8]! * f, W[w + 1]! + e[9]! * f, W[w + 2]! + e[10]! * f, bone.ra, bone.rb);
      } else {
        const b = bone.b * 3;
        this.caps.set(k, W[a]!, W[a + 1]!, W[a + 2]!, W[b]!, W[b + 1]!, W[b + 2]!, bone.ra, bone.rb);
      }
      if (bone.flat < 1) this.caps.flatten(k, nx, ny, nz);
    }
    this.caps.commit();
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

/**
 * Where the ghost holds a lantern (box units, from its light): the middle of its handle loop, as the real lantern's
 * loop sits (lantern-view.ts) and the ghost lantern's below.
 */
export const GHOST_LANTERN_GRIP: V3 = [0, 0.155, 0];
/** The handle loop's radius (box units). */
const LOOP_R = 0.016;

/**
 * The ghost lantern's capsules: eight fins, a ring above and below them, the spire, its handle loop round the grip,
 * and the core (last).
 */
function lanternCapsules(): [V3, V3, number][] {
  const out: [V3, V3, number][] = [];
  const oct = (r: number, y: number, i: number): V3 => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let i = 0; i < 8; i++) out.push([oct(0.041, -0.058, i), oct(0.041, 0.058, i), 0.005]);
  for (let i = 0; i < 8; i++) out.push([oct(0.05, 0.064, i), oct(0.05, 0.064, i + 1), 0.0055]);
  for (let i = 0; i < 8; i++) out.push([oct(0.052, -0.062, i), oct(0.052, -0.062, i + 1), 0.0055]);
  out.push([[0, 0.07, 0], [0, GHOST_LANTERN_GRIP[1] - LOOP_R, 0], 0.008]);
  const g = GHOST_LANTERN_GRIP;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
    out.push([[g[0] + Math.cos(a0) * LOOP_R, g[1] + Math.sin(a0) * LOOP_R, g[2]], [g[0] + Math.cos(a1) * LOOP_R, g[1] + Math.sin(a1) * LOOP_R, g[2]], 0.0042]);
  }
  out.push([[0, -0.036, 0], [0, 0.036, 0], 0.032]);
  return out;
}
const LANTERN_PARTS = lanternCapsules();
/** The ghost lantern's capsules (box units, about its light): from, to, radius. The core is the last. */
export const GHOST_LANTERN_PARTS: readonly (readonly [V3, V3, number])[] = LANTERN_PARTS;
export const GHOST_LANTERN_CAPSULES = LANTERN_PARTS.length;

export class GhostLantern {
  /** Where it is, in box units (its origin is the light). */
  readonly pos: V3 = [0, 0, 0];
  private readonly caps: CapsuleSet;
  private alpha = 1;

  /** A lantern drawn by capsules [from, from + GHOST_LANTERN_CAPSULES) of `caps` (a set of its own when none). */
  constructor(
    caps?: CapsuleSet,
    private readonly from = 0,
  ) {
    this.caps = caps ?? new CapsuleSet(LANTERN_PARTS.length, "Ghost Lantern");
    const L = GHOST_LOOK, core = LANTERN_PARTS.length - 1;
    for (let i = 0; i < LANTERN_PARTS.length; i++) {
      this.caps.look(this.from + i, 1, 1, 1, i === core ? L.coreBody : L.lampBody, i === core ? L.coreBright : L.lampBright);
    }
    this.sync(IDENTITY);
    this.caps.fade(this.from, this.from + LANTERN_PARTS.length, this.alpha);
  }

  /** The mesh that draws it (shared with the ghost hand in a GhostRig). */
  get mesh(): Mesh {
    return this.caps.mesh;
  }

  /** Where it is, in box units. Drawn there from the next sync(). */
  setPos(p: Readonly<V3>): void {
    this.pos[0] = p[0];
    this.pos[1] = p[1];
    this.pos[2] = p[2];
  }

  /** Its capsules into the world through the box's matrix `m` (box units to the world; uniform scale). */
  sync(m: Readonly<Matrix4>): void {
    const e = m.elements, s = Math.hypot(e[0]!, e[1]!, e[2]!), P = this.pos;
    for (let i = 0; i < LANTERN_PARTS.length; i++) {
      const part = LANTERN_PARTS[i]!, a = part[0], b = part[1], r = part[2] * s;
      const ax = P[0] + a[0], ay = P[1] + a[1], az = P[2] + a[2], bx = P[0] + b[0], by = P[1] + b[1], bz = P[2] + b[2];
      this.caps.set(
        this.from + i,
        e[0]! * ax + e[4]! * ay + e[8]! * az + e[12]!,
        e[1]! * ax + e[5]! * ay + e[9]! * az + e[13]!,
        e[2]! * ax + e[6]! * ay + e[10]! * az + e[14]!,
        e[0]! * bx + e[4]! * by + e[8]! * bz + e[12]!,
        e[1]! * bx + e[5]! * by + e[9]! * bz + e[13]!,
        e[2]! * bx + e[6]! * by + e[10]! * bz + e[14]!,
        r,
        r,
      );
    }
    this.caps.commit();
  }

  get opacity(): number {
    return this.alpha;
  }

  /** 0 draws nothing. */
  set opacity(v: number) {
    if (v === this.alpha) return;
    this.alpha = v;
    this.caps.fade(this.from, this.from + LANTERN_PARTS.length, v);
  }
}

const IDENTITY = new Matrix4();

/** The ghost hand and the ghost lantern in one capsule mesh: one draw call. Add `mesh` to the scene's top level. */
export class GhostRig {
  readonly caps = new CapsuleSet(GHOST_BONES.length + LANTERN_PARTS.length, "Ghost");
  readonly hand = new GhostHand("right", this.caps, 0);
  readonly lamp = new GhostLantern(this.caps, GHOST_BONES.length);

  get mesh(): Mesh {
    return this.caps.mesh;
  }
}
