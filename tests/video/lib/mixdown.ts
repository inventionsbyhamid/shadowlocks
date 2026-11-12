// ffmpeg command lines for a mix plan. Pure: builds arguments and filter graphs, runs nothing.
import path from "node:path";
import { type Duck, duckExpr, type Layer, levelExpr, type MixPlan, type MusicPlan, panMatrix, VOICES } from "./audio";

/** A loop decoded to PCM once, played sample exactly with `aloop` (no decoder gap at the seam). */
export interface PcmLoop {
  file: string;
  /** Loop length and start, in samples at the mix rate (the manifest's lengthSamples, loopStartSec). */
  samples: number;
  startSample: number;
}

export interface MixFiles {
  /** Folder the manifest's file paths are relative to (public/audio). */
  audioDir: string;
  calmLoop?: PcmLoop;
  intenseLoop?: PcmLoop;
  ambienceLoop?: PcmLoop;
  ambienceGain?: number;
  /** Channel count of a layer's file (from ffprobe). */
  channels: (file: string) => number;
}

/** A voice-over over an edit: everything else ducks under it. */
export interface Narration {
  file: string;
  /** Seconds into the mix where it starts. */
  t: number;
  /** Linear gain on the voice. */
  gain: number;
  /** How far the bed (music and effects) goes down while the voice speaks, dB. */
  duckDb: number;
}

export interface MixRequest {
  plan: MixPlan;
  /** Music voices to play (null: no music in this mix). */
  music: MusicPlan | null;
  musicBus: number;
  /** End with the engine's master limiter (full mixes; stems stay unlimited). */
  limiter: boolean;
  out: string;
  sampleRate?: number;
  narration?: Narration;
}

/**
 * Sidechain settings that take the bed about `duckDb` down under a voice at normal speaking level:
 * the voice's peaks sit far above the threshold, so the gain reduction approaches duckDb.
 */
export function duckFilter(duckDb: number): string {
  const ratio = 8;
  // Reduction = (level - threshold) * (1 - 1/ratio); a voice peaks near -12 dBFS.
  const threshDb = -12 - duckDb / (1 - 1 / ratio);
  const lin = Math.max(0.000976563, 10 ** (threshDb / 20));
  return `sidechaincompress=threshold=${lin.toFixed(6)}:ratio=${ratio}:attack=25:release=400:makeup=1:detection=peak`;
}

const f = (x: number) => (Math.abs(x) < 1e-9 ? "0" : Number(x.toFixed(6)).toString());

/** Filters for one placed layer, from its split input to a labelled stereo stream. */
function layerChain(l: Layer, channels: number, sr: number): string {
  const parts: string[] = [`aresample=${sr}`];
  if (l.reverse) parts.push("areverse");
  if (Math.abs(l.rate - 1) > 1e-6) parts.push(`asetrate=${Math.round(sr * l.rate)}`, `aresample=${sr}`);
  if (l.lowpassHz) parts.push(`lowpass=f=${f(l.lowpassHz)}:width_type=q:width=0.707`);
  if (l.fadeIn) parts.push(`afade=t=in:st=0:d=${f(l.fadeIn)}`);
  if (l.fadeOut && l.duration > 0) parts.push(`afade=t=out:st=${f(Math.max(0, l.duration - l.fadeOut))}:d=${f(l.fadeOut)}`);
  const [left, right] = panMatrix(l.azimuth, channels);
  // ffmpeg's pan takes each input channel at most once per output channel.
  const out = (row: [number, number]) => {
    if (channels < 2) return `${f(l.gain * row[0])}*c0`;
    const terms = row.flatMap((k, i) => (Math.abs(k) > 1e-9 ? [`${f(l.gain * k)}*c${i}`] : []));
    return terms.length ? terms.join("+") : "0*c0";
  };
  parts.push(`pan=stereo|c0=${out(left)}|c1=${out(right)}`);
  parts.push(`adelay=delays=${Math.round(l.t * 1000)}:all=1`);
  return parts.join(",");
}

/** The engine's master limiter (DynamicsCompressor: -6 dB threshold, 12:1, 3 ms, 150 ms). */
export const LIMITER = "acompressor=threshold=0.501187:ratio=12:attack=3:release=150:knee=8:makeup=1";

/**
 * ffmpeg arguments and a filter script for a mix. Every layer, the music voices (each calm copy
 * low-passed for its state) and the ducks are summed without normalising, then padded or cut to the
 * plan's length. Returns `{ args, script }`: write `script` to the file named after
 * `-filter_complex_script` in args.
 */
export function mixCommand(r: MixRequest, files: MixFiles, scriptFile: string): { args: string[]; script: string } {
  const sr = r.sampleRate ?? 48000;
  const D = r.plan.duration;
  const inputs: string[][] = [];
  const chains: string[] = [];
  const mixIn: string[] = [];

  const byFile = new Map<string, Layer[]>();
  for (const l of r.plan.layers) {
    if (l.t >= D) continue;
    const list = byFile.get(l.file) ?? [];
    list.push(l);
    byFile.set(l.file, list);
  }
  let n = 0;
  for (const [file, layers] of byFile) {
    const idx = inputs.length;
    inputs.push(["-i", path.isAbsolute(file) ? file : path.join(files.audioDir, file)]);
    const ch = files.channels(file);
    const labels = layers.map(() => `s${n++}`);
    chains.push(labels.length > 1 ? `[${idx}:a]asplit=${labels.length}${labels.map((x) => `[${x}]`).join("")}` : `[${idx}:a]anull[${labels[0]}]`);
    layers.forEach((l, i) => {
      chains.push(`[${labels[i]}]${layerChain(l, ch, sr)}[l${labels[i]}]`);
      mixIn.push(`[l${labels[i]}]`);
    });
  }

  const loop = (l: PcmLoop, offset: number): number => {
    const idx = inputs.length;
    inputs.push(["-i", l.file]);
    chains.push(
      `[${idx}:a]aresample=${sr},aloop=loop=-1:size=${l.samples}:start=${l.startSample},` +
        `atrim=start=${f(offset)}:duration=${f(D)},asetpts=PTS-STARTPTS[loop${idx}]`,
    );
    return idx;
  };

  const m = r.music;
  // A pack with a calm loop only (the music bed: the engine then plays nothing for intense) still has its music.
  if (m && files.calmLoop) {
    const used = VOICES.filter((v) => (m.initial[v] > 0 || m.ramps[v].length > 0) && (v !== "intense" || files.intenseLoop));
    const voiceOut: string[] = [];
    const calm = used.filter((v) => v !== "intense");
    if (calm.length) {
      const idx = loop(files.calmLoop, r.plan.music.offsetSec);
      chains.push(`[loop${idx}]asplit=${calm.length}${calm.map((v) => `[raw_${v}]`).join("")}`);
    }
    if (used.includes("intense") && files.intenseLoop) {
      const idx = loop(files.intenseLoop, r.plan.music.offsetSec);
      chains.push(`[loop${idx}]anull[raw_intense]`);
    }
    for (const v of used) {
      const lp = v === "menu" ? m.cutoff.menu : v === "results" ? m.cutoff.results : 0;
      const filt = lp ? `lowpass=f=${f(lp)}:width_type=q:width=0.707,` : "";
      // Small blocks so the level follows its curve closely.
      chains.push(`[raw_${v}]${filt}asetnsamples=n=240,volume=eval=frame:volume='${levelExpr(m, v)}'[v_${v}]`);
      voiceOut.push(`[v_${v}]`);
    }
    if (voiceOut.length) {
      chains.push(
        `${voiceOut.join("")}amix=inputs=${voiceOut.length}:normalize=0,asetnsamples=n=240,volume=eval=frame:volume='${duckExpr(r.plan.ducks)}',volume=${f(r.musicBus)}[music]`,
      );
      mixIn.push("[music]");
    }
  }
  if (r.plan.ambience && files.ambienceLoop) {
    const idx = loop(files.ambienceLoop, 0);
    chains.push(`[loop${idx}]volume=${f(files.ambienceGain ?? 0.3)}[amb]`);
    mixIn.push("[amb]");
  }
  if (mixIn.length === 0) {
    const idx = inputs.length;
    inputs.push(["-f", "lavfi", "-i", `anullsrc=r=${sr}:cl=stereo`]);
    mixIn.push(`[${idx}:a]`);
  }
  const tail = [`apad=whole_dur=${f(D)}`, `atrim=0:${f(D)}`];
  const fo = r.plan.fadeOutSec ?? 0;
  if (fo > 0) tail.push(`afade=t=out:st=${f(Math.max(0, D - fo))}:d=${f(Math.min(fo, D))}`);
  if (r.limiter) tail.push(LIMITER);
  tail.push(`aformat=sample_rates=${sr}:channel_layouts=stereo`);
  const sum = `amix=inputs=${mixIn.length}:normalize=0:duration=longest`;
  const nar = r.narration;
  if (nar) {
    const idx = inputs.length;
    inputs.push(["-i", nar.file]);
    chains.push(`${mixIn.join("")}${sum},aformat=sample_rates=${sr}:channel_layouts=stereo[bed]`);
    chains.push(
      `[${idx}:a]aresample=${sr},aformat=channel_layouts=stereo,volume=${f(nar.gain)},adelay=delays=${Math.round(nar.t * 1000)}:all=1,` +
        `apad=whole_dur=${f(D)},asplit=2[voice][key]`,
    );
    chains.push(`[bed][key]${duckFilter(nar.duckDb)}[ducked]`);
    chains.push(`[ducked][voice]amix=inputs=2:normalize=0:duration=first,${tail.join(",")}[out]`);
  } else {
    chains.push(`${mixIn.join("")}${sum},${tail.join(",")}[out]`);
  }
  return {
    args: ["-y", "-hide_banner", "-loglevel", "error", ...inputs.flat(), "-filter_complex_script", scriptFile, "-map", "[out]", "-c:a", "pcm_s16le", r.out],
    script: `${chains.join(";\n")}\n`,
  };
}

/** Ducks moved by `dt` seconds (edits). */
export const shiftDucks = (ducks: Duck[], dt: number): Duck[] => ducks.map((d) => ({ t: d.t + dt, depth: d.depth, end: d.end + dt }));

/** PNG frames to the lossless mezzanine: x264 RGB at qp 0 (bit exact), Matroska. */
export function mezzanineArgs(o: { framesPattern: string; fps: number; frames: number; out: string }): string[] {
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(o.fps), "-i", o.framesPattern, "-frames:v", String(o.frames),
    "-c:v", "libx264rgb", "-qp", "0", "-preset", "veryfast", "-pix_fmt", "rgb24", "-r", String(o.fps),
    o.out,
  ];
}

/** RGB to BT.709 limited range 4:2:0 with error diffusion dithering (no banding in soft gradients). */
export const DELIVERY_VF = "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int:sws_dither=ed,format=yuv420p";

export interface DeliveryRequest {
  /** Video filter graph input(s): the mezzanine(s). */
  inputs: string[];
  /** Filter producing [v] from the inputs (null: the first input as is). */
  videoFilter: string | null;
  audio: string;
  fps: number;
  crf: number;
  preset: string;
  out: string;
  /** More inputs after the audio (input options, then "-i", file), as an end card's still. */
  extraInputs?: string[][];
  /** Scale the picture down to this size first (Lanczos, in RGB): frames drawn larger than delivered. */
  scale?: { width: number; height: number };
}

/** A Lanczos scale to `s`, in front of the delivery conversion; nothing when absent. */
export const downscale = (s?: { width: number; height: number }): string => (s ? `scale=${s.width}:${s.height}:flags=lanczos+accurate_rnd+full_chroma_int,` : "");

/** The one lossy encode: H.264 (aq-mode 3), BT.709 tagged, AAC stereo, ready to stream (faststart). */
export function deliveryArgs(d: DeliveryRequest): string[] {
  const graph = `${d.videoFilter ?? "[0:v]null[v]"};[v]${downscale(d.scale)}${DELIVERY_VF}[vo]`;
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    // Two decoder threads per clip: with a thread per core, twenty open 1440p decoders hold gigabytes of frames.
    ...d.inputs.flatMap((f) => ["-threads", "2", "-i", f]), "-i", d.audio, ...(d.extraInputs ?? []).flat(),
    "-filter_complex", graph, "-map", "[vo]", "-map", `${d.inputs.length}:a`,
    "-c:v", "libx264", "-preset", d.preset, "-crf", String(d.crf), "-x264-params", "aq-mode=3", "-r", String(d.fps),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", d.out,
  ];
}

/** Full-size stills (PNG) of frames `at` from a clip, scaled down to `scale` (the delivery size) when given. */
export function stillArgs(input: string, frame: number, out: string, scale?: { width: number; height: number }): string[] {
  const vf = `select='eq(n,${frame})'${scale ? `,${downscale(scale).slice(0, -1)}` : ""}`;
  return ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-vf", vf, "-frames:v", "1", "-update", "1", out];
}

/** A contact sheet: `cols` x `rows` frames spread evenly over the clip, each `width` px wide. */
export function contactSheetArgs(o: { input: string; frames: number; out: string; cols?: number; rows?: number; width?: number }): string[] {
  const cols = o.cols ?? 4;
  const rows = o.rows ?? 3;
  const every = Math.max(1, Math.floor(o.frames / (cols * rows)));
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-i", o.input,
    "-vf", `select='not(mod(n,${every}))',scale=${o.width ?? 480}:-2,tile=${cols}x${rows}:padding=4:margin=4:color=0x1c191d`,
    "-frames:v", "1", "-update", "1", o.out,
  ];
}

export interface EditClip {
  file: string;
  /** Length in frames. */
  frames: number;
}

/**
 * Video of an edit: clips one after another, each pair crossfaded over `fadeFrames` frames (0: a
 * cut). Everything is counted in whole frames, so every clip starts on a frame. Returns the filter
 * ending in [v], where each clip starts (frames and seconds) and the edit's length.
 */
export function editVideoFilter(
  clips: EditClip[],
  fadeFrames: number,
  fps: number,
): { filter: string; startFrames: number[]; starts: number[]; frames: number; duration: number } {
  if (clips.length === 0) throw new Error("an edit needs at least one clip");
  if (!Number.isInteger(fadeFrames) || fadeFrames < 0) throw new Error(`crossfade must be whole frames, not ${fadeFrames}`);
  const shortest = Math.min(...clips.map((c) => c.frames));
  if (clips.length > 1 && fadeFrames >= shortest) throw new Error(`a ${fadeFrames} frame crossfade is not shorter than the shortest clip (${shortest} frames)`);
  const startFrames: number[] = [];
  let t = 0;
  for (const c of clips) {
    startFrames.push(t);
    t += c.frames - fadeFrames;
  }
  const frames = clips.length === 1 ? (clips[0] as EditClip).frames : t + fadeFrames;
  const starts = startFrames.map((n) => n / fps);
  const sec = (n: number) => f(n / fps);
  let filter: string;
  if (clips.length === 1) filter = "[0:v]null[v]";
  else if (fadeFrames === 0) filter = `${clips.map((_, i) => `[${i}:v]`).join("")}concat=n=${clips.length}:v=1:a=0[v]`;
  else {
    // Each clip cut into its head (the fade in), body and tail (the fade out); each tail crossfades with the next
    // head on its own (offset 0), and the bodies and fades are joined in order. A chain of xfades with offsets into
    // the edit would hold every later clip's frames in memory until its offset (gigabytes past a minute of edit).
    const n = clips.length;
    for (let i = 1; i < n - 1; i++) {
      if ((clips[i] as EditClip).frames <= 2 * fadeFrames) throw new Error(`clip ${i} (${(clips[i] as EditClip).frames} frames) is not longer than its two ${fadeFrames} frame crossfades`);
    }
    const parts: string[] = [];
    const order: string[] = [];
    const cut = (from: string, a: number, b: number, to: string) => parts.push(`${from}trim=start_frame=${a}:end_frame=${b},setpts=PTS-STARTPTS${to}`);
    clips.forEach((c, i) => {
      const outs = [...(i > 0 ? [`[h${i}]`] : []), `[b${i}]`, ...(i < n - 1 ? [`[t${i}]`] : [])];
      const src = outs.map((o) => `${o.slice(0, -1)}s]`);
      parts.push(`[${i}:v]split=${outs.length}${src.join("")}`);
      if (i > 0) cut(`[h${i}s]`, 0, fadeFrames, `[h${i}]`);
      cut(`[b${i}s]`, i > 0 ? fadeFrames : 0, i < n - 1 ? c.frames - fadeFrames : c.frames, `[b${i}]`);
      if (i < n - 1) cut(`[t${i}s]`, c.frames - fadeFrames, c.frames, `[t${i}]`);
    });
    for (let i = 0; i < n; i++) {
      order.push(`[b${i}]`);
      if (i < n - 1) {
        parts.push(`[t${i}][h${i + 1}]xfade=transition=fade:duration=${sec(fadeFrames)}:offset=0[x${i}]`);
        order.push(`[x${i}]`);
      }
    }
    parts.push(`${order.join("")}concat=n=${order.length}:v=1:a=0[v]`);
    filter = parts.join(";");
  }
  return { filter, startFrames, starts, frames, duration: frames / fps };
}

/**
 * An end card after an edit's last frame: the frame held for `extraFrames`, a blurred, slightly darker copy of it
 * (input `stillInput`: that last frame as a still, so nothing waits on the whole edit to reach it) fading in over
 * `fadeFrames`, and the card's still (input `cardInput`, a transparent PNG at the edit's size) fading in over it a few
 * frames later. Takes the edit's filter (ending in [v], `frames` long) and returns one that ends in [v],
 * `frames + extraFrames` long. A `blurSigma` of 0 keeps the held frame as it is (sharp, its colours untouched): the card
 * lays its own shade where its words go.
 */
export function endCardFilter(
  filter: string,
  o: { frames: number; fps: number; extraFrames: number; fadeFrames: number; cardInput: number; stillInput: number; blurSigma: number },
): string {
  if (!/\[v\]$/.test(filter)) throw new Error("the edit filter must end in [v]");
  if (!Number.isInteger(o.extraFrames) || o.extraFrames <= o.fadeFrames) throw new Error(`an end card of ${o.extraFrames} frames is not longer than its fade`);
  const t0 = f(o.frames / o.fps);
  const fade = f(o.fadeFrames / o.fps);
  const lag = f((o.frames + Math.round(o.fps * 0.15)) / o.fps);
  if (o.blurSigma <= 0) {
    return (
      `${filter.slice(0, -3)}[vcut];` +
      `[vcut]tpad=stop_mode=clone:stop=${o.extraFrames}[vbg];` +
      `[${o.cardInput}:v]format=yuva444p,fade=t=in:st=0:d=${fade}:alpha=1,setpts=PTS+${lag}/TB[vcard];` +
      `[vbg][vcard]overlay=eof_action=pass:format=auto[v]`
    );
  }
  return (
    `${filter.slice(0, -3)}[vcut];` +
    `[vcut]tpad=stop_mode=clone:stop=${o.extraFrames}[vhold];` +
    `[${o.stillInput}:v]gblur=sigma=${f(o.blurSigma)},eq=brightness=-0.03:saturation=0.85,` +
    `format=yuva444p,fade=t=in:st=0:d=${fade}:alpha=1,setpts=PTS+${t0}/TB[vblur];` +
    `[vhold][vblur]overlay=eof_action=pass:format=auto[vbg];` +
    `[${o.cardInput}:v]format=yuva444p,fade=t=in:st=0:d=${fade}:alpha=1,setpts=PTS+${lag}/TB[vcard];` +
    `[vbg][vcard]overlay=eof_action=pass:format=auto[v]`
  );
}

/**
 * A still layer (input `input`, a transparent PNG at the edit's size: the corner label) laid over the edit only within
 * the given spans (seconds). Takes a filter ending in [v] and returns one ending in [v], the same length.
 */
export function labelFilter(filter: string, o: { input: number; spans: Array<[number, number]> }): string {
  if (!/\[v\]$/.test(filter)) throw new Error("the edit filter must end in [v]");
  if (o.spans.length === 0) return filter;
  const on = o.spans.map(([a, b]) => `between(t,${f(a)},${f(b)})`).join("+");
  return `${filter.slice(0, -3)}[vnl];[${o.input}:v]format=yuva444p[vlab];[vnl][vlab]overlay=x=0:y=0:eof_action=repeat:format=auto:enable='${on}'[v]`;
}

/**
 * Caption layers (inputs `input`, `input + 1`, ...: transparent PNGs as wide as the edit, each looped from t = 0) laid
 * over the edit at `y` (px from the top; default 0), each from `from` to `to` (seconds), its opacity fading in and out over `fade`. Takes a filter ending in
 * [v] and returns one ending in [v], the same length.
 */
export function captionFilter(filter: string, o: { input: number; spans: Array<[number, number]>; fade: number; y?: number }): string {
  if (!/\[v\]$/.test(filter)) throw new Error("the edit filter must end in [v]");
  if (o.spans.length === 0) return filter;
  let out = `${filter.slice(0, -3)}[vc0]`;
  o.spans.forEach(([a, b], i) => {
    if (b - a < 2 * o.fade) throw new Error(`caption ${i} is on for ${(b - a).toFixed(2)} s, less than its fades`);
    const last = i === o.spans.length - 1;
    out +=
      `;[${o.input + i}:v]format=yuva444p,fade=t=in:st=${f(a)}:d=${f(o.fade)}:alpha=1,fade=t=out:st=${f(b - o.fade)}:d=${f(o.fade)}:alpha=1[cap${i}]` +
      `;[vc${i}][cap${i}]overlay=x=0:y=${o.y ?? 0}:eof_action=pass:format=auto${last ? "[v]" : `[vc${i + 1}]`}`;
  });
  return out;
}

/** A crossfade in ms as whole frames at `fps` (nearest). */
export const fadeFramesFor = (ms: number, fps: number): number => Math.round((ms / 1000) * fps);
