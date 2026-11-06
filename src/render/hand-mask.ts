// Your real hand stays visible: in passthrough the game would draw the box over the player's real hand, hiding the
// finger at the very moment it fills a finger lock. So each tracked hand is drawn first as an invisible capsule hand
// (the same bones as its shadow, colour off, depth on): whatever of the game lies behind it fails the depth test,
// and the camera image of the real hand shows through.
//
// One draw call for both hands: a unit capsule instanced per bone, its ends (aA, aB, world metres) and radius (aR)
// per instance; the vertex shader puts each vertex round its end. Its front (near) faces are drawn, their depth
// pushed back to the bone's centre line, so the hand's own outline (drawn later and depth tested) is never hidden by
// the mask, while anything of the game behind the centre line is.
// Off without passthrough (a VR session has no real hand to show). No allocation per frame.
import {
  BufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from "@iwsdk/core";
import type { V3 } from "../core/types";
import { type HandJoints, JOINT_COUNT } from "../input/hand-joints";
import {
  BONE_A,
  BONE_B,
  BONES_PER_HAND,
  FINGER_RADIUS_CM,
  HAND_BONES,
  MAX_HAND_OUTLINES,
  PALM_RADIUS_CM,
  readHand,
  SIDES,
} from "./hand-shadow";
import { LiveAttribute } from "./live-attribute";

/** Drawn before everything: the box, the panels and the hand's own outline then test against its depth. */
export const HAND_MASK_ORDER = -10;
/** The capsule's resolution: around it, and from each pole to its waist. */
const AROUND = 10;
const POLE_TO_WAIST = 3;

/**
 * A unit capsule along y: a hemisphere at each end joined at the waist. `position` is each vertex's offset from its
 * end on the unit sphere, `aEnd` which end it belongs to (0: a, 1: b); the band joining the two waists is the side.
 */
function capsuleGeometry(): InstancedBufferGeometry {
  const pos: number[] = [], end: number[] = [], idx: number[] = [];
  // Rings from the a pole up to a's waist, then from b's waist up to the b pole.
  const rings: { y: number; r: number; end: number }[] = [];
  for (let i = 0; i <= POLE_TO_WAIST; i++) {
    const t = (-Math.PI / 2) * (1 - i / POLE_TO_WAIST);
    rings.push({ y: Math.sin(t), r: Math.cos(t), end: 0 });
  }
  for (let i = 0; i <= POLE_TO_WAIST; i++) {
    const t = (Math.PI / 2) * (i / POLE_TO_WAIST);
    rings.push({ y: Math.sin(t), r: Math.cos(t), end: 1 });
  }
  for (const ring of rings) {
    for (let j = 0; j < AROUND; j++) {
      const a = (2 * Math.PI * j) / AROUND;
      pos.push(ring.r * Math.cos(a), ring.y, ring.r * Math.sin(a));
      end.push(ring.end);
    }
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < AROUND; j++) {
      const a = i * AROUND + j, b = i * AROUND + ((j + 1) % AROUND), c = a + AROUND, d = b + AROUND;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new InstancedBufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aEnd", new BufferAttribute(new Float32Array(end), 1));
  return g;
}

const MASK_VERTEX = /* glsl */ `
attribute float aEnd;
attribute vec3 aA;
attribute vec3 aB;
attribute float aR;
`;
/**
 * The vertex round its end of the bone; slEnd is that end, where the depth is written. The capsule's local x, y, z go
 * to E1, U, E2 with E2 = E1 x U: a right-handed frame (a turn, not a mirror), so the geometry's outward faces stay
 * counter-clockwise from outside and survive back-face culling. maskVertex is this, in TypeScript, for the tests.
 */
const MASK_BEGIN = /* glsl */ `
vec3 slEnd = mix(aA, aB, aEnd);
vec3 slAxis = aB - aA;
float slLen = length(slAxis);
vec3 slU = slLen > 1e-6 ? slAxis / slLen : vec3(0.0, 1.0, 0.0);
vec3 slH = abs(slU.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
vec3 slE1 = normalize(cross(slU, slH));
vec3 slE2 = cross(slE1, slU);
vec3 transformed = slEnd + aR * (position.x * slE1 + position.y * slU + position.z * slE2);
`;

const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normV = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** MASK_BEGIN in TypeScript (allocates; for tests): where a capsule vertex (`local`, its `end`) lands for bone A-B. */
export function maskVertex(local: V3, end: number, A: V3, B: V3, R: number): V3 {
  const e: V3 = [A[0] + (B[0] - A[0]) * end, A[1] + (B[1] - A[1]) * end, A[2] + (B[2] - A[2]) * end];
  const axis: V3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], len = Math.hypot(axis[0], axis[1], axis[2]);
  const u: V3 = len > 1e-6 ? [axis[0] / len, axis[1] / len, axis[2] / len] : [0, 1, 0];
  const h: V3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normV(crossV(u, h)), e2 = crossV(e1, u);
  const [x, y, z] = local;
  return [0, 1, 2].map((k) => e[k]! + R * (x * e1[k]! + y * u[k]! + z * e2[k]!)) as V3;
}
/** Never nearer the eye than the bone's centre line (view space looks down -z). */
const MASK_PROJECT = /* glsl */ `
vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
mvPosition.z = min(mvPosition.z, (modelViewMatrix * vec4(slEnd, 1.0)).z);
gl_Position = projectionMatrix * mvPosition;
`;

function maskShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader =
    MASK_VERTEX +
    shader.vertexShader.replace("#include <begin_vertex>", MASK_BEGIN).replace("#include <project_vertex>", MASK_PROJECT);
}

export class HandMask {
  readonly mesh: Mesh;
  /** Off without passthrough (set each frame by the game). */
  enabled = true;
  private readonly geometry: InstancedBufferGeometry;
  private readonly a: LiveAttribute;
  private readonly b: LiveAttribute;
  private readonly r: LiveAttribute;
  private readonly joints = new Float64Array(JOINT_COUNT * 3);
  private drawn = 0;

  constructor(world: { scene: Object3D }) {
    this.geometry = capsuleGeometry();
    this.a = new LiveAttribute(new Float32Array(MAX_HAND_OUTLINES * 3), 3);
    this.b = new LiveAttribute(new Float32Array(MAX_HAND_OUTLINES * 3), 3);
    this.r = new LiveAttribute(new Float32Array(MAX_HAND_OUTLINES), 1);
    this.geometry.setAttribute("aA", this.a);
    this.geometry.setAttribute("aB", this.b);
    this.geometry.setAttribute("aR", this.r);
    this.geometry.instanceCount = 0;
    const mat = new MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true });
    mat.onBeforeCompile = maskShader;
    mat.customProgramCacheKey = () => "sl-hand-mask";
    this.mesh = new Mesh(this.geometry, mat);
    this.mesh.name = "Hand Mask";
    this.mesh.renderOrder = HAND_MASK_ORDER;
    // The capsules follow the hands anywhere; bounds would go stale every frame.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    world.scene.add(this.mesh);
  }

  /** Capsules drawn this frame. */
  get count(): number {
    return this.drawn;
  }

  /** Every bone of each tracked hand, the hand holding the lantern too (the real hand always shows). */
  update(joints: HandJoints): void {
    let k = 0;
    if (this.enabled) {
      const A = this.a.array as Float32Array, B = this.b.array as Float32Array, R = this.r.array as Float32Array;
      const w = this.joints;
      const rFinger = FINGER_RADIUS_CM / 100, rPalm = PALM_RADIUS_CM / 100;
      for (let h = 0; h < 2; h++) {
        if (!readHand(joints, SIDES[h]!, null, w)) continue;
        for (let i = 0; i < BONES_PER_HAND; i++) {
          const ia = BONE_A[i]! * 3, ib = BONE_B[i]! * 3, o = k * 3;
          A[o] = w[ia]!;
          A[o + 1] = w[ia + 1]!;
          A[o + 2] = w[ia + 2]!;
          B[o] = w[ib]!;
          B[o + 1] = w[ib + 1]!;
          B[o + 2] = w[ib + 2]!;
          R[k] = HAND_BONES[i]!.palm ? rPalm : rFinger;
          k++;
        }
      }
      this.a.commit(k);
      this.b.commit(k);
      this.r.commit(k);
    }
    this.drawn = k;
    this.geometry.instanceCount = k;
    this.mesh.visible = k > 0;
  }
}
