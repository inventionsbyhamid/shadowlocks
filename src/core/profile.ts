// The player's profile as stored on the device: the first-launch marker, the box reached and the one in
// progress, lessons, tips, the collection, the daily streak and settings. The loader checks, clamps or
// defaults every field on its own, so a damaged or older save never stops the game from starting and one
// bad field never costs the rest. Times are wall-clock ms since the epoch, always passed in.
import type { ShapeName, V3 } from "./types";

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
  /**
   * The generator version (GENERATOR_VERSION) the box was played under. A box saved under another one (or
   * none) is regenerated from its key and started afresh: its lantern, open locks and pieces belong to a box
   * that may have changed.
   */
  gen?: number;
  /** Lantern position in box units. */
  lantern: V3;
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

/** Just-in-time tips, shown the first time they matter. */
export type TipId = "decoys" | "ringless" | "hidden" | "drawer";

/** A solved box's reward in the collection. */
export interface CollectionItem {
  key: string;
  owner: string;
  loot: string;
  shapes: ShapeName[];
  /** When it was solved. */
  atMs: number;
  /** Play time it took. */
  timeMs: number;
  hints: number;
}

export interface Profile {
  version: 1;
  /** Written on the first launch and never changed: the paywall update reads an early build as "owned". */
  firstLaunch: { atMs: number; build: string };
  /** The latest time this profile has seen, so a clock moved back cannot win back trial days. */
  lastSeenMs: number;
  /** The numbered box to play next (1 until box 1 is solved). */
  nextBox: number;
  /** The numbered box in progress. */
  current: BoxSnapshot | null;
  /** Lessons finished, and the step a lesson in progress resumes at. */
  lessons: { l1: boolean; l2: boolean; step: { id: "l1" | "l2"; index: number } | null };
  tipsSeen: TipId[];
  collection: CollectionItem[];
  /** The Daily Box: the streak, the last day solved (YYYY-MM-DD, local) and the daily box in progress. */
  daily: { streak: number; best: number; lastDay: string | null; current: BoxSnapshot | null };
  settings: Settings;
}

export const BOX_SIZE_CM = { min: 18, max: 30, default: 24 } as const;

const TIPS: Record<TipId, true> = { decoys: true, ringless: true, hidden: true, drawer: true };
const SHAPE_NAMES: Record<ShapeName, true> = {
  Key: true,
  Star: true,
  Moon: true,
  Diamond: true,
  Crown: true,
  Arrow: true,
  Hourglass: true,
  Cat: true,
  Bird: true,
  Teapot: true,
};

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

/** A first launch at `nowMs` on `build`: box 1, nothing played yet. */
export function newProfile(nowMs: number, build: string): Profile {
  return {
    version: 1,
    firstLaunch: { atMs: nowMs, build },
    lastSeenMs: nowMs,
    nextBox: 1,
    current: null,
    lessons: { l1: false, l2: false, step: null },
    tipsSeen: [],
    collection: [],
    daily: { streak: 0, best: 0, lastDay: null, current: null },
    settings: defaultSettings(),
  };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNat = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isTime = (v: unknown): v is number => isNum(v) && v >= 0;
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const clampNum = (v: unknown, lo: number, hi: number, d: number): number => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : d);
const nat = (v: unknown): number => (isNat(v) ? v : 0);
const has = <K extends string>(set: Record<K, true>, v: unknown): v is K => typeof v === "string" && Object.hasOwn(set, v);

/** A real calendar day as `YYYY-MM-DD`. */
export function isDayKey(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** The real shape of a saved box: anything else (an old or damaged save) is dropped, never half restored. */
export function isSnapshot(v: unknown): v is BoxSnapshot {
  return (
    isRec(v) &&
    typeof v.key === "string" &&
    v.key.length > 0 &&
    (v.gen === undefined || isNat(v.gen)) &&
    Array.isArray(v.lantern) &&
    v.lantern.length === 3 &&
    v.lantern.every(isNum) &&
    Array.isArray(v.open) &&
    v.open.every(isNat) &&
    Array.isArray(v.crystal) &&
    v.crystal.every((c) => isRec(c) && isNat(c.lock) && isNum(c.z)) &&
    isTime(v.elapsedMs) &&
    isNat(v.hints) &&
    isRec(v.hintLevel) &&
    Object.entries(v.hintLevel).every(([k, n]) => /^\d+$/.test(k) && isNat(n))
  );
}

/** A saved box with only its own fields (extra stored keys are not carried along), or null. */
function snapshotFrom(v: unknown): BoxSnapshot | null {
  if (!isSnapshot(v)) return null;
  const hintLevel: Record<number, number> = {};
  for (const [k, n] of Object.entries(v.hintLevel)) hintLevel[Number(k)] = n;
  return {
    key: v.key,
    ...(v.gen === undefined ? {} : { gen: v.gen }),
    lantern: [v.lantern[0], v.lantern[1], v.lantern[2]],
    open: [...v.open],
    crystal: v.crystal.map((c) => ({ lock: c.lock, z: c.z })),
    elapsedMs: v.elapsedMs,
    hints: v.hints,
    hintLevel,
  };
}

function collectionItemFrom(v: unknown): CollectionItem | null {
  if (!isRec(v)) return null;
  const { key, owner, loot, shapes, atMs, timeMs, hints } = v;
  if (typeof key !== "string" || key.length === 0 || typeof owner !== "string" || typeof loot !== "string") return null;
  if (!Array.isArray(shapes) || !isTime(atMs) || !isTime(timeMs) || !isNat(hints)) return null;
  return { key, owner, loot, shapes: shapes.filter((s): s is ShapeName => has(SHAPE_NAMES, s)), atMs, timeMs, hints };
}

/** Settings from any stored value: each field clamped to its range or set to its default. */
export function settingsFrom(raw: unknown): Settings {
  const s = isRec(raw) ? raw : {};
  const d = defaultSettings();
  return {
    warmth: bool(s.warmth, d.warmth),
    boxSizeCm: clampNum(s.boxSizeCm, BOX_SIZE_CM.min, BOX_SIZE_CM.max, d.boxSizeCm),
    musicVol: clampNum(s.musicVol, 0, 1, d.musicVol),
    sfxVol: clampNum(s.sfxVol, 0, 1, d.sfxVol),
    reducedMotion: bool(s.reducedMotion, d.reducedMotion),
    captions: bool(s.captions, d.captions),
    dimming: bool(s.dimming, d.dimming),
    handed: s.handed === "left" ? "left" : "right",
  };
}

/**
 * Any stored value to a valid profile, loaded at `nowMs` by `build`. Anything that is not a version 1
 * profile starts fresh; a missing or broken first-launch marker is written now. `lastSeenMs` becomes the
 * latest of the stored value, the first launch and `nowMs`, so it never moves back.
 */
export function migrate(raw: unknown, nowMs: number, build: string): Profile {
  if (!isRec(raw) || raw.version !== 1) return newProfile(nowMs, build);
  const fl = raw.firstLaunch;
  const firstLaunch =
    isRec(fl) && isTime(fl.atMs) && typeof fl.build === "string" && fl.build.length > 0
      ? { atMs: fl.atMs, build: fl.build }
      : { atMs: nowMs, build };
  const lastSeenMs = Math.max(isTime(raw.lastSeenMs) ? raw.lastSeenMs : 0, firstLaunch.atMs, isNum(nowMs) ? nowMs : 0);

  const ls = isRec(raw.lessons) ? raw.lessons : {};
  const st = isRec(ls.step) ? ls.step : {};
  const step: Profile["lessons"]["step"] = (st.id === "l1" || st.id === "l2") && isNat(st.index) ? { id: st.id, index: st.index } : null;

  const tipsSeen: TipId[] = [];
  for (const t of Array.isArray(raw.tipsSeen) ? raw.tipsSeen : []) if (has(TIPS, t) && !tipsSeen.includes(t)) tipsSeen.push(t);

  const collection: CollectionItem[] = [];
  for (const v of Array.isArray(raw.collection) ? raw.collection : []) {
    const item = collectionItemFrom(v);
    if (item) collection.push(item);
  }

  const dr = isRec(raw.daily) ? raw.daily : {};
  const streak = nat(dr.streak);

  return {
    version: 1,
    firstLaunch,
    lastSeenMs,
    nextBox: isNat(raw.nextBox) && raw.nextBox >= 1 ? raw.nextBox : 1,
    current: snapshotFrom(raw.current),
    lessons: { l1: bool(ls.l1, false), l2: bool(ls.l2, false), step },
    tipsSeen,
    collection,
    daily: {
      streak,
      best: Math.max(nat(dr.best), streak),
      lastDay: isDayKey(dr.lastDay) ? dr.lastDay : null,
      current: snapshotFrom(dr.current),
    },
    settings: settingsFrom(raw.settings),
  };
}

/**
 * The profile with its progress started over (Settings, Reset progress): boxes, the box in
 * progress, lessons, tips, the collection and the Daily Box with its streak. Settings stay, and so
 * do the first-launch marker and the latest time seen: a reset never gives back trial days.
 */
export function withProgressReset(p: Readonly<Profile>): Profile {
  const fresh = newProfile(p.firstLaunch.atMs, p.firstLaunch.build);
  return { ...fresh, firstLaunch: { ...p.firstLaunch }, lastSeenMs: p.lastSeenMs, settings: { ...p.settings } };
}
