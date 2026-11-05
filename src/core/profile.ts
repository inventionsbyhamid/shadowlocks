// The player's profile as stored on the device: settings and the box in progress. Task 7 grows it
// (first launch, lessons, collection, daily streak); the loader's style stays: every field is
// checked, clamped or defaulted, so a damaged or older save never stops the game from starting.
import type { Vec3 } from "./types";

export interface Settings {
  /** Panel glow and hums that grow as a lock gets close. */
  warmth: boolean;
  /** Box size in cm (the box scales around its back panel). */
  boxSizeCm: number;
  musicVol: number;
  sfxVol: number;
  reducedMotion: boolean;
  captions: boolean;
  /** Dim the room around the box while playing. */
  dimming: boolean;
  handed: "right" | "left";
}

/** A box in progress as saved: enough to put the lantern, open locks and finger pieces back. */
export interface BoxSnapshot {
  /** Which box (numbered or daily); the generator rebuilds it from this. */
  key: string;
  /** Lantern position in box units. */
  lantern: Vec3;
  /** Indexes of the open locks. */
  open: number[];
  /** Pieces a finger cast, by lock, at their depth in box units. */
  crystal: { lock: number; z: number }[];
  /** Play time so far (time while hidden does not count). */
  elapsedMs: number;
  hints: number;
  /** Hint level reached, by lock. */
  hintLevel: Record<number, number>;
}

export interface Profile {
  version: 1;
  settings: Settings;
  inProgress: BoxSnapshot | null;
}

export const BOX_SIZE_CM = { min: 18, max: 30, default: 24 } as const;

export function defaultSettings(): Settings {
  return {
    warmth: true,
    boxSizeCm: BOX_SIZE_CM.default,
    musicVol: 0.7,
    sfxVol: 0.9,
    reducedMotion: false,
    captions: true,
    dimming: true,
    handed: "right",
  };
}

export function defaultProfile(): Profile {
  return { version: 1, settings: defaultSettings(), inProgress: null };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNat = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const clampNum = (v: unknown, lo: number, hi: number, d: number): number => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** The real shape of a saved box: anything else (an old or damaged save) is dropped, never half restored. */
export function isSnapshot(v: unknown): v is BoxSnapshot {
  return (
    isRec(v) &&
    typeof v.key === "string" &&
    v.key.length > 0 &&
    Array.isArray(v.lantern) &&
    v.lantern.length === 3 &&
    v.lantern.every(isNum) &&
    Array.isArray(v.open) &&
    v.open.every(isNat) &&
    Array.isArray(v.crystal) &&
    v.crystal.every((c) => isRec(c) && isNat(c.lock) && isNum(c.z)) &&
    isNum(v.elapsedMs) &&
    v.elapsedMs >= 0 &&
    isNat(v.hints) &&
    isRec(v.hintLevel) &&
    Object.entries(v.hintLevel).every(([k, n]) => /^\d+$/.test(k) && isNat(n))
  );
}

/** Any stored value to a valid profile: unknown versions start fresh, bad fields fall back to defaults. */
export function migrate(raw: unknown): Profile {
  const d = defaultProfile();
  if (!isRec(raw) || raw.version !== 1) return d;
  const s = isRec(raw.settings) ? raw.settings : {};
  const ds = d.settings;
  const settings: Settings = {
    warmth: bool(s.warmth, ds.warmth),
    boxSizeCm: clampNum(s.boxSizeCm, BOX_SIZE_CM.min, BOX_SIZE_CM.max, ds.boxSizeCm),
    musicVol: clampNum(s.musicVol, 0, 1, ds.musicVol),
    sfxVol: clampNum(s.sfxVol, 0, 1, ds.sfxVol),
    reducedMotion: bool(s.reducedMotion, ds.reducedMotion),
    captions: bool(s.captions, ds.captions),
    dimming: bool(s.dimming, ds.dimming),
    handed: s.handed === "left" ? "left" : "right",
  };
  return { version: 1, settings, inProgress: isSnapshot(raw.inProgress) ? raw.inProgress : null };
}
