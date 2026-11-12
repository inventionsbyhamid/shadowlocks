// Video builds only (VITE_VIDEO=1; main.ts imports this behind that flag, so production bundles
// drop it). On a headset the player sees their own hand through passthrough: the game's hand mask
// (render/hand-mask.ts) keeps every bone of a tracked hand clear of the box, so the camera image
// shows there. A render has no camera image, so the video build draws a stand-in in the spirit of
// the Quest system hand: a soft smoky fill with a thin light outline, fading out toward the wrist
// so the missing forearm never shows. It covers the mask's capsules (read from the mask's own
// buffers, a little wider) and IWSDK's hand mesh (a little inflated) as one surface, so the hole the
// mask leaves never shows as a dark halo round the hand. IWSDK's thin outline mesh is not drawn.
// Nothing here changes the mask, the shadows or anything the game does with the hand.
import {
  BufferAttribute,
  type BufferGeometry,
  FrontSide,
  InstancedBufferGeometry,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  ShaderMaterial,
  SkinnedMesh,
  Vector3,
  type World,
} from "@iwsdk/core";

export const HAND_LOOK = {
  /** The fill: a cool smoky grey (sRGB) at this opacity. */
  fill: 0x6a6e76,
  fillAlpha: 0.46,
  /** The outline: warm white, where the surface turns away from the eye (1 - n.v from `edge[0]` to `edge[1]`). */
  rim: 0xf6efe4,
  rimAlpha: 0.95,
  edge: [0.8, 0.95] as const,
  /** Drawn after the box and its glows (IWSDK draws its outline at 999), still depth tested. */
  renderOrder: 998,
  /** IWSDK's hand mesh is pushed out along its normals by this much (m). */
  inflate: 0.0015,
  /** The mask's capsules are drawn this much wider (m), so none of the mask's hole shows past the stand-in. */
  coverMargin: 0.0016,
  /** The capsules' resolution: around, and from each pole to the waist (finer than the mask's, so no facets). */
  around: 28,
  poleToWaist: 8,
  /** Faded out toward the wrist: fully gone at `fade[0]` (m along the hand from the wrist joint), full at `fade[1]`. */
  fade: [0.0, 0.045] as const,
  /** Palm capsules (from the wrist) are the mask's wider ones: radius over this (m). */
  palmRadius: 0.015,
  /** The one light on the fill (world space, toward the light): from above, a little right and toward the player. */
  keyDir: [0.3, 0.9, 0.3] as const,
};

/** A linear-light colour uniform from an sRGB hex colour (the shader works in linear light). */
function colourUniform(hex: number): { value: Vector3 } {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return { value: new Vector3(lin((hex >> 16) & 255), lin((hex >> 8) & 255), lin(hex & 255)) };
}

const FRAGMENT = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uFill;
uniform vec3 uRim;
uniform float uFillAlpha;
uniform float uRimAlpha;
uniform vec2 uEdge;
uniform vec2 uFade;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vAlong;
void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float rim = smoothstep(uEdge.x, uEdge.y, 1.0 - clamp(abs(dot(n, v)), 0.0, 1.0));
  float wrapped = max(0.0, (dot(n, uKeyDir) + 0.5) / 1.5);
  vec3 fill = uFill * (0.85 + 0.15 * wrapped);
  vec3 color = mix(fill, uRim, rim);
  float alpha = mix(uFillAlpha, uRimAlpha, rim) * smoothstep(uFade.x, uFade.y, vAlong);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

/** IWSDK's skinned hand, pushed out along its normals; vAlong from a per-vertex attribute (bind pose). */
const SKIN_VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float uInflate;
attribute float nsAlong;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vAlong;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = position + normal * uInflate;
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vAlong = nsAlong;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * The mask's capsules (render/hand-mask.ts MASK_BEGIN, the same frame), a little wider, on a finer capsule. A palm
 * capsule (from the wrist) fades along its length; a finger's is always full.
 */
const COVER_VERTEX = /* glsl */ `
attribute float aEnd;
attribute vec3 aA;
attribute vec3 aB;
attribute float aR;
uniform float uMargin;
uniform float uPalmR;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vAlong;
void main() {
  vec3 slEnd = mix(aA, aB, aEnd);
  vec3 slAxis = aB - aA;
  float slLen = length(slAxis);
  vec3 slU = slLen > 1e-6 ? slAxis / slLen : vec3(0.0, 1.0, 0.0);
  vec3 slH = abs(slU.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 slE1 = normalize(cross(slU, slH));
  vec3 slE2 = cross(slE1, slU);
  vec3 dir = position.x * slE1 + position.y * slU + position.z * slE2;
  vec3 wp = slEnd + (aR + uMargin) * dir;
  vWorldPos = wp;
  vWorldNormal = dir;
  vAlong = aR > uPalmR ? dot(wp - aA, slU) : 1.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

function lookMaterial(vertexShader: string, depthOnly: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uKeyDir: { value: new Vector3(...HAND_LOOK.keyDir).normalize() },
      uFill: colourUniform(HAND_LOOK.fill),
      uRim: colourUniform(HAND_LOOK.rim),
      uFillAlpha: { value: HAND_LOOK.fillAlpha },
      uRimAlpha: { value: HAND_LOOK.rimAlpha },
      uEdge: { value: [...HAND_LOOK.edge] },
      uFade: { value: [...HAND_LOOK.fade] },
      uInflate: { value: HAND_LOOK.inflate },
      uMargin: { value: HAND_LOOK.coverMargin },
      uPalmR: { value: HAND_LOOK.palmRadius },
    },
    vertexShader,
    fragmentShader: FRAGMENT,
    side: FrontSide,
    // A depth-only pass first (both surfaces), then the colour where each is front-most: the hand shows as one
    // surface, never doubled where a finger crosses the palm or a capsule pokes through the mesh.
    transparent: true,
    colorWrite: !depthOnly,
    depthWrite: depthOnly,
    depthTest: true,
  });
}

/** A capsule along y (unit radius): rings from the a pole to its waist, then from b's waist to the b pole. */
function capsuleGeometry(): InstancedBufferGeometry {
  const pos: number[] = [], end: number[] = [], idx: number[] = [];
  const rings: { y: number; r: number; end: number }[] = [];
  const k = HAND_LOOK.poleToWaist, around = HAND_LOOK.around;
  for (let i = 0; i <= k; i++) {
    const t = (-Math.PI / 2) * (1 - i / k);
    rings.push({ y: Math.sin(t), r: Math.cos(t), end: 0 });
  }
  for (let i = 0; i <= k; i++) {
    const t = (Math.PI / 2) * (i / k);
    rings.push({ y: Math.sin(t), r: Math.cos(t), end: 1 });
  }
  for (const ring of rings) {
    for (let j = 0; j < around; j++) {
      const a = (2 * Math.PI * j) / around;
      pos.push(ring.r * Math.cos(a), ring.y, ring.r * Math.sin(a));
      end.push(ring.end);
    }
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * around + j, b = i * around + ((j + 1) % around), c = a + around, d = b + around;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new InstancedBufferGeometry();
  g.setIndex(idx);
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aEnd", new BufferAttribute(new Float32Array(end), 1));
  return g;
}

/**
 * Each vertex's distance (m) along the hand from the wrist joint toward the middle finger's knuckle, in the bind
 * pose, as attribute `nsAlong` (once per geometry).
 */
function addAlong(mesh: SkinnedMesh): void {
  const g = mesh.geometry as BufferGeometry;
  if (g.getAttribute("nsAlong")) return;
  const bones = mesh.skeleton.bones;
  const at = (name: string): Vector3 | null => {
    const i = bones.findIndex((b) => b.name === name);
    const inv = mesh.skeleton.boneInverses[i];
    return i < 0 || !inv ? null : new Vector3().applyMatrix4(new Matrix4().copy(inv).invert());
  };
  const wrist = at("wrist");
  const knuckle = at("middle-finger-phalanx-proximal");
  const pos = g.getAttribute("position");
  const along = new Float32Array(pos.count).fill(1);
  if (wrist && knuckle) {
    const axis = knuckle.clone().sub(wrist).normalize();
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
      along[i] = v.sub(wrist).dot(axis);
    }
  }
  g.setAttribute("nsAlong", new BufferAttribute(along, 1));
}

interface Uniforms {
  outlineThickness?: unknown;
  outlineColor?: unknown;
}

const uniformsOf = (m: Material | Material[] | undefined): Uniforms | undefined =>
  m && !Array.isArray(m) ? ((m as ShaderMaterial).uniforms as Uniforms | undefined) : undefined;

export interface HandLookResult {
  /** Hand meshes now drawn in the video look. */
  solid: number;
  /** IWSDK outline meshes not drawn. */
  contour: number;
}

export interface VideoApi {
  /**
   * Restyle every IWSDK hand in the scene (`on`, the default) or put IWSDK's look back. Cheap
   * enough to call every frame: hands created later (input mode switch) are picked up too.
   */
  styleHands(on?: boolean): HandLookResult;
}

declare global {
  interface Window {
    __nsVideo?: VideoApi;
  }
}

export function installVideoMode(world: World): VideoApi {
  const look = lookMaterial(SKIN_VERTEX, false);
  const depth = lookMaterial(SKIN_VERTEX, true);
  const hidden = new ShaderMaterial({ colorWrite: false, depthWrite: false, depthTest: true, transparent: true });
  const coverLook = lookMaterial(COVER_VERTEX, false);
  const coverDepth = lookMaterial(COVER_VERTEX, true);
  const extras: Mesh[] = [];
  let cover: { geometry: InstancedBufferGeometry; from: InstancedBufferGeometry } | null = null;

  /** The stand-in over the mask's capsules: children of the mask, so they show exactly when it does. */
  const coverMask = () => {
    if (cover) return;
    const mask = world.scene.getObjectByName("Hand Mask") as Mesh | undefined;
    const from = mask?.geometry as InstancedBufferGeometry | undefined;
    if (!mask || !from?.getAttribute("aA")) return;
    const geometry = capsuleGeometry();
    for (const name of ["aA", "aB", "aR"]) geometry.setAttribute(name, from.getAttribute(name));
    geometry.instanceCount = 0;
    cover = { geometry, from };
    const sync = () => {
      geometry.instanceCount = from.instanceCount;
    };
    for (const [mat, order, name] of [
      [coverDepth, HAND_LOOK.renderOrder - 1, "Video Hand Cover Depth"],
      [coverLook, HAND_LOOK.renderOrder, "Video Hand Cover"],
    ] as const) {
      const m = new Mesh(geometry, mat);
      m.name = name;
      m.renderOrder = order;
      m.frustumCulled = false;
      // The capsules are in world space (the mask's mesh sits at the origin).
      m.matrixAutoUpdate = false;
      m.onBeforeRender = sync;
      mask.add(m);
      extras.push(m);
    }
  };

  const api: VideoApi = {
    styleHands(on = true) {
      const out: HandLookResult = { solid: 0, contour: 0 };
      const hands: SkinnedMesh[] = [];
      if (on) coverMask();
      world.scene.traverse((o: Object3D) => {
        const mesh = o as SkinnedMesh;
        if (!mesh.isSkinnedMesh || mesh.userData.nsDepth === true) return;
        const data = mesh.userData as { nsOriginal?: Material; nsOrder?: number; nsPre?: SkinnedMesh };
        const current = data.nsOriginal ?? (mesh.material as Material);
        const u = uniformsOf(current);
        const outline = u?.outlineColor !== undefined;
        if (!outline && u?.outlineThickness === undefined) return;
        if (on) {
          if (!data.nsOriginal) data.nsOriginal = mesh.material as Material;
          if (outline) {
            mesh.material = hidden;
            out.contour++;
            return;
          }
          addAlong(mesh);
          mesh.material = look;
          if (data.nsOrder === undefined) data.nsOrder = mesh.renderOrder;
          mesh.renderOrder = HAND_LOOK.renderOrder;
          if (!data.nsPre) hands.push(mesh);
          out.solid++;
        } else if (data.nsOriginal) {
          mesh.material = data.nsOriginal;
          if (data.nsOrder !== undefined) mesh.renderOrder = data.nsOrder;
          delete data.nsOriginal;
          delete data.nsOrder;
        }
      });
      // A depth-only copy of each hand, drawn just before it (same geometry and skeleton, a child
      // so it shares the hand's transform).
      for (const mesh of hands) {
        const pre = new SkinnedMesh(mesh.geometry, depth);
        pre.name = "Video Hand Depth";
        pre.userData.nsDepth = true;
        pre.bindMode = mesh.bindMode;
        pre.bind(mesh.skeleton, mesh.bindMatrix);
        pre.renderOrder = HAND_LOOK.renderOrder - 1;
        pre.frustumCulled = false;
        mesh.add(pre);
        (mesh.userData as { nsPre?: SkinnedMesh }).nsPre = pre;
        extras.push(pre);
      }
      for (const m of extras) m.visible = on;
      return out;
    },
  };
  window.__nsVideo = api;
  return api;
}
