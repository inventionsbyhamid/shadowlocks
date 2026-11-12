// Render options, from the environment (scripts/video.sh passes them with --env).
import path from "node:path";

export type Quality = "final" | "draft";

export interface VideoOptions {
  /** Shots to render, in order (SHOTS=a,b). */
  shots: string[];
  /** Edit to cut from rendered shots afterwards (EDIT=name), if any. */
  edit: string | null;
  quality: Quality;
  width: number;
  height: number;
  /**
   * Delivery size (OUT_SIZE=WxH, default the render size): frames are drawn at width x height and the delivery
   * encode scales them down (Lanczos), so thin threads and gold edges are supersampled instead of shimmering.
   */
  outWidth: number;
  outHeight: number;
  fps: number;
  /** Horizontal field of view in degrees (a Quest 3 recording shows about 90). */
  hfovDeg: number;
  /** x264 settings of the delivery encode. */
  crf: number;
  preset: string;
  /** Keep a shot's PNG frames after its mezzanine is verified (default: delete them). */
  keepFrames: boolean;
  /** Ignore frames and finished shots from earlier runs. */
  fresh: boolean;
  /** Reuse finished shots and frames made from an older app or library (REUSE_STALE=1), with a warning. */
  reuseStale: boolean;
  /** Stop a shot after this many newly recorded frames (to check resuming), 0 = never. */
  stopAfter: number;
  /** Stop resumably when the frames of the shot in progress pass this many GB (EXPECT_GB). */
  expectGb: number;
  /** Stop resumably when the disk has less free than this (MIN_FREE_GB, default 100). */
  minFreeGb: number;
  /** Id of the browser image the frames come from (NS_IMAGE_ID, set by scripts/video.sh). */
  imageId: string;
  /** Lazily written cache on the server: frames, mezzanines, stems, work files. Never pulled. */
  cacheRoot: string;
  /** Delivery files (MP4, contact sheet, stills, JSON) for this size and rate: pulled back with test-results. */
  outDir: string;
}

const QUALITY: Record<Quality, { width: number; height: number; crf: number; preset: string }> = {
  final: { width: 1920, height: 1080, crf: 18, preset: "slow" },
  draft: { width: 1280, height: 720, crf: 22, preset: "veryfast" },
};

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return n;
};

export function videoOptions(env: Record<string, string | undefined> = process.env, root = process.cwd()): VideoOptions {
  const quality = (env.QUALITY ?? "draft") as Quality;
  const q = QUALITY[quality];
  if (!q) throw new Error(`QUALITY is final or draft, not ${env.QUALITY}`);
  let { width, height } = q;
  if (env.SIZE) {
    const m = /^(\d+)x(\d+)$/.exec(env.SIZE);
    if (!m) throw new Error(`SIZE is WxH, not ${env.SIZE}`);
    width = Number(m[1]);
    height = Number(m[2]);
  }
  // x264 with yuv420p needs even sizes.
  if (width % 2 || height % 2) throw new Error(`SIZE must be even: ${width}x${height}`);
  let [outWidth, outHeight] = [width, height];
  if (env.OUT_SIZE) {
    const m = /^(\d+)x(\d+)$/.exec(env.OUT_SIZE);
    if (!m) throw new Error(`OUT_SIZE is WxH, not ${env.OUT_SIZE}`);
    outWidth = Number(m[1]);
    outHeight = Number(m[2]);
    if (outWidth % 2 || outHeight % 2) throw new Error(`OUT_SIZE must be even: ${outWidth}x${outHeight}`);
    if (outWidth > width || outHeight > height) throw new Error(`OUT_SIZE ${outWidth}x${outHeight} is larger than the render size ${width}x${height}`);
  }
  const shots = (env.SHOTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Not under node_modules: an npm ci (dependencies changed) would clear it. The runner never uploads
  // over it or pulls it.
  const cacheRoot = path.resolve(root, env.CACHE_DIR ?? ".video-cache");
  const fps = num(env.FPS, 60);
  return {
    shots,
    edit: env.EDIT?.trim() || null,
    quality,
    width,
    height,
    outWidth,
    outHeight,
    fps,
    hfovDeg: num(env.HFOV, 90),
    crf: num(env.CRF, q.crf),
    preset: env.PRESET ?? q.preset,
    keepFrames: env.KEEP_FRAMES === "1",
    fresh: env.FRESH === "1",
    reuseStale: env.REUSE_STALE === "1",
    stopAfter: num(env.STOP_AFTER, 0),
    expectGb: num(env.EXPECT_GB, quality === "final" ? 4 : 2),
    minFreeGb: num(env.MIN_FREE_GB, 100),
    imageId: env.NS_IMAGE_ID?.trim() || "unknown",
    cacheRoot,
    outDir: path.resolve(root, "test-results/video", `${width}x${height}-${fps}`),
  };
}

const sizeKey = (o: Pick<VideoOptions, "width" | "height" | "fps">) => `${o.width}x${o.height}-${o.fps}`;

/** Folder of one shot's PNG frames at one size and rate. */
export function framesDir(o: Pick<VideoOptions, "cacheRoot" | "width" | "height" | "fps">, shot: string): string {
  return path.join(o.cacheRoot, "frames", `${shot}-${sizeKey(o)}`);
}

/** Lossless picture of each finished shot (and edit work files) at one size and rate. */
export function mezzDir(o: Pick<VideoOptions, "cacheRoot" | "width" | "height" | "fps">): string {
  return path.join(o.cacheRoot, "mezz", sizeKey(o));
}

/** Sound stems, mixes, filter scripts and decoded loops at one size and rate. */
export function workDir(o: Pick<VideoOptions, "cacheRoot" | "width" | "height" | "fps">): string {
  return path.join(o.cacheRoot, "work", sizeKey(o));
}
