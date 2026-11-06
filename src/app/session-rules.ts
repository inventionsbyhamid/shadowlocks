// The box session's rules that need no frame: a lock's state in play, what a solved box does to the profile, what it
// adds to the collection, which lock a hint is for, and which lock a gaze ray picks on the panel. Pure apart from the
// profile they are handed.
import { recordDailySolve } from "../core/daily";
import { ENVELOPE } from "../core/envelope";
import { GENERATOR_VERSION, seedKey } from "../core/generator";
import type { BoxSnapshot, Profile } from "../core/profile";
import type { Coverage, LockSamples } from "../core/solve";
import type { Box, BoxSpec, Lock, V3 } from "../core/types";

/** A lock of the box in play: its samples and this frame's coverage, made once per box. */
export class LockState {
  readonly cov: Coverage = { cover: 0, spill: 0, spillAll: 0, gap: 0 };
  open = false;
  /** A finger lock whose piece has formed: open for good, its celebration once the piece is there. */
  done = false;
  meets = false;
  meetMs = 0;
  /** Warmth now (unsmoothed), its eased value for the hum, and the last value sent on the bus. */
  w = 0;
  smooth = 0;
  sentW = -1;
  ring = false;
  crystalZ = Number.NaN;
  openInMs = -1;
  constructor(readonly lock: Lock, readonly samples: LockSamples) {}
}

/**
 * The save of a box still being built: a resumed box's own save (a copy), else a fresh one with the lantern at the
 * start (on the left for a left-handed player).
 */
export function loadingSnapshot(spec: BoxSpec | null, snap: BoxSnapshot | null, left: boolean): BoxSnapshot {
  if (snap) return { ...snap, lantern: [snap.lantern[0], snap.lantern[1], snap.lantern[2]], open: [...snap.open], crystal: snap.crystal.map((c) => ({ ...c })), hintLevel: { ...snap.hintLevel } };
  const key = spec && spec.kind !== "lesson" ? seedKey(spec) : "";
  return {
    key,
    gen: GENERATOR_VERSION,
    mirrored: left,
    lantern: [ENVELOPE.START[0] * (left ? -1 : 1), ENVELOPE.START[1], ENVELOPE.START[2]],
    open: [],
    crystal: [],
    elapsedMs: 0,
    hints: 0,
    hintLevel: {},
  };
}

/** The lock a hint is for: the one in focus if it is still closed, else the warmest closed one, else -1. */
export function hintTargetOf(locks: readonly { readonly lock: Lock; readonly done: boolean; readonly w: number }[], focused: number | null): number {
  if (focused !== null && locks[focused] && !locks[focused]!.done) return focused;
  let best = -1, w = -1;
  for (const s of locks) {
    if (s.done || s.w <= w) continue;
    w = s.w;
    best = s.lock.i;
  }
  return best;
}

/** The head's gaze picks a lock within this share of its size from its centre (between locks it picks none). */
export const GAZE_REACH = 0.62;

/**
 * A box was solved (it opens): a numbered box moves the next box on (never back: replaying an earlier box changes
 * nothing) and clears the box in progress; a Daily Box records the day (the streak counts a day once) and clears the
 * daily box in progress.
 */
export function solveBox(p: Profile, spec: BoxSpec): void {
  if (spec.kind === "box") {
    if (p.nextBox < spec.n + 1) p.nextBox = spec.n + 1;
    p.current = null;
  } else if (spec.kind === "daily") {
    p.daily = { ...recordDailySolve(p, spec.day).daily, current: null };
  }
}

/** The box's reward goes into the collection (once: a box already there is not added again). */
export function collect(p: Profile, box: Box, atMs: number, timeMs: number, hints: number): void {
  if (p.collection.some((c) => c.key === box.key)) return;
  p.collection.push({ key: box.key, owner: box.owner, loot: box.loot, shapes: box.locks.map((l) => l.shape), atMs, timeMs, hints });
}

/**
 * The closed lock whose outline the ray from `o` along `dir` (box units) meets on the panel: the nearest centre within
 * GAZE_REACH of its size, or null (looking away, between locks, or at an open lock). Allocation-free.
 */
export function lockOnPanel(locks: readonly { readonly lock: Lock; readonly open: boolean }[], o: V3, dir: V3): number | null {
  if (!(dir[2] < 0) || !(o[2] > 0)) return null;
  const t = -o[2] / dir[2];
  const x = o[0] + dir[0] * t, y = o[1] + dir[1] * t;
  let best = -1, bd = Number.POSITIVE_INFINITY;
  for (let i = 0; i < locks.length; i++) {
    if (locks[i]!.open) continue;
    const l = locks[i]!.lock;
    const dx = x - l.center[0], dy = y - l.center[1];
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r <= l.size * GAZE_REACH && r < bd) {
      bd = r;
      best = l.i;
    }
  }
  return best < 0 ? null : best;
}
