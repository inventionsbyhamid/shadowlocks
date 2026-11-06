// Switches for testing on a real Quest, read from the page address. They ship in production but do
// nothing unless named in the address:
//   ?perf=1       a small stats panel beside the box: frame rate, frame time, JS time per frame,
//                 draw calls, triangles, multiview on or off
//   ?multiview=0  draw the two eyes one after the other instead of together (no OCULUS_multiview), to
//                 compare frame times with the default
//   ?box=N        start straight into box N as practice, from the start: it is never saved, solved or
//                 collected, so the box in progress, the next box, the collection and the streak stay as
//                 they were (its Next is box N+1, practice too)
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3, type World } from "@iwsdk/core";
import { BOX_ROOT_NAME } from "../render/placement";

export interface FieldFlags {
  perf: boolean;
  multiview: boolean;
}

const ON = new Set(["", "1", "on", "true", "yes"]);

export function readFieldFlags(search: string): FieldFlags {
  const q = new URLSearchParams(search);
  const flag = (name: string, fallback: boolean) => (q.has(name) ? ON.has((q.get(name) ?? "").toLowerCase()) : fallback);
  return { perf: flag("perf", false), multiview: flag("multiview", true) };
}

/** `?box=N`: the box to start in (a whole number from 1), or null when the address names none (or a bad one). */
export function startBox(search: string): number | null {
  const v = new URLSearchParams(search).get("box");
  if (v === null || !/^[1-9]\d{0,5}$/.test(v)) return null;
  return Number(v);
}

/**
 * Turn multiview off before an XR session starts: three only uses it when the WebGL extension is
 * there, so the renderer is told it is not.
 */
export function disableMultiview(renderer: { extensions: { has(name: string): boolean } }): void {
  const ext = renderer.extensions;
  const has = ext.has.bind(ext);
  ext.has = (name: string) => (name === "OCULUS_multiview" ? false : has(name));
}

/** Frame intervals and JS time over the last frames, without allocating per frame. */
export class FrameStats {
  private readonly gaps: Float32Array;
  private readonly js: Float32Array;
  private readonly scratch: Float32Array;
  private n = 0;
  private at = 0;
  private last = -1;

  constructor(readonly size = 180) {
    this.gaps = new Float32Array(size);
    this.js = new Float32Array(size);
    this.scratch = new Float32Array(size);
  }

  /** A frame that started at `nowMs` and spent `jsMs` in JS. */
  frame(nowMs: number, jsMs: number): void {
    if (this.last >= 0) {
      this.gaps[this.at] = nowMs - this.last;
      this.js[this.at] = jsMs;
      this.at = (this.at + 1) % this.size;
      if (this.n < this.size) this.n++;
    }
    this.last = nowMs;
  }

  private p95(src: Float32Array): number {
    const s = this.scratch.subarray(0, this.n);
    s.set(src.subarray(0, this.n));
    s.sort();
    return s[Math.min(this.n - 1, Math.floor(this.n * 0.95))] ?? 0;
  }

  private avg(src: Float32Array): number {
    let t = 0;
    for (let i = 0; i < this.n; i++) t += src[i] as number;
    return this.n ? t / this.n : 0;
  }

  summary(): { frames: number; fps: number; frameP95: number; jsAvg: number; jsP95: number } {
    const gap = this.avg(this.gaps);
    return { frames: this.n, fps: gap > 0 ? 1000 / gap : 0, frameP95: this.p95(this.gaps), jsAvg: this.avg(this.js), jsP95: this.p95(this.js) };
  }
}

const W = 640;
const H = 240;
const REFRESH_MS = 500;

export interface PerfPanel {
  mesh: Mesh;
  /** The lines last drawn. */
  lines: string[];
}

/**
 * The ?perf=1 panel: 18 x 7 cm, left of the box and tilted toward the player, drawn on top of
 * everything (one draw call). Text refreshes twice a second; the numbers cover all JS in the world
 * update (IWSDK's systems and ours, not the GPU) and the last frame's draw calls.
 */
export function showPerfPanel(world: World, now: () => number = () => performance.now()): PerfPanel {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new Mesh(new PlaneGeometry(0.18, 0.0675), material);
  mesh.name = "Perf Panel";
  mesh.renderOrder = 10_000;
  mesh.frustumCulled = false;
  world.scene.add(mesh);
  const panel: PerfPanel = { mesh, lines: [] };

  const stats = new FrameStats();
  const boxPos = new Vector3();
  const boxQuat = new Quaternion();
  const offset = new Vector3();
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.55);
  let lastDraw = -Infinity;

  const draw = (t: number) => {
    lastDraw = t;
    const s = stats.summary();
    const info = world.renderer.info.render;
    const xr = world.renderer.xr as unknown as { isMultiview?: boolean; isPresenting: boolean };
    const target = world.session?.frameRate;
    panel.lines = [
      `${s.fps.toFixed(0)} fps${target ? ` of ${target}` : ""}, slowest ${s.frameP95.toFixed(1)} ms`,
      `JS ${s.jsAvg.toFixed(1)} ms a frame, slowest ${s.jsP95.toFixed(1)} ms`,
      `${info.calls} draws, ${(info.triangles / 1000).toFixed(1)}k triangles`,
      `multiview ${xr.isMultiview ? "on" : "off"}${xr.isPresenting ? "" : " (not in XR)"}`,
    ];
    mesh.userData.lines = panel.lines;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(16, 19, 24, 0.82)";
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 24);
    ctx.fill();
    ctx.fillStyle = "#f4f1ea";
    ctx.font = "600 32px system-ui, sans-serif";
    panel.lines.forEach((line, i) => ctx.fillText(line, 24, 54 + i * 52, W - 48));
    texture.needsUpdate = true;
    // Beside the box (left of its back panel, a little toward the player), wherever it is placed.
    const box = world.scene.getObjectByName(BOX_ROOT_NAME);
    if (box) {
      box.getWorldPosition(boxPos);
      box.getWorldQuaternion(boxQuat);
      offset.set(-0.28, 0.02, 0.06).applyQuaternion(boxQuat);
      mesh.position.copy(boxPos).add(offset);
      mesh.quaternion.copy(boxQuat).multiply(tilt);
    }
  };

  const update = world.update.bind(world);
  world.update = (delta: number, time: number) => {
    const a = now();
    update(delta, time);
    const b = now();
    stats.frame(a, b - a);
    if (b - lastDraw >= REFRESH_MS) draw(b);
  };
  return panel;
}
