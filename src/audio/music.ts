import type { MusicState } from "./manifest";

export interface MusicTrack {
  buffer: AudioBuffer;
  bpm: number;
  loopStart: number;
  loopEnd: number;
  /** Per-track trim, linear. */
  gain: number;
}

export type MusicTracks = Partial<Record<"calm" | "intense", MusicTrack>>;

/** How a menu-like state colours the calm loop: low-pass cutoff and a level multiplier (linear). */
export interface StateFx {
  lowpassHz: number;
  gain: number;
}

export type MusicFx = Partial<Record<"menu" | "results", StateFx>>;

export const FADE_SECONDS = 1.5;
/** The calm voice's cutoff while playing calm: well above anything audible, so effectively no filter. */
export const OPEN_LOWPASS_HZ = 20000;
/** Web Audio reads a low-pass Q in dB; -3 dB is the flat Butterworth response (no peak at the cutoff). */
export const LOWPASS_Q_DB = -3;
/** Only for a manifest without musicStateFx (the values the writer uses); the manifest always wins. */
export const FALLBACK_FX: Record<"menu" | "results", StateFx> = {
  menu: { lowpassHz: 1200, gain: 10 ** (-3 / 20) },
  results: { lowpassHz: 900, gain: 10 ** (-5 / 20) },
};
const START_LEAD = 0.05;
const CURVE_POINTS = 64;
/** Gains are stored as float32, so a level "at target" can differ in the 8th digit. */
const LEVEL_EPS = 1e-4;
/** Below this the music is not heard yet (-26 dB), so it can start over on its first bar line. */
const AUDIBLE = 0.05;
const DROP_FADE = 0.02;

interface Playing {
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** The level this voice is heading for, kept here because a fade queued for the next bar still reads the old level. */
  target: number;
}

interface Group {
  calm?: Playing;
  intense?: Playing;
  /** Low-pass on the calm voice (source -> filter -> gain). */
  filter: BiquadFilterNode | null;
  /** Cutoff the calm voice is heading for. */
  cutoff: number;
  /** Context time both voices started: bar lines are epoch + n * bar. */
  epoch: number;
  bar: number;
  stopAt: number | null;
}

interface Mix {
  calm: number;
  intense: number;
  cutoff: number;
}

type Shape = (from: number, to: number, out: Float32Array) => Float32Array;

function shaped(from: number, to: number, out: Float32Array, f: (t: number) => number): Float32Array {
  const n = out.length;
  for (let i = 0; i < n; i++) out[i] = f(i / (n - 1));
  out[0] = from;
  out[n - 1] = to;
  return out;
}

/** Equal power fade between two levels: the falling side follows cos, the rising side sin. Ends exactly on `to`. */
export const equalPowerCurve: Shape = (from, to, out) =>
  shaped(from, to, out, (t) => from + (to - from) * (to >= from ? Math.sin((t * Math.PI) / 2) : 1 - Math.cos((t * Math.PI) / 2)));

/** S-shaped level move for one signal (calm to menu and back): no power compensation, the signal is the same. */
export const smoothCurve: Shape = (from, to, out) => shaped(from, to, out, (t) => from + ((to - from) * (1 - Math.cos(t * Math.PI))) / 2);

/** Cutoff sweep, even in pitch (exponential in Hz). */
export const sweepCurve: Shape = (from, to, out) => shaped(from, to, out, (t) => from * (to / from) ** t);

/**
 * Plays the two real loops, calm and intense, started at the same context time so every change is a
 * gain move that keeps the beat. menu and results are the calm voice with its low-pass and level
 * swept to the state's `musicStateFx` (one signal, so no crossfade with a copy of itself); only a
 * change that brings intense in or out uses equal power. Changes start on the next bar line.
 */
export class MusicDirector {
  private tracks: MusicTracks = {};
  private fx: MusicFx = {};
  private group: Group | null = null;
  private current: MusicState = "off";

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {}

  get state(): MusicState {
    return this.current;
  }

  /** A loop is playing (started and not fading out to off). */
  get playing(): boolean {
    const g = this.group;
    return !!g && g.stopAt === null;
  }

  /** The low-pass cutoff the calm loop is heading for (Hz). */
  get cutoff(): number {
    return this.group?.cutoff ?? OPEN_LOWPASS_HZ;
  }

  /** The calm loop's low-pass cutoff right now (Hz). */
  get filterHz(): number {
    return this.group?.filter?.frequency.value ?? OPEN_LOWPASS_HZ;
  }

  setTracks(tracks: MusicTracks, fx: MusicFx = {}): void {
    this.tracks = tracks;
    this.fx = fx;
  }

  hasTrack(state: MusicState): boolean {
    if (state === "off") return true;
    return this.tracks[state === "intense" ? "intense" : "calm"] !== undefined;
  }

  set(next: MusicState): void {
    if (next === this.current) return;
    if (!this.hasTrack(next)) return;
    const now = this.ctx.currentTime;
    if (this.group && this.group.stopAt !== null && this.group.stopAt <= now) this.group = null;
    this.current = next;

    if (next === "off") {
      const g = this.group;
      if (!g || g.stopAt !== null) return;
      this.retarget(g, { calm: 0, intense: 0, cutoff: g.cutoff }, now, now);
      g.stopAt = now + FADE_SECONDS + 0.05;
      g.calm?.source.stop(g.stopAt);
      g.intense?.source.stop(g.stopAt);
      return;
    }

    let g = this.group;
    // Nothing heard yet (the first fade is still queued or barely begun): start over, so the music
    // begins on its first bar line now instead of after a silent bar.
    if (g && g.stopAt === null && !this.audible(g)) {
      this.drop(g, now);
      g = null;
    }
    let at: number;
    if (!g || g.stopAt !== null) {
      at = now + START_LEAD;
      g = this.start(at, next);
      this.group = g;
    } else {
      at = this.nextBar(g, now + START_LEAD);
    }
    this.retarget(g, this.mixOf(next, g), at, now);
  }

  private mixOf(state: MusicState, g: Group): Mix {
    const calm = this.tracks.calm?.gain ?? 1;
    if (state === "calm") return { calm, intense: 0, cutoff: OPEN_LOWPASS_HZ };
    if (state === "menu" || state === "results") {
      const fx = this.fx[state] ?? FALLBACK_FX[state];
      return { calm: calm * fx.gain, intense: 0, cutoff: fx.lowpassHz };
    }
    if (state === "intense") return { calm: 0, intense: this.tracks.intense?.gain ?? 1, cutoff: g.cutoff };
    return { calm: 0, intense: 0, cutoff: g.cutoff };
  }

  /**
   * Point both voices and the calm cutoff at the new mix. Decisions use the targets kept in JS,
   * never `gain.value`: a fade queued for the next bar still reads the old level. When anything
   * changes, every param is cancelled and re-anchored at its current value and the ones not yet at
   * target move from the same bar line, so an earlier queued fade can never fire later. A move that
   * was half way holds its value until that bar line. menu to results with the same values does nothing.
   */
  private retarget(g: Group, mix: Mix, at: number, now: number): void {
    const { calm, intense } = g;
    const changed =
      (calm !== undefined && (calm.target !== mix.calm || g.cutoff !== mix.cutoff)) ||
      (intense !== undefined && intense.target !== mix.intense);
    if (!changed) return;
    const shape = intense !== undefined && intense.target !== mix.intense ? equalPowerCurve : smoothCurve;
    if (calm) this.move(calm.gain.gain, mix.calm, shape, LEVEL_EPS, at, now);
    if (intense) this.move(intense.gain.gain, mix.intense, shape, LEVEL_EPS, at, now);
    if (g.filter) this.move(g.filter.frequency, mix.cutoff, sweepCurve, 1, at, now);
    if (calm) calm.target = mix.calm;
    if (intense) intense.target = mix.intense;
    g.cutoff = mix.cutoff;
  }

  private move(p: AudioParam, want: number, shape: Shape, eps: number, at: number, now: number): void {
    const here = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(here, now);
    if (Math.abs(here - want) > eps) p.setValueCurveAtTime(shape(here, want, new Float32Array(CURVE_POINTS)), at, FADE_SECONDS);
  }

  private audible(g: Group): boolean {
    return (g.calm?.gain.gain.value ?? 0) > AUDIBLE || (g.intense?.gain.gain.value ?? 0) > AUDIBLE;
  }

  /** Retire a group nobody hears yet: a short fade, then stop. */
  private drop(g: Group, now: number): void {
    for (const v of [g.calm, g.intense]) {
      if (!v) continue;
      const p = v.gain.gain;
      const here = p.value;
      p.cancelScheduledValues(now);
      p.setValueAtTime(here, now);
      p.linearRampToValueAtTime(0, now + DROP_FADE);
      v.source.stop(now + DROP_FADE);
    }
    g.stopAt = now + DROP_FADE;
  }

  private start(when: number, first: MusicState): Group {
    const calmTrack = this.tracks.calm;
    const bpm = calmTrack?.bpm ?? this.tracks.intense?.bpm ?? 120;
    const g: Group = { filter: null, cutoff: OPEN_LOWPASS_HZ, epoch: when, bar: (60 / bpm) * 4, stopAt: null };
    if (calmTrack) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = LOWPASS_Q_DB;
      // A group that opens on menu or results starts already filtered, so nothing sweeps on the first bar.
      g.cutoff = this.mixOf(first, g).cutoff;
      filter.frequency.value = g.cutoff;
      g.filter = filter;
      g.calm = this.voice(calmTrack, when, filter);
    }
    if (this.tracks.intense) g.intense = this.voice(this.tracks.intense, when, null);
    return g;
  }

  private voice(t: MusicTrack, when: number, filter: BiquadFilterNode | null): Playing {
    const source = this.ctx.createBufferSource();
    source.buffer = t.buffer;
    source.loop = true;
    source.loopStart = t.loopStart;
    source.loopEnd = t.loopEnd;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    if (filter) {
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(this.out);
    source.onended = () => {
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
    source.start(when);
    return { source, gain, target: 0 };
  }

  private nextBar(g: Group, from: number): number {
    const k = Math.ceil((from - g.epoch) / g.bar - 1e-9);
    return g.epoch + Math.max(0, k) * g.bar;
  }
}
