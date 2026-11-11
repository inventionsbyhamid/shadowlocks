import { clamp01 } from "../core/clamp";
import type { Vec3 } from "../core/types";
import { AMBIENCE_ID, BASE_SFX_IDS, STING_IDS, type AudioManifest, type ListenerPose, type MusicEntry, type MusicState, type SfxEntry, type SfxId, type StingId } from "./manifest";
import { MusicDirector, type MusicFx, type MusicTracks } from "./music";

export interface EngineOptions {
  createContext?: () => AudioContext;
  /** Random source in [0, 1); injectable for tests. */
  random?: () => number;
  warn?: (message: string) => void;
  /** Prefix for manifest file paths when fetching. */
  baseUrl?: string;
  /**
   * Called for every sound that has a caption, even when the sound itself is
   * muted, on cooldown or before unlock, so captions never depend on hearing it.
   */
  onCaption?: (id: string, caption: string) => void;
}

export interface LoadOptions {
  /** Pre-made buffers by manifest file name (placeholders, tests). */
  buffers?: Map<string, AudioBuffer>;
  fetchData?: (url: string) => Promise<ArrayBuffer>;
  /** Prefix for manifest file paths when fetching; overrides the engine's `baseUrl`. */
  baseUrl?: string;
  /**
   * Stand-ins (placeholders) for anything that does not load: a sound with no loaded file, or a
   * base sound id the manifest lacks, uses the stand-in's entry and buffers; a missing loop or sting
   * uses the stand-in's. Called only when something is missing, possibly more than once: cache it.
   */
  fallback?: () => SoundSet;
}

/** A manifest plus already decoded buffers for its files. */
export interface SoundSet {
  manifest: AudioManifest;
  buffers: Map<string, AudioBuffer>;
}

/** fetch() that treats an HTTP error as a failure (a 404 page is not audio). */
export async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.arrayBuffer();
}

/**
 * Lets a caller cut a playing sound short (a hum or a slide that ends with its animation).
 * The handle belongs to the pooled voice, so play() allocates nothing for it. It is valid until
 * that sound ends or its voice is stolen; after that the voice may carry another sound, so do not
 * keep it longer than the sound itself.
 */
export interface PlayHandle {
  stop(fadeMs?: number): void;
}

const NOOP_HANDLE: PlayHandle = Object.freeze({ stop() {} });

export interface PlayOptions {
  position?: Vec3;
  /** Force one variant (0-based) instead of rotating. */
  variant?: number;
  /** Extra pitch in semitones. */
  pitch?: number;
  /** Extra linear gain multiplier. */
  gain?: number;
  /** Start this many seconds from now, exactly on the audio clock (layered sounds). */
  delay?: number;
  /** Dip the music this many dB while this sound plays (the box's tune); the deeper of this and the manifest's duck. */
  duckDb?: number;
}

/**
 * A looping sound with a level that moves (the warmth hums). It runs on its own source and nodes,
 * outside the voice pool, so a burst of one-shots can never steal it. Valid until stopped.
 */
export interface LoopHandle {
  /** Still playing (not stopped). */
  readonly playing: boolean;
  /** Move the level (linear, times the sound's trim) over `rampMs` (default 40 ms): no zipper noise. */
  setGain(gain: number, rampMs?: number): void;
  /** Move the pitch, in semitones over the sound's tuning, over `rampMs` (default 40 ms). */
  setPitch(semitones: number, rampMs?: number): void;
  /** Move the sound (spatial sounds only). */
  setPosition(p: Vec3): void;
  /** Fade out over `fadeMs` (default 150 ms) and stop. */
  stop(fadeMs?: number): void;
}

export interface LoopOptions {
  position?: Vec3;
  /** Semitones over the sound's tuning. */
  pitch?: number;
  /** Starting level (linear); default 0, so a loop starts silent and ramps up with setGain. */
  gain?: number;
}

/** Gain and pitch moves on a loop take this long unless told otherwise (ms). */
export const LOOP_RAMP_MS = 40;
/** A stopped loop fades out over this long unless told otherwise (ms). */
export const LOOP_FADE_MS = 150;

const NO_OPTIONS: PlayOptions = Object.freeze({});

export const VOICE_POOL_SIZE = 16;
const DUCK_ATTACK = 0.05;
const DUCK_RELEASE = 0.3;
const STING_DUCK_DB = 6;
const STEAL_FADE = 0.005;
const AMBIENCE_FADE = 1;

/** What a sound id means regardless of whether its file loaded: caption and companion. */
interface SoundMeta {
  caption: string | null;
  withId?: string;
}

interface Sound {
  id: string;
  entry: SfxEntry;
  buffers: AudioBuffer[];
  detuneCents: number;
  lowpassHz?: number;
  next: number;
  lastAt: number;
}

interface Voice {
  gain: GainNode;
  lp: BiquadFilterNode;
  hrtf: PannerNode;
  eq: PannerNode;
  source: AudioBufferSourceNode | null;
  soundId: string;
  startedAt: number;
  /** Bus node this voice is routed to while playing. */
  dest: AudioNode | null;
  handle: PlayHandle;
  /** Made once per voice: frees the voice when its current source ends (a stolen source is ignored). */
  onEnded: (e: Event) => void;
  /** When the last steal's fade ends: the new sound starts then. */
  stolenAt: number;
}

const db = (x: number) => 10 ** (x / 20);

export class AudioEngine {
  private ctx: AudioContext;
  private random: () => number;
  private warnFn: (m: string) => void;
  private baseUrl: string;
  private onCaption?: EngineOptions["onCaption"];
  /** Sting trim by sting id. */
  private stingTrim = new Map<string, number>();

  private master: GainNode;
  private musicBus: GainNode;
  private duck: GainNode;
  private sfxBus: GainNode;
  private uiBus: GainNode;
  private ambienceBus: GainNode;

  private manifest: AudioManifest | null = null;
  private sounds = new Map<string, Sound>();
  private meta = new Map<string, SoundMeta>();
  private stingBuffers = new Map<string, AudioBuffer>();
  private stingDuck = new Map<string, number>();
  private ambienceOn = false;
  private ambience: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private warned = new Set<string>();
  private voices: Voice[] = [];
  private music: MusicDirector;

  private unlocked = false;
  private suspended = false;
  private mono = false;
  private wanted: MusicState = "off";
  private vol = { music: 1, sfx: 1 };
  private duckDepth = 1;
  private duckUntil = 0;
  /** When the current duck starts going down (it may still be to come). */
  private duckFrom = 0;

  constructor(opts: EngineOptions = {}) {
    this.random = opts.random ?? Math.random;
    this.warnFn = opts.warn ?? ((m) => console.warn(m));
    this.baseUrl = opts.baseUrl ?? "";
    this.onCaption = opts.onCaption;
    this.ctx = opts.createContext ? opts.createContext() : new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    const c = this.ctx;

    this.master = c.createGain();
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.master.connect(limiter);
    limiter.connect(c.destination);

    this.musicBus = c.createGain();
    this.duck = c.createGain();
    this.sfxBus = c.createGain();
    this.uiBus = c.createGain();
    this.ambienceBus = c.createGain();
    this.duck.connect(this.musicBus);
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // UI and ambience sit inside effects, so the effects slider scales them too.
    this.uiBus.connect(this.sfxBus);
    this.ambienceBus.connect(this.sfxBus);
    this.applyVolumes();

    for (let i = 0; i < VOICE_POOL_SIZE; i++) this.voices.push(this.makeVoice());
    this.music = new MusicDirector(c, this.duck);
  }

  get context(): AudioContext {
    return this.ctx;
  }

  get activeVoices(): number {
    return this.voices.reduce((n, v) => n + (v.source ? 1 : 0), 0);
  }

  get musicState(): MusicState {
    return this.wanted;
  }

  /**
   * The music as heard (tests and tools): the state asked for, whether the bed is playing, the
   * low-pass cutoff it is heading for and the cutoff right now.
   */
  musicInfo(): { state: MusicState; playing: boolean; cutoffHz: number; filterHz: number } {
    return { state: this.wanted, playing: this.music.playing, cutoffHz: this.music.cutoff, filterHz: this.music.filterHz };
  }

  /** Bus node by name, for tests and tooling. */
  busGain(name: string): GainNode {
    return name === "music" ? this.musicBus : name === "ui" ? this.uiBus : name === "ambience" ? this.ambienceBus : this.sfxBus;
  }

  duckGain(): GainNode {
    return this.duck;
  }

  /** Where a sound that sits inside the effects bus joins it (the voice guide's own gain stage: voice.ts). */
  effectsInput(): AudioNode {
    return this.sfxBus;
  }

  /** Dip the music `dbDown` for `sec` from now (50 ms down, 300 ms back), merged with any dip already under way. */
  duckMusicFor(dbDown: number, sec: number): void {
    this.duckMusic(dbDown, sec);
  }

  /** End the music's dip now (a voice line cut short): back up over the usual 300 ms. */
  releaseDuck(): void {
    const now = this.ctx.currentTime;
    if (now >= this.duckUntil) return;
    this.duckUntil = now;
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1, now + DUCK_RELEASE);
  }

  private get ready(): boolean {
    return this.unlocked && !this.suspended && this.ctx.state === "running";
  }

  /**
   * Sound can play: the engine was unlocked (unlock() finished) and the context runs. A context
   * that started by itself (autoplay allowed) still needs unlock() before anything plays.
   */
  get running(): boolean {
    return this.unlocked && this.ctx.state === "running";
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Call from the first pinch or poke. Before it resolves, play() is silent: the engine counts as
   * unlocked only once the context really resumed, so nothing queues up while resume is pending.
   */
  async unlock(): Promise<void> {
    this.suspended = false;
    try {
      await this.ctx.resume();
    } catch (e) {
      this.warnOnce("resume", `audio: could not start audio: ${String(e)}`);
      return;
    }
    this.unlocked = true;
    this.applyMusic();
    this.applyAmbience();
  }

  suspend(): void {
    this.suspended = true;
    this.ctx.suspend().catch((e) => this.warnOnce("suspend", `audio: could not suspend: ${String(e)}`));
  }

  resume(): void {
    this.suspended = false;
    if (this.unlocked) this.ctx.resume().catch((e) => this.warnOnce("resume", `audio: could not resume: ${String(e)}`));
  }

  // ------------------------------------------------------------------ loading

  /** Sound effects first, then music. Callers may call the two halves separately. */
  async load(m: AudioManifest, o: LoadOptions = {}): Promise<void> {
    await this.loadSfx(m, o);
    await this.loadMusic(m, o);
  }

  async loadSfx(m: AudioManifest, o: LoadOptions = {}): Promise<void> {
    this.manifest = m;
    this.applyVolumes();
    this.sounds.clear();
    this.meta.clear();
    const files = new Map<string, AudioBuffer>();
    const all = [...new Set(Object.values(m.sfx).flatMap((e) => e.files))];
    await Promise.all(
      all.map(async (f) => {
        const b = await this.getBuffer(f, o);
        if (b) files.set(f, b);
      }),
    );
    const entries = new Map(Object.entries(m.sfx));
    const loaded = (e: SfxEntry, from: Map<string, AudioBuffer>) => e.files.map((f) => from.get(f)).filter((b): b is AudioBuffer => !!b);
    const missing = [...entries].filter(([, e]) => loaded(e, files).length === 0).map(([id]) => id);
    for (const id of BASE_SFX_IDS) if (!entries.has(id)) missing.push(id);
    const fb = missing.length > 0 ? o.fallback?.() : undefined;
    for (const id of missing) {
      const stand = fb?.manifest.sfx[id];
      if (!stand || loaded(stand, fb!.buffers).length === 0) continue;
      entries.set(id, stand);
      for (const f of stand.files) files.set(f, fb!.buffers.get(f)!);
    }
    for (const [id, entry] of entries) {
      this.meta.set(id, { caption: entry.caption ?? null });
      const buffers = loaded(entry, files);
      if (buffers.length === 0) continue;
      this.sounds.set(id, { id, entry, buffers, detuneCents: entry.detuneCents, lowpassHz: entry.lowpassHz, next: 0, lastAt: -Infinity });
    }
    for (const [id, d] of Object.entries(m.derived)) {
      this.meta.set(id, { caption: entries.get(d.from)?.caption ?? null, withId: d.with });
    }
    const reversed = new Map<string, AudioBuffer[]>();
    for (const [id, d] of Object.entries(m.derived)) {
      const base = this.sounds.get(d.from);
      if (!base) continue;
      let buffers = base.buffers;
      if (d.variant !== undefined && base.buffers[d.variant]) buffers = [base.buffers[d.variant]!];
      if (d.reverse) {
        const key = `${d.from}:${d.variant ?? "*"}`;
        buffers = reversed.get(key) ?? buffers.map((b) => this.reverseCopy(b));
        reversed.set(key, buffers);
      }
      this.sounds.set(id, {
        id,
        entry: base.entry,
        buffers,
        detuneCents: base.detuneCents + (d.semitones ?? 0) * 100,
        lowpassHz: base.lowpassHz,
        next: 0,
        lastAt: -Infinity,
      });
    }
    this.applyAmbience();
  }

  /**
   * Loads calm (the music bed) and intense, the menu and results colouring from `musicStateFx`, and
   * the stings. menu and results always play the calm loop.
   */
  async loadMusic(m: AudioManifest, o: LoadOptions = {}): Promise<void> {
    this.manifest = m;
    let fb: SoundSet | undefined;
    const stand = () => (fb ??= o.fallback?.());
    const tracks: MusicTracks = {};
    const states = m.musicStates;
    for (const state of ["calm", "intense"] as const) {
      const key = states[state];
      // The bed always has a stand-in; a second loop or a sting only when the pack names one (a
      // pack without them is complete, and synthesising stand-ins costs a frame at boot).
      if (!key && state !== "calm") continue;
      let e = key ? m.music[key] : undefined;
      let buffer = e ? await this.getBuffer(e.file, o) : null;
      if (!buffer) {
        const s = stand();
        const k = s?.manifest.musicStates[state];
        e = k ? s!.manifest.music[k] : undefined;
        buffer = e ? (s!.buffers.get(e.file) ?? null) : null;
      }
      if (!e || !buffer) continue;
      tracks[state] = {
        buffer,
        bpm: e.bpm ?? 120,
        loopStart: e.loopStartSec ?? 0,
        loopEnd: e.loopEndSec ?? buffer.duration,
        gain: db(e.gainDb ?? 0),
      };
    }
    for (const state of ["menu", "results"] as const) {
      const key = states[state];
      if (key && key !== states.calm) this.warnOnce(`music:${state}`, `audio: ${state} names ${key}; menu and results always play the calm loop`);
    }
    const fx: MusicFx = {};
    for (const state of ["menu", "results"] as const) {
      const f = m.musicStateFx?.[state];
      if (f) fx[state] = { lowpassHz: f.lowpassHz, gain: db(f.gainDb) };
    }
    this.music.setTracks(tracks, fx);
    for (const id of STING_IDS) {
      // postprocess puts stings in `music`; accept an `sfx` entry too in case they move there.
      const key = m.stings[id];
      if (!key) continue;
      let e: Pick<MusicEntry, "gainDb" | "duckMusicDb"> | undefined = key ? (m.music[key] ?? m.sfx[key]) : undefined;
      const file = key ? (m.music[key]?.file ?? m.sfx[key]?.files[0]) : undefined;
      let buffer = file ? await this.getBuffer(file, o) : null;
      if (!buffer) {
        const s = stand();
        const k = s?.manifest.stings[id];
        const se = k ? s!.manifest.music[k] : undefined;
        buffer = se ? (s!.buffers.get(se.file) ?? null) : null;
        e = se;
      }
      if (!buffer) continue;
      this.stingBuffers.set(id, buffer);
      this.stingTrim.set(id, db(e?.gainDb ?? 0));
      this.stingDuck.set(id, e?.duckMusicDb || STING_DUCK_DB);
    }
    this.applyMusic();
  }

  private async getBuffer(file: string, o: LoadOptions): Promise<AudioBuffer | null> {
    const pre = o.buffers?.get(file);
    if (pre) return pre;
    try {
      const url = (o.baseUrl ?? this.baseUrl) + file;
      const data = await (o.fetchData ?? fetchArrayBuffer)(url);
      return await this.ctx.decodeAudioData(data);
    } catch (e) {
      this.warnOnce(`load:${file}`, `audio: could not load ${file}: ${String(e)}`);
      return null;
    }
  }

  private reverseCopy(b: AudioBuffer): AudioBuffer {
    const out = this.ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const src = b.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i]!;
    }
    return out;
  }

  // ------------------------------------------------------------------ effects

  /**
   * Play a sound effect. The caption (if the manifest gives one) is sent first, before every gate
   * (not unlocked, suspended, effects at 0, cooldown, file failed to load), so captions never
   * depend on hearing the sound. A derived sound's companion (`with`) follows the same rule.
   */
  play(id: SfxId, o: PlayOptions = NO_OPTIONS): PlayHandle {
    const meta = this.meta.get(id);
    if (meta?.caption) this.onCaption?.(id, meta.caption);
    const handle = this.start(id, o);
    if (meta?.withId) this.play(meta.withId as SfxId, o.position ? { position: o.position } : NO_OPTIONS);
    return handle;
  }

  private start(id: SfxId, o: PlayOptions): PlayHandle {
    const s = this.sounds.get(id);
    if (!s) {
      if (this.ready) this.warnOnce(`sfx:${id}`, `audio: no sound "${id}" in the manifest`);
      return NOOP_HANDLE;
    }
    const e = s.entry;
    if (!this.ready || this.vol.sfx <= 0) return NOOP_HANDLE;
    const now = this.ctx.currentTime;
    if ((now - s.lastAt) * 1000 < e.cooldownMs) return NOOP_HANDLE;
    s.lastAt = now;

    let idx: number;
    if (o.variant !== undefined) idx = o.variant % s.buffers.length;
    else {
      idx = s.next % s.buffers.length;
      s.next = (idx + 1) % s.buffers.length;
    }
    const buffer = s.buffers[idx]!;

    const cents = s.detuneCents + (this.random() * 2 - 1) * e.pitchCents + (o.pitch ?? 0) * 100;
    const rate = 2 ** (cents / 1200);
    const gain = db(e.gainDb + (this.random() * 2 - 1) * e.gainRandDb) * (o.gain ?? 1);

    const v = this.acquire(s.id, e.maxVoices, now);
    // After a steal the old sound is still fading through this voice: start once that fade is done
    // (or later, when the caller asked for a delay).
    const wantAt = o.delay !== undefined && o.delay > 0 ? now + o.delay : now;
    const at = v.stolenAt > wantAt ? v.stolenAt : wantAt;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.loop = e.loop;
    v.source = src;
    v.soundId = s.id;
    v.startedAt = now;
    const g = v.gain.gain;
    if (at === now) g.cancelScheduledValues(now);
    g.setValueAtTime(gain, at);

    v.gain.disconnect();
    v.lp.disconnect();
    v.hrtf.disconnect();
    v.eq.disconnect();
    let tail: AudioNode = v.gain;
    if (s.lowpassHz) {
      v.lp.frequency.setValueAtTime(s.lowpassHz, at);
      tail.connect(v.lp);
      tail = v.lp;
    }
    if (o.position && e.spatial !== "none" && !this.mono) {
      const p = e.spatial === "hrtf" ? v.hrtf : v.eq;
      p.positionX.setValueAtTime(o.position[0], at);
      p.positionY.setValueAtTime(o.position[1], at);
      p.positionZ.setValueAtTime(o.position[2], at);
      tail.connect(p);
      tail = p;
    }
    v.dest = e.bus === "ui" ? this.uiBus : e.bus === "ambience" ? this.ambienceBus : this.sfxBus;
    tail.connect(v.dest);
    src.connect(v.gain);
    src.onended = v.onEnded;
    src.start(at);

    const duckDb = o.duckDb !== undefined && o.duckDb > e.duckMusicDb ? o.duckDb : e.duckMusicDb;
    if (duckDb > 0) this.duckMusic(duckDb, buffer.duration / rate, at);
    return v.handle;
  }

  // -------------------------------------------------------------------- loops

  /** A loop can start now: audio runs and effects are not at 0 (cheap: check it before preparing one). */
  canLoop(): boolean {
    return this.ready && this.vol.sfx > 0;
  }

  /**
   * Start a looping sound outside the voice pool (never stolen by one-shots), silent unless
   * `o.gain` says otherwise: move its level with setGain. Null before audio starts, while effects
   * are off, or when the pack has no such sound (warned once, as play() does); ask again later.
   */
  loop(id: SfxId, o: LoopOptions = {}): LoopHandle | null {
    if (!this.canLoop()) return null;
    const s = this.sounds.get(id);
    if (!s) {
      this.warnOnce(`sfx:${id}`, `audio: no sound "${id}" in the manifest`);
      return null;
    }
    const e = s.entry;
    const c = this.ctx;
    const now = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = s.buffers[0]!;
    src.loop = true;
    src.playbackRate.setValueAtTime(2 ** ((s.detuneCents + (o.pitch ?? 0) * 100) / 1200), now);
    const trim = db(e.gainDb);
    const gain = c.createGain();
    gain.gain.setValueAtTime(Math.max(0, o.gain ?? 0) * trim, now);
    src.connect(gain);
    let tail: AudioNode = gain;
    let lp: BiquadFilterNode | null = null;
    if (s.lowpassHz) {
      lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(s.lowpassHz, now);
      tail.connect(lp);
      tail = lp;
    }
    let panner: PannerNode | null = null;
    if (o.position && e.spatial !== "none" && !this.mono) {
      panner = c.createPanner();
      panner.panningModel = e.spatial === "hrtf" ? "HRTF" : "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = 0.3;
      panner.rolloffFactor = 1;
      tail.connect(panner);
      tail = panner;
    }
    tail.connect(e.bus === "ui" ? this.uiBus : e.bus === "ambience" ? this.ambienceBus : this.sfxBus);
    const handle = new EngineLoop(c, src, gain, lp, panner, s.detuneCents, trim);
    if (o.position) handle.setPosition(o.position);
    src.start(now);
    return handle;
  }

  private acquire(soundId: string, maxVoices: number, now: number): Voice {
    let same = 0;
    let oldestSame: Voice | null = null;
    let free: Voice | null = null;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (!v.source) {
        free ??= v;
        continue;
      }
      if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
      if (v.soundId === soundId) {
        same++;
        if (!oldestSame || v.startedAt < oldestSame.startedAt) oldestSame = v;
      }
    }
    if (same >= maxVoices && oldestSame) {
      this.steal(oldestSame, now);
      return oldestSame;
    }
    if (free) return free;
    this.steal(oldest!, now);
    return oldest!;
  }

  /**
   * Cut a voice over to a new sound. The old sound fades out over 5 ms through the voice's own gain
   * (same panner and filter it was playing through) and stops; the new sound starts at `stolenAt`,
   * once the fade is done. The old source stays wired to the voice gain until it ends.
   */
  private steal(v: Voice, now: number): void {
    const src = v.source;
    if (!src) return;
    const g = v.gain.gain;
    const level = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(level, now);
    g.linearRampToValueAtTime(0, now + STEAL_FADE);
    src.stop(now + STEAL_FADE);
    v.source = null;
    v.stolenAt = now + STEAL_FADE;
  }

  /** Unwire the voice: its own chain, and the bus. */
  private release(v: Voice): void {
    v.source?.disconnect();
    v.source = null;
    v.dest = null;
    v.gain.disconnect();
    v.lp.disconnect();
    v.hrtf.disconnect();
    v.eq.disconnect();
  }

  private makeVoice(): Voice {
    const c = this.ctx;
    const hrtf = c.createPanner();
    hrtf.panningModel = "HRTF";
    const eq = c.createPanner();
    eq.panningModel = "equalpower";
    for (const p of [hrtf, eq]) {
      p.distanceModel = "inverse";
      p.refDistance = 0.3;
      p.rolloffFactor = 1;
    }
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    const v: Voice = { gain: c.createGain(), lp, hrtf, eq, source: null, soundId: "", startedAt: 0, dest: null, handle: NOOP_HANDLE, onEnded: () => {}, stolenAt: 0 };
    v.onEnded = (e) => {
      const src = e.target as AudioBufferSourceNode | null;
      // A stolen sound only lets go of the voice gain; the voice itself now carries another sound.
      if (src && src !== v.source) src.disconnect();
      else if (src) this.release(v);
    };
    v.handle = {
      stop: (fadeMs = 40) => {
        const src = v.source;
        if (!src) return;
        const now = c.currentTime;
        const sec = Math.max(0, fadeMs) / 1000;
        const g = v.gain.gain;
        const level = g.value;
        g.cancelScheduledValues(now);
        g.setValueAtTime(level, now);
        g.linearRampToValueAtTime(0, now + sec);
        src.stop(now + sec + 0.005);
      },
    };
    return v;
  }

  // -------------------------------------------------------------------- music

  setMusic(state: MusicState): void {
    this.wanted = state;
    this.applyMusic();
  }

  private applyMusic(): void {
    if (this.unlocked) this.music.set(this.wanted);
  }

  /** A short musical sting; music ducks (6 dB unless the manifest says) while it plays. `streak` is the daily_streak effect. */
  sting(id: StingId): void {
    if (!this.ready) return;
    if (id === "streak") {
      this.play("daily_streak");
      return;
    }
    const buffer = this.stingBuffers.get(id);
    if (!buffer) {
      this.warnOnce(`sting:${id}`, `audio: no sting "${id}" in the manifest`);
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = this.stingTrim.get(id) ?? 1;
    src.connect(g);
    g.connect(this.musicBus);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    src.start();
    this.duckMusic(this.stingDuck.get(id) ?? STING_DUCK_DB, buffer.duration);
  }

  /**
   * Room tone (`amb_room`) for the virtual-room fallback; passthrough has the real room, so it is
   * off by default. Fades over 1 s on its own looping source, outside the voice pool, so it is never
   * stolen. Plays once unlocked and loaded; a manifest without it makes this a no-op.
   */
  setAmbience(on: boolean): void {
    this.ambienceOn = on;
    this.applyAmbience();
  }

  private applyAmbience(): void {
    const want = this.ambienceOn && this.unlocked;
    const now = this.ctx.currentTime;
    if (want && !this.ambience) {
      const buffer = this.sounds.get(AMBIENCE_ID)?.buffers[0];
      if (!buffer) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(db(this.sounds.get(AMBIENCE_ID)!.entry.gainDb), now + AMBIENCE_FADE);
      source.connect(gain);
      gain.connect(this.ambienceBus);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start(now);
      this.ambience = { source, gain };
    } else if (!want && this.ambience) {
      const { source, gain } = this.ambience;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + AMBIENCE_FADE);
      source.stop(now + AMBIENCE_FADE);
      this.ambience = null;
    }
  }

  /**
   * Lower music by `dbDown` for `hold` seconds from `from` (default now), then release. Overlapping
   * ducks merge: the deeper depth, the later end, and the earlier start while the one before has not
   * begun (sounds handed over ahead of time, as a whole tune at once).
   */
  private duckMusic(dbDown: number, hold: number, from?: number): void {
    const now = this.ctx.currentTime;
    let start = from !== undefined && from > now ? from : now;
    let depth = db(-dbDown);
    let end = start + DUCK_ATTACK + hold;
    if (now < this.duckUntil) {
      depth = Math.min(depth, this.duckDepth);
      end = Math.max(end, this.duckUntil);
      if (this.duckFrom > now && this.duckFrom < start) start = this.duckFrom;
    }
    this.duckDepth = depth;
    this.duckUntil = end;
    this.duckFrom = start;
    const g = this.duck.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (start > now) g.setValueAtTime(g.value, start);
    g.linearRampToValueAtTime(depth, start + DUCK_ATTACK);
    g.setValueAtTime(depth, end);
    g.linearRampToValueAtTime(1, end + DUCK_RELEASE);
  }

  // ----------------------------------------------------------------- settings

  setVolumes(v: { music: number; sfx: number }): void {
    this.vol.music = clamp01(v.music);
    this.vol.sfx = clamp01(v.sfx);
    this.applyVolumes();
  }

  setMono(on: boolean): void {
    this.mono = on;
  }

  setListener(p: ListenerPose): void {
    const l = this.ctx.listener;
    l.positionX.value = p.position[0];
    l.positionY.value = p.position[1];
    l.positionZ.value = p.position[2];
    l.forwardX.value = p.forward[0];
    l.forwardY.value = p.forward[1];
    l.forwardZ.value = p.forward[2];
    l.upX.value = p.up[0];
    l.upY.value = p.up[1];
    l.upZ.value = p.up[2];
  }

  private applyVolumes(): void {
    const b = this.manifest?.buses;
    this.setBus(this.musicBus, (b?.music ?? 0.5) * this.vol.music);
    this.setBus(this.sfxBus, (b?.sfx ?? 1) * this.vol.sfx);
    this.setBus(this.uiBus, b?.ui ?? 0.8);
    this.setBus(this.ambienceBus, b?.ambience ?? 0.3);
  }

  private setBus(g: GainNode, v: number): void {
    const now = this.ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    if (v <= 0) g.gain.setValueAtTime(0, now);
    else g.gain.setTargetAtTime(v, now, 0.015);
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnFn(message);
  }
}

/**
 * Move an AudioParam from where it is now to `to` over `sec`: hold the current value first, so a
 * change half way through an earlier ramp starts from the level heard, not from the old target.
 */
function rampParam(p: AudioParam, to: number, now: number, sec: number): void {
  const here = p.value;
  p.cancelScheduledValues(now);
  p.setValueAtTime(here, now);
  if (sec > 0) p.linearRampToValueAtTime(to, now + sec);
  else p.setValueAtTime(to, now);
}

/** A looping sound on its own nodes (AudioEngine.loop). Allocates nothing after it is made. */
class EngineLoop implements LoopHandle {
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly src: AudioBufferSourceNode,
    private readonly gain: GainNode,
    private readonly lp: BiquadFilterNode | null,
    private readonly panner: PannerNode | null,
    private readonly detuneCents: number,
    private readonly trim: number,
  ) {
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      lp?.disconnect();
      panner?.disconnect();
    };
  }

  get playing(): boolean {
    return !this.stopped;
  }

  setGain(gain: number, rampMs = LOOP_RAMP_MS): void {
    if (this.stopped) return;
    rampParam(this.gain.gain, Math.max(0, gain) * this.trim, this.ctx.currentTime, Math.max(0, rampMs) / 1000);
  }

  setPitch(semitones: number, rampMs = LOOP_RAMP_MS): void {
    if (this.stopped) return;
    const rate = 2 ** ((this.detuneCents + semitones * 100) / 1200);
    rampParam(this.src.playbackRate, rate, this.ctx.currentTime, Math.max(0, rampMs) / 1000);
  }

  setPosition(p: Vec3): void {
    const pan = this.panner;
    if (this.stopped || !pan) return;
    const now = this.ctx.currentTime;
    pan.positionX.setValueAtTime(p[0], now);
    pan.positionY.setValueAtTime(p[1], now);
    pan.positionZ.setValueAtTime(p[2], now);
  }

  stop(fadeMs = LOOP_FADE_MS): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    const sec = Math.max(0, fadeMs) / 1000;
    rampParam(this.gain.gain, 0, now, sec);
    this.src.stop(now + sec + 0.005);
  }
}
