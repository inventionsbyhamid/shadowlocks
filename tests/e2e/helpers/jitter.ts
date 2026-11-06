/* eslint-disable @typescript-eslint/no-explicit-any */
// The jitter bot: a careful player whose hand shakes, drifts as it lets go and drops out of tracking now and then,
// playing the box session through IWER's emulated hand (or controller), so the feel layer's assists (the speed gate,
// the settle, the ring line lock, the release lookback) are proven under the conditions they exist for.
//
// - withJitter(dispatch, opts) wraps IWER's remote dispatch: every hand position the bot sets is off by up to
//   `noiseMm` on each axis (a new uniform draw every frame), opening a pinch drags the hand `releaseDriftCm` in a
//   random direction, and every `dropoutEverySec` the hand is out of tracking for `dropoutMs`.
// - approachPlan and sweepPlan are the bot's paths (box units): the careful approach (to 3 cm short of the spot at
//   10 cm/s, then 2 cm/s) and the fast sweeps (15-30 cm/s back and forth through the spots).
// - Bot drives one hand (or controller) frame by frame from the page: a per-frame driver set before every step of the
//   virtual clock moves it along queued legs through withJitter. botSolve plays a box with it: each plain lock by the
//   careful approach and a release, each finger lock by the lantern on its spot and the index finger laid in its gap
//   at depth 0.45 and held there.
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import type { SlFingerLock, SlLantern, SlLock, SlSessionState } from "../../../src/app/test-api";
import type { BoxSpec, V2, V3, Vec3 } from "../../../src/core/types";
import { axisOf, ControllerFinger, onRay, Pointer } from "./finger";
import { addRunNote, DT, XrApp } from "./xr-app";

// --- The jitter ---------------------------------------------------------------------------------------------------

/** IWER's remote dispatch (`IWER_DEVICE.remote.dispatch`), or anything shaped like it. */
export type Dispatch = (method: string, params: Record<string, any>) => Promise<unknown>;

export interface JitterOptions {
  /** Each position set is off by up to this on every axis (mm; uniform, a new draw every command). */
  noiseMm: number;
  /** Opening a pinch from closed drags the hand this far (cm; drawn from the range), in a random direction... */
  releaseDriftCm: [number, number];
  /**
   * ...over this long from the first opening command (ms, default 150). It stays while the hand is held where it let go,
   * and ends with the next pinch or as soon as the hand is sent anywhere else (the next gesture is aimed afresh).
   */
  releaseDriftMs?: number;
  /** The hand is out of tracking this long (ms)... */
  dropoutMs: number;
  /** ...once every this many seconds (the first at a random time in the first period). */
  dropoutEverySec: number;
  seed: number;
  /** The clock (ms); the page's performance.now (the virtual clock in tests) when not given. */
  now?: () => number;
}

export interface Jittered {
  /** Pass every command through this instead of IWER's dispatch. */
  dispatch: Dispatch;
  /** Once a frame, before it is stepped: starts and ends the tracking dropouts. */
  tick(): void;
  /** The moved devices are out of tracking now. */
  readonly lost: boolean;
  /** Dropouts so far, each release drift's length (cm), and the dropout commands IWER refused. */
  readonly stats: { dropouts: number; drifts: number[]; errors: string[] };
}

/** A tracked hand (Quest hand tracking): 3 mm of noise, 1-1.5 cm of drift opening a pinch, 200 ms lost every 10 s. */
export const HAND_JITTER: Omit<JitterOptions, "seed"> = { noiseMm: 3, releaseDriftCm: [1, 1.5], dropoutMs: 200, dropoutEverySec: 10 };
/**
 * A Touch controller: tracked to well under a millimetre, so the noise is the hand's own tremor (1 mm); pulling or
 * letting go of the trigger tips the controller a few millimetres (0.3-0.6 cm); the same dropouts as a hand (a
 * controller rarely loses tracking: this is harsher than life).
 */
export const CONTROLLER_JITTER: Omit<JitterOptions, "seed"> = { noiseMm: 1, releaseDriftCm: [0.3, 0.6], dropoutMs: 200, dropoutEverySec: 10 };

/**
 * IWER's remote dispatch with a real hand's imperfections (see JitterOptions). A device counts as moved once a
 * `set_transform` or `animate_to` with a position names it; only moved devices drop out. While they are out, their
 * transforms and pinch values are kept, not sent; coming back sends the pinch, then `set_connected`, then the latest
 * transform. Self-contained: the page evaluates this function's source, so it uses nothing outside itself.
 */
export function withJitter(dispatch: Dispatch, opts: JitterOptions): Jittered {
  let seed = opts.seed >>> 0 || 1;
  const rnd = (): number => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const now = opts.now ?? (() => performance.now());
  const noiseM = opts.noiseMm / 1000;
  const driftMs = opts.releaseDriftMs ?? 150;
  const periodMs = opts.dropoutEverySec * 1000;
  const moved = new Set<string>();
  const pinch: Record<string, number> = {};
  /** A release drift per device: when it started, its full offset, and where the hand was asked to be then. */
  const drift: Record<string, { t0: number; v: [number, number, number]; at: number[] | null } | null> = {};
  const xyz = (p: any): number[] => (Array.isArray(p) ? [p[0], p[1], p[2]] : [p.x, p.y, p.z]);
  const last: Record<string, { method: string; params: Record<string, any> }> = {};
  const stats = { dropouts: 0, drifts: [] as number[], errors: [] as string[] };
  let lost = false;
  let lostUntil = 0;
  let nextDrop = Number.NaN;

  const send = (method: string, params: Record<string, any>): Promise<unknown> => {
    const p = params.position;
    const d = drift[params.device];
    const k = d ? (driftMs > 0 ? Math.min(1, (now() - d.t0) / driftMs) : 1) : 0;
    const arr = Array.isArray(p);
    const q = [arr ? p[0] : p.x, arr ? p[1] : p.y, arr ? p[2] : p.z];
    for (let i = 0; i < 3; i++) q[i] = q[i] + (d ? d.v[i]! * k : 0) + noiseM * (2 * rnd() - 1);
    return dispatch(method, { ...params, position: arr ? q : { x: q[0], y: q[1], z: q[2] } });
  };
  const quiet = (method: string, params: Record<string, any>): void => {
    dispatch(method, params).catch((e: any) => stats.errors.push(`${method}: ${e?.message ?? e}`));
  };

  return {
    stats,
    get lost() {
      return lost;
    },
    dispatch(method, params) {
      const device = params && typeof params.device === "string" ? (params.device as string) : null;
      if (device && params.position && (method === "set_transform" || method === "animate_to")) {
        moved.add(device);
        const d = drift[device];
        if (d) {
          const q = xyz(params.position);
          if (!d.at) d.at = q;
          else if (Math.abs(q[0]! - d.at[0]!) + Math.abs(q[1]! - d.at[1]!) + Math.abs(q[2]! - d.at[2]!) > 1e-9) drift[device] = null;
        }
        if (method === "set_transform") last[device] = { method, params };
        return lost ? Promise.resolve(null) : send(method, params);
      }
      if (device && method === "set_select_value") {
        const prev = pinch[device] ?? 0;
        const v = params.value as number;
        if (prev >= 0.99 && v < prev) {
          // The fingers start to open: the pinch point drags off in some direction.
          let x = 0, y = 0, z = 0, n = 0;
          do {
            x = 2 * rnd() - 1;
            y = 2 * rnd() - 1;
            z = 2 * rnd() - 1;
            n = Math.hypot(x, y, z);
          } while (n < 1e-3 || n > 1);
          const [lo, hi] = opts.releaseDriftCm;
          const cm = lo + (hi - lo) * rnd();
          const held = last[device];
          drift[device] = {
            t0: now(),
            v: [(x / n) * cm * 0.01, (y / n) * cm * 0.01, (z / n) * cm * 0.01],
            at: held ? xyz(held.params.position) : null,
          };
          stats.drifts.push(cm);
        } else if (prev <= 0.01 && v > prev) {
          drift[device] = null;
        }
        pinch[device] = v;
        if (lost && moved.has(device)) return Promise.resolve(null);
      }
      return dispatch(method, params);
    },
    tick() {
      const t = now();
      if (!(periodMs > 0 && Number.isFinite(periodMs))) return;
      if (nextDrop !== nextDrop) nextDrop = t + periodMs * (1 - rnd());
      if (!lost) {
        if (t < nextDrop) return;
        while (nextDrop <= t) nextDrop += periodMs;
        if (!moved.size) return;
        lost = true;
        lostUntil = t + opts.dropoutMs;
        stats.dropouts++;
        for (const d of moved) quiet("set_connected", { device: d, connected: false });
      } else if (t >= lostUntil) {
        lost = false;
        for (const d of moved) {
          quiet("set_select_value", { device: d, value: pinch[d] ?? 0 });
          quiet("set_connected", { device: d, connected: true });
          const l = last[d];
          if (l) send(l.method, l.params).catch((e: any) => stats.errors.push(`${l.method}: ${e?.message ?? e}`));
        }
      }
    },
  };
}

// --- Paths --------------------------------------------------------------------------------------------------------

/** One straight leg of a path: to `to` at `cmps` centimetres a second. */
export interface Leg {
  to: V3;
  cmps: number;
}

/** The careful player (the plan's model): to 3 cm short of the spot at 10 cm/s, then the rest at 2 cm/s. */
export const CAREFUL = { shortCm: 3, fastCmps: 10, slowCmps: 2 } as const;
export type ApproachOptions = Partial<{ -readonly [K in keyof typeof CAREFUL]: number }>;

const dist3 = (a: Readonly<V3>, b: Readonly<V3>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp3 = (a: Readonly<V3>, b: Readonly<V3>, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The careful approach from `from` to `to` (box units; `cmPerUnit` centimetres to a unit), straight. */
export function approachPlan(from: V3, to: V3, cmPerUnit: number, o: ApproachOptions = {}): Leg[] {
  const { shortCm, fastCmps, slowCmps } = { ...CAREFUL, ...o };
  const end: V3 = [to[0], to[1], to[2]];
  const cm = dist3(from, to) * cmPerUnit;
  if (cm <= shortCm) return [{ to: end, cmps: slowCmps }];
  return [
    { to: lerp3(from, to, (cm - shortCm) / cm), cmps: fastCmps },
    { to: end, cmps: slowCmps },
  ];
}

/** How long `legs` take from `from` (ms). */
export function pathMs(from: V3, legs: readonly Leg[], cmPerUnit: number): number {
  let ms = 0, p = from;
  for (const l of legs) {
    ms += ((dist3(p, l.to) * cmPerUnit) / l.cmps) * 1000;
    p = l.to;
  }
  return ms;
}

export interface SweepOptions {
  seed: number;
  cmPerUnit: number;
  /** Sweep at least this long (ms). */
  totalMs: number;
  /** Speeds are drawn from this range (cm/s; default 15-30). */
  cmps?: [number, number];
  /** A sweep runs up to this far either side of the point it passes (cm, default 8)... */
  halfCm?: number;
  /** ...which is within this of a spot (cm, default 1). */
  passCm?: number;
  /** It turns no nearer than this to any spot (cm, default 4: well outside the settle radius)... */
  awayCm?: number;
  /** ...nor further than this outside the spots' bounds (cm, default 8), nor deeper than this (box z, default 1.02). */
  marginCm?: number;
  minZ?: number;
}

/** A seeded random number source in [0, 1) (mulberry32). */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random direction (uniform on the sphere), scaled by `r`, or by up to `r` with `inside`. */
function randomDir(rnd: () => number, r = 1, inside = false): V3 {
  for (;;) {
    const v: V3 = [2 * rnd() - 1, 2 * rnd() - 1, 2 * rnd() - 1];
    const n = Math.hypot(v[0], v[1], v[2]);
    if (n > 1 || n < 1e-3) continue;
    const k = inside ? r : r / n;
    return [v[0] * k, v[1] * k, v[2] * k];
  }
}

/**
 * Fast sweeps for `totalMs` from `start` (box units): each one comes to its start point (a leg at sweep speed too),
 * then runs straight through a point within `passCm` of a random spot, in a random direction, to its end. Every turn
 * stays `awayCm` from every spot, inside the spots' bounds widened by `marginCm` and in front of `minZ`. `sweeps` names
 * each sweep's spot and the index of its leg through it.
 */
export function sweepPlan(start: V3, spots: readonly V3[], o: SweepOptions): { legs: Leg[]; sweeps: { spot: number; leg: number }[] } {
  const rnd = random(o.seed);
  const u = 1 / o.cmPerUnit;
  const [vLo, vHi] = o.cmps ?? [15, 30];
  const half = (o.halfCm ?? 8) * u, pass = (o.passCm ?? 1) * u, away = (o.awayCm ?? 4) * u, margin = (o.marginCm ?? 8) * u;
  const minZ = o.minZ ?? 1.02;
  const lo: V3 = [Infinity, Infinity, minZ], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of spots) {
    for (let i = 0; i < 3; i++) {
      if (i < 2) lo[i] = Math.min(lo[i]!, s[i]! - margin);
      hi[i] = Math.max(hi[i]!, s[i]! + margin);
    }
  }
  /** How far from p along d (unit) the path may go: up to `half`, inside the bounds. */
  const reach = (p: V3, d: V3): number => {
    let s = half;
    for (let i = 0; i < 3; i++) {
      if (d[i]! > 1e-12) s = Math.min(s, (hi[i]! - p[i]!) / d[i]!);
      else if (d[i]! < -1e-12) s = Math.min(s, (lo[i]! - p[i]!) / d[i]!);
    }
    return Math.max(0, s);
  };
  const clear = (q: V3) => spots.every((s) => dist3(q, s) >= away);
  const legs: Leg[] = [];
  const sweeps: { spot: number; leg: number }[] = [];
  let at = start, ms = 0;
  while (ms < o.totalMs) {
    let found: { spot: number; a: V3; b: V3 } | null = null;
    for (let tries = 0; tries < 500 && !found; tries++) {
      const spot = Math.floor(rnd() * spots.length);
      const off = randomDir(rnd, pass * Math.cbrt(rnd()), true);
      const p: V3 = [spots[spot]![0] + off[0], spots[spot]![1] + off[1], spots[spot]![2] + off[2]];
      const d = randomDir(rnd);
      const back: V3 = [-d[0], -d[1], -d[2]];
      const a = lerp3(p, [p[0] + back[0], p[1] + back[1], p[2] + back[2]], reach(p, back));
      const b = lerp3(p, [p[0] + d[0], p[1] + d[1], p[2] + d[2]], reach(p, d));
      if (clear(a) && clear(b)) found = { spot, a, b };
    }
    if (!found) throw new Error("sweepPlan: no sweep fits these spots");
    const speed = () => vLo + (vHi - vLo) * rnd();
    const into = { to: found.a, cmps: speed() }, through = { to: found.b, cmps: speed() };
    ms += pathMs(at, [into, through], o.cmPerUnit);
    legs.push(into, through);
    sweeps.push({ spot: found.spot, leg: legs.length - 1 });
    at = found.b;
  }
  return { legs, sweeps };
}

// --- The bot ------------------------------------------------------------------------------------------------------

export type BotInput = "hands" | "controllers";

export interface BotOptions {
  input?: BotInput;
  /** The jitter (HAND_JITTER or CONTROLLER_JITTER by default, seed 1); null for none. */
  jitter?: Partial<JitterOptions> | null;
  /** The careful approach (CAREFUL by default). */
  careful?: ApproachOptions;
  /** How deep the finger lies in the beam on a finger lock (box z, default 0.45). */
  fingerDepth?: number;
}

/** How one lock went. */
export interface LockResult {
  lock: number;
  finger: boolean;
  open: boolean;
  /** Careful approaches it took (a careful player tries again when the lock stays shut). */
  attempts: number;
  /** Pinches it took to pick the lantern up, over all attempts (a dropout can swallow one). */
  grabs: number;
  /** Whether the lantern had settled onto the spot when the hand let go, per attempt. */
  settled: boolean[];
  /** How far the lantern came to rest from the spot after the last release (mm). */
  restMm: number;
  /** Finger locks: how many times the finger was laid. */
  lays: number;
  /**
   * Finger locks, per lay: how far off the laid finger ended (mm from the gap's line, degrees), and its hold: frames
   * held, frames meeting the rule, frames with no finger shadow, best progress, mean and least gap filled, most spill.
   */
  holds?: { offMm: number; deg: number; frames: number; meets: number; noFinger: number; progress: number; gap: number; gapMin: number; spillAll: number; coverMin: number }[];
  /** Virtual ms from starting on this lock until it opened (or gave up). */
  ms: number;
  /** Why it could not be tried, when it could not. */
  blocked?: string;
}

export interface BotResult {
  key: string;
  solved: boolean;
  /** Virtual ms from the box in play to its last lock open (or to giving up). */
  ms: number;
  locks: LockResult[];
  /** Tracking dropouts during the box. */
  dropouts: number;
  /** Frames stepped for the box and the real ms they took on the server (what the e2e budget pays). */
  frames: number;
  realMs: number;
}

const add = (a: Readonly<Vec3>, b: Readonly<Vec3>, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The fingers close (or open) over this long (ms); the jitter's release drift runs while they open. */
const PINCH_MS = 120;
/** The hand reaches for the lantern at this speed (cm/s), the last 4 cm at REACH_SLOW_CMPS; it leaves at AWAY_CMPS. */
const REACH_CMPS = 25;
const REACH_SLOW_CMPS = 10;
const AWAY_CMPS = 20;
/** Pinches before giving up on picking the lantern up; careful approaches before giving up on a lock. */
const GRAB_TRIES = 4;
const LOCK_TRIES = 3;
/** A released lantern on the spot opens its lock well within this (ms: OPEN_DWELL_MS is 100). */
const OPEN_WAIT_MS = 1500;
/** A laid finger opens its lock within this (ms: a 600 ms hold, the piece forming 700 ms, dropouts restarting it). */
const FINGER_WAIT_MS = 5000;
const FINGER_LAYS = 2;

/**
 * Page script: the bot's hand, moved before every frame of the virtual clock while `driving`. It goes along queued
 * legs (world metres) at their speeds, holds still (shaking) between them, and ramps its pinch; every command goes
 * through withJitter (its source in `cfg.src`). Installs once per page; a second call starts over with `cfg`.
 */
function pageBot(cfg: { src: string; jitter: JitterOptions | null; device: string; anchor: string | null }): void {
  const w = window as any;
  const remote = w.IWER_DEVICE.remote;
  const raw = (m: string, p: Record<string, unknown>) => remote.dispatch(m, p) as Promise<unknown>;
  const jit = cfg.jitter
    ? (0, eval)(`(${cfg.src})`)(raw, { ...cfg.jitter, now: () => w.__vt.now })
    : { dispatch: raw, tick() {}, lost: false, stats: { dropouts: 0, drifts: [], errors: [] } };
  const errors: string[] = [];
  const fire = (m: string, p: Record<string, unknown>) => {
    jit.dispatch(m, p).catch((e: any) => errors.push(`${m}: ${e?.message ?? e}`));
  };
  const bot: any = {
    jit,
    errors,
    device: cfg.device,
    anchor: cfg.anchor,
    driving: false,
    /** The commanded position (world), before the jitter. */
    pos: null as number[] | null,
    /** Sent with every transform while set (hand directions); `once` with the next one only. */
    orient: undefined as unknown,
    once: undefined as unknown,
    legs: [] as { to: number[]; cmps: number }[],
    leg: null as null | { from: number[]; to: number[]; t0: number; dur: number },
    sel: 0,
    ramp: null as null | { from: number; to: number; t0: number; dur: number },
    /** While set: the lantern's closest approach to each of `spots` (box units), kept in `min`. */
    watch: null as null | { spots: number[][]; min: number[] },
    /** While set: a finger lock's hold, frame by frame (frames, meeting, the hold's best progress, gap and spill). */
    hold: null as null | Record<string, number>,
    idle() {
      return !bot.leg && bot.legs.length === 0 && !bot.ramp;
    },
    stop() {
      bot.legs = [];
      bot.leg = null;
      bot.ramp = null;
    },
    frame() {
      const t = w.__vt.now as number;
      jit.tick();
      if (bot.watch) {
        const L = w.__sl.lantern().pos, W = bot.watch;
        for (let i = 0; i < W.spots.length; i++) {
          const s = W.spots[i];
          W.min[i] = Math.min(W.min[i], Math.hypot(L[0] - s[0], L[1] - s[1], L[2] - s[2]));
        }
      }
      if (bot.hold) {
        const H = bot.hold, f = w.__sl.fingerLocks().find((x: any) => x.lock === H.lock);
        if (f) {
          H.frames++;
          if (f.meets) H.meets++;
          if (!w.__sl.hands().finger.length) H.noFinger++;
          H.progress = Math.max(H.progress, f.progress);
          H.gap += f.coverage.gap;
          H.gapMin = Math.min(H.gapMin, f.coverage.gap);
          H.spillAll = Math.max(H.spillAll, f.coverage.spillAll);
          H.coverMin = Math.min(H.coverMin, f.coverage.cover);
        }
      }
      if (!bot.pos) return;
      let start = t;
      for (;;) {
        if (bot.leg && t >= bot.leg.t0 + bot.leg.dur) {
          bot.pos = bot.leg.to.slice();
          start = bot.leg.t0 + bot.leg.dur;
          bot.leg = null;
        }
        if (bot.leg || !bot.legs.length) break;
        const l = bot.legs.shift();
        const p = bot.pos;
        const d = Math.hypot(l.to[0] - p[0], l.to[1] - p[1], l.to[2] - p[2]);
        bot.leg = { from: p.slice(), to: l.to.slice(), t0: start, dur: (d / (l.cmps / 100)) * 1000 };
      }
      if (bot.leg) {
        const L = bot.leg, k = L.dur > 0 ? Math.min(1, (t - L.t0) / L.dur) : 1;
        bot.pos = [0, 1, 2].map((i) => L.from[i] + (L.to[i] - L.from[i]) * k);
      }
      const params: Record<string, unknown> = { device: bot.device, position: { x: bot.pos[0], y: bot.pos[1], z: bot.pos[2] } };
      if (bot.anchor) params.anchor = bot.anchor;
      const o = bot.once ?? bot.orient;
      bot.once = undefined;
      if (o !== undefined) params.orientation = o;
      fire("set_transform", params);
      if (bot.ramp) {
        const R = bot.ramp, k = R.dur > 0 ? Math.min(1, (t - R.t0) / R.dur) : 1;
        const v = R.from + (R.to - R.from) * k;
        if (v !== bot.sel) {
          bot.sel = v;
          fire("set_select_value", { device: bot.device, value: v });
        }
        if (k >= 1) bot.ramp = null;
      }
    },
  };
  w.__bot = bot;
  if (!w.__botStepping) {
    const step = w.__vt.step.bind(w.__vt);
    w.__vt.step = (ms: number) => {
      const b = w.__bot;
      if (b && b.driving) b.frame();
      return step(ms);
    };
    w.__botStepping = true;
  }
}


/**
 * The careful player, driving the right hand (or the right controller) frame by frame through withJitter. Positions it
 * moves to are world metres for the hand; box units for the lantern and spots.
 */
export class Bot {
  readonly app: XrApp;
  readonly page: Page;
  readonly device: string;
  readonly jitter: JitterOptions | null;
  readonly careful: ApproachOptions;
  readonly fingerDepth: number;
  cmPerUnit = 24;
  /** The lantern minus the commanded hand (world), measured after each grab. */
  private off: Vec3 = [0, 0, 0];

  private constructor(app: XrApp, readonly input: BotInput, o: BotOptions) {
    this.app = app;
    this.page = app.page;
    this.device = input === "hands" ? "hand-right" : "controller-right";
    const base = input === "hands" ? HAND_JITTER : CONTROLLER_JITTER;
    this.jitter = o.jitter === null ? null : { ...base, seed: 1, ...o.jitter };
    this.careful = o.careful ?? {};
    this.fingerDepth = o.fingerDepth ?? 0.45;
  }

  /** Install the bot on a booted page (a box shown or not) and bring its hand (or controller) beside the lantern. */
  static async attach(target: Page | XrApp, o: BotOptions = {}): Promise<Bot> {
    const app = target instanceof XrApp ? target : new XrApp(target, "logic", []);
    const bot = new Bot(app, o.input ?? "hands", o);
    await bot.page.evaluate(pageBot, {
      src: withJitter.toString(),
      jitter: bot.jitter,
      device: bot.device,
      anchor: bot.input === "hands" ? "grasp" : null,
    });
    if (bot.input === "hands") {
      await app.queue("set_input_mode", { mode: "hand" });
      await app.queue("set_connected", { device: bot.device, connected: true });
      await app.queue("set_hand_pose", { device: bot.device, poseId: "default" });
    } else {
      await app.queue("set_input_mode", { mode: "controller" });
      await app.queue("set_connected", { device: bot.device, connected: true });
      // The other controller rests in the lap, beside and below the box: it never reaches the beam.
      const [lap] = await bot.world([[-2.5, -2, 3]]);
      await app.queue("set_transform", { device: "controller-left", position: { x: lap![0], y: lap![1], z: lap![2] } });
    }
    await app.settle();
    bot.cmPerUnit = (await app.state()).box.sizeM * 100;
    const [rest] = await bot.world([[0.35, -0.1, 1.75]]);
    await bot.page.evaluate((p) => {
      const b = (window as any).__bot;
      b.pos = p;
      b.once = b.anchor ? "auto" : undefined;
      b.driving = true;
    }, rest!);
    await bot.hold(100);
    return bot;
  }

  // ---------------------------------------------------------------------------------------------- moving the hand

  /** Box units to world metres (the box as drawn). */
  world(pts: V3[]): Promise<Vec3[]> {
    return this.page.evaluate((q) => window.__ns!.scene.toWorld(q), pts);
  }

  lantern(): Promise<SlLantern> {
    return this.page.evaluate(() => window.__sl!.lantern());
  }

  /** Where the bot asks its hand to be (world), before the jitter. */
  hand(): Promise<Vec3> {
    return this.page.evaluate(() => (window as any).__bot.pos as Vec3);
  }

  /** Go along `legs` (world, the commanded hand), stepping until the hand is through them. */
  async go(legs: { to: Vec3; cmps: number }[], label = "the bot's hand moving"): Promise<void> {
    if (!legs.length) return;
    const ms = await this.page.evaluate((ls) => {
      const b = (window as any).__bot;
      let p = b.pos as Vec3, total = 0;
      for (const l of ls) {
        total += (Math.hypot(l.to[0] - p[0], l.to[1] - p[1], l.to[2] - p[2]) / (l.cmps / 100)) * 1000;
        p = l.to;
        b.legs.push({ to: l.to, cmps: l.cmps });
      }
      return total;
    }, legs);
    await this.app.stepUntil((_ns, w) => w.__bot.idle(), { maxMs: ms + 2000, batch: 24, label });
    await this.check();
  }

  /** Stand still (shaking) for `ms`. */
  async hold(ms: number): Promise<void> {
    await this.app.step(Math.max(1, Math.round(ms / DT)));
    await this.check();
  }

  /** Close (1) or open (0) the pinch, or the trigger, over `ms`. */
  async pinch(to: number, ms = PINCH_MS): Promise<void> {
    await this.page.evaluate(
      ({ to, ms }) => {
        const b = (window as any).__bot;
        b.ramp = { from: b.sel, to, t0: (window as any).__vt.now, dur: ms };
      },
      { to, ms },
    );
    await this.app.stepUntil((_ns, w) => w.__bot.idle(), { maxMs: ms + 1000, batch: 4, label: "the pinch" });
    await this.check();
  }

  /** Step until `pred(window, arg)` (a page function) holds, at most `maxMs`; false if it never did. */
  async waitFor<A>(pred: (w: any, arg: A) => boolean, arg: A, maxMs: number): Promise<boolean> {
    const src = pred.toString();
    const end = (await this.app.now()) + maxMs;
    for (;;) {
      const r = await this.page.evaluate(
        ({ src, arg, end }) => {
          const w = window as any;
          const f = (0, eval)(`(${src})`) as (w: unknown, a: unknown) => boolean;
          for (let i = 0; i < 24; i++) {
            if (f(w, arg)) return 1;
            if (w.__vt.now >= end) return 0;
            w.__vt.step(1000 / 72);
          }
          return f(w, arg) ? 1 : w.__vt.now >= end ? 0 : -1;
        },
        { src, arg: arg as unknown, end },
      );
      if (r >= 0) {
        await this.check();
        return r === 1;
      }
    }
  }

  /** IWER commands the page refused: a failure of the bot itself, never of the game. */
  private async check(): Promise<void> {
    const errs = await this.page.evaluate(() => {
      const b = (window as any).__bot;
      return [...b.errors.splice(0), ...b.jit.stats.errors.splice(0)] as string[];
    });
    if (errs.length) throw new Error(`IWER refused the bot's commands: ${errs.join("; ")}`);
  }

  // ---------------------------------------------------------------------------------------------- the lantern

  /**
   * Reach for the lantern with the open hand, pinch it where it stands, and hold still until the grip is known.
   * Returns the pinches it took (a pinch made while the hand is out of tracking does not take).
   */
  async grab(): Promise<number> {
    // Still closed (a new box takes the lantern out of the hand): open it first.
    if (await this.page.evaluate(() => (window as any).__bot.sel > 0)) {
      await this.pinch(0, 100);
      await this.hold(150);
    }
    for (let n = 1; n <= GRAB_TRIES; n++) {
      const L = (await this.lantern()).pos;
      const [Lw, near] = await this.world([L, [L[0], L[1] + 0.08, L[2] + 0.12]]);
      await this.go([{ to: near!, cmps: REACH_CMPS }, { to: Lw!, cmps: REACH_SLOW_CMPS }], "reaching for the lantern");
      if (this.input === "controllers") {
        // The trigger grabs at the controller's grip, which sits off its origin: put the grip on the lantern.
        for (let i = 0; i < 2; i++) {
          const g = await this.page.evaluate(() => {
            const s = (window.__ns!.world as any).player.gripSpaces.right;
            const v = s.getWorldPosition(new s.position.constructor());
            return [v.x, v.y, v.z] as Vec3;
          });
          await this.go([{ to: add(await this.hand(), sub(Lw!, g)), cmps: 5 }], "the grip onto the lantern");
        }
      }
      await this.hold(80);
      await this.pinch(1);
      const held = await this.waitFor((w) => w.__sl.lantern().held && w.__sl.lantern().holder === "right", null, 400);
      if (held) {
        await this.hold(250);
        this.off = await this.measureOff(12);
        return n;
      }
      await this.pinch(0, 100);
      await this.hold(300);
    }
    throw new Error(`the bot could not pick the lantern up in ${GRAB_TRIES} pinches`);
  }

  /** The lantern minus the commanded hand (world), averaged over `n` frames. */
  private measureOff(n: number): Promise<Vec3> {
    return this.page.evaluate((n) => {
      const w = window as any;
      const acc: number[] = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        w.__vt.step(1000 / 72);
        const L = w.__ns.scene.toWorld([w.__sl.lantern().pos])[0];
        for (let k = 0; k < 3; k++) acc[k] = acc[k]! + (L[k] - w.__bot.pos[k]) / n;
      }
      return acc as Vec3;
    }, n);
  }

  /** Carry the held lantern to `to` (box units) along `legs` (the lantern's path, box units). */
  async carryAlong(legs: Leg[], label = "carrying the lantern"): Promise<void> {
    const ws = await this.world(legs.map((l) => l.to));
    await this.go(legs.map((l, i) => ({ to: sub(ws[i]!, this.off), cmps: l.cmps })), label);
  }

  /** The careful approach with the held lantern from where it is to `spot` (box units). */
  async approach(spot: V3): Promise<void> {
    const from = (await this.lantern()).pos;
    await this.carryAlong(approachPlan(from, spot, this.cmPerUnit, this.careful), "the careful approach");
  }

  /** Open the hand (or let go of the trigger) and step until the lantern is let go. */
  async release(): Promise<void> {
    await this.pinch(0);
    if (!(await this.waitFor((w) => !w.__sl.lantern().held, null, 1500))) throw new Error("the lantern was not let go");
  }

  /** The open hand leaves the lantern: back toward the player and up a little. */
  async away(): Promise<void> {
    const [a, b] = await this.world([
      [0, 0, 1],
      [0, 0.12, 1.35],
    ]);
    await this.go([{ to: add(await this.hand(), sub(b!, a!)), cmps: AWAY_CMPS }], "the hand leaving the lantern");
  }

  // ---------------------------------------------------------------------------------------------- locks

  /** A plain lock: the careful approach to its spot and a release, again (from 5 cm out) while it stays shut. */
  async openPlain(lock: SlLock): Promise<LockResult> {
    const t0 = await this.app.now();
    const r: LockResult = { lock: lock.i, finger: false, open: false, attempts: 0, grabs: 0, settled: [], restMm: NaN, lays: 0, ms: 0 };
    while (!r.open && r.attempts < LOCK_TRIES) {
      r.attempts++;
      await this.place(lock.spot, r);
      r.open = await this.waitFor((w, i) => w.__sl.session.state().open.includes(i), lock.i, OPEN_WAIT_MS);
      await this.away();
    }
    r.ms = (await this.app.now()) - t0;
    return r;
  }

  /** Pick the lantern up, bring it carefully onto `spot` and let go (a retry first backs off 5 cm). */
  private async place(spot: V3, r: LockResult): Promise<void> {
    r.grabs += await this.grab();
    if (r.attempts > 1) await this.carryAlong([{ to: [spot[0], spot[1], spot[2] + 5 / this.cmPerUnit], cmps: 10 }], "backing off");
    await this.approach(spot);
    r.settled.push((await this.lantern()).mode === "settled");
    await this.release();
    const L = (await this.lantern()).pos;
    r.restMm = Math.hypot(L[0] - spot[0], L[1] - spot[1], L[2] - spot[2]) * this.cmPerUnit * 10;
  }

  /**
   * A finger lock: the lantern carefully onto its spot (the lock then one piece short), then the index finger laid
   * along the missing piece on the rays from the spot at `fingerDepth`, held there (shaking) until the lock opens.
   */
  async openFinger(lock: SlLock): Promise<LockResult> {
    const t0 = await this.app.now();
    const r: LockResult = { lock: lock.i, finger: true, open: false, attempts: 0, grabs: 0, settled: [], restMm: NaN, lays: 0, ms: 0 };
    const short = (w: any, i: number) => {
      const f = w.__sl.fingerLocks().find((x: any) => x.lock === i);
      return !!f && f.coverage.cover >= 0.92 && f.coverage.spill <= 0.25;
    };
    while (r.attempts < LOCK_TRIES) {
      r.attempts++;
      await this.place(lock.spot, r);
      if (await this.waitFor(short, lock.i, 300)) break;
      await this.away();
    }
    if (!(await this.waitFor(short, lock.i, 0))) {
      await this.away();
      r.ms = (await this.app.now()) - t0;
      return r;
    }
    const fl = (await this.page.evaluate(() => window.__sl!.fingerLocks())).find((f) => f.lock === lock.i)!;
    const out = await this.fingerHold(fl, r);
    r.open = out === "open";
    if (out !== "open" && out !== "shut") r.blocked = out;
    r.ms = (await this.app.now()) - t0;
    return r;
  }

  /** Where a finger at `fingerDepth` fills `fl`'s gap: the middle of the missing piece on the rays, and its way. */
  private gapLine(fl: SlFingerLock): { mid: Vec3; dir: Vec3 } {
    const { mid, angle } = axisOf(fl.piece);
    // The right hand's finger points to the player's left, so the hand lies to the right of the gap.
    const sign = Math.cos(angle) >= 0 ? -1 : 1;
    return { mid: onRay(fl.spot, mid as V2, this.fingerDepth), dir: [sign * Math.cos(angle), sign * Math.sin(angle), 0] };
  }

  /**
   * The finger laid in the gap, as a player aims it by its shadow (the lay itself is not shaken), then held there with
   * the jitter until the lock opens: the right index finger (Pointer), or the right controller's stand-in finger
   * (ControllerFinger: a fingertip-sized capsule along its aim, just past its front). "open", "shut", or why it could
   * not be tried.
   */
  private async fingerHold(fl: SlFingerLock, r: LockResult): Promise<string> {
    const { mid, dir } = this.gapLine(fl);
    const hands = this.input === "hands";
    let open = false, blocked = "";
    while (!open && !blocked && r.lays < FINGER_LAYS) {
      await this.waitFor((w) => !w.__bot.jit.lost, null, 1000);
      await this.page.evaluate(() => ((window as any).__bot.driving = false));
      let laid: { off: number; angle: number }, at: Vec3, orient: unknown;
      if (hands) {
        const p = new Pointer(this.app, "right");
        laid = await p.lay(mid, dir);
        const t = p as unknown as { fingers: Vec3; palm: Vec3 };
        at = p.tip;
        orient = { fingers: { x: t.fingers[0], y: t.fingers[1], z: t.fingers[2] }, palm: { x: t.palm[0], y: t.palm[1], z: t.palm[2] } };
      } else {
        const c = new ControllerFinger(this.app, "right");
        try {
          laid = await c.lay(mid, dir);
        } catch (e) {
          if (!/casts no stand-in/.test(String(e))) throw e;
          blocked = "no controller fingertip: the game casts no stand-in finger for the controller in the box";
          await this.page.evaluate(() => ((window as any).__bot.driving = true));
          break;
        }
        at = c.pos;
        orient = c.q;
      }
      r.lays++;
      await this.page.evaluate(
        ({ at, orient, anchor, lock }) => {
          const b = (window as any).__bot;
          b.stop();
          b.anchor = anchor;
          b.orient = orient;
          b.pos = at;
          b.sel = 0;
          b.hold = { lock, frames: 0, meets: 0, noFinger: 0, progress: 0, gap: 0, gapMin: Infinity, spillAll: 0, coverMin: Infinity };
          b.driving = true;
        },
        { at, orient, anchor: hands ? "index-tip" : null, lock: fl.lock },
      );
      open = await this.waitFor((w, i) => w.__sl.session.state().open.includes(i), fl.lock, FINGER_WAIT_MS);
      const h = await this.page.evaluate(() => {
        const b = (window as any).__bot, H = b.hold;
        b.hold = null;
        return H as Record<string, number>;
      });
      (r.holds ??= []).push({
        offMm: laid.off * this.cmPerUnit * 10,
        deg: (laid.angle * 180) / Math.PI,
        frames: h.frames!,
        meets: h.meets!,
        noFinger: h.noFinger!,
        progress: h.progress!,
        gap: h.gap! / Math.max(1, h.frames!),
        gapMin: h.gapMin!,
        spillAll: h.spillAll!,
        coverMin: h.coverMin!,
      });
    }
    // Out of the box along its depth, then (a hand) the open hand again, ready for the lantern.
    const [inBox, outBox] = await this.world([
      [0, 0, this.fingerDepth],
      [0, 0, 1.7],
    ]);
    await this.go([{ to: add(await this.hand(), sub(outBox!, inBox!)), cmps: AWAY_CMPS }], "the finger leaving the box");
    await this.page.evaluate((hands) => {
      const b = (window as any).__bot;
      b.orient = undefined;
      if (hands) {
        b.anchor = "grasp";
        b.once = "auto";
      }
    }, hands);
    if (hands) {
      await this.waitFor((w) => !w.__bot.jit.lost, null, 1000);
      await this.app.queue("set_hand_pose", { device: this.device, poseId: "default" });
      await this.hold(60);
    }
    return blocked || (open ? "open" : "shut");
  }

  // ---------------------------------------------------------------------------------------------- a box

  /** Play `spec` (as the menus will) and step until it is in play with its panel etched; the bus is cleared first. */
  async start(spec: BoxSpec): Promise<SlSessionState> {
    await this.page.evaluate(() => window.__ns!.clearEvents());
    await this.page.evaluate((s) => window.__sl!.session.play(s), spec);
    await this.app.stepUntil(
      (ns, w) => {
        const s = w.__sl.session.state();
        return ns.events("box-start").length > 0 && s?.stage === "playing" && s.revealed;
      },
      { maxMs: 15_000, label: "the box in play" },
    );
    return (await this.page.evaluate(() => window.__sl!.session.state()))!;
  }

  /** Watch the lantern's closest approach to `spots` (box units) from now on; `watched` reads it (cm) and stops. */
  async watch(spots: V3[]): Promise<void> {
    await this.page.evaluate((s) => ((window as any).__bot.watch = { spots: s, min: s.map(() => Infinity) }), spots);
  }

  async watched(): Promise<number[]> {
    const min = await this.page.evaluate(() => {
      const b = (window as any).__bot;
      const m = b.watch?.min ?? [];
      b.watch = null;
      return m as number[];
    });
    return min.map((d) => d * this.cmPerUnit);
  }

  /** Play `spec` and solve it lock by lock, in order. */
  async solve(spec: BoxSpec): Promise<BotResult> {
    const real0 = Date.now(), f0 = await this.frames();
    const s = await this.start(spec);
    const t0 = await this.app.now();
    const drops0 = await this.dropouts();
    const locks: LockResult[] = [];
    for (const lock of s.locks) {
      const open = (await this.page.evaluate(() => window.__sl!.session.state()))!.open;
      if (open.includes(lock.i)) throw new Error(`lock ${lock.i} of ${s.key} opened before the bot went for it`);
      const r = lock.finger ? await this.openFinger(lock) : await this.openPlain(lock);
      locks.push(r);
      if (!r.open && !r.blocked) break;
    }
    const after = (await this.page.evaluate(() => window.__sl!.session.state())) as SlSessionState;
    const solved = after.open.length === s.locks.length;
    return {
      key: s.key!,
      solved,
      ms: (await this.app.now()) - t0,
      locks,
      dropouts: (await this.dropouts()) - drops0,
      frames: (await this.frames()) - f0,
      realMs: Date.now() - real0,
    };
  }

  /** Tracking dropouts so far. */
  dropouts(): Promise<number> {
    return this.page.evaluate(() => (window as any).__bot.jit.stats.dropouts as number);
  }

  /** Frames the virtual clock has stepped so far. */
  frames(): Promise<number> {
    return this.page.evaluate(() => (window as any).__vt.frames as number);
  }
}

// --- Reporting (the bot specs) ------------------------------------------------------------------------------------

const s1 = (ms: number) => (ms / 1000).toFixed(1);

/** One lock as a line: how it went, approaches, pinches, settles, where the lantern came to rest, lays, time. */
export function lockLine(l: LockResult): string {
  const how = l.open ? "open" : l.blocked ? "blocked" : "SHUT";
  const parts = [`${l.finger ? "finger" : "plain"} ${l.lock} ${how}`, `${l.attempts} approach${l.attempts === 1 ? "" : "es"}`];
  if (l.grabs > l.attempts) parts.push(`${l.grabs} pinches`);
  if (l.settled.length) parts.push(`settled ${l.settled.map((s) => (s ? "yes" : "no")).join("/")}`);
  if (Number.isFinite(l.restMm)) parts.push(`rest ${l.restMm.toFixed(1)} mm`);
  for (const h of l.holds ?? []) parts.push(`lay: ${h.meets}/${h.frames} frames meeting, gap ${(h.gap * 100).toFixed(0)}%`);
  parts.push(`${s1(l.ms)} s`);
  return parts.join(", ");
}

/** One box as a line: solved, virtual and real time, dropouts, and each lock. */
export function boxLine(input: BotInput, r: BotResult): string {
  return (
    `bot (${input}) ${r.key}: ${r.solved ? "solved" : "NOT solved"} in ${s1(r.ms)} s (${r.frames} frames, ${s1(r.realMs)} s real), ` +
    `${r.dropouts} dropouts; ${r.locks.map(lockLine).join("; ")}`
  );
}

/** Results to test-results/bot/<name>.json (pulled back from the server) and a line to the console and the test. */
export function saveResults(name: string, data: unknown): void {
  fs.mkdirSync(path.join("test-results", "bot"), { recursive: true });
  fs.writeFileSync(path.join("test-results", "bot", `${name}.json`), JSON.stringify(data, null, 1));
}

export function report(testInfo: TestInfo, line: string): void {
  console.log(line);
  testInfo.annotations.push({ type: "bot", description: line });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

/**
 * Boxes `from` to `to`, one after the other with one bot (each played to the end, then judged by the caller); every
 * box's line goes to the test and the console, the results to test-results/bot/<name>.json, a summary to the run notes.
 */
export async function solveBoxes(app: XrApp, o: BotOptions & { from: number; to: number; name: string }, testInfo: TestInfo): Promise<BotResult[]> {
  const input = o.input ?? "hands";
  const bot = await Bot.attach(app, o);
  const out: BotResult[] = [];
  for (let n = o.from; n <= o.to; n++) {
    const r = await bot.solve({ kind: "box", n });
    out.push(r);
    report(testInfo, boxLine(input, r));
    saveResults(o.name, out);
  }
  const locks = out.flatMap((r) => r.locks);
  const tried = locks.filter((l) => !l.blocked);
  const firstTry = tried.filter((l) => l.open && l.attempts === 1).length;
  const placed = locks.flatMap((l) => l.settled);
  const solved = out.filter((r) => r.solved);
  const frames = out.reduce((a, r) => a + r.frames, 0), real = out.reduce((a, r) => a + r.realMs, 0);
  const blocked = locks.filter((l) => l.blocked);
  const note =
    `bot (${input}) boxes ${o.from}-${o.to}: ${solved.length}/${out.length} solved, median ${s1(median(solved.map((r) => r.ms)))} s, ` +
    `slowest ${s1(Math.max(0, ...solved.map((r) => r.ms)))} s; ${firstTry}/${tried.length} locks on the first approach; ` +
    `lantern settled at ${placed.filter(Boolean).length}/${placed.length} releases; ${out.reduce((a, r) => a + r.dropouts, 0)} dropouts; ` +
    `${frames} frames in ${s1(real)} s real (${(real / Math.max(1, frames)).toFixed(0)} ms a frame)` +
    (blocked.length ? `; ${blocked.length} finger locks blocked: ${blocked[0]!.blocked}` : "");
  report(testInfo, note);
  addRunNote(note);
  return out;
}

/** Console errors the page logged (a bot spec ends with none). */
export const pageErrors = (app: XrApp): string[] => app.consoleLines.filter((l) => l.startsWith("error:") || l.startsWith("PAGEERROR"));

/**
 * Play box `spec` and solve it as a careful player with a shaking hand (the plan's interface; a `bot` from
 * Bot.attach can be passed to keep one hand across boxes). `ms` is virtual time from the box in play to its last lock.
 */
export async function botSolve(page: Page | XrApp, spec: BoxSpec, o: BotOptions & { bot?: Bot } = {}): Promise<BotResult> {
  const bot = o.bot ?? (await Bot.attach(page, o));
  return bot.solve(spec);
}
