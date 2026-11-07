// Test builds only (test-hooks.ts imports it behind VITE_TEST_HOOKS): what one eye's frame asks of the GPU, measured
// in the page with the renderer's own draw list, for estimates on headsets the emulator cannot time (Quest 2).
//
// census(): the frame drawn once more for one eye, from that eye's pose, with a projection and a target size the test
// chooses (Quest 2's eye buffer, say), into an offscreen target. Then every draw again, one at a time and in the
// renderer's own order (opaque, then transmissive, then transparent, each as three sorted it), each with a copy of its
// own material whose shader runs as it is but writes 1/255 additively instead of its colour: the target's sum is the
// fragments that draw wrote (depth tested against everything drawn before it, as on the headset), the pixels it covers,
// and its overdraw on itself. A fragment its shader discards is not counted (it was still shaded). After each count the
// draw runs again with its real material and colour writes off, so it leaves the depth it leaves in the frame.
// Textures: every texture the scene's materials hold, with its size in memory.
//
// probe(): what a fragment of each draw's program costs, relative to the others: each draw alone, framed to fill the
// target, drawn N times on a big target and on a tiny one, timed (real ms, the GPU waited for); the difference over the
// difference in fragments is the time a fragment takes. The browser here renders in software (SwiftShader), so the
// times rank programs by the work a fragment does (arithmetic and texture reads), not by a headset's speed.
import {
  AddEquation,
  Box3,
  type BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  FloatType,
  HalfFloatType,
  type Material,
  MeshBasicMaterial,
  type Object3D,
  OneFactor,
  PerspectiveCamera,
  RedFormat,
  RGFormat,
  type Scene,
  Sphere,
  SRGBColorSpace,
  type Texture,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
  type World,
} from "@iwsdk/core";

/** A layer nothing in the game uses: the draw being counted is put on it, alone with the lights. */
const LAYER = 31;

export interface CensusOptions {
  /** The target's size (pixels); a fraction of the eye buffer's, say, the counts scaled up after. */
  width: number;
  height: number;
  /** The eye's view: half angles (degrees) left, right, up and down of its forward direction. */
  fov: { left: number; right: number; up: number; down: number };
  /** Which eye's pose (0 left). */
  eye?: 0 | 1;
  /** Return the frame as a PNG data URL too. */
  image?: boolean;
}

export interface CensusDraw {
  /** The object (its nearest named ancestor first when it has no name). */
  name: string;
  list: "opaque" | "transmissive" | "transparent";
  /** The material's type, its program's name and what makes it cost (lights, maps, clearcoat, blending). */
  material: string;
  program: string;
  features: string[];
  renderOrder: number;
  triangles: number;
  instances: number;
  /** Fragments written in the census target, and pixels with at least one. */
  fragments: number;
  pixels: number;
}

export interface CensusTexture {
  name: string;
  width: number;
  height: number;
  bytes: number;
  kind: string;
}

export interface Census {
  width: number;
  height: number;
  /** A hash of the frame's pixels (colour and alpha) as the renderer drew it. */
  hash: string;
  draws: CensusDraw[];
  textures: CensusTexture[];
  textureBytes: number;
  /** What the renderer holds now: programs, textures and geometries. */
  programs: number;
  rendererTextures: number;
  rendererGeometries: number;
  image?: string;
}

export interface ProbeResult {
  name: string;
  program: string;
  /** ns of software rendering per fragment (big target minus tiny), and the fragments it was timed over. */
  nsPerFragment: number;
  fragments: number;
}

interface Entry {
  object: Object3D;
  list: CensusDraw["list"];
}

type Renderable = Object3D & { material: Material | Material[]; geometry?: BufferGeometry; count?: number; isInstancedMesh?: boolean };

/** The shader as onBeforeCompile hands it over. */
interface Shader {
  fragmentShader: string;
}

/**
 * The fragment shader run as it is (an early return or a discard included), then made to write 1/255 to every
 * channel: main becomes censusMain, and a new main calls it and writes the count.
 */
export function countingFragment(src: string): string {
  const main = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)/;
  if (!main.test(src)) return src;
  const out = /\bout\s+(?:(?:highp|mediump|lowp)\s+)?vec4\s+(\w+)\s*;/.exec(src)?.[1] ?? "gl_FragColor";
  return `${src.replace(main, "void censusMain()")}\nvoid main() {\n  censusMain();\n  ${out} = vec4(1.0 / 255.0);\n}\n`;
}

function asList(m: Material | Material[]): Material[] {
  return Array.isArray(m) ? m : [m];
}

function nameOf(o: Object3D): string {
  if (o.name) return o.name;
  let p = o.parent;
  while (p && !p.name) p = p.parent;
  return `${p ? p.name : "(scene)"} > ${o.type}`;
}

/** What makes a material's fragments cost: its kind, lights, maps, clearcoat, blending, sides. */
function features(m: Material): string[] {
  const f: string[] = [];
  const a = m as Material & Record<string, unknown>;
  if (m.transparent) f.push("transparent");
  if (m.blending === 2) f.push("additive");
  else if (m.blending === 5) f.push("custom blend");
  else if (m.blending !== 0 && m.blending !== 1) f.push(`blending ${m.blending}`);
  if (m.side === DoubleSide) f.push(m.forceSinglePass ? "double sided, one pass" : "double sided");
  if (m.side === 1) f.push("back side");
  if (!m.depthTest) f.push("no depth test");
  if (!m.depthWrite) f.push("no depth write");
  for (const k of ["map", "envMap", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "alphaMap", "aoMap", "lightMap"]) {
    if ((a[k] as Texture | null | undefined)?.isTexture) f.push(k);
  }
  if (typeof a.clearcoat === "number" && a.clearcoat > 0) f.push("clearcoat");
  if (typeof a.transmission === "number" && a.transmission > 0) f.push("transmission");
  if (typeof a.sheen === "number" && a.sheen > 0) f.push("sheen");
  if (typeof a.iridescence === "number" && a.iridescence > 0) f.push("iridescence");
  if (a.vertexColors) f.push("vertex colours");
  if ((a as { lights?: boolean }).lights) f.push("lights");
  const uniforms = (a as { uniforms?: Record<string, { value: unknown }> }).uniforms;
  if (uniforms) {
    const tex = Object.values(uniforms).filter((u) => (u?.value as Texture | null)?.isTexture).length;
    if (tex) f.push(`${tex} texture uniform${tex > 1 ? "s" : ""}`);
  }
  if (Object.prototype.hasOwnProperty.call(m, "customProgramCacheKey")) f.push(`key ${m.customProgramCacheKey()}`);
  return f;
}

function triangles(o: Renderable): { triangles: number; instances: number } {
  const g = o.geometry;
  if (!g) return { triangles: 0, instances: 1 };
  const inst = o.isInstancedMesh ? (o.count ?? 1) : ((g as { instanceCount?: number }).instanceCount ?? 1);
  const n = g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0);
  const drawn = Math.min(n, g.drawRange.count);
  const isMesh = (o as { isMesh?: boolean }).isMesh || (o as { isSprite?: boolean }).isSprite;
  const instances = Number.isFinite(inst) ? inst : 1;
  return { triangles: isMesh ? Math.floor(drawn / 3) * instances : 0, instances };
}

const CHANNELS: Record<number, number> = { [RedFormat]: 1, [RGFormat]: 2 };

function textureEntry(t: Texture, owner: string): CensusTexture {
  const img = (t.image ?? {}) as { width?: number; height?: number; depth?: number; videoWidth?: number; videoHeight?: number };
  const mip0 = (t as { mipmaps?: { width: number; height: number }[] }).mipmaps?.[0];
  const compressed = (t as { isCompressedTexture?: boolean }).isCompressedTexture === true;
  const width = (compressed ? mip0?.width : undefined) ?? img.width ?? img.videoWidth ?? 0;
  const height = (compressed ? mip0?.height : undefined) ?? img.height ?? img.videoHeight ?? 0;
  const depth = img.depth ?? 1;
  const channels = CHANNELS[t.format] ?? 4;
  const perChannel = t.type === FloatType ? 4 : t.type === HalfFloatType ? 2 : 1;
  // Compressed blocks: a byte a pixel (ASTC 4x4, ETC2 RGBA) is near enough for a census.
  const perPixel = compressed ? 1 : channels * perChannel;
  const mipmapped = (t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003) || ((t as { mipmaps?: unknown[] }).mipmaps?.length ?? 0) > 1;
  const bytes = Math.round(width * height * depth * perPixel * (mipmapped ? 4 / 3 : 1));
  const kind = compressed ? "compressed" : `${channels} x ${perChannel} B${mipmapped ? ", mipmapped" : ""}`;
  return { name: t.name || owner, width, height, bytes, kind };
}

/** Every texture the scene's materials hold (uniforms too), once each. */
function sceneTextures(scene: Scene): CensusTexture[] {
  const seen = new Map<Texture, string>();
  const add = (v: unknown, owner: string) => {
    if ((v as Texture | null)?.isTexture && !seen.has(v as Texture)) seen.set(v as Texture, owner);
  };
  add(scene.background, "scene background");
  add(scene.environment, "scene environment");
  scene.traverse((o) => {
    const mats = (o as Partial<Renderable>).material;
    if (!mats) return;
    for (const m of asList(mats)) {
      const owner = `${nameOf(o)} (${m.type})`;
      for (const v of Object.values(m)) add(v, owner);
      const uniforms = (m as { uniforms?: Record<string, { value: unknown } | undefined> }).uniforms;
      if (uniforms) {
        for (const u of Object.values(uniforms)) {
          const v = u?.value;
          if (Array.isArray(v)) v.forEach((x) => add(x, owner));
          else add(v, owner);
        }
      }
    }
  });
  return [...seen].map(([t, owner]) => textureEntry(t, owner)).sort((a, b) => b.bytes - a.bytes);
}

/** The program a material draws with now (its name), or its type before it has been drawn. */
function programOf(r: WebGLRenderer, m: Material): string {
  const p = (r.properties.get(m) as { currentProgram?: { name?: string } }).currentProgram;
  return p?.name || m.name || m.type;
}

interface Saved {
  target: ReturnType<WebGLRenderer["getRenderTarget"]>;
  xr: boolean;
  autoClear: boolean;
  clear: Color;
  alpha: number;
  background: Scene["background"];
}

/** Draw outside XR into our own targets, the renderer's state put back after. */
function borrow(world: World): { r: WebGLRenderer; restore(): void } {
  const r = world.renderer, scene = world.scene;
  const saved: Saved = {
    target: r.getRenderTarget(),
    xr: r.xr.enabled,
    autoClear: r.autoClear,
    clear: r.getClearColor(new Color()),
    alpha: r.getClearAlpha(),
    background: scene.background,
  };
  r.xr.enabled = false;
  // A colour background clears the target on every render, which would wipe the depth the counts build up.
  scene.background = null;
  return {
    r,
    restore() {
      r.xr.enabled = saved.xr;
      r.autoClear = saved.autoClear;
      r.setClearColor(saved.clear, saved.alpha);
      r.setRenderTarget(saved.target);
      scene.background = saved.background;
    },
  };
}

/** The eye's camera with the given view: its pose from the XR camera's eye (or the world camera outside XR). */
function eyeCamera(world: World, fov: CensusOptions["fov"], eye: 0 | 1): PerspectiveCamera {
  const xrCam = world.renderer.xr.getCamera() as { cameras?: PerspectiveCamera[] };
  const src = (world.renderer.xr.isPresenting ? xrCam.cameras?.[eye] : undefined) ?? world.camera;
  const cam = new PerspectiveCamera();
  cam.matrixAutoUpdate = false;
  cam.matrixWorldAutoUpdate = false;
  cam.matrixWorld.copy(src.matrixWorld);
  cam.matrixWorldInverse.copy(src.matrixWorld).invert();
  const near = 0.01, far = 50, t = (deg: number) => Math.tan((deg * Math.PI) / 180) * near;
  cam.projectionMatrix.makePerspective(-t(fov.left), t(fov.right), t(fov.up), -t(fov.down), near, far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  return cam;
}

/** A copy of `m` with its own shader that writes 1/255 additively, its depth test as `m`'s, writing no depth. */
function counting(m: Material, cache: Map<Material, Material>): Material {
  const had = cache.get(m);
  if (had) return had;
  let c: Material;
  try {
    c = m.clone();
  } catch {
    // A material that cannot be copied: counted as a plain one of its shape (its own shader's discards are lost).
    c = new MeshBasicMaterial({ side: m.side, transparent: m.transparent, depthTest: m.depthTest, depthFunc: m.depthFunc });
  }
  const hook = m.onBeforeCompile;
  const key = m.customProgramCacheKey();
  c.onBeforeCompile = (shader, renderer) => {
    hook.call(m, shader, renderer);
    (shader as Shader).fragmentShader = countingFragment((shader as Shader).fragmentShader);
  };
  c.customProgramCacheKey = () => `${key}|census`;
  c.blending = CustomBlending;
  c.blendEquation = AddEquation;
  c.blendEquationAlpha = AddEquation;
  c.blendSrc = OneFactor;
  c.blendDst = OneFactor;
  c.blendSrcAlpha = OneFactor;
  c.blendDstAlpha = OneFactor;
  c.premultipliedAlpha = false;
  c.depthWrite = false;
  c.colorWrite = true;
  cache.set(m, c);
  return c;
}

/** Put `objects` alone (with the scene's lights) on the census layer while `run` draws; layers put back after. */
function alone<T>(scene: Scene, objects: Object3D[], cam: PerspectiveCamera, run: () => T): T {
  const lights: Object3D[] = [];
  scene.traverse((o) => {
    if ((o as { isLight?: boolean }).isLight) lights.push(o);
  });
  const all = [...lights, ...objects];
  const had = all.map((o) => o.layers.isEnabled(LAYER));
  for (const o of all) o.layers.enable(LAYER);
  cam.layers.set(LAYER);
  try {
    return run();
  } finally {
    all.forEach((o, i) => {
      if (!had[i]) o.layers.disable(LAYER);
    });
  }
}

function sumCounts(r: WebGLRenderer, rt: WebGLRenderTarget, buf: Uint8Array): { fragments: number; pixels: number } {
  r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
  let fragments = 0, pixels = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const v = buf[i]!;
    fragments += v;
    if (v) pixels++;
  }
  return { fragments, pixels };
}

/** The frame as the renderer sorts it for this camera: every draw's object once, in drawing order. */
function drawOrder(r: WebGLRenderer, scene: Scene, cam: PerspectiveCamera): Entry[] {
  r.render(scene, cam);
  const list = (r as unknown as { renderLists: { get(s: Scene, depth: number): Record<CensusDraw["list"], { object: Object3D }[]> } }).renderLists.get(
    scene,
    0,
  );
  const seen = new Set<Object3D>(), out: Entry[] = [];
  for (const name of ["opaque", "transmissive", "transparent"] as const) {
    for (const item of list[name]) {
      if (seen.has(item.object)) continue;
      seen.add(item.object);
      out.push({ object: item.object, list: name });
    }
  }
  return out;
}

/** FNV-1a over a frame's bytes: two frames with the same hash have the same pixels (as near as a test needs). */
function hashOf(buf: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function pngOf(buf: Uint8Array, w: number, h: number): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  // The target's rows run bottom up; a premultiplied colour over black reads as it shows over a dark room.
  for (let y = 0; y < h; y++) {
    const from = (h - 1 - y) * w * 4, to = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      img.data[to + x] = buf[from + x]!;
      img.data[to + x + 1] = buf[from + x + 1]!;
      img.data[to + x + 2] = buf[from + x + 2]!;
      img.data[to + x + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

export function census(world: World, o: CensusOptions): Census {
  const { r, restore } = borrow(world);
  const scene = world.scene;
  const cam = eyeCamera(world, o.fov, o.eye ?? 0);
  const colour = new WebGLRenderTarget(o.width, o.height, { depthBuffer: true, stencilBuffer: true });
  colour.texture.colorSpace = SRGBColorSpace;
  const rt = new WebGLRenderTarget(o.width, o.height, { depthBuffer: true, stencilBuffer: true });
  const cache = new Map<Material, Material>();
  try {
    // The frame as it draws, and its draw list.
    r.setRenderTarget(colour);
    r.autoClear = true;
    r.setClearColor(0x000000, 0);
    const order = drawOrder(r, scene, cam);
    const pixels = new Uint8Array(o.width * o.height * 4);
    r.readRenderTargetPixels(colour, 0, 0, o.width, o.height, pixels);
    const hash = hashOf(pixels);
    const image = o.image ? pngOf(pixels, o.width, o.height) : undefined;
    // Every draw counted in turn, in the same order, over the depth the draws before it left.
    r.setRenderTarget(rt);
    r.autoClear = false;
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    const buf = new Uint8Array(o.width * o.height * 4);
    const draws: CensusDraw[] = [];
    for (const e of order) {
      const obj = e.object as Renderable;
      const mats = asList(obj.material);
      const counted = Array.isArray(obj.material) ? mats.map((m) => counting(m, cache)) : counting(obj.material, cache);
      const sums = alone(scene, [obj], cam, () => {
        r.clear(true, false, false);
        const orig = obj.material;
        obj.material = counted;
        try {
          r.render(scene, cam);
        } finally {
          obj.material = orig;
        }
        const s = sumCounts(r, rt, buf);
        // The depth this draw leaves for the ones after it.
        if (mats.some((m) => m.depthWrite && m.depthTest !== false)) {
          const writes = mats.map((m) => m.colorWrite);
          for (const m of mats) m.colorWrite = false;
          try {
            r.render(scene, cam);
          } finally {
            mats.forEach((m, i) => (m.colorWrite = writes[i]!));
          }
        }
        return s;
      });
      const m = mats[0]!;
      const tri = triangles(obj);
      draws.push({
        name: nameOf(obj),
        list: e.list,
        material: mats.map((x) => x.type).join(" + "),
        program: mats.map((x) => programOf(r, x)).join(" + "),
        features: features(m),
        renderOrder: obj.renderOrder,
        triangles: tri.triangles,
        instances: tri.instances,
        fragments: sums.fragments,
        pixels: sums.pixels,
      });
    }
    const textures = sceneTextures(scene);
    const info = r.info as unknown as { programs?: unknown[]; memory: { textures: number; geometries: number } };
    return {
      width: o.width,
      height: o.height,
      hash,
      draws,
      textures,
      textureBytes: textures.reduce((s, t) => s + t.bytes, 0),
      programs: info.programs?.length ?? 0,
      rendererTextures: info.memory.textures,
      rendererGeometries: info.memory.geometries,
      ...(image ? { image } : {}),
    };
  } finally {
    restore();
    colour.dispose();
    rt.dispose();
    for (const c of cache.values()) c.dispose();
  }
}

/** A camera at the eye looking at `obj`, its view just holding the object's bounds (null when the eye is inside them). */
function framing(world: World, obj: Object3D, eye: PerspectiveCamera): PerspectiveCamera | null {
  // Not precise: an instanced mesh's bounds then hold all its instances.
  const box = new Box3().setFromObject(obj, false);
  if (box.isEmpty()) return null;
  const s = box.getBoundingSphere(new Sphere());
  const at = new Vector3().setFromMatrixPosition(eye.matrixWorld);
  const d = at.distanceTo(s.center);
  if (d <= s.radius * 1.05) return null;
  const cam = new PerspectiveCamera((2 * Math.asin(s.radius / d) * 180) / Math.PI, 1, Math.max(0.005, d - s.radius), d + s.radius);
  cam.position.copy(at);
  cam.lookAt(s.center);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  void world;
  return cam;
}

/**
 * What a fragment of each named draw costs in software rendering, each draw framed to fill the target (`size` square),
 * drawn `repeats` times there and on an 8 x 8 target: (time big - time tiny) / repeats / (fragments big - tiny).
 */
export function probe(world: World, o: { names: string[]; fov: CensusOptions["fov"]; size: number; repeats: number; realNow: () => number }): ProbeResult[] {
  const { r, restore } = borrow(world);
  const scene = world.scene;
  const eye = eyeCamera(world, o.fov, 0);
  const big = new WebGLRenderTarget(o.size, o.size, { depthBuffer: true, stencilBuffer: true });
  const tiny = new WebGLRenderTarget(8, 8, { depthBuffer: true, stencilBuffer: true });
  const cache = new Map<Material, Material>();
  const pixel = new Uint8Array(4);
  const out: ProbeResult[] = [];
  try {
    r.autoClear = false;
    r.setClearColor(0x000000, 0);
    const order = drawOrder(r, scene, eye);
    for (const name of o.names) {
      const e = order.find((x) => nameOf(x.object) === name);
      if (!e) continue;
      const obj = e.object as Renderable;
      const mats = asList(obj.material);
      const counted = Array.isArray(obj.material) ? mats.map((m) => counting(m, cache)) : counting(obj.material, cache);
      let cam = framing(world, obj, eye) ?? eye;
      const frags = (rt: WebGLRenderTarget) =>
        alone(scene, [obj], cam, () => {
          r.setRenderTarget(rt);
          r.clear(true, true, true);
          const orig = obj.material;
          obj.material = counted;
          try {
            r.render(scene, cam);
          } finally {
            obj.material = orig;
          }
          return sumCounts(r, rt, new Uint8Array(rt.width * rt.height * 4)).fragments;
        });
      // Real ms for `n` draws of the object with its own material, the GPU waited for (a one-pixel read).
      const time = (rt: WebGLRenderTarget, n: number) =>
        alone(scene, [obj], cam, () => {
          r.setRenderTarget(rt);
          r.clear(true, true, true);
          r.render(scene, cam);
          r.readRenderTargetPixels(rt, 0, 0, 1, 1, pixel);
          // No clear between draws (its cost grows with the target, not the fragments): a depth-writing draw passes its
          // own depth again (three tests less-or-equal).
          const t0 = o.realNow();
          for (let i = 0; i < n; i++) r.render(scene, cam);
          r.readRenderTargetPixels(rt, 0, 0, 1, 1, pixel);
          return o.realNow() - t0;
        });
      let fBig = frags(big), fTiny = frags(tiny);
      // A mesh its vertex shader places (the ghost hand's capsules) has bounds that frame nothing: the eye's view then.
      if (fBig - fTiny < 1000 && cam !== eye) {
        cam = eye;
        fBig = frags(big);
        fTiny = frags(tiny);
      }
      if (fBig - fTiny < 1000) continue;
      const tBig = time(big, o.repeats), tTiny = time(tiny, o.repeats);
      out.push({ name, program: mats.map((m) => programOf(r, m)).join(" + "), nsPerFragment: ((tBig - tTiny) * 1e6) / o.repeats / (fBig - fTiny), fragments: fBig });
    }
    return out;
  } finally {
    restore();
    big.dispose();
    tiny.dispose();
    for (const c of cache.values()) c.dispose();
  }
}
