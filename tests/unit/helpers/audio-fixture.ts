import { AudioEngine } from "../../../src/audio/engine";
import type { AudioManifest, SfxEntry } from "../../../src/audio/manifest";
import { DEFAULT_SFX } from "../../../src/audio/manifest";
import { FakeAudioContext, FakeBuffer, asCtx, type ParamEvent } from "./fake-audio";

export function sfx(files: string[], over: Partial<SfxEntry> = {}): SfxEntry {
  return { ...DEFAULT_SFX, files, pitchCents: 0, ...over };
}

export function fixtureManifest(): AudioManifest {
  return {
    version: 1,
    buses: { music: 0.55, sfx: 1, ui: 0.8 },
    sfx: {
      ui_press: sfx(["press_a", "press_b", "press_c"], { bus: "ui", spatial: "equalpower", cooldownMs: 40, maxVoices: 3 }),
      brass_clunk: sfx(["smash_a"], { spatial: "hrtf", maxVoices: 2, pitchCents: 150, gainRandDb: 1.5, cooldownMs: 30, caption: "Clunk" }),
      lantern_pick: sfx(["grab_a"], { spatial: "hrtf", maxVoices: 16, cooldownMs: 0 }),
      ring_chime: sfx(["bloom_a"], { spatial: "hrtf" }),
      glass_tick: sfx(["combo_a"]),
      crystallise: sfx(["cmax_a"], { duckMusicDb: 4 }),
      walls_hinge: sfx(["hit_a"], { duckMusicDb: 4 }),
      thread_shimmer: sfx(["rival_a"], { spatial: "hrtf", lowpassHz: 5000 }),
      dial_tick: sfx(["tick_a", "tock_a"], { cooldownMs: 0 }),
      daily_streak: sfx(["streak_a"], { duckMusicDb: 6 }),
      mb_g5: sfx(["note_g5"], { spatial: "hrtf", maxVoices: 6, detuneCents: -7, cooldownMs: 0 }),
      lock_hum: sfx(["hum_a"], { spatial: "hrtf", loop: true, maxVoices: 3, detuneCents: -2, cooldownMs: 0 }),
    },
    derived: {
      // Music-box notes pitched from one sample (they inherit its tuning), as the pack does.
      mb_fs5: { from: "mb_g5", semitones: -1 },
      mb_a5: { from: "mb_g5", semitones: 2 },
      lesson_step: { from: "mb_g5", semitones: 0 },
      // Test-only ids for the engine's other derived options (the pack does not use them yet).
      chime_reversed: { from: "ring_chime", reverse: true },
      tick_with_crystal: { from: "glass_tick", semitones: 10, with: "crystallise" },
      tock_low: { from: "dial_tick", variant: 1, semitones: -2 },
    },
    music: {
      music_bed: { file: "m_calm", role: "loop", loop: true, bpm: 120, bars: 16, loopStartSec: 0, loopEndSec: 32, gainDb: 0 },
      music_intense: { file: "m_int", role: "loop", loop: true, bpm: 120, bars: 16, loopStartSec: 0, loopEndSec: 32, gainDb: 0 },
      sting_solve: { file: "m_solve", role: "sting", loop: false, durationSec: 4.8, duckMusicDb: 6, gainDb: 0 },
    },
    musicStates: { calm: "music_bed", intense: "music_intense", menu: "music_bed", results: "music_bed" },
    // Deliberately not the writer's values, so tests prove the engine reads the manifest.
    musicStateFx: { menu: { lowpassHz: 1500, gainDb: -2 }, results: { lowpassHz: 800, gainDb: -6 } },
    stings: { solve: "sting_solve" },
  };
}

export interface Rig {
  ctx: FakeAudioContext;
  manifest: AudioManifest;
  engine: AudioEngine;
  buffers: Map<string, AudioBuffer>;
  warnings: string[];
  buf(file: string): FakeBuffer;
  loadMusic(): Promise<void>;
  duckEvents(): ParamEvent[];
}

export async function makeRig(opts: { unlock?: boolean; music?: boolean; random?: () => number; deferMusic?: boolean; tweak?: (m: AudioManifest) => void; captions?: [string, string][] } = {}): Promise<Rig> {
  const ctx = new FakeAudioContext();
  const warnings: string[] = [];
  const buffers = new Map<string, AudioBuffer>();
  const m = fixtureManifest();
  opts.tweak?.(m);
  const files = [
    ...Object.values(m.sfx).flatMap((e) => e.files),
    ...Object.values(m.music).map((e) => e.file),
  ];
  for (const f of files) {
    const len = f.startsWith("m_") ? 480000 : 4800;
    const b = new FakeBuffer(1, len, 48000);
    b.data[0]![0] = 0.5;
    b.data[0]![1] = 0.25;
    buffers.set(f, b as unknown as AudioBuffer);
  }
  const engine = new AudioEngine({
    createContext: () => asCtx(ctx),
    random: opts.random ?? (() => 0.5),
    warn: (msg) => warnings.push(msg),
    onCaption: (id, text) => opts.captions?.push([id, text]),
  });
  if (opts.deferMusic) await engine.loadSfx(m, { buffers });
  else await engine.load(m, { buffers });
  if (opts.unlock !== false) await engine.unlock();
  return { ctx, manifest: m, engine, buffers, warnings, duckEvents: () => (engine.duckGain().gain as unknown as { events: ParamEvent[] }).events,
    loadMusic: () => engine.loadMusic(m, { buffers }),
    buf: (f) => buffers.get(f) as unknown as FakeBuffer };
}
