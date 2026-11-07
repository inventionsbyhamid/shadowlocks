// The box is a music box: every lock owns one note of the box's chord, a lock opening plays its note
// on the comb, and a box opening rolls the chord and plays a short tune grown from the box's seed. All
// in KEY at BPM, so nothing the box plays can clash with the bed or with itself. Pure: the cue
// mapper turns these schedules into sounds (and the demo video's mix replays the same mapping).
import { mulberry32, seedFrom } from "../core/rng";
import { DIAL_TICKS_CM } from "../feel/constants";

/** The key of every pitched sound: the lock notes, hums, dial ticks, tunes and the music bed. */
export const KEY = "G major";
export const BPM = 72;
/** One eighth note at BPM: the box tune's step. */
export const EIGHTH_MS = 60_000 / BPM / 2;

/**
 * The music box's two octaves of G major, G4 to G6, as sound ids. Every chord tone (G B D) and E6
 * are samples; the rest are derived from the nearest sample (sound design 5).
 */
export const MUSIC_BOX_NOTES = [
  "mb_g4", "mb_a4", "mb_b4", "mb_c5", "mb_d5", "mb_e5", "mb_fs5",
  "mb_g5", "mb_a5", "mb_b5", "mb_c6", "mb_d6", "mb_e6", "mb_fs6", "mb_g6",
] as const;
export type MusicBoxNote = (typeof MUSIC_BOX_NOTES)[number];

/** A lock opening, in layers after the moment it opens (sound design 2.4). */
export const LOCK_OPEN_MS = { tick: 0, clunk: 120, note: 200 } as const;

/** The box opening (sound design 2.4, step 6): the chord rolls, the walls hinge, the drawer, the tune. */
export const BOX_OPEN_MS = { chord: 500, chordStep: 80, walls: 700, drawer: 1300, tune: 1700 } as const;
/** The chord that resolves when the last lock opens, rolled upwards. */
export const RESOLVE_CHORD: readonly MusicBoxNote[] = ["mb_g4", "mb_b4", "mb_d5", "mb_g5"];

/** Dial ticks over the last 4, 3, 2 and 1 cm climb G A B D: semitones over the tick's own pitch. */
export const DIAL_TICK_SEMITONES: readonly number[] = [0, 2, 4, 7];

/** One sound of a schedule: what plays, and when (ms on the caller's clock). */
export interface Scheduled {
  id: string;
  atMs: number;
  /** The music dips this many dB while this sound plays (the box's tune). */
  duckDb?: number;
}

/** The music dips this many dB under the box's tune: down in 50 ms with its first note, up 300 ms after its last. */
export const TUNE_DUCK_DB = 4;

// ------------------------------------------------------------------------------------- notes

const NAMES = ["c", "cs", "d", "ds", "e", "f", "fs", "g", "gs", "a", "as", "b"];
const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
/** MIDI note of G4, the pitch the one lock_hum loop is tuned to. */
const HUM_MIDI = 67;

function readKey(key: string): { tonic: number; minor: boolean } {
  const m = /^([A-G])([#b]?)\s+(major|minor)$/.exec(key.trim());
  if (!m) throw new Error(`music box: cannot read the key "${key}" (expected say "G major" or "E minor")`);
  const shift = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return { tonic: (LETTERS[m[1]!]! + shift + 12) % 12, minor: m[3] === "minor" };
}

/** The pitch classes (0 = C) of `key`'s scale. */
export function pitchClassesOf(key: string): number[] {
  const { tonic, minor } = readKey(key);
  return (minor ? MINOR : MAJOR).map((i) => (tonic + i) % 12);
}

/** A music-box sound id ("mb_fs5") as a MIDI note number (F#5 = 78). */
export function midiOf(id: string): number {
  const m = /^mb_([a-g]s?)(\d)$/.exec(id);
  const pc = m ? NAMES.indexOf(m[1]!) : -1;
  if (!m || pc < 0) throw new Error(`music box: "${id}" is not a note`);
  return pc + 12 * (Number(m[2]) + 1);
}

function noteId(midi: number): string {
  return `mb_${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * The note lock `lockIndex` plays when it opens: locks 0, 1 and 2 are the root, third and fifth of the
 * box chord (the tonic triad of `key`), from the root in octave 5. In G major: G5, B5, D6.
 */
export function noteFor(lockIndex: number, key: string = KEY): string {
  const { tonic, minor } = readKey(key);
  const chord = [0, minor ? 3 : 4, 7];
  return noteId(72 + tonic + chord[((lockIndex % 3) + 3) % 3]!);
}

/** How far above G4 the lock's hum is: its note an octave down (0, +4, +7 in G major). */
export function humSemitones(lockIndex: number, key: string = KEY): number {
  return midiOf(noteFor(lockIndex, key)) - 12 - HUM_MIDI;
}

/** The dial tick's pitch, in semitones, for the tick at `cm` from the spot (0 for a distance it does not know). */
export function dialTickPitch(cm: number): number {
  const i = DIAL_TICKS_CM.indexOf(cm);
  return i < 0 ? 0 : (DIAL_TICK_SEMITONES[i] ?? 0);
}

// -------------------------------------------------------------------------------------- tune

/** Indices into MUSIC_BOX_NOTES of the pentatonic notes (G A B D E) the tune walks on, A4 to E6. */
const WALK = [1, 2, 4, 5, 7, 8, 9, 11, 12];
/** Where a tune starts: D5, G5, B5 or D6 (chord tones in the middle of the comb). */
const STARTS = [2, 4, 6, 7];
/** Steps along WALK: mostly to a neighbour, sometimes a skip. */
const STEPS = [-2, -1, -1, 1, 1, 2];
/** The note before the last: D5, E5, F#5 (the leading tone, the tune's one colour note), A5 or B5. */
const APPROACH = [4, 5, 6, 8, 9];
/** The tune ends on G5, the root, held. */
const HOME = 7;

/**
 * The box's own tune: 6 to 8 notes, the same for the same seed. It walks the pentatonic notes of the
 * key in small steps, approaches the root, and ends on a held G5.
 */
export function tuneFor(seed: string): MusicBoxNote[] {
  const r = mulberry32(seedFrom(`tune:${seed}`));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const n = 6 + Math.floor(r() * 3);
  let p = pick(STARTS);
  const idx: number[] = [WALK[p]!];
  while (idx.length < n - 2) {
    const step = pick(STEPS);
    p = p + step >= 0 && p + step < WALK.length ? p + step : p - step;
    idx.push(WALK[p]!);
  }
  const last = idx[idx.length - 1]!;
  const near = APPROACH.filter((a) => a !== last && Math.abs(a - last) <= 4);
  idx.push(near.length ? pick(near) : APPROACH.reduce((a, b) => (Math.abs(b - last) < Math.abs(a - last) ? b : a)));
  idx.push(HOME);
  return idx.map((i) => MUSIC_BOX_NOTES[i]!);
}

// ----------------------------------------------------------------------------------- schedules

/** A lock opening: the glass tick at once, the brass clunk at +120 ms, the lock's note at +200 ms. */
export function scheduleLockOpen(lock: number, atMs: number, key: string = KEY): Scheduled[] {
  return [
    { id: "glass_tick", atMs: atMs + LOCK_OPEN_MS.tick },
    { id: "brass_clunk", atMs: atMs + LOCK_OPEN_MS.clunk },
    { id: noteFor(lock, key), atMs: atMs + LOCK_OPEN_MS.note },
  ];
}

/**
 * The box opening, in time order: the chord resolves (G4 B4 D5 G5 rolled 80 ms apart from +500 ms),
 * the walls hinge open at +700, the drawer slides out at +1300, and the box's tune plays in eighth
 * notes from +1700, each note dipping the music TUNE_DUCK_DB (the notes ring on into the next, so
 * their dips join into one, from the first note until the last has rung).
 */
export function scheduleBoxOpen(seed: string, atMs: number): Scheduled[] {
  const out: Scheduled[] = RESOLVE_CHORD.map((id, i) => ({ id, atMs: atMs + BOX_OPEN_MS.chord + i * BOX_OPEN_MS.chordStep }));
  out.push({ id: "walls_hinge", atMs: atMs + BOX_OPEN_MS.walls }, { id: "drawer_slide", atMs: atMs + BOX_OPEN_MS.drawer });
  tuneFor(seed).forEach((id, i) => out.push({ id, atMs: atMs + BOX_OPEN_MS.tune + i * EIGHTH_MS, duckDb: TUNE_DUCK_DB }));
  return out.sort((a, b) => a.atMs - b.atMs);
}
