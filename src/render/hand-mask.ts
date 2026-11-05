// Your real hand stays visible: in passthrough the game would draw the box over the player's real hand, hiding the
// finger at the very moment it fills a finger lock. So each tracked hand is drawn first as an invisible capsule hand
// (the same bones as its shadow, colour off, depth on): whatever of the game lies behind it fails the depth test,
// and the camera image of the real hand shows through.
//
// One draw call for both hands: a unit capsule instanced per bone, its ends (aA, aB, world metres) and radius (aR)
// per instance; the vertex shader puts each vertex round its end. The depth is written at the bone's centre line,
// not its front surface, so the hand's own outline (drawn later and depth tested) is never hidden by the mask.
// Off without passthrough (a VR session has no real hand to show). No allocation per frame.
import {
  BufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from "@iwsdk/core";
import type { V3 } from "../core/types";
import { HAND_JOINTS, type HandJoints, type HandSide, JOINT_COUNT } from "../input/hand-joints";
import { BONES_PER_HAND, FINGER_RADIUS_CM, HAND_BONES, MAX_HAND_OUTLINES, PALM_RADIUS_CM, readHand } from "./hand-shadow";
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
/** The vertex round its end of the bone; slEnd is that end, where the depth is written. */
const MASK_BEGIN = /* glsl */ `
vec3 slEnd = mix(aA, aB, aEnd);
vec3 slAxis = aB - aA;
float slLen = length(slAxis);
vec3 slU = slLen > 1e-6 ? slAxis / slLen : vec3(0.0, 1.0, 0.0);
vec3 slH = abs(slU.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
vec3 slE1 = normalize(cross(slU, slH));
vec3 slE2 = cross(slU, slE1);
vec3 transformed = slEnd + aR * (position.x * slE1 + position.y * slU + position.z * slE2);
`;
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

const SIDES: readonly HandSide[] = ["left", "right"];
const BONE_A = Int32Array.from(HAND_BONES, (b) => HAND_JOINTS.indexOf(b.a));
const BONE_B = Int32Array.from(HAND_BONES, (b) => HAND_JOINTS.indexOf(b.b));

export class HandMask {
  readonly mesh: Mesh;
  /** Off without passthrough (set each frame by the game). */
  enabled = true;
  private readonly geometry: InstancedBufferGeometry;
  private readonly a: LiveAttribute;
  private readonly b: LiveAttribute;
  private readonly r: LiveAttribute;
  private readonly joints = new Float64Array(JOINT_COUNT * 3);
  private readonly tmp = new Vector3();
  private readonly p: V3 = [0, 0, 0];
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
        if (!readHand(joints, SIDES[h]!, null, w, this.tmp, this.p)) continue;
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
