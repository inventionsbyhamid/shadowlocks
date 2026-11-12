// A shot's sound and delivery encode, and edits cut from rendered shots. Nothing here changes what a
// frame looks like, so it is not part of the frames' version (a change re-mixes or re-cuts only).
import fs from "node:fs";
import path from "node:path";
import type { AudioManifest } from "../../../src/audio/manifest";
import { type Duck, type Layer, type MixPlan, type MusicChange, musicSetup, musicSummary, planMix, planMusic } from "./audio";
import { audioFacts, channelsOf, ffmpeg, measureEbur128, mediaFacts, normalizeLoudness, type NormalizeResult } from "./ffrun";
import { CAPTION_TOP, type EndCard } from "./endcard";
import { type Ebur128, type LoudnessTarget, loudnessProblems } from "./loudness";
import { captionFilter, contactSheetArgs, deliveryArgs, editVideoFilter, endCardFilter, fadeFramesFor, labelFilter, mixCommand, type Narration, type PcmLoop, shiftDucks, stillArgs } from "./mixdown";
import { type VideoOptions, workDir } from "./options";
import { readRecord, type ShotRecord, shotFile, writeRecord } from "./records";
import { shotVersions, type Versions } from "./version";

const ROOT = process.cwd();

/** The delivery scale, when frames are drawn larger than delivered (OUT_SIZE). */
export const outScale = (o: Pick<VideoOptions, "width" | "height" | "outWidth" | "outHeight">): { width: number; height: number } | undefined =>
  o.outWidth !== o.width || o.outHeight !== o.height ? { width: o.outWidth, height: o.outHeight } : undefined;
const AUDIO_DIR = path.resolve(ROOT, "public/audio");
const SAMPLE_RATE = 48000;

/** No sound pack: no effects, no music (the mix is silence of the right length). */
export const SILENT_MANIFEST: AudioManifest = {
  version: 1,
  buses: { music: 1, sfx: 1, ui: 1 },
  sfx: {},
  derived: {},
  music: {},
  musicStates: {},
  stings: {},
};

/** The sound pack's manifest, or SILENT_MANIFEST (with a warning) while the repo has no pack yet. */
export function readManifest(log?: (s: string) => void): AudioManifest {
  const file = path.join(AUDIO_DIR, "manifest.json");
  if (!fs.existsSync(file)) {
    log?.(`warning: no ${path.relative(ROOT, file)}: the sound is silent until the sound pack is in`);
    return SILENT_MANIFEST;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as AudioManifest;
}

/** Loops decoded to PCM once (cached by source), with their exact loop length in samples. */
function pcmLoop(o: VideoOptions, file: string, lengthSamples: number | undefined, loopStartSec = 0): PcmLoop {
  const src = path.join(AUDIO_DIR, file);
  const stamp = `${path.basename(file, path.extname(file))}-${fs.statSync(src).size}-${Math.round(fs.statSync(src).mtimeMs)}`;
  const out = path.join(workDir(o), `loop-${stamp}.wav`);
  if (!fs.existsSync(out)) {
    const trim = lengthSamples ? `,atrim=end_sample=${lengthSamples}` : "";
    ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-af", `aresample=${SAMPLE_RATE}${trim}`, "-c:a", "pcm_f32le", `${out}.tmp.wav`]);
    fs.renameSync(`${out}.tmp.wav`, out);
  }
  const samples = lengthSamples ?? audioFacts(out)?.samples ?? 0;
  if (samples <= 0) throw new Error(`could not measure the loop ${file}`);
  return { file: out, samples, startSample: Math.round(loopStartSec * SAMPLE_RATE) };
}

function mixTo(o: VideoOptions, plan: MixPlan, out: string, withMusic: boolean, limiter: boolean, m: AudioManifest, scriptFile: string, narration?: Narration): void {
  const setup = musicSetup(m);
  const calmKey = m.musicStates.calm;
  const intenseKey = m.musicStates.intense;
  const calm = calmKey ? m.music[calmKey] : undefined;
  const intense = intenseKey ? m.music[intenseKey] : undefined;
  const amb = m.sfx.amb_room;
  const files = {
    audioDir: AUDIO_DIR,
    calmLoop: withMusic && calm ? pcmLoop(o, calm.file, calm.lengthSamples, calm.loopStartSec) : undefined,
    intenseLoop: withMusic && intense ? pcmLoop(o, intense.file, intense.lengthSamples, intense.loopStartSec) : undefined,
    ambienceLoop: withMusic && plan.ambience && amb?.files[0] ? pcmLoop(o, amb.files[0], undefined) : undefined,
    ambienceGain: amb ? 10 ** (amb.gainDb / 20) * (m.buses.ambience ?? 0.3) * m.buses.sfx : 0,
    channels: (file: string) => channelsOf(path.isAbsolute(file) ? file : path.join(AUDIO_DIR, file)),
  };
  const req = {
    plan: withMusic ? plan : { ...plan, ambience: false },
    music: withMusic ? planMusic(plan.music, setup) : null,
    musicBus: m.buses.music,
    limiter,
    out,
    narration,
  };
  const cmd = mixCommand(req, files, scriptFile);
  fs.writeFileSync(scriptFile, cmd.script);
  ffmpeg(cmd.args);
}

/** Sound from the stored events, the delivery encode from the mezzanine, checks, sheet and stills. */
export async function finishShot(base: ShotRecord, o: VideoOptions, v: Versions, mezz: string, log: (s: string) => void): Promise<ShotRecord> {
  const name = base.shot;
  const t0 = Date.now();
  const manifest = readManifest(log);
  const plan = planMix(base.events, manifest, {
    duration: base.duration,
    seed: name,
    initialMusic: base.music.initial,
    musicOffsetSec: base.music.offsetSec,
    ambience: base.ambience,
  });
  const work = workDir(o);
  const fx = path.join(work, `${name}.fx.wav`);
  const mix = path.join(work, `${name}.mix.wav`);
  mixTo(o, plan, fx, false, false, manifest, path.join(work, `${name}.fx.filter`));
  mixTo(o, plan, mix, true, true, manifest, path.join(work, `${name}.mix.filter`));
  const loud = measureEbur128(mix);

  const mp4 = path.join(o.outDir, `${name}.mp4`);
  const encAt = Date.now();
  const scale = outScale(o);
  ffmpeg(deliveryArgs({ inputs: [mezz], videoFilter: null, audio: mix, fps: o.fps, crf: o.crf, preset: o.preset, out: mp4, scale }));
  const encodeMs = Date.now() - encAt;
  const facts = mediaFacts(mp4);
  const problems: string[] = [];
  if (facts.frames !== base.frames) problems.push(`${facts.frames} frames in the MP4, ${base.frames} rendered`);
  if (facts.width !== o.outWidth || facts.height !== o.outHeight) problems.push(`MP4 is ${facts.width}x${facts.height}, not ${o.outWidth}x${o.outHeight}`);
  if (Math.abs(facts.fps - o.fps) > 0.01) problems.push(`MP4 runs at ${facts.fps} fps`);
  if (!facts.audio || facts.audio.channels !== 2) problems.push("no stereo audio track");
  else if (Math.abs(facts.audio.duration - base.duration) > 0.1) problems.push(`audio is ${facts.audio.duration.toFixed(2)} s, picture ${base.duration.toFixed(2)} s`);
  if (problems.length) throw new Error(`${name}: delivery file failed checks: ${problems.join("; ")}`);
  const contact = path.join(o.outDir, `${name}-contact.png`);
  ffmpeg(contactSheetArgs({ input: mp4, frames: base.frames, out: contact }));
  // Full-size stills from the lossless picture (a quarter, half and three quarters in).
  const stills = [0.25, 0.5, 0.75].map((k, i) => {
    const file = path.join(o.outDir, `${name}-still-${i + 1}.png`);
    ffmpeg(stillArgs(mezz, Math.min(base.frames - 1, Math.floor(base.frames * k)), file, scale));
    return path.basename(file);
  });

  const record: ShotRecord = {
    ...base,
    mixVersion: v.mix,
    outWidth: o.outWidth,
    outHeight: o.outHeight,
    quality: o.quality,
    crf: o.crf,
    preset: o.preset,
    mp4: path.basename(mp4),
    contact: path.basename(contact),
    stills,
    fx: path.relative(ROOT, fx),
    music: plan.music,
    ducks: plan.ducks,
    cues: plan.log,
    loudness: loud,
    stats: {
      ...base.stats,
      music: musicSummary(plan),
      mp4Bytes: fs.statSync(mp4).size,
      deliveryMs: { mix: encAt - t0, encode: encodeMs, total: Date.now() - t0 },
    },
  };
  writeRecord(o, record);
  log(`${name}: -> ${path.relative(ROOT, mp4)} (${((record.stats.mp4Bytes as number) / 1e6).toFixed(1)} MB, ${loud.I} LUFS, ${loud.TP} dBTP)`);
  log(`${name}: stats ${JSON.stringify(record.stats)}`);
  return record;
}

export interface Edit {
  /** Shots in order (each must be rendered at the same size, rate and encode settings). */
  shots: string[];
  /** Crossfade between shots, ms (rounded to whole frames; 0: straight cuts). */
  crossfadeMs: number;
  /**
   * Delivery loudness (ebur128, a plain gain after a peak limiter when needed, true peak checked). Default -14 LUFS, -1 dBTP; null keeps
   * the game's own levels.
   */
  loudness?: LoudnessTarget | null;
  /** A voice-over, from a file in the repo folder (for example video-assets/, not committed). */
  narration?: { file: string; startSec?: number; gainDb?: number; duckDb?: number };
  /** A title card after the last shot, over a blurred hold of its last frame (lib/endcard.ts). */
  endCard?: EndCard;
  /** A corner label (lib/endcard.ts cornerLabelHtml) over the named shots, never over the end card. */
  label?: { text: string; shots: string[] };
  /**
   * Captions (lib/endcard.ts captionHtml) in the lower third: each over shot `shot` from `atSec` into it for `sec`
   * seconds (at least 2.5 so it can be read), fading in and out.
   */
  captions?: Caption[];
}

export interface Caption {
  text: string;
  shot: string;
  atSec: number;
  sec: number;
}

/** A caption must stay up this long to be read. */
export const CAPTION_MIN_SEC = 2.5;
const CAPTION_FADE_SEC = 0.25;

/** Where each caption is on in the edit (seconds), from the shots' starts; throws on a caption too short or off its shot. */
export function captionSpans(captions: Caption[], shots: string[], starts: number[], durations: number[]): Array<[number, number]> {
  return captions.map((c) => {
    const i = shots.indexOf(c.shot);
    if (i < 0) throw new Error(`caption "${c.text}": shot ${c.shot} is not in the edit`);
    if (c.sec < CAPTION_MIN_SEC) throw new Error(`caption "${c.text}" is on for ${c.sec} s; at least ${CAPTION_MIN_SEC} s`);
    if (c.atSec < 0 || c.atSec + c.sec > (durations[i] as number) + 1e-6) throw new Error(`caption "${c.text}" runs past shot ${c.shot}`);
    const a = (starts[i] as number) + c.atSec;
    return [a, a + c.sec];
  });
}

/** The music tail under an end card fades out over the card's last this many seconds. */
const END_CARD_MUSIC_FADE_SEC = 2;

export const EDIT_LOUDNESS: LoudnessTarget = { I: -14, TP: -1 };

/**
 * The loudness an edit is brought to: its own target (EDIT_LOUDNESS unless it says), or none (null)
 * when the mix is silence: no sound pack in the repo yet and no voice-over. No gain brings silence to
 * the target, so the edit keeps the silent levels, with a warning, instead of failing.
 */
export function editLoudness(
  edit: Pick<Edit, "loudness" | "narration">,
  m: AudioManifest,
  log: (s: string) => void,
  name = "edit",
): LoudnessTarget | null {
  const target = edit.loudness === undefined ? EDIT_LOUDNESS : edit.loudness;
  if (target && m === SILENT_MANIFEST && !edit.narration) {
    log(`warning: edit ${name}: no sound pack, so no loudness step (silence cannot reach ${target.I} LUFS)`);
    return null;
  }
  return target;
}
/**
 * How far under the true peak ceiling the PCM is aimed at first, for what AAC adds. Sharp transients
 * (clunks and chimes) can come out of AAC 3 dB over the PCM: a delivered MP4 that is still
 * over is cut again with that much more headroom (up to three encodes).
 */
const AAC_HEADROOM_DB = 0.5;
const AAC_TRIES = 3;

export interface EditRecord {
  edit: string;
  shots: Array<{ shot: string; frameVersion: string; mixVersion: string; frames: number; startFrame: number }>;
  fadeFrames: number;
  frames: number;
  duration: number;
  crf: number;
  preset: string;
  /** The normalisation, and the headroom under the ceiling the PCM was aimed at for AAC. */
  loudness: (NormalizeResult & { target: LoudnessTarget; aacHeadroomDb: number }) | null;
  /** The mix as PCM, and the MP4's decoded AAC track (what a viewer hears). */
  measured: Ebur128;
  delivered: Ebur128;
  narration: Edit["narration"] | null;
  /** The end card, where it starts (s) and how many frames it adds. */
  endCard: (EndCard & { startSec: number; frames: number }) | null;
  label: Edit["label"] | null;
  captions: Caption[];
}

/**
 * Cut an edit from rendered shots: pictures from the lossless mezzanines crossfaded in whole frames,
 * each shot's effects stem placed at its start (faded across the crossfade), one continuous music bed
 * under all of it, an optional voice-over the rest ducks under, loudness to the target, and one
 * delivery encode with the shots' own settings.
 */
export function renderEdit(
  name: string,
  edit: Edit,
  o: VideoOptions,
  log: (s: string) => void,
  cardPng?: string,
  labelPng?: string,
  captionPngs: string[] = [],
): string {
  const records = edit.shots.map((s) => {
    const r = readRecord(o, s);
    if (!r || !r.mp4) throw new Error(`edit ${name}: shot ${s} is not rendered at ${o.width}x${o.height}`);
    if (!fs.existsSync(path.resolve(ROOT, r.mezz))) throw new Error(`edit ${name}: the mezzanine of ${s} is gone; render the shot again`);
    const now = shotVersions(ROOT, shotFile(s), { ...o, width: r.width, height: r.height, fps: r.fps, hfovDeg: r.hfovDeg });
    const stale = now.frames !== r.frameVersion || now.mix !== r.mixVersion || r.imageId !== o.imageId;
    log(`edit ${name}: ${s} frames ${r.frameVersion} sound ${r.mixVersion}${stale ? ` (stale: now ${now.frames} / ${now.mix})` : ""}`);
    if (stale && !o.reuseStale) throw new Error(`edit ${name}: shot ${s} is stale; render it again first, or set REUSE_STALE=1`);
    return r;
  });
  const first = records[0] as ShotRecord;
  for (const r of records) {
    if (r.width !== first.width || r.height !== first.height || r.fps !== first.fps || r.crf !== first.crf || r.preset !== first.preset) {
      throw new Error(
        `edit ${name}: ${r.shot} is ${r.width}x${r.height}@${r.fps} crf ${r.crf} ${r.preset}, ${first.shot} is ${first.width}x${first.height}@${first.fps} crf ${first.crf} ${first.preset}`,
      );
    }
  }
  const fps = first.fps;
  const fadeFrames = fadeFramesFor(edit.crossfadeMs, fps);
  const cut = editVideoFilter(records.map((r) => ({ file: path.resolve(ROOT, r.mezz), frames: r.frames })), fadeFrames, fps);
  // The end card: the last frame held, blurred in, the card's still over it.
  const card = edit.endCard;
  if (card && !cardPng) throw new Error(`edit ${name}: its end card was not drawn`);
  const cardFade = card ? fadeFramesFor(card.fadeMs ?? 600, fps) : 0;
  const cardFrames = card ? cardFade + Math.round(card.holdSec * fps) : 0;
  const v = {
    ...cut,
    filter: card
      ? endCardFilter(cut.filter, {
          frames: cut.frames,
          fps,
          extraFrames: cardFrames,
          fadeFrames: cardFade,
          cardInput: records.length + 1,
          stillInput: records.length + 2,
          blurSigma: ((card.blurSigma ?? 14) * first.width) / 960,
        })
      : cut.filter,
    frames: cut.frames + cardFrames,
    duration: (cut.frames + cardFrames) / fps,
  };
  const cardInputs: string[][] = [];
  if (card && cardPng) {
    // The held frame as a still: the edit's last frame, from the last shot's lossless picture.
    const last = records[records.length - 1] as ShotRecord;
    const still = path.join(workDir(o), `edit-${name}-last.png`);
    ffmpeg(stillArgs(path.resolve(ROOT, last.mezz), last.frames - 1, still));
    const hold = ["-loop", "1", "-framerate", String(fps), "-t", String(cardFrames / fps + 0.5)];
    cardInputs.push([...hold, "-i", cardPng], [...hold, "-i", still]);
  }
  // The corner label over its shots (crossfades between two labelled shots keep it up), after the card is laid.
  const label = edit.label;
  if (label && !labelPng) throw new Error(`edit ${name}: its corner label was not drawn`);
  if (label) {
    const unknown = label.shots.filter((s) => !edit.shots.includes(s));
    if (unknown.length) throw new Error(`edit ${name}: the label names shots not in the edit: ${unknown.join(", ")}`);
    const spans: Array<[number, number]> = [];
    edit.shots.forEach((s, i) => {
      if (label.shots.includes(s)) spans.push([v.starts[i] as number, (v.starts[i] as number) + (records[i] as ShotRecord).frames / fps]);
    });
    v.filter = labelFilter(v.filter, { input: records.length + 1 + cardInputs.length, spans });
    cardInputs.push(["-loop", "1", "-framerate", String(fps), "-t", String(v.duration + 0.5), "-i", labelPng as string]);
  }
  const caps = edit.captions ?? [];
  if (caps.length) {
    if (captionPngs.length !== caps.length) throw new Error(`edit ${name}: its captions were not drawn`);
    const spans = captionSpans(caps, edit.shots, v.starts, records.map((r) => r.duration));
    const y = Math.round(CAPTION_TOP * first.height);
    v.filter = captionFilter(v.filter, { input: records.length + 1 + cardInputs.length, spans, fade: CAPTION_FADE_SEC, y });
    spans.forEach(([, b], i) => cardInputs.push(["-loop", "1", "-framerate", String(fps), "-t", String(b + 0.5), "-i", captionPngs[i] as string]));
  }
  const fade = fadeFrames / fps;
  const m = readManifest(log);

  // One mix plan for the whole edit: stems as layers, music changes and ducks moved to edit time.
  const layers: Layer[] = records.map((r, i) => ({
    t: v.starts[i] as number,
    file: path.resolve(ROOT, r.fx),
    id: r.shot,
    gain: 1,
    azimuth: null,
    rate: 1,
    reverse: false,
    duration: r.duration,
    ...(fade > 0 && i > 0 ? { fadeIn: fade } : {}),
    ...(fade > 0 && i < records.length - 1 ? { fadeOut: fade } : {}),
  }));
  const changes: MusicChange[] = [];
  let ducks: Duck[] = [];
  records.forEach((r, i) => {
    const at = v.starts[i] as number;
    if (i > 0) changes.push({ t: at, state: r.music.initial });
    for (const c of r.music.changes) changes.push({ t: c.t + at, state: c.state });
    ducks = ducks.concat(shiftDucks(r.ducks, at));
  });
  const plan: MixPlan = {
    duration: v.duration,
    layers,
    music: { initial: first.music.initial, offsetSec: first.music.offsetSec, changes },
    ducks: ducks.sort((a, b) => a.t - b.t),
    ambience: false,
    ...(card ? { fadeOutSec: Math.min(END_CARD_MUSIC_FADE_SEC, cardFrames / fps) } : {}),
    log: [],
  };
  const work = workDir(o);
  const n = edit.narration;
  const narration: Narration | undefined = n
    ? { file: path.resolve(ROOT, n.file), t: n.startSec ?? 0, gain: 10 ** ((n.gainDb ?? 0) / 20), duckDb: n.duckDb ?? 8 }
    : undefined;
  if (narration && !fs.existsSync(narration.file)) throw new Error(`edit ${name}: no narration file ${n?.file}`);
  const wav = path.join(work, `edit-${name}.wav`);
  mixTo(o, plan, wav, true, true, m, path.join(work, `edit-${name}.filter`), narration);
  const target = editLoudness(edit, m, log, name);
  const out = path.join(o.outDir, `${name}.mp4`);
  // Encoded under a temporary name: the edit's MP4 only appears once every check passed.
  const tmp = path.join(work, `edit-${name}.tmp.mp4`);
  let audio = wav;
  let loud: EditRecord["loudness"] = null;
  let measured: Ebur128;
  let delivered: Ebur128;
  let headroom = AAC_HEADROOM_DB;
  for (let attempt = 1; ; attempt++) {
    if (target) {
      audio = path.join(work, `edit-${name}.loud.wav`);
      // AAC can lift the true peak: aim the PCM under the ceiling by the headroom.
      const r = normalizeLoudness(wav, audio, { ...target, TP: target.TP - headroom });
      loud = { ...r, target, aacHeadroomDb: headroom };
      const miss = loudnessProblems(r.result, target);
      if (miss.length) throw new Error(`edit ${name}: the mix missed its loudness target after every try: ${miss.join("; ")}`);
    }
    measured = measureEbur128(audio);
    ffmpeg(
      deliveryArgs({
        inputs: records.map((r) => path.resolve(ROOT, r.mezz)),
        videoFilter: v.filter,
        audio,
        fps,
        crf: first.crf,
        preset: first.preset,
        out: tmp,
        extraInputs: cardInputs,
        scale: outScale(o),
      }),
    );
    const facts = mediaFacts(tmp);
    if (Math.abs(facts.frames - v.frames) > 0) throw new Error(`edit ${name}: ${facts.frames} frames, expected ${v.frames}`);
    // What a viewer hears: the AAC track of the MP4, decoded and measured.
    delivered = measureEbur128(tmp);
    if (!target) break;
    const miss = loudnessProblems(delivered, target);
    if (!miss.length) break;
    if (attempt >= AAC_TRIES) throw new Error(`edit ${name}: the delivered MP4 missed its loudness target: ${miss.join("; ")}`);
    const over = delivered.TP - target.TP;
    log(`edit ${name}: AAC came out ${(delivered.TP - measured.TP).toFixed(1)} dB over the PCM's true peak; cutting again with ${(headroom + Math.max(0.3, over + 0.3)).toFixed(1)} dB headroom`);
    headroom += Math.max(0.3, over + 0.3);
  }
  fs.renameSync(tmp, out);
  ffmpeg(contactSheetArgs({ input: out, frames: v.frames, out: path.join(o.outDir, `${name}-contact.png`), cols: 6, rows: 4, width: 320 }));
  const rec: EditRecord = {
    edit: name,
    shots: records.map((r, i) => ({ shot: r.shot, frameVersion: r.frameVersion, mixVersion: r.mixVersion, frames: r.frames, startFrame: v.startFrames[i] as number })),
    fadeFrames,
    frames: v.frames,
    duration: v.duration,
    crf: first.crf,
    preset: first.preset,
    loudness: loud,
    measured,
    delivered,
    narration: edit.narration ?? null,
    endCard: card ? { ...card, startSec: cut.duration, frames: cardFrames } : null,
    label: label ?? null,
    captions: caps,
  };
  fs.writeFileSync(path.join(o.outDir, `${name}.json`), JSON.stringify(rec, null, 2));
  log(
    `edit ${name}: ${records.length} shots, ${fadeFrames} frame crossfades, ${v.duration.toFixed(2)} s, ${v.frames} frames, ` +
      `MP4 ${delivered.I} LUFS, LRA ${delivered.LRA} LU, true peak ${delivered.TP} dBTP (PCM ${measured.I} LUFS, ${measured.TP} dBTP) -> ${path.relative(ROOT, out)}`,
  );
  return out;
}

