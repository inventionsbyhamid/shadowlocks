import type { Vec3 } from "../core/types";

// Sound ids, from the sound design (plan/sound/shadow-locks-sound.md, Task 3). Music box notes are
// derived sounds (a few samples, pitched); their ids come with the sound pack.

export const UI_SFX_IDS = ["ui_hover", "ui_press", "ui_back", "drawer_pull", "gentle_error"] as const;

export const LANTERN_SFX_IDS = ["lantern_pick", "lantern_set", "lantern_creak", "dial_tick", "fingertip_hum", "lock_hum"] as const;

export const LOCK_SFX_IDS = ["glass_tick", "brass_clunk", "ring_chime", "thread_shimmer", "crystallise"] as const;

export const BOX_SFX_IDS = ["walls_hinge", "drawer_slide", "reward_lift", "collection_drop", "daily_streak"] as const;

export const GUIDE_SFX_IDS = ["hint_reveal", "lesson_step", "theatre_dim", "theatre_up"] as const;

/** Ids that only exist as derived sounds (no files of their own). None yet: the music box notes come with the pack. */
export const DERIVED_SFX_IDS = [] as const;

export const BASE_SFX_IDS = [...UI_SFX_IDS, ...LANTERN_SFX_IDS, ...LOCK_SFX_IDS, ...BOX_SFX_IDS, ...GUIDE_SFX_IDS] as const;

export type SfxId = (typeof BASE_SFX_IDS)[number] | (typeof DERIVED_SFX_IDS)[number];
/** The room tone loop for the virtual-room fallback; played with `setAmbience`, not `play`. */
export const AMBIENCE_ID = "amb_room";
/** Stings: `solve` from the manifest's music section; `streak` plays the daily_streak effect. */
export const STING_IDS = ["solve"] as const;
export type StingId = (typeof STING_IDS)[number] | "streak";
/** menu and results play the calm loop (the music bed) through a low-pass; off is silence. */
export type MusicState = "menu" | "results" | "calm" | "intense" | "off";
export type BusName = "music" | "sfx" | "ui" | "ambience";

/**
 * The shapes below follow `tools/audio/postprocess.mjs` field for field (sound design 6.5),
 * so a manifest it writes type-checks as is. Fields the engine does not read are kept optional.
 */
export interface SfxEntry {
  files: string[];
  durations?: number[];
  bus: "sfx" | "ui" | "ambience";
  /** hrtf: 3D at the sound position; equalpower: panned at the position; none: head-locked. */
  spatial: "hrtf" | "equalpower" | "none";
  /** Per-sound trim set by ear, in dB. */
  gainDb: number;
  detuneCents: number;
  /** Random pitch spread, plus or minus, in cents. */
  pitchCents: number;
  /** Random gain spread, plus or minus, in dB. */
  gainRandDb: number;
  cooldownMs: number;
  maxVoices: number;
  duckMusicDb: number;
  caption: string | null;
  loop: boolean;
  /** Low-pass in Hz (none when absent). */
  lowpassHz?: number;
  /** Raw takes and the gain applied at render time (informational). */
  sources?: string[];
  renderGainDb?: number[];
}

export interface DerivedEntry {
  from: string;
  reverse?: boolean;
  /** Use only this file of the source sound (0-based). */
  variant?: number;
  semitones?: number;
  /** Another sound that plays together with this one. */
  with?: string;
}

export interface MusicEntry {
  file: string;
  role: "loop" | "loop-native" | "sting";
  loop: boolean;
  bus?: "music";
  bpm?: number;
  bars?: number;
  key?: string;
  lengthSamples?: number;
  loopStartSec?: number;
  loopEndSec?: number;
  durationSec?: number;
  /** Per-track trim set by ear, in dB (applied by the engine). */
  gainDb?: number;
  /** null for loops. */
  duckMusicDb?: number | null;
  /** Render-time details (informational; crossfadeSec is the baked loop seam, not the engine fade). */
  renderGainDb?: number;
  crossfadeSec?: number;
  provider?: string;
  source?: string;
  sourceStartSec?: number;
  sourceBpm?: number;
  startNote?: string;
  basis?: string;
}

export interface AudioManifest {
  version: number;
  generatedUtc?: string;
  sampleRate?: number;
  container?: string;
  codec?: string;
  buses: { music: number; sfx: number; ui: number; ambience?: number };
  sfx: Record<string, SfxEntry>;
  derived: Record<string, DerivedEntry>;
  /** Loops and stings. Stings are rendered as one-shots but live here. */
  music: Record<string, MusicEntry>;
  /**
   * Only calm and intense have files (calm is the music bed). menu and results name the calm track
   * (played through `musicStateFx`).
   */
  musicStates: { calm?: string; intense?: string; menu?: string; results?: string };
  /** How menu and results colour the calm loop. */
  musicStateFx?: { menu?: MusicStateFx; results?: MusicStateFx };
  stings: { solve?: string };
  bytes?: { sfx: number; music: number };
}

export interface MusicStateFx {
  /** Low-pass cutoff on the calm loop. */
  lowpassHz: number;
  /** Level change against calm, in dB. */
  gainDb: number;
}

export interface ListenerPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
}

export const DEFAULT_SFX: Omit<SfxEntry, "files"> = {
  bus: "sfx",
  spatial: "none",
  gainDb: 0,
  detuneCents: 0,
  pitchCents: 50,
  gainRandDb: 0,
  cooldownMs: 30,
  maxVoices: 3,
  duckMusicDb: 0,
  caption: null,
  loop: false,
};

export function isSfxId(id: string): id is SfxId {
  return (BASE_SFX_IDS as readonly string[]).includes(id) || (DERIVED_SFX_IDS as readonly string[]).includes(id);
}
