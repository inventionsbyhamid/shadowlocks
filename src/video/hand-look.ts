// Video builds only (VITE_VIDEO=1; main.ts imports this behind that flag, so production bundles
// drop it). IWSDK draws hands as a thin white outline, which barely shows in emulator footage. For
// the demo video the hand becomes a stylized "system hand", in the spirit of Quest's own: a light,
// mostly see-through body with a warm-white fresnel rim and a soft ink contour, so the box, its
// shadows and the panels stay readable through it, over the dark frame and the ivory back panel
// alike. A short wrist stub fades out 7 cm past the wrist: no forearm.
import {
  type Bone,
  BufferAttribute,
  FrontSide,
  LatheGeometry,
  type Material,
  Mesh,
  type Object3D,
  ShaderMaterial,
  SkinnedMesh,
  Vector2,
  Vector3,
  type World,
} from "@iwsdk/core";

export const HAND_LOOK = {
  /**
   * The body: a cool light grey (sRGB), mostly see-through; a little darker than white so it still
   * shows over the ivory back panel, and cool against the warm rim.
   */
  body: 0xb9c2ce,
  bodyAlpha: 0.3,
  /** Fresnel rim: warm white; strong and wide at the silhouette. */
  rim: 0xfff0d6,
  rimAlpha: 1.0,
  rimPower: 1.35,
  /** Rim brightness over the rim colour (it reads as a glow, clipped at white). */
  rimGlow: 1.25,
  /**
   * IWSDK's outline mesh, recoloured: a warm mid grey line, darker than the ivory panel and lighter
   * than the black frame, so the hand's edge reads on both.
   */
  contour: 0x7a756d,
  /** Drawn after the box and its glows (IWSDK draws its outline at 999), still depth tested. */
  renderOrder: 998,
  /** The hand is shrunk along its normals by this much, so the contour shows around it. */
  inset: 0.0012,
  /**
   * Wrist stub from the wrist joint toward the elbow (+z of the wrist joint, as WebXR joint poses
   * have it): radius (m) along its length (m), wider across the hand than through it; it fades out
   * over `fade` (m from the wrist joint).
   */
  stub: {
    profile: [
      [0.0, -0.012],
      [0.022, -0.012],
      [0.026, 0.0],
      [0.028, 0.04],
      [0.03, 0.08],
      [0.0, 0.082],
    ] as ReadonlyArray<readonly [number, number]>,
    across: 1.22,
    through: 0.82,
    fade: [0.005, 0.07] as const,
    /**
     * The wrist bent this far (degrees, the stub turned toward the palm side): IWER poses the hand
     * only, and a stub straight on from fingers that reach down into the box points up over it.
     */
    flexDeg: 30,
  },
  /**
   * The one light on the body (world space, toward the light): from above, a little right and from
   * the player's side, so the fingers read as rounded. Its own light: the hand does not follow the
   * game's lighting, which changes as the game's look does.
   */
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

/** The wrist stub: a lathe along +z, slightly flattened, with each vertex's distance past the wrist. */
function stubGeometry(): LatheGeometry {
  const f = HAND_LOOK.stub;
  const g = new LatheGeometry(
    f.profile.map(([r, y]) => new Vector2(r, y)),
    28,
  );
  g.scale(f.across, 1, f.through);
  // Lathe axis y becomes z (toward the elbow); the lathe's z (through the hand) becomes y.
  g.rotateX(Math.PI / 2);
  const pos = g.getAttribute("position");
  const past = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) past[i] = Math.max(0, pos.getZ(i));
  g.setAttribute("pastWrist", new BufferAttribute(past, 1));
  return g;
}

const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float uInset;
#ifdef STUB
attribute float pastWrist;
varying float vPast;
#endif
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = position - normal * uInset;
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  #ifdef STUB
  vPast = pastWrist;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uKeyDir;
uniform vec3 uBody;
uniform vec3 uRim;
uniform float uBodyAlpha;
uniform float uRimAlpha;
uniform float uRimPower;
uniform float uRimGlow;
uniform vec2 uFade;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#ifdef STUB
varying float vPast;
#endif
void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float nv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float rim = pow(1.0 - nv, uRimPower);
  // A little of the key light on the body, so the fingers read as rounded, not flat.
  float wrapped = max(0.0, (dot(n, uKeyDir) + 0.5) / 1.5);
  vec3 body = uBody * (0.62 + 0.38 * wrapped);
  // The rim glows a little past white paper, as a lit edge does.
  vec3 color = mix(body, uRim * uRimGlow, rim);
  float alpha = mix(uBodyAlpha, uRimAlpha, rim);
  #ifdef STUB
  alpha *= 1.0 - smoothstep(uFade.x, uFade.y, vPast);
  #endif
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

function handMaterial(o: { stub?: boolean; depthOnly?: boolean } = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uKeyDir: { value: new Vector3(...HAND_LOOK.keyDir).normalize() },
      uBody: colourUniform(HAND_LOOK.body),
      uRim: colourUniform(HAND_LOOK.rim),
      uBodyAlpha: { value: HAND_LOOK.bodyAlpha },
      uRimAlpha: { value: HAND_LOOK.rimAlpha },
      uRimPower: { value: HAND_LOOK.rimPower },
      uRimGlow: { value: HAND_LOOK.rimGlow },
      uFade: { value: new Vector2(HAND_LOOK.stub.fade[0], HAND_LOOK.stub.fade[1]) },
      uInset: { value: HAND_LOOK.inset },
    },
    defines: o.stub ? { STUB: "" } : {},
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: FrontSide,
    // The depth-only pass first: the see-through hand then shows only its front surface, so a
    // finger over the palm does not double up. All of it in the transparent list, after the
    // box's own glows and the panels (lower render orders), which then show through.
    transparent: true,
    colorWrite: !o.depthOnly,
    depthWrite: !!o.depthOnly || !!o.stub,
    depthTest: true,
  });
}

interface Uniforms {
  outlineThickness?: unknown;
  outlineColor?: { value: { setHex(hex: number): unknown; getHex(): number } };
}

const uniformsOf = (m: Material | Material[] | undefined): Uniforms | undefined =>
  m && !Array.isArray(m) ? ((m as ShaderMaterial).uniforms as Uniforms | undefined) : undefined;

export interface HandLookResult {
  /** Hand meshes now drawn in the video look. */
  solid: number;
  /** Outline meshes recoloured as the contour. */
  contour: number;
}

export interface VideoApi {
  /**
   * Restyle every IWSDK hand in the scene (`on`, the default) or put IWSDK's outline back. Cheap
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
  const look = handMaterial();
  const depth = handMaterial({ depthOnly: true });
  const stubLook = handMaterial({ stub: true });
  const geometry = stubGeometry();
  const extras: Mesh[] = [];
  let outlineHex: number | null = null;

  const api: VideoApi = {
    styleHands(on = true) {
      const out: HandLookResult = { solid: 0, contour: 0 };
      const wrists: Bone[] = [];
      const hands: SkinnedMesh[] = [];
      world.scene.traverse((o: Object3D) => {
        const mesh = o as SkinnedMesh;
        if (!mesh.isSkinnedMesh || mesh.userData.nsDepth === true) return;
        const data = mesh.userData as { nsOriginal?: Material; nsOrder?: number; nsPre?: SkinnedMesh };
        const current = data.nsOriginal ?? (mesh.material as Material);
        const u = uniformsOf(current);
        if (u?.outlineColor) {
          // The outline material is one object shared by both hands.
          if (on && outlineHex === null) {
            outlineHex = u.outlineColor.value.getHex();
            u.outlineColor.value.setHex(HAND_LOOK.contour);
          } else if (!on && outlineHex !== null) {
            u.outlineColor.value.setHex(outlineHex);
            outlineHex = null;
          }
          if (on) out.contour++;
          return;
        }
        if (!u || u.outlineThickness === undefined) return;
        if (on) {
          if (!data.nsOriginal) data.nsOriginal = mesh.material as Material;
          mesh.material = look;
          if (data.nsOrder === undefined) data.nsOrder = mesh.renderOrder;
          mesh.renderOrder = HAND_LOOK.renderOrder;
          if (!data.nsPre) hands.push(mesh);
          const wrist = mesh.skeleton?.bones.find((b: Bone) => b.name === "wrist");
          if (wrist && !wrist.userData.nsStub) wrists.push(wrist);
          out.solid++;
        } else if (data.nsOriginal) {
          mesh.material = data.nsOriginal;
          mesh.renderOrder = data.nsOrder ?? 0;
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
      // A short stub on each wrist joint that fades out, so the hand does not end in a cut.
      for (const wrist of wrists) {
        if (wrist.userData.nsStub) continue;
        const stub = new Mesh(geometry, stubLook);
        stub.name = "Video Wrist";
        stub.renderOrder = HAND_LOOK.renderOrder;
        // About the wrist's x axis: +z (toward the elbow) turns toward -y (the palm side).
        stub.rotation.x = (HAND_LOOK.stub.flexDeg * Math.PI) / 180;
        wrist.add(stub);
        wrist.userData.nsStub = stub;
        extras.push(stub);
      }
      for (const m of extras) m.visible = on;
      return out;
    },
  };
  window.__nsVideo = api;
  return api;
}
