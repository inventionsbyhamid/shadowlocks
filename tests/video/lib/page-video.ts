/**
 * Functions that run inside the page for video renders. Each one is serialized by Playwright, so it
 * must be self-contained: no imports, no outer variables.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SlFrameState } from "../../../src/app/test-api";

/**
 * Init script (before the app loads).
 * - Refuse the box worker, so the game builds boxes on the main thread (its box client falls back
 *   to that when the worker cannot start): a worker answers in real time, which could put a new box
 *   on a different frame in every run. Other workers are kept.
 * - Count async work in flight (fetches, image and audio decodes, worker requests), so every frame can
 *   wait for it before stepping (`__nsVideoIdle`): a lazily loaded asset then lands on the same frame
 *   in every run however slow the server is. A worker that never answers is let go after a second.
 */
export function videoInit(): void {
  const w = window as any;
  if (w.__nsVideoInit) return;
  w.__nsVideoInit = true;
  const realNow = performance.now.bind(performance);
  const realSetInterval = w.setInterval.bind(w);
  const realClearInterval = w.clearInterval.bind(w);
  // Timers stay real (the wait below needs them, and IWER re-arms one every frame), but a timer the
  // app itself starts during setup or recording is noted: it would fire on real time, not frames.
  const appTimers: string[] = (w.__nsVideoAppTimers = []);
  for (const name of ["setTimeout", "setInterval"]) {
    const real = w[name].bind(w);
    w[name] = (...a: unknown[]) => {
      if (w.__nsVideoRecording || w.__nsVideoSetup) {
        const site = (new Error().stack ?? "").split("\n").find((l) => /\/src\//.test(l));
        if (site && appTimers.length < 50) appTimers.push(`${name} ${site.trim()}`);
      }
      return real(...a);
    };
  }
  let pending = 0;
  const waiters: Array<() => void> = [];
  const settle = () => {
    if (pending > 0) return;
    for (const f of waiters.splice(0)) f();
  };
  const track = <T,>(p: Promise<T>): Promise<T> => {
    pending++;
    const done = () => {
      pending--;
      settle();
    };
    p.then(done, done);
    return p;
  };
  const realFetch = w.fetch?.bind(w);
  if (realFetch) w.fetch = (...a: unknown[]) => track(realFetch(...a));
  // A response body arrives after the fetch itself resolves.
  for (const m of ["arrayBuffer", "blob", "json", "text"]) {
    const body = w.Response?.prototype?.[m];
    if (body) {
      w.Response.prototype[m] = function (this: unknown, ...a: unknown[]) {
        return track(body.apply(this, a));
      };
    }
  }
  const realBitmap = w.createImageBitmap?.bind(w);
  if (realBitmap) w.createImageBitmap = (...a: unknown[]) => track(realBitmap(...a));
  const Ctx = w.BaseAudioContext ?? w.AudioContext;
  if (Ctx?.prototype?.decodeAudioData) {
    const decode = Ctx.prototype.decodeAudioData;
    Ctx.prototype.decodeAudioData = function (this: unknown, ...a: unknown[]) {
      return track(decode.apply(this, a));
    };
  }
  const Real = w.Worker as typeof Worker | undefined;
  if (Real) {
    class VideoWorker extends Real {
      private nsWaiting = 0;
      private nsSince = 0;
      constructor(url: string | URL, options?: WorkerOptions) {
        if (String(url).includes("box.worker")) throw new Error("video render: boxes on the main thread");
        super(url, options);
        this.addEventListener("message", () => this.nsAnswered());
        this.addEventListener("error", () => this.nsAnswered(true));
        workers.add(this);
      }
      override postMessage(...a: [any, any?]): void {
        if (this.nsWaiting === 0) this.nsSince = realNow();
        this.nsWaiting++;
        pending++;
        super.postMessage(...(a as [any]));
      }
      nsAnswered(all = false): void {
        const n = all ? this.nsWaiting : Math.min(1, this.nsWaiting);
        this.nsWaiting -= n;
        pending -= n;
        settle();
      }
      /** Let go of requests that waited longer than `ms` (fire and forget messages). */
      nsExpire(ms: number): void {
        if (this.nsWaiting > 0 && realNow() - this.nsSince > ms) this.nsAnswered(true);
      }
    }
    const workers = new Set<VideoWorker>();
    w.Worker = VideoWorker;
    w.__nsVideoExpireWorkers = (ms: number) => {
      for (const wk of workers) wk.nsExpire(ms);
    };
  }
  /** Resolves true once nothing is in flight, or false after `maxMs` of real time. */
  w.__nsVideoIdle = (maxMs = 3000): Promise<boolean> => {
    if (pending <= 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t0 = realNow();
      const timer = realSetInterval(() => {
        w.__nsVideoExpireWorkers?.(1000);
        if (pending <= 0) return;
        if (realNow() - t0 > maxMs) {
          realClearInterval(timer);
          console.warn(`video: still ${pending} async operations after ${maxMs} ms; stepping anyway`);
          resolve(false);
        }
      }, 20);
      waiters.push(() => {
        realClearInterval(timer);
        resolve(true);
      });
    });
  };
  w.__nsVideoPending = () => pending;
  // Each recorded frame drains the app's event log (the sound is mixed from it), so waits read the
  // events seen since recording started from here: those drained, then any not drained yet.
  w.__nsVideoSeen = [];
  w.__nsVideoEvents = (type?: string): unknown[] => {
    const all = (w.__nsVideoSeen as Array<{ type: string }>).concat(w.__ns.events());
    return type ? all.filter((e) => e.type === type) : all;
  };
}

/**
 * After boot, before anything is recorded:
 * - the emulated headset's field of view;
 * - frames can be stepped without drawing (`window.__nsVideoSkip`): the scene is hidden only while it
 *   is drawn, so every system, matrix and the camera still update exactly as in a drawn frame;
 * - `Date` follows the virtual clock from a fixed epoch (`Date.now() = epochMs + performance.now()`),
 *   so anything read from the clock (the day's box, saved times) is the same in every run;
 * - during the shot's setup (`__nsVideoSetup`) and while recording (`__nsVideoRecording`), only
 *   `setupStep`, `videoFrame` and `alignStep` may step the clock: anything else stepping (a helper
 *   that steps on its own, in the page) throws instead of skipping the wait for async work;
 * - the frame fingerprint (`frameFingerprint`, passed as its source text) as
 *   `window.__nsVideoFingerprint`, the same code the unit tests run.
 */
export function videoPrepare(o: { fovy: number; epochMs: number; fingerprint: string }): { canvas: [number, number]; fovy: number } {
  const w = window as any;
  const d = w.IWER_DEVICE;
  d.fovy = o.fovy;
  w.__nsVideoFingerprint = (0, eval)(`(${o.fingerprint})`);
  const patch = (renderer: any) => {
    if (!renderer || renderer.__nsVideoPatched) return;
    const draw = renderer.render.bind(renderer);
    renderer.render = (scene: any, camera: any) => {
      if (!w.__nsVideoSkip) return draw(scene, camera);
      const visible = scene.visible;
      scene.visible = false;
      try {
        draw(scene, camera);
      } finally {
        scene.visible = visible;
      }
    };
    renderer.__nsVideoPatched = true;
  };
  patch(w.__ns.world.renderer);
  patch(d.sem?.renderer);
  for (const id of ["enter-overlay", "status"]) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  }
  const Base = w.__nsVideoRealDate ?? w.Date;
  w.__nsVideoRealDate = Base;
  const nowMs = () => o.epochMs + performance.now();
  function VideoDate(this: unknown, ...args: unknown[]): unknown {
    if (!new.target) return new Base(nowMs()).toString();
    return args.length ? Reflect.construct(Base, args) : new Base(nowMs());
  }
  VideoDate.prototype = Base.prototype;
  VideoDate.now = nowMs;
  VideoDate.parse = Base.parse;
  VideoDate.UTC = Base.UTC;
  w.Date = VideoDate;
  const vt = w.__vt;
  if (!vt.__nsVideoGuard) {
    const step = vt.step.bind(vt);
    vt.step = (ms: number) => {
      if ((w.__nsVideoRecording || w.__nsVideoSetup) && !w.__nsVideoStepping) {
        throw new Error("video: only the video recorder steps frames in a shot's setup or play (use the app helpers, wait or until)");
      }
      return step(ms);
    };
    vt.__nsVideoGuard = true;
  }
  const canvas = w.__ns.world.renderer.domElement as HTMLCanvasElement;
  return { canvas: [canvas.width, canvas.height], fovy: d.fovy };
}

/**
 * The dark stage (a shot's `darkStage`): the emulator's room is not drawn (as the store art's plates), the theatre's
 * veil is off (the player's own Dim room setting, so nothing darkens the backdrop), and each captured frame lays the
 * app over `backdrop`, a flat colour, where the room would be. Nothing is added to the scene: the box, its lantern,
 * its shadows and the hands are what the game draws.
 */
export function darkStage(o: { backdrop: string }): { dimming: string } {
  const w = window as any;
  const sem = w.IWER_DEVICE?.sem;
  w.__nsNoRoom = true;
  if (sem) {
    sem.render = () => {};
    if (sem.environmentCanvas) sem.environmentCanvas.style.display = "none";
  }
  w.__nsCaptureBackdrop = o.backdrop;
  const ui = w.__ns.ui;
  if (typeof ui.settings()?.dimming !== "boolean") return { dimming: "missing" };
  ui.setSettings({ dimming: false });
  return { dimming: ui.settings().dimming === false ? "off" : "stuck" };
}

/**
 * The photographic room (a shot's `photoRoom`): an equirectangular photograph drawn where the emulator draws its room,
 * on the emulator's own environment canvas, behind the app. The emulator's room stays loaded (the game never reads its
 * planes: the box is placed from the head alone) but is no longer drawn; instead each drawn frame paints the photograph
 * as seen from the headset's pose with its lens (IWER_DEVICE position, quaternion, fovy), at infinity, turned `yawDeg`
 * (the photograph's column 0.5 + yawDeg / 360 straight ahead, as ffmpeg's v360 yaw). No parallax: keep the camera near
 * one eye point. The theatre's veil is the app's, drawn over this canvas, so the room dims exactly as the game dims it.
 * The image comes as base64 (a JPEG); its pixels are drawn as they are (no colour conversion), sampled with gradients
 * worked out from the view so the seam at the photograph's edge and the mip levels stay smooth.
 */
export async function photoRoom(o: { jpegBase64: string; yawDeg: number }): Promise<{ ok: boolean; why?: string; size?: [number, number]; maxTexture?: number; aniso?: number }> {
  const w = window as any;
  const d = w.IWER_DEVICE;
  const sem = d?.sem;
  if (!sem?.renderer) return { ok: false, why: "the emulator has no synthetic environment" };
  const canvas = sem.environmentCanvas as HTMLCanvasElement;
  const gl = sem.renderer.getContext() as WebGL2RenderingContext;
  if (!gl || typeof gl.texStorage2D !== "function") return { ok: false, why: "the environment canvas has no WebGL2 context" };
  const bin = atob(o.jpegBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "none" });
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (bmp.width > maxTexture || bmp.height > maxTexture) return { ok: false, why: `the photograph is ${bmp.width}x${bmp.height}, the GPU takes ${maxTexture}`, maxTexture };
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`photo room shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const prog = gl.createProgram() as WebGLProgram;
  gl.attachShader(
    prog,
    compile(
      gl.VERTEX_SHADER,
      `#version 300 es
out vec2 ndc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  ndc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`,
    ),
  );
  gl.attachShader(
    prog,
    compile(
      gl.FRAGMENT_SHADER,
      `#version 300 es
precision highp float;
in vec2 ndc;
uniform sampler2D pano;
uniform mat3 rot;
uniform vec2 tanHalf;
uniform vec2 px;
uniform float yaw;
out vec4 color;
const float PI = 3.141592653589793;
vec2 uvOf(vec2 n) {
  vec3 d = normalize(rot * vec3(n.x * tanHalf.x, n.y * tanHalf.y, -1.0));
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(0.5 + (lon + yaw) / (2.0 * PI), 0.5 - lat / PI);
}
void main() {
  vec2 uv = uvOf(ndc);
  vec2 ux = uvOf(ndc + vec2(px.x, 0.0)) - uv;
  vec2 uy = uvOf(ndc + vec2(0.0, px.y)) - uv;
  ux.x -= floor(ux.x + 0.5);
  uy.x -= floor(uy.x + 0.5);
  color = vec4(textureGrad(pano, uv, ux, uy).rgb, 1.0);
}`,
    ),
  );
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { ok: false, why: `photo room program: ${gl.getProgramInfoLog(prog)}` };
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const ext = gl.getExtension("EXT_texture_filter_anisotropic");
  let aniso = 1;
  if (ext) {
    aniso = Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number);
    gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, aniso);
  }
  const size: [number, number] = [bmp.width, bmp.height];
  bmp.close();
  const vao = gl.createVertexArray();
  const at = (n: string) => gl.getUniformLocation(prog, n);
  const uPano = at("pano"), uRot = at("rot"), uTan = at("tanHalf"), uPx = at("px"), uYaw = at("yaw");
  const app = w.__ns.world.renderer.domElement as HTMLCanvasElement;
  const rot = new Float32Array(9);
  sem.render = () => {
    // Undrawn frames (setup, fast-forward) draw nothing here either.
    if (w.__nsVideoSkip) return;
    const dims = d.canvasDimensions as { width: number; height: number } | undefined;
    const cw = dims?.width ?? app.width, ch = dims?.height ?? app.height;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const q = d.quaternion as { x: number; y: number; z: number; w: number };
    const { x, y, z } = q, qw = q.w;
    // Camera to world, column major.
    rot[0] = 1 - 2 * (y * y + z * z);
    rot[1] = 2 * (x * y + z * qw);
    rot[2] = 2 * (x * z - y * qw);
    rot[3] = 2 * (x * y - z * qw);
    rot[4] = 1 - 2 * (x * x + z * z);
    rot[5] = 2 * (y * z + x * qw);
    rot[6] = 2 * (x * z + y * qw);
    rot[7] = 2 * (y * z - x * qw);
    rot[8] = 1 - 2 * (x * x + y * y);
    const ty = Math.tan((d.fovy as number) / 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    for (const cap of [gl.DEPTH_TEST, gl.CULL_FACE, gl.BLEND, gl.SCISSOR_TEST, gl.STENCIL_TEST]) gl.disable(cap);
    gl.colorMask(true, true, true, true);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uPano, 0);
    gl.uniformMatrix3fv(uRot, false, rot);
    gl.uniform2f(uTan, ty * (cw / ch), ty);
    gl.uniform2f(uPx, 2 / cw, 2 / ch);
    gl.uniform1f(uYaw, (o.yawDeg * Math.PI) / 180);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  return { ok: true, size, maxTexture, aniso };
}

/** The headset's pose now. */
export function headsetPose(): { position: [number, number, number]; quaternion: [number, number, number, number] } {
  const d = (window as any).IWER_DEVICE;
  return {
    position: [d.position.x, d.position.y, d.position.z],
    quaternion: [d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w],
  };
}

/**
 * One undrawn step toward virtual time `target` (ms): a full frame, or the rest when less is left.
 * Returns the ms still left.
 */
export async function alignStep(o: { target: number; dt: number }): Promise<number> {
  const w = window as any;
  await w.__nsVideoIdle?.();
  w.__nsVideoSkip = true;
  const left = o.target - w.__vt.now;
  if (left > 1e-6) {
    w.__nsVideoStepping = true;
    try {
      w.__vt.step(Math.min(o.dt, left));
    } finally {
      w.__nsVideoStepping = false;
    }
  }
  return o.target - w.__vt.now;
}

/**
 * One undrawn setup frame, as recorded frames do it: if `src` (a stepUntil predicate) is given and
 * already true, report done; else wait for async work in flight, then step `dt`.
 */
export async function setupStep(o: { dt: number; src: string | null; arg: unknown }): Promise<{ done: boolean; now: number }> {
  const w = window as any;
  w.__nsVideoSetup = true;
  if (o.src) {
    const f = (0, eval)(`(${o.src})`) as (ns: unknown, w: unknown, a: unknown) => boolean;
    if (f(w.__ns, w, o.arg)) return { done: true, now: w.__vt.now as number };
  }
  await w.__nsVideoIdle?.();
  w.__nsVideoSkip = true;
  w.__nsVideoStepping = true;
  try {
    w.__vt.step(o.dt);
  } finally {
    w.__nsVideoStepping = false;
  }
  return { done: false, now: w.__vt.now as number };
}

export interface FrameArgs {
  dt: number;
  position: readonly [number, number, number];
  quaternion: readonly [number, number, number, number];
  /** IWER's vertical field of view (radians) for this frame: the view's lens. */
  fovy?: number;
  /** Step without drawing (fast-forward). */
  skip: boolean;
  capture: boolean;
  /** Restyle IWSDK's hands as the see-through system hand (window.__nsVideo, video builds only). */
  solidHands: boolean;
}

export interface FrameResult {
  img: string | null;
  /** Fingerprint of the frame's state: equal in every run of a deterministic shot. */
  hash: string;
  /** Bus events since the last frame. */
  events: unknown[];
  head: { p: [number, number, number]; q: [number, number, number, number] };
  /**
   * Buttons on screen, only on frames with events: an event that names a button (`id`) is heard
   * there, as the game's own sound places it.
   */
  buttons: Array<{ id: string; world: [number, number, number] }> | null;
  screen: string;
  /** What the fingerprint read of the game: `window.__sl.frameState()` (null: no box in play, or no hook). */
  game: SlFrameState | null;
  /** Real ms: whole step (systems, IWER, draw submit), and the capture (draw finish, composite, PNG). */
  stepMs: number;
  captureMs: number;
  calls: number;
  triangles: number;
  hands: { solid: number; contour: number } | null;
  /** Real ms this frame waited for async work (asset loads, decodes, workers) before stepping. */
  idleMs: number;
}

/** A hand's pose for the fingerprint: position (m) and quaternion. */
export interface FrameHand {
  side: string;
  p: readonly [number, number, number];
  q: readonly [number, number, number, number];
}

/**
 * Fingerprint of a frame's state (8 hex characters, FNV-1a): virtual time, screen, the game state
 * from `__sl.frameState()`, both hands' poses and the frame's events. Numbers are rounded to 1e-4
 * (0.1 mm for the hands; the lantern is in box units, so finer), so float noise below what shows
 * never splits two runs. A null game (no box yet, or no hook) hashes as "no box"; fields missing
 * from a game state hash as such instead of failing.
 * Runs in the page too (videoPrepare installs it from its source), so it is self-contained.
 */
export function frameFingerprint(now: number, screen: string, game: unknown, hands: readonly FrameHand[], events: readonly unknown[]): string {
  const r4 = (x: unknown) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n * 1e4) : "x";
  };
  let text = `${now.toFixed(3)}|${screen}|`;
  const g = game && typeof game === "object" ? (game as { boxKey?: unknown; lantern?: unknown; openLocks?: unknown; screen?: unknown }) : null;
  if (g) {
    const l = Array.isArray(g.lantern) ? g.lantern : [];
    const open = Array.isArray(g.openLocks) ? g.openLocks : [];
    text += `box ${String(g.boxKey)}|lantern ${r4(l[0])},${r4(l[1])},${r4(l[2])}|open ${open.map(String).join(",")}|${String(g.screen)}|`;
  } else {
    text += "no box|";
  }
  for (const h of hands) {
    text += `${h.side}:${r4(h.p[0])},${r4(h.p[1])},${r4(h.p[2])},${r4(h.q[0])},${r4(h.q[1])},${r4(h.q[2])},${r4(h.q[3])};`;
  }
  for (const e of events) text += JSON.stringify(e);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Wait for async work in flight, pose the headset, step one frame, collect its events and state,
 * and optionally capture it.
 */
export async function videoFrame(a: FrameArgs): Promise<FrameResult> {
  const w = window as any;
  const d = w.IWER_DEVICE;
  const ns = w.__ns;
  const vt = w.__vt;
  const i0 = vt.realNow();
  await w.__nsVideoIdle?.();
  const idleMs = vt.realNow() - i0;
  d.position.set(a.position[0], a.position[1], a.position[2]);
  d.quaternion.set(a.quaternion[0], a.quaternion[1], a.quaternion[2], a.quaternion[3]);
  if (a.fovy !== undefined && Math.abs(d.fovy - a.fovy) > 1e-9) d.fovy = a.fovy;
  const hands = a.solidHands && w.__nsVideo ? w.__nsVideo.styleHands(true) : null;
  w.__nsVideoSkip = a.skip;
  const s0 = vt.realNow();
  w.__nsVideoStepping = true;
  try {
    vt.step(a.dt);
  } finally {
    w.__nsVideoStepping = false;
  }
  const stepMs = vt.realNow() - s0;
  const events = ns.events();
  if (events.length) {
    ns.clearEvents();
    if (w.__nsVideoRecording) for (const e of events) w.__nsVideoSeen.push(e);
  }
  // The voice guide's lines this frame (src/video/voice-out.ts): heard in the shot's sound as the game's own clips.
  for (const line of w.__nsVideoVoice?.drain() ?? []) events.push({ type: "video.voice", ...line });
  const st = ns.state();
  // The game's own small hook (null while no box is in play; missing in a build without it).
  const game = (w.__sl?.frameState?.() ?? null) as SlFrameState | null;
  const poses: FrameHand[] = [];
  for (const side of ["left", "right"]) {
    const h = d.hands?.[side];
    if (!h) continue;
    const p = h.position;
    const q = h.quaternion;
    poses.push({ side, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] });
  }
  const hash = w.__nsVideoFingerprint(vt.now, st.screen, game, poses, events) as string;

  let img: string | null = null;
  let captureMs = 0;
  if (a.capture) {
    const c0 = vt.realNow();
    img = w.__nsCapture("image/png") as string;
    captureMs = vt.realNow() - c0;
  }
  const info = ns.world.renderer.info.render;
  return {
    img,
    hash,
    events,
    head: { p: [d.position.x, d.position.y, d.position.z], q: [d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w] },
    buttons: events.length ? st.buttons.map((b: any) => ({ id: b.id, world: b.world })) : null,
    screen: st.screen,
    game,
    stepMs,
    captureMs,
    calls: info.calls,
    triangles: info.triangles,
    hands,
    idleMs,
  };
}
