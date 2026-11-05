import { COPY } from "../ui/copy";
import { DEFAULT_SFX, type AudioManifest, type MusicEntry, type SfxEntry } from "./manifest";

/**
 * Synthesised stand-ins so the game makes sound before the real files exist (and for any file that
 * fails to load). Everything is generated in code at load; the sound pack replaces it.
 */

const RATE = 24000;
const BPM = 120;
const LOOP_BARS = 4;
const BAR_SEC = (60 / BPM) * 4;

type Recipe =
  | { k: "tick"; f: number; d: number }
  | { k: "thock"; f: number; d: number }
  | { k: "bonk"; f: number; d: number }
  | { k: "arp"; notes: number[]; d: number; amp?: number }
  | { k: "blip"; f0: number; f1: number; d: number }
  | { k: "whoosh"; up: boolean; d: number; amp?: number }
  | { k: "roll"; d: number }
  | { k: "tone"; f: number; d: number }
  | { k: "hinge"; d: number }
  /** A music-box note: one ringing partial at exactly `f` (no variant detune). */
  | { k: "pluck"; f: number; d: number };

interface Spec {
  v: number;
  sp: SfxEntry["spatial"];
  r: Recipe;
  bus?: "ui";
  pc?: number;
  gr?: number;
  cd?: number;
  mv?: number;
  duck?: number;
  cap?: string;
  lp?: number;
}

const C = COPY.captions;

const S: Record<string, Spec> = {
  ui_hover: { v: 3, sp: "equalpower", bus: "ui", pc: 80, gr: 0.5, cd: 50, r: { k: "tick", f: 3200, d: 0.05 } },
  ui_press: { v: 3, sp: "equalpower", bus: "ui", pc: 60, gr: 0.5, cd: 40, r: { k: "tick", f: 1800, d: 0.09 } },
  ui_back: { v: 2, sp: "equalpower", bus: "ui", pc: 60, gr: 0.5, cd: 40, r: { k: "blip", f0: 1500, f1: 1000, d: 0.14 } },
  drawer_pull: { v: 1, sp: "hrtf", gr: 0.5, cd: 40, r: { k: "whoosh", up: true, d: 0.35 } },
  gentle_error: { v: 1, sp: "equalpower", bus: "ui", gr: 0.5, cd: 200, cap: C.notNow, r: { k: "bonk", f: 180, d: 0.22 } },

  lantern_pick: { v: 3, sp: "hrtf", pc: 100, gr: 1, cd: 30, r: { k: "thock", f: 320, d: 0.1 } },
  lantern_set: { v: 3, sp: "hrtf", pc: 100, gr: 1, cd: 30, r: { k: "thock", f: 150, d: 0.14 } },
  lantern_creak: { v: 2, sp: "hrtf", pc: 120, gr: 1, cd: 120, r: { k: "roll", d: 0.3 } },
  dial_tick: { v: 2, sp: "hrtf", pc: 0, cd: 0, r: { k: "tick", f: 2400, d: 0.04 } },
  fingertip_hum: { v: 1, sp: "hrtf", cd: 30, r: { k: "tone", f: 330, d: 0.9 } },
  lock_hum: { v: 1, sp: "hrtf", cd: 30, r: { k: "tone", f: 196, d: 0.9 } },

  glass_tick: { v: 2, sp: "hrtf", pc: 60, gr: 1, cd: 30, r: { k: "tick", f: 4200, d: 0.06 } },
  brass_clunk: { v: 2, sp: "hrtf", pc: 80, gr: 1, cd: 30, cap: C.lockOpen, r: { k: "thock", f: 110, d: 0.28 } },
  ring_chime: { v: 1, sp: "hrtf", cd: 120, cap: C.ringsLine, r: { k: "arp", notes: [1568, 2093], d: 0.5, amp: 0.5 } },
  thread_shimmer: { v: 1, sp: "hrtf", cd: 60, r: { k: "whoosh", up: true, d: 0.4, amp: 0.3 } },
  crystallise: { v: 1, sp: "hrtf", cap: C.pieceFormed, r: { k: "arp", notes: [1047, 1319, 1568, 2093], d: 0.7 } },

  walls_hinge: { v: 1, sp: "none", duck: 4, cap: C.boxOpens, r: { k: "hinge", d: 0.6 } },
  drawer_slide: { v: 1, sp: "hrtf", r: { k: "whoosh", up: false, d: 0.5 } },
  reward_lift: { v: 1, sp: "none", duck: 4, r: { k: "arp", notes: [523, 659, 784, 1047], d: 0.9 } },
  collection_drop: { v: 2, sp: "hrtf", pc: 60, r: { k: "thock", f: 260, d: 0.2 } },
  daily_streak: { v: 1, sp: "none", duck: 6, cap: C.streak, r: { k: "arp", notes: [392, 523, 659, 784], d: 0.9 } },

  hint_reveal: { v: 1, sp: "none", cap: C.hint, r: { k: "arp", notes: [1568, 2093], d: 0.5, amp: 0.5 } },
  theatre_dim: { v: 1, sp: "none", r: { k: "whoosh", up: false, d: 0.6, amp: 0.3 } },
  theatre_up: { v: 1, sp: "none", r: { k: "whoosh", up: true, d: 0.6, amp: 0.3 } },

  // The music box's samples (G major), at their notes.
  mb_g4: { v: 1, sp: "hrtf", cd: 0, mv: 6, r: { k: "pluck", f: 392.0, d: 1.2 } },
  mb_b4: { v: 1, sp: "hrtf", cd: 0, mv: 6, r: { k: "pluck", f: 493.88, d: 1.2 } },
  mb_d5: { v: 1, sp: "hrtf", cd: 0, mv: 6, r: { k: "pluck", f: 587.33, d: 1.2 } },
  mb_g5: { v: 1, sp: "hrtf", cd: 0, mv: 6, r: { k: "pluck", f: 783.99, d: 1.0 } },
  mb_b5: { v: 1, sp: "hrtf", cd: 0, mv: 6, r: { k: "pluck", f: 987.77, d: 1.0 } },
  mb_d6: { v: 1, sp: "hrtf", cd: 0, mv: 6, r: { k: "pluck", f: 1174.66, d: 1.0 } },
  mb_e6: { v: 1, sp: "hrtf", cd: 0, mv: 6, r: { k: "pluck", f: 1318.51, d: 1.0 } },
  mb_g6: { v: 1, sp: "hrtf", cd: 0, mv: 6, r: { k: "pluck", f: 1567.98, d: 1.0 } },
};

/** The other scale notes from the nearest sample, and the lesson beat (B5), as the pack derives them. */
const DERIVED: AudioManifest["derived"] = {
  mb_a4: { from: "mb_g4", semitones: 2 },
  mb_c5: { from: "mb_b4", semitones: 1 },
  mb_e5: { from: "mb_d5", semitones: 2 },
  mb_fs5: { from: "mb_g5", semitones: -1 },
  mb_a5: { from: "mb_g5", semitones: 2 },
  mb_c6: { from: "mb_b5", semitones: 1 },
  mb_fs6: { from: "mb_g6", semitones: -1 },
  lesson_step: { from: "mb_b5", semitones: 0 },
};

// ----------------------------------------------------------------- synthesis

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function sine(b: Float32Array, start: number, f: number, dur: number, tau: number, amp: number, f1 = f): void {
  const i0 = Math.floor(start * RATE);
  const n = Math.min(b.length - i0, Math.floor(dur * RATE));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const fr = f + ((f1 - f) * i) / Math.max(1, n);
    phase += (2 * Math.PI * fr) / RATE;
    const att = Math.min(1, i / (0.002 * RATE));
    b[i0 + i]! += Math.sin(phase) * Math.exp(-t / tau) * amp * att;
  }
}

function noise(b: Float32Array, r: () => number, start: number, dur: number, tau: number, amp: number, smooth = 0): void {
  const i0 = Math.floor(start * RATE);
  const n = Math.min(b.length - i0, Math.floor(dur * RATE));
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2;
    lp = smooth > 0 ? lp + (x - lp) * (1 - smooth) : x;
    b[i0 + i]! += lp * Math.exp(-(i / RATE) / tau) * amp;
  }
}

function renderSfx(id: string, v: number, rec: Recipe): Float32Array {
  const bump = 2 ** ((v * 0.7) / 12) * (v % 2 ? 1 : 0.97);
  const r = rng(hash(`${id}:${v}`));
  const len = Math.max(Math.ceil((rec.d + 0.08) * RATE), 64);
  const b = new Float32Array(len);
  switch (rec.k) {
    case "tick":
      noise(b, r, 0, 0.006, 0.002, 0.5);
      sine(b, 0, rec.f * bump, rec.d, rec.d / 4, 0.5);
      break;
    case "thock":
      sine(b, 0, rec.f * bump, rec.d, rec.d / 3, 0.9, rec.f * bump * 0.6);
      noise(b, r, 0, 0.03, 0.01, 0.35, 0.6);
      break;
    case "bonk":
      sine(b, 0, rec.f * bump, rec.d, rec.d / 3, 0.8, rec.f * bump * 0.7);
      sine(b, 0.07, rec.f * bump * 0.9, rec.d, rec.d / 3, 0.5, rec.f * bump * 0.6);
      break;
    case "arp": {
      const step = Math.min(0.09, rec.d / (rec.notes.length + 2));
      rec.notes.forEach((f, i) => {
        sine(b, i * step, f * bump, rec.d, rec.d / 3, (rec.amp ?? 0.6) / (1 + i * 0.1));
        sine(b, i * step, f * bump * 2.01, rec.d, rec.d / 6, 0.15);
      });
      break;
    }
    case "blip":
      sine(b, 0, rec.f0 * bump, rec.d / 2, rec.d / 4, 0.6);
      sine(b, rec.d / 2.5, rec.f1 * bump, rec.d, rec.d / 3, 0.6);
      break;
    case "whoosh": {
      const n = len;
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const env = Math.sin(Math.PI * t) ** 2;
        const k = rec.up ? 0.9 - 0.7 * t : 0.2 + 0.7 * t;
        lp += (r() * 2 - lp) * (1 - k);
        b[i]! = lp * env * (rec.amp ?? 0.6);
      }
      break;
    }
    case "roll":
      for (let i = 0; i < 8; i++) {
        noise(b, r, i * 0.035, 0.006, 0.002, 0.35);
        sine(b, i * 0.035, (2200 + i * 120) * bump, 0.02, 0.006, 0.3);
      }
      break;
    case "tone":
      sine(b, 0, rec.f * bump, rec.d, rec.d / 3, 0.6);
      sine(b, 0, rec.f * bump * 2, rec.d, rec.d / 5, 0.2);
      break;
    case "hinge":
      // Four soft knocks falling in pitch: walls swinging open.
      for (let i = 0; i < 4; i++) {
        sine(b, i * 0.12, (260 - i * 30) * bump, 0.12, 0.04, 0.7, 150);
        noise(b, r, i * 0.12, 0.02, 0.006, 0.25, 0.6);
      }
      break;
    case "pluck":
      // In tune, so no variant bump: a comb tooth and a faint octave.
      sine(b, 0, rec.f, rec.d, rec.d / 3, 0.6);
      sine(b, 0, rec.f * 2, rec.d, rec.d / 8, 0.1);
      break;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(b[i]!));
  const norm = peak > 0 ? 0.8 / peak : 1;
  const tail = Math.floor(0.015 * RATE);
  for (let i = 0; i < len; i++) {
    const fade = i > len - tail ? (len - i) / tail : 1;
    b[i] = b[i]! * norm * fade;
  }
  return b;
}

const NOTE = (semi: number, base = 110) => base * 2 ** (semi / 12);

/** One chord per bar, as semitones above A2 (110 Hz): Dm Bb F C. Menus play the bed through a low-pass. */
const CHORDS = {
  dm: [5, 8, 12],
  bb: [1, 5, 8],
  f: [8, 12, 15],
  c: [3, 7, 10],
} as const;

/** A gentle stand-in for the music bed: pad, plucks on half notes, soft bass. */
function renderBed(): Float32Array {
  const n = Math.round(LOOP_BARS * BAR_SEC * RATE);
  const b = new Float32Array(n);
  const prog = [CHORDS.dm, CHORDS.bb, CHORDS.f, CHORDS.c];
  const r = rng(7);
  const beat = 60 / BPM;
  prog.forEach((chord, bar) => {
    const t0 = bar * BAR_SEC;
    // Pad: sines with a window that is zero at the bar edges, so the loop never clicks.
    const i0 = Math.round(t0 * RATE);
    const bn = Math.round(BAR_SEC * RATE);
    for (const semi of chord) {
      const f = NOTE(semi);
      for (let i = 0; i < bn; i++) {
        const w = Math.sin((Math.PI * i) / bn) ** 0.5;
        b[i0 + i]! += Math.sin((2 * Math.PI * f * (i / RATE))) * 0.12 * w;
      }
    }
    // Plucks, four to the bar.
    const plucks = 4;
    const stepT = BAR_SEC / plucks;
    for (let e = 0; e < plucks; e++) {
      const semi = chord[e % chord.length]! + 12;
      sine(b, t0 + e * stepT, NOTE(semi), 0.25, 0.1, 0.14);
    }
    // Bass with the same bar window as the pad, so bars never click.
    const bassF = NOTE(chord[0]! - 12);
    for (let i = 0; i < bn; i++) {
      const w = Math.sin((Math.PI * i) / bn) ** 0.5;
      b[i0 + i]! += Math.sin(2 * Math.PI * bassF * (i / RATE)) * 0.2 * w;
    }
    for (let q = 0; q < 4; q++) noise(b, r, t0 + q * beat + beat / 2, 0.02, 0.006, 0.05);
  });
  return b;
}

/** The solve sting: a rising run, then a chord. */
function renderSting(): Float32Array {
  const dur = 2.2;
  const b = new Float32Array(Math.round(dur * RATE));
  const notes = [587, 740, 880, 1175, 1480];
  notes.forEach((f, i) => sine(b, i * 0.14, f, dur, 0.5, 0.35));
  const chord = [293, 370, 440];
  for (const f of chord) sine(b, notes.length * 0.14, f, dur, 0.7, 0.2);
  const tail = Math.floor(0.2 * RATE);
  for (let i = 0; i < tail; i++) b[b.length - 1 - i]! *= i / tail;
  return b;
}

// ------------------------------------------------------------------ assembly

export interface Placeholders {
  manifest: AudioManifest;
  buffers: Map<string, AudioBuffer>;
}

function toBuffer(ctx: AudioContext, data: Float32Array): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, RATE);
  buf.getChannelData(0).set(data);
  return buf;
}

export function makePlaceholders(ctx: AudioContext): Placeholders {
  const buffers = new Map<string, AudioBuffer>();
  const sfx: Record<string, SfxEntry> = {};
  for (const [id, s] of Object.entries(S)) {
    const files: string[] = [];
    const durations: number[] = [];
    for (let v = 0; v < s.v; v++) {
      const file = `placeholder/${id}_${v}`;
      const data = renderSfx(id, v, s.r);
      buffers.set(file, toBuffer(ctx, data));
      files.push(file);
      durations.push(data.length / RATE);
    }
    sfx[id] = {
      ...DEFAULT_SFX,
      files,
      durations,
      bus: s.bus ?? "sfx",
      spatial: s.sp,
      pitchCents: s.pc ?? (s.r.k === "arp" || s.r.k === "tone" || s.r.k === "pluck" ? 0 : 50),
      gainRandDb: s.gr ?? 0,
      cooldownMs: s.cd ?? 30,
      maxVoices: s.mv ?? 3,
      duckMusicDb: s.duck ?? 0,
      caption: s.cap ?? null,
      lowpassHz: s.lp,
    };
  }

  const music: Record<string, MusicEntry> = {};
  {
    const id = "music_bed";
    const file = `placeholder/${id}`;
    buffers.set(file, toBuffer(ctx, renderBed()));
    music[id] = {
      file,
      role: "loop",
      loop: true,
      bpm: BPM,
      bars: LOOP_BARS,
      loopStartSec: 0,
      loopEndSec: (LOOP_BARS * 4 * 60) / BPM,
      gainDb: 0,
    };
  }
  {
    const id = "sting_solve";
    const data = renderSting();
    const file = `placeholder/${id}`;
    buffers.set(file, toBuffer(ctx, data));
    music[id] = { file, role: "sting", loop: false, durationSec: data.length / RATE, duckMusicDb: 6, gainDb: 0 };
  }

  const manifest: AudioManifest = {
    version: 1,
    sampleRate: RATE,
    buses: { music: 0.5, sfx: 1, ui: 0.8, ambience: 0.3 },
    sfx,
    derived: { ...DERIVED },
    music,
    // The same music fields as the real pack: the bed is calm; menus play it through an 800 Hz
    // low-pass, results a little more open.
    musicStates: { calm: "music_bed", menu: "music_bed", results: "music_bed" },
    musicStateFx: { menu: { lowpassHz: 800, gainDb: -3 }, results: { lowpassHz: 1200, gainDb: -2 } },
    stings: { solve: "sting_solve" },
  };
  return { manifest, buffers };
}
