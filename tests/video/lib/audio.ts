// A shot's sound, rendered offline. The frame-stepped run records every bus event with its frame
// time; here the game's own CueMapper turns them into cues, the audio manifest into placed sounds
// (the same trims, bus levels, variant rotation, pitch and level spread, cooldowns, panning and
// distance as the engine), and ffmpeg mixes them from public/audio/. Pure: no files, no processes.
import type { Cue, CueEvent } from "../../../src/audio/cues";
import { CueMapper } from "../../../src/audio/cues";
import type { AudioManifest, MusicState, SfxEntry } from "../../../src/audio/manifest";
import type { Vec3 } from "../../../src/core/types";
import type { Quat, V3 } from "./camera";

/** Bus events of one frame, with the head pose and the buttons on screen in that frame. */
export interface FrameEvents {
  /** Seconds from the shot's first frame. */
  t: number;
  events: CueEvent[];
  head: { p: V3; q: Quat };
  /** Buttons on screen (an event naming one by `id` is heard there, as in the game's sound). */
  buttons: Array<{ id: string; world: V3 }> | null;
}

/** One sound placed in time. */
export interface Layer {
  t: number;
  /** File under the audio folder (public/audio), or an absolute path (stems). */
  file: string;
  id: string;
  /** Linear: trim, level spread, bus, distance. */
  gain: number;
  /** Degrees, 0 ahead, +90 right; null when head-locked (not spatial). */
  azimuth: number | null;
  rate: number;
  reverse: boolean;
  lowpassHz?: number;
  /** Fade in and out (seconds) at the layer's own start and end (edit stems). */
  fadeIn?: number;
  fadeOut?: number;
  /** Seconds the layer plays for (file length over rate). */
  duration: number;
}

export interface Duck {
  t: number;
  /** Linear level music goes down to. */
  depth: number;
  /** When the release starts. */
  end: number;
}

export interface MusicChange {
  t: number;
  state: MusicState;
}

export interface MixPlan {
  duration: number;
  layers: Layer[];
  /** Music state already playing at the first frame, and how far into the loop it is. */
  music: { initial: MusicState; offsetSec: number; changes: MusicChange[] };
  ducks: Duck[];
  ambience: boolean;
  /** Fade the whole mix out over its last this many seconds (an edit's end card). */
  fadeOutSec?: number;
  /** What happened, for the shot's cue log. */
  log: Array<{ t: number; cue: string; note?: string }>;
}

const db = (x: number) => 10 ** (x / 20);
const DUCK_ATTACK = 0.05;
export const DUCK_RELEASE = 0.3;
const STING_DUCK_DB = 6;
/** The effect the engine plays for the `streak` sting (AudioEngine.sting). */
const STREAK_SFX = "daily_streak";
/** PannerNode settings of the engine's voices. */
const REF_DISTANCE = 0.3;
const ROLLOFF = 1;

/** Small seeded PRNG (mulberry32), so the same shot always mixes the same. */
export function seeded(seedText: string): () => number {
  let s = 0x9e3779b9;
  for (let i = 0; i < seedText.length; i++) s = Math.imul(s ^ seedText.charCodeAt(i), 0x85ebca6b) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rotate `v` by the inverse of unit quaternion `q`: world to head frame (x right, y up, -z ahead). */
function toHead(v: V3, q: Quat): V3 {
  const [x, y, z, w] = q;
  // q^-1 = (-x, -y, -z, w)
  const ix = -x;
  const iy = -y;
  const iz = -z;
  const tx = 2 * (iy * v[2] - iz * v[1]);
  const ty = 2 * (iz * v[0] - ix * v[2]);
  const tz = 2 * (ix * v[1] - iy * v[0]);
  return [v[0] + w * tx + (iy * tz - iz * ty), v[1] + w * ty + (iz * tx - ix * tz), v[2] + w * tz + (ix * ty - iy * tx)];
}

/** Azimuth (degrees, +90 right) and distance of `p` from the head. */
export function placeFromHead(p: V3, head: { p: V3; q: Quat }): { azimuth: number; distance: number } {
  const local = toHead([p[0] - head.p[0], p[1] - head.p[1], p[2] - head.p[2]], head.q);
  return {
    azimuth: (Math.atan2(local[0], -local[2]) * 180) / Math.PI,
    distance: Math.hypot(local[0], local[1], local[2]),
  };
}

/** The engine's inverse distance model (refDistance 0.3, rolloff 1). */
export function distanceGain(d: number): number {
  const dist = Math.max(d, REF_DISTANCE);
  return REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (dist - REF_DISTANCE));
}

/**
 * Web Audio's equal-power panning as a 2 x 2 matrix: output [L, R] from input [c0, c1] (a mono
 * input feeds both columns from c0). `azimuth` null: head-locked, mono to both sides at full level.
 */
export function panMatrix(azimuth: number | null, channels: number): [[number, number], [number, number]] {
  if (azimuth === null) return channels >= 2 ? [[1, 0], [0, 1]] : [[1, 0], [1, 0]];
  let a = Math.max(-180, Math.min(180, azimuth));
  if (a > 90) a = 180 - a;
  else if (a < -90) a = -180 - a;
  if (channels < 2) {
    const x = (a + 90) / 180;
    return [[Math.cos((x * Math.PI) / 2), 0], [Math.sin((x * Math.PI) / 2), 0]];
  }
  if (a <= 0) {
    const x = (a + 90) / 90;
    const gl = Math.cos((x * Math.PI) / 2);
    const gr = Math.sin((x * Math.PI) / 2);
    return [[1, gl], [0, gr]];
  }
  const x = a / 90;
  const gl = Math.cos((x * Math.PI) / 2);
  const gr = Math.sin((x * Math.PI) / 2);
  return [[gl, 0], [gr, 1]];
}

interface Resolved {
  entry: SfxEntry;
  files: string[];
  durations: number[];
  detuneCents: number;
  reverse: boolean;
  lowpassHz?: number;
  with?: string;
}

function resolveSfx(m: AudioManifest, id: string): Resolved | null {
  const own = m.sfx[id];
  if (own) {
    return {
      entry: own,
      files: own.files,
      durations: own.durations ?? [],
      detuneCents: own.detuneCents,
      reverse: false,
      lowpassHz: own.lowpassHz,
    };
  }
  const d = m.derived[id];
  const base = d ? m.sfx[d.from] : undefined;
  if (!d || !base) return null;
  const pick = d.variant !== undefined && base.files[d.variant] !== undefined;
  return {
    entry: base,
    files: pick ? [base.files[d.variant as number] as string] : base.files,
    durations: pick ? [base.durations?.[d.variant as number] ?? 0] : (base.durations ?? []),
    detuneCents: base.detuneCents + (d.semitones ?? 0) * 100,
    reverse: !!d.reverse,
    lowpassHz: base.lowpassHz,
    with: d.with,
  };
}

function busGain(m: AudioManifest, bus: SfxEntry["bus"]): number {
  const sfx = m.buses.sfx;
  if (bus === "ui") return m.buses.ui * sfx;
  if (bus === "ambience") return (m.buses.ambience ?? 0.3) * sfx;
  return sfx;
}

/**
 * Where an event happened when it carries no `at`: the button it names (`id`) on screen in that
 * frame, as the game's own sound locates it (src/app/sound.ts).
 */
function locate(frame: FrameEvents, e: CueEvent): Vec3 | undefined {
  const id = (e as { id?: unknown }).id;
  if (typeof id !== "string") return undefined;
  const b = frame.buttons?.find((x) => x.id === id);
  return b ? [b.world[0], b.world[1], b.world[2]] : undefined;
}

export interface PlanOptions {
  duration: number;
  /** Seeds the pitch and level spread. */
  seed: string;
  initialMusic: MusicState;
  musicOffsetSec?: number;
  ambience?: boolean;
}

/** Turn a shot's recorded events into placed sounds, music changes and ducks. */
export function planMix(frames: FrameEvents[], m: AudioManifest, o: PlanOptions): MixPlan {
  const random = seeded(o.seed);
  const plan: MixPlan = {
    duration: o.duration,
    layers: [],
    music: { initial: o.initialMusic, offsetSec: o.musicOffsetSec ?? 0, changes: [] },
    ducks: [],
    ambience: !!o.ambience,
    log: [],
  };
  let current: FrameEvents = { t: 0, events: [], head: { p: [0, 0, 0], q: [0, 0, 0, 1] }, buttons: null };
  const mapper = new CueMapper({ locate: (e) => locate(current, e) });
  const next = new Map<string, number>();
  const lastAt = new Map<string, number>();

  const duck = (t: number, dbDown: number, hold: number) => {
    const depth = db(-dbDown);
    const end = t + DUCK_ATTACK + hold;
    const last = plan.ducks[plan.ducks.length - 1];
    if (last && t < last.end) {
      last.depth = Math.min(last.depth, depth);
      last.end = Math.max(last.end, end);
    } else {
      plan.ducks.push({ t, depth, end });
    }
  };

  const playSfx = (t: number, id: string, c: { position?: readonly number[]; pitch?: number; gain?: number; variant?: number }) => {
    const r = resolveSfx(m, id);
    if (!r || r.files.length === 0) {
      plan.log.push({ t, cue: id, note: "no such sound in the manifest" });
      return;
    }
    const e = r.entry;
    const prev = lastAt.get(id);
    if (prev !== undefined && (t - prev) * 1000 < e.cooldownMs) {
      plan.log.push({ t, cue: id, note: "cooldown" });
      return;
    }
    lastAt.set(id, t);
    let idx: number;
    if (c.variant !== undefined) idx = c.variant % r.files.length;
    else {
      idx = (next.get(id) ?? 0) % r.files.length;
      next.set(id, (idx + 1) % r.files.length);
    }
    // Same order of draws as the engine: pitch, then level.
    const cents = r.detuneCents + (random() * 2 - 1) * e.pitchCents + (c.pitch ?? 0) * 100;
    const rate = 2 ** (cents / 1200);
    let gain = db(e.gainDb + (random() * 2 - 1) * e.gainRandDb) * (c.gain ?? 1) * busGain(m, e.bus);
    let azimuth: number | null = null;
    if (c.position && e.spatial !== "none") {
      const place = placeFromHead([c.position[0] ?? 0, c.position[1] ?? 0, c.position[2] ?? 0], current.head);
      azimuth = place.azimuth;
      gain *= distanceGain(place.distance);
    }
    const length = (r.durations[idx] ?? 0) / rate;
    plan.layers.push({
      t,
      file: r.files[idx] as string,
      id,
      gain,
      azimuth,
      rate,
      reverse: r.reverse,
      ...(r.lowpassHz ? { lowpassHz: r.lowpassHz } : {}),
      duration: length,
    });
    plan.log.push({ t, cue: id, note: azimuth === null ? undefined : `azimuth ${azimuth.toFixed(0)}` });
    if (e.duckMusicDb > 0) duck(t, e.duckMusicDb, length);
    if (r.with) playSfx(t, r.with, c.position ? { position: c.position } : {});
  };

  const apply = (t: number, cue: Cue) => {
    if (cue.kind === "sfx") playSfx(t, cue.id, cue);
    else if (cue.kind === "music") {
      plan.music.changes.push({ t, state: cue.state });
      plan.log.push({ t, cue: `music ${cue.state}` });
    } else if (cue.id === "streak") playSfx(t, STREAK_SFX, {});
    else {
      const key = m.stings[cue.id];
      const entry = key ? m.music[key] : undefined;
      if (!entry) {
        plan.log.push({ t, cue: `sting ${cue.id}`, note: "no such sting in the manifest" });
        return;
      }
      const length = entry.durationSec ?? 0;
      plan.layers.push({ t, file: entry.file, id: `sting_${cue.id}`, gain: db(entry.gainDb ?? 0) * m.buses.music, azimuth: null, rate: 1, reverse: false, duration: length });
      plan.log.push({ t, cue: `sting ${cue.id}` });
      duck(t, entry.duckMusicDb || STING_DUCK_DB, length);
    }
  };

  for (const f of frames) {
    current = f;
    if (f.events.length === 0) continue;
    // Layered sounds (a lock opening, the box's tune) land their delay after the event.
    for (const cue of mapper.map(f.events)) apply(f.t + (cue.kind === "sfx" && cue.delayMs ? cue.delayMs / 1000 : 0), cue);
  }
  return plan;
}

// ------------------------------------------------------------------------------------- music

export type Voice = "calm" | "menu" | "results" | "intense";
export const VOICES: Voice[] = ["calm", "menu", "results", "intense"];
export type Shape = "equal-power" | "smooth";

export interface Ramp {
  at: number;
  from: number;
  to: number;
  shape: Shape;
}

export interface MusicPlan {
  /** Seconds the fades take (the engine's FADE_SECONDS). */
  fade: number;
  initial: Record<Voice, number>;
  ramps: Record<Voice, Ramp[]>;
  /** Low-pass of the menu and results voices (the calm loop, filtered). */
  cutoff: { menu: number; results: number };
}

export interface MusicSetup {
  calmGain: number;
  intenseGain: number;
  fx: { menu: { lowpassHz: number; gain: number }; results: { lowpassHz: number; gain: number } };
  bpm: number;
}

export function musicSetup(m: AudioManifest): MusicSetup {
  const calm = m.musicStates.calm ? m.music[m.musicStates.calm] : undefined;
  const intenseKey = m.musicStates.intense;
  const intense = intenseKey ? m.music[intenseKey] : undefined;
  const fx = (s: "menu" | "results", hz: number, gainDb: number) => {
    const f = m.musicStateFx?.[s];
    return { lowpassHz: f?.lowpassHz ?? hz, gain: db(f?.gainDb ?? gainDb) };
  };
  return {
    calmGain: db(calm?.gainDb ?? 0),
    intenseGain: db(intense?.gainDb ?? 0),
    fx: { menu: fx("menu", 1200, -3), results: fx("results", 900, -5) },
    bpm: calm?.bpm ?? intense?.bpm ?? 120,
  };
}

/**
 * The engine plays one calm voice (its low-pass and level move for menu and results) and one
 * intense voice. Offline, the calm loop runs three times in parallel (open, menu filter, results
 * filter) and a cutoff sweep becomes a smooth crossfade between them; intense comes and goes with an
 * equal-power fade, as in the engine. Changes land on the next bar line, as in MusicDirector.
 */
export function planMusic(music: MixPlan["music"], s: MusicSetup): MusicPlan {
  const FADE = 1.5;
  const LEAD = 0.05;
  const bar = (60 / s.bpm) * 4;
  const mixOf = (state: MusicState): Record<Voice, number> => ({
    calm: state === "calm" ? s.calmGain : 0,
    menu: state === "menu" ? s.calmGain * s.fx.menu.gain : 0,
    results: state === "results" ? s.calmGain * s.fx.results.gain : 0,
    intense: state === "intense" ? s.intenseGain : 0,
  });
  const plan: MusicPlan = {
    fade: FADE,
    initial: mixOf(music.initial),
    ramps: { calm: [], menu: [], results: [], intense: [] },
    cutoff: { menu: s.fx.menu.lowpassHz, results: s.fx.results.lowpassHz },
  };
  let state = music.initial;
  let target = mixOf(state);
  // Bar lines: the loop started `offsetSec` before the first frame (or starts with the first change).
  let epoch: number | null = state === "off" ? null : -music.offsetSec;
  for (const c of [...music.changes].sort((a, b) => a.t - b.t)) {
    if (c.state === state) continue;
    state = c.state;
    const want = mixOf(state);
    let at: number;
    if (state === "off") at = c.t;
    else if (epoch === null || VOICES.every((v) => target[v] === 0)) {
      // Nothing heard: the music (re)starts now.
      at = c.t + LEAD;
      epoch ??= at;
    } else {
      const k = Math.ceil((c.t + LEAD - epoch) / bar - 1e-9);
      at = epoch + Math.max(0, k) * bar;
    }
    const intenseMoves = target.intense !== want.intense;
    const shape: Shape = intenseMoves ? "equal-power" : "smooth";
    for (const v of VOICES) {
      const ramps = plan.ramps[v];
      // A fade queued for the same bar line that has not started yet is replaced.
      while (ramps.length && (ramps[ramps.length - 1] as Ramp).at >= at) ramps.pop();
      const from = voiceLevel(plan, v, at);
      if (Math.abs(from - want[v]) > 1e-6) ramps.push({ at, from, to: want[v], shape });
    }
    target = want;
  }
  return plan;
}

function shapeAt(shape: Shape, rising: boolean, x: number): number {
  const k = x <= 0 ? 0 : x >= 1 ? 1 : x;
  if (shape === "smooth") return (1 - Math.cos(k * Math.PI)) / 2;
  return rising ? Math.sin((k * Math.PI) / 2) : 1 - Math.cos((k * Math.PI) / 2);
}

/** A voice's level at time `t` (seconds). */
export function voiceLevel(plan: MusicPlan, v: Voice, t: number): number {
  let level = plan.initial[v];
  for (const r of plan.ramps[v]) {
    if (t <= r.at) break;
    level = r.from + (r.to - r.from) * shapeAt(r.shape, r.to > r.from, (t - r.at) / plan.fade);
  }
  return level;
}

const num = (x: number) => (Math.abs(x) < 1e-9 ? "0" : x.toFixed(6));

/** ffmpeg `volume` expression (in `t`) for a voice's level: a sum of one-shot ramps. */
export function levelExpr(plan: MusicPlan, v: Voice): string {
  let expr = num(plan.initial[v]);
  for (const r of plan.ramps[v]) {
    const x = `clip((t-${num(r.at)})/${num(plan.fade)},0,1)`;
    const d = r.to - r.from;
    const g =
      r.shape === "smooth" ? `(1-cos(PI*${x}))/2` : r.to > r.from ? `sin(PI/2*${x})` : `(1-cos(PI/2*${x}))`;
    expr += `+(${num(d)})*${g}`;
  }
  return expr;
}

/** ffmpeg `volume` expression for the music ducks (1 when none). */
export function duckExpr(ducks: Duck[]): string {
  if (ducks.length === 0) return "1";
  return ducks
    .map(
      (d) =>
        `(1-(${num(1 - d.depth)})*clip((t-${num(d.t)})/${DUCK_ATTACK},0,1)*(1-clip((t-${num(d.end)})/${DUCK_RELEASE},0,1)))`,
    )
    .join("*");
}

/** Music playing at the start of the plan and changes after it, for logs. */
export function musicSummary(p: MixPlan): string {
  return [p.music.initial, ...p.music.changes.map((c) => `${c.state}@${c.t.toFixed(2)}`)].join(" -> ");
}
