// Running ffmpeg and ffprobe (inside the build server's browser image, never on a laptop).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  type Ebur128,
  ebur128Args,
  limiterFilter,
  limitPlan,
  linearFits,
  type LoudnessTarget,
  type LoudnormMeasure,
  measureArgs,
  normalizeFilter,
  parseEbur128,
  parseLoudnorm,
  stayedLinear,
} from "./loudness";

export function ffmpeg(args: string[]): void {
  try {
    execFileSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: Buffer; message: string };
    throw new Error(`ffmpeg failed: ${err.stderr?.toString().trim() || err.message}\n  args: ${args.join(" ")}`);
  }
}

function probe(args: string[]): string {
  return execFileSync("ffprobe", ["-v", "error", ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

const channelCache = new Map<string, number>();

/** Channels of a file's first audio stream. */
export function channelsOf(file: string): number {
  let n = channelCache.get(file);
  if (n === undefined) {
    n = Number(probe(["-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", file])) || 1;
    channelCache.set(file, n);
  }
  return n;
}

export interface MediaFacts {
  frames: number;
  width: number;
  height: number;
  fps: number;
  /** Container duration, seconds. */
  duration: number;
  audio: { channels: number; sampleRate: number; duration: number } | null;
}

/** Counts the video frames by decoding them (slow on long files, exact). `audio: false` skips the audio probe. */
export function mediaFacts(file: string, o: { audio?: boolean } = {}): MediaFacts {
  const v = JSON.parse(
    probe(["-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height,r_frame_rate:format=duration", "-of", "json", file]),
  ) as { streams: Array<{ nb_read_frames: string; width: number; height: number; r_frame_rate: string }>; format: { duration: string } };
  const s = v.streams[0];
  if (!s) throw new Error(`${file}: no video stream`);
  const [num, den] = s.r_frame_rate.split("/").map(Number);
  return {
    frames: Number(s.nb_read_frames),
    width: s.width,
    height: s.height,
    fps: (num ?? 0) / (den || 1),
    duration: Number(v.format.duration),
    audio: o.audio === false ? null : audioFacts(file),
  };
}

/** The first audio stream: channels, rate, seconds and exact length in samples (null when none). */
export function audioFacts(file: string): { channels: number; sampleRate: number; duration: number; samples: number } | null {
  const a = JSON.parse(probe(["-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate,duration,duration_ts,time_base", "-of", "json", file])) as {
    streams: Array<{ channels: number; sample_rate: string; duration?: string; duration_ts?: number; time_base?: string }>;
  };
  const as = a.streams[0];
  if (!as) return null;
  const rate = Number(as.sample_rate);
  const duration = Number(as.duration ?? 0);
  const [tn, td] = (as.time_base ?? "").split("/").map(Number);
  const exact = as.duration_ts !== undefined && tn === 1 && td === rate;
  return { channels: as.channels, sampleRate: rate, duration, samples: exact ? Number(as.duration_ts) : Math.round(duration * rate) };
}

/** Peak and mean level of an audio file (dB), from ffmpeg's volumedetect. */
export function loudness(file: string): { meanDb: number; maxDb: number } {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  const out = `${r.stderr ?? ""}`;
  return { meanDb: Number(/mean_volume: (-?[\d.]+)/.exec(out)?.[1] ?? Number.NaN), maxDb: Number(/max_volume: (-?[\d.]+)/.exec(out)?.[1] ?? Number.NaN) };
}

/** Run ffmpeg and return what it printed on stderr (measurement filters print there). */
export function ffmpegStderr(args: string[]): string {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${(r.stderr ?? "").trim().split("\n").slice(-5).join(" | ")}\n  args: ${args.join(" ")}`);
  return r.stderr ?? "";
}

export function measureEbur128(file: string): Ebur128 {
  return parseEbur128(ffmpegStderr(ebur128Args(file)));
}

export interface NormalizeResult {
  measured: LoudnormMeasure;
  limiterDb: number | null;
  linear: boolean;
  result: Ebur128;
}

/**
 * Two-pass loudness normalisation to `t`: measure; if the plain gain would push the true peak over the
 * ceiling, limit the peaks first (oversampled); measure again, and limit harder while the linear pass
 * would still overshoot; apply loudnorm linearly; verify with ebur128 (and limit harder if the true
 * peak still came out over). Up to five tries. Writes 48 kHz 16-bit PCM.
 */
export function normalizeLoudness(input: string, output: string, t: LoudnessTarget): NormalizeResult {
  const first = parseLoudnorm(ffmpegStderr(measureArgs(input, t)));
  let margin = 0.5;
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= 4;
    const plan = limitPlan(first, t, margin);
    let src = input;
    if (plan.ceilingDb !== null) {
      src = `${output}.limited.wav`;
      ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-af", limiterFilter(plan.ceilingDb), "-c:a", "pcm_f32le", src]);
    }
    const m = plan.ceilingDb === null ? first : parseLoudnorm(ffmpegStderr(measureArgs(src, t)));
    if (!last && !linearFits(m, t)) {
      // The limiter took some loudness too (more gain needed) or left inter-sample peaks: go lower.
      margin += m.TP + (t.I - m.I) - t.TP + 0.1;
      continue;
    }
    const log = ffmpegStderr(["-y", "-hide_banner", "-nostats", "-i", src, "-af", normalizeFilter(m, t), "-c:a", "pcm_s16le", output]);
    if (src !== input) fs.rmSync(src, { force: true });
    const result = measureEbur128(output);
    const linear = stayedLinear(log);
    if ((result.TP <= t.TP + 0.05 && linear) || last) return { measured: m, limiterDb: plan.ceilingDb, linear, result };
    margin += Math.max(0.2, result.TP - t.TP + 0.2);
  }
}
