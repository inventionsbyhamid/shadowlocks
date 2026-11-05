import type { FeedbackEvent } from "../app/bus";
import { type Hand, HAPTICS, type HapticPattern } from "../app/haptics";
import type { BoxSpec, Vec3 } from "../core/types";
import type { AudioEngine, PlayHandle, PlayOptions } from "./engine";
import { Hums, humsOn, type LoopEngine } from "./hums";
import { isSfxId, type MusicState, type SfxId, type StingId } from "./manifest";
import { BOX_OPEN_MS, dialTickPitch, LOCK_OPEN_MS, scheduleBoxOpen, scheduleLockOpen } from "./music-box";

/**
 * Bus events (hands, the shell) and the box's game events as cue input. Events are read only
 * through `type` and a few optional fields (`id`, `to`, `k`, `done`, `lock`, `on`, `key`, `cm`, and
 * an `at` position), so this file does not depend on how each event is declared. The cue logic stays
 * pure: the demo video's mix replays it from the recorded events.
 *
 * Game events (the names the box session uses):
 * - `lock-open` {lock}: glass tick, brass clunk at +120 ms, the lock's music-box note at +200 ms.
 * - `box-open` {key}: the chord resolves, walls, drawer, and the box's tune from its key (the seed).
 * - `ring` {lock, on}: the ring chime when the rings line up (on), nothing when they part.
 * - `crystallise` {lock}, `hint` {lock}, `lesson-step`: their sounds.
 * - `tick` {cm}, or `feel` {e: {type: "tick", cm}}: a dial tick, climbing G A B D.
 */
export type CueEvent = FeedbackEvent | { type: string; [key: string]: unknown };

export type Cue =
  | { kind: "sfx"; id: SfxId; position?: Vec3; pitch?: number; gain?: number; variant?: number; delayMs?: number }
  | { kind: "sting"; id: StingId }
  | { kind: "music"; state: MusicState };

/** Hand and lantern events and the sounds they make (placed where they happened). */
const INPUT_SOUNDS: Record<string, SfxId[]> = {
  hover: ["ui_hover"],
  grab: ["lantern_pick"],
  release: ["lantern_set"],
};
/** Keys that step back out of a screen: a softer click. */
const BACK_KEYS = new Set(["settings-done"]);
/** Screens (UiEvent `screen`, field `to`) with a box in play; every other screen is menu music. */
const PLAY_SCREENS = new Set(["play"]);
const EMPTY: readonly Cue[] = Object.freeze([]);
/** A count-up's tick rises this many semitones from its start to its end. */
const COUNT_PITCH_SPAN = 5;
/** A slider's tick follows its value: -3 semitones at the bottom of the range, +9 at the top. */
const SLIDER_PITCH_LOW = -3;
const SLIDER_PITCH_SPAN = 12;
/** The lesson beat is mb_b5 at half gain (-6 dB, about the menu's level). */
export const LESSON_STEP_GAIN = 0.5;
/** The game events the mapper knows (see CueEvent): in the game they sound through GameSounds. */
export const GAME_CUE_TYPES: ReadonlySet<string> = new Set(["lock-open", "box-open", "ring", "crystallise", "hint", "lesson-step", "tick", "feel"]);

const unit = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const lockOf = (e: { [k: string]: unknown }): number => (typeof e.lock === "number" && Number.isInteger(e.lock) ? e.lock : 0);

function positionOf(e: { [k: string]: unknown }): Vec3 | undefined {
  const at = e.at;
  if (Array.isArray(at) && at.length === 3 && at.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return [at[0], at[1], at[2]];
  }
  return undefined;
}

export interface CueMapperOptions {
  /**
   * Finds where an event happened in the world (a button id to a position, a lock to its place on
   * the panel) when the event itself carries no `at`. Spatial sounds use it.
   */
  locate?: (event: CueEvent) => Vec3 | undefined;
}

/**
 * Turns events into cues. Music cues are emitted whenever the wanted state may have changed; the
 * engine ignores repeats. Layered sounds carry `delayMs` after their event.
 */
export class CueMapper {
  constructor(private opts: CueMapperOptions = {}) {}

  /** Map a batch of events. */
  map(events: readonly CueEvent[]): readonly Cue[] {
    const n = events.length;
    if (n === 0) return EMPTY;
    const out: Cue[] = [];
    for (let i = 0; i < n; i++) this.one(events[i]!, out);
    return out.length === 0 ? EMPTY : out;
  }

  private sfx(out: Cue[], id: SfxId, extra?: Partial<PlayOptions>): void {
    out.push(extra ? { kind: "sfx", id, ...extra } : { kind: "sfx", id });
  }

  private where(e: CueEvent): Vec3 | undefined {
    return positionOf(e) ?? this.opts.locate?.(e);
  }

  /** A spatial sound at the event's own `at`, else wherever `locate` puts it, else head-locked. */
  private sfxAt(out: Cue[], id: SfxId, e: CueEvent, extra?: Partial<Extract<Cue, { kind: "sfx" }>>): void {
    const position = this.where(e);
    out.push(position ? { kind: "sfx", id, position, ...extra } : { kind: "sfx", id, ...extra });
  }

  /** A schedule of layers, all at one place (the event's), each `delayMs` after the event. */
  private layers(out: Cue[], e: CueEvent, schedule: readonly { id: string; atMs: number }[]): void {
    const position = this.where(e);
    for (const s of schedule) {
      if (!isSfxId(s.id)) continue;
      const cue: Extract<Cue, { kind: "sfx" }> = { kind: "sfx", id: s.id };
      if (position) cue.position = position;
      if (s.atMs > 0) cue.delayMs = s.atMs;
      out.push(cue);
    }
  }

  private one(e: CueEvent, out: Cue[]): void {
    switch (e.type) {
      case "press": {
        const id = String((e as { id?: unknown }).id ?? "");
        this.sfxAt(out, BACK_KEYS.has(id) ? "ui_back" : "ui_press", e);
        return;
      }
      case "screen": {
        const to = String((e as { to?: unknown }).to ?? "");
        out.push({ kind: "music", state: PLAY_SCREENS.has(to) ? "calm" : "menu" });
        return;
      }
      case "count": {
        const c = e as { k?: unknown; done?: unknown };
        if (c.done === true) return;
        this.sfx(out, "dial_tick", { pitch: COUNT_PITCH_SPAN * unit(c.k) });
        return;
      }
      case "slider": {
        const pitch = SLIDER_PITCH_LOW + SLIDER_PITCH_SPAN * unit((e as { k?: unknown }).k);
        this.sfxAt(out, "dial_tick", e, { pitch });
        return;
      }
      case "lock-open":
        this.layers(out, e, scheduleLockOpen(lockOf(e), 0));
        return;
      case "box-open":
        this.layers(out, e, scheduleBoxOpen(String((e as { key?: unknown }).key ?? ""), 0));
        return;
      case "ring":
        if ((e as { on?: unknown }).on === true) this.sfxAt(out, "ring_chime", e);
        return;
      case "crystallise":
        this.sfxAt(out, "crystallise", e);
        return;
      case "hint":
        this.sfxAt(out, "hint_reveal", e);
        return;
      case "lesson-step":
        this.sfx(out, "lesson_step", { gain: LESSON_STEP_GAIN });
        return;
      case "tick":
        this.sfxAt(out, "dial_tick", e, { pitch: dialTickPitch(Number((e as { cm?: unknown }).cm)) });
        return;
      case "feel": {
        const inner = (e as { e?: { type?: unknown; cm?: unknown } }).e;
        if (inner?.type === "tick") this.sfxAt(out, "dial_tick", e, { pitch: dialTickPitch(Number(inner.cm)) });
        return;
      }
      default: {
        const input = INPUT_SOUNDS[e.type];
        if (input) for (const id of input) this.sfxAt(out, id, e);
      }
    }
  }
}

/** Anything with the three engine calls cues need. */
export type CueTarget = Pick<AudioEngine, "play" | "sting" | "setMusic">;

/**
 * Receives the handle of every sound the cues start, so the app can cut one short (a hum or a
 * slide that ends with its animation). A handle is valid until its sound ends; drop it then.
 */
export type HandleSink = (id: SfxId, handle: PlayHandle) => void;

/**
 * Sends cues to the engine at once (a delayed cue starts `delayMs` later on the audio clock). An sfx
 * cue carries the play options itself, so nothing is allocated here. The game uses CueScheduler.
 */
export function applyCues(engine: CueTarget, cues: readonly Cue[], onHandle?: HandleSink): void {
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    if (c.kind === "sfx") {
      const h = engine.play(c.id, c.delayMs ? { ...c, delay: c.delayMs / 1000 } : c);
      onHandle?.(c.id, h);
    } else if (c.kind === "sting") engine.sting(c.id);
    else engine.setMusic(c.state);
  }
}

/** Returns a handler for batches of events that plays their cues at once. */
export function attachCues(engine: CueTarget, mapper = new CueMapper(), onHandle?: HandleSink): (events: readonly CueEvent[]) => void {
  return (events) => applyCues(engine, mapper.map(events), onHandle);
}

// ------------------------------------------------------------------------------ the scheduler

/**
 * A layered sound reaches the engine at most this long before it should sound, then starts exactly
 * on the audio clock. Long sequences (the box opening) so never hold voices far ahead of time.
 */
export const LOOKAHEAD_MS = 50;
const QUEUE = 48;

interface Pending {
  due: number;
  id: SfxId;
  position: Vec3;
  placed: boolean;
  pitch: number | undefined;
  gain: number | undefined;
  variant: number | undefined;
}

/**
 * Plays cues, holding the delayed ones until just before their time (frame clock, ms). Allocation
 * free: a fixed queue kept in time order, and one options object reused for every play.
 */
export class CueScheduler {
  private readonly queue: Pending[] = Array.from({ length: QUEUE }, () => ({
    due: 0,
    id: "glass_tick" as SfxId,
    position: [0, 0, 0] as Vec3,
    placed: false,
    pitch: undefined,
    gain: undefined,
    variant: undefined,
  }));
  private n = 0;
  private readonly opts: PlayOptions = {};

  constructor(
    private readonly engine: CueTarget,
    private readonly now: () => number,
    private readonly onHandle?: HandleSink,
  ) {}

  /** Sounds still waiting for their time. */
  get pending(): number {
    return this.n;
  }

  push(cues: readonly Cue[]): void {
    const t = this.now();
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i]!;
      if (c.kind === "sting") this.engine.sting(c.id);
      else if (c.kind === "music") this.engine.setMusic(c.state);
      else {
        const d = c.delayMs ?? 0;
        if (d <= LOOKAHEAD_MS || this.n === QUEUE) this.play(c.id, c.position, c.pitch, c.gain, c.variant, d);
        else this.hold(t + d, c);
      }
    }
  }

  /** Per frame: hand the engine every sound due within the lookahead, exactly timed. */
  update(): void {
    if (this.n === 0) return;
    const t = this.now();
    const q = this.queue;
    while (this.n > 0 && q[0]!.due - t <= LOOKAHEAD_MS) {
      const p = q[0]!;
      this.play(p.id, p.placed ? p.position : undefined, p.pitch, p.gain, p.variant, p.due - t);
      for (let i = 1; i < this.n; i++) q[i - 1] = q[i]!;
      q[this.n - 1] = p;
      this.n--;
    }
  }

  /** Drop every sound still waiting (play ended, a new box). */
  clear(): void {
    this.n = 0;
  }

  private play(id: SfxId, position: Vec3 | undefined, pitch: number | undefined, gain: number | undefined, variant: number | undefined, delayMs: number): void {
    const o = this.opts;
    o.position = position;
    o.pitch = pitch;
    o.gain = gain;
    o.variant = variant;
    o.delay = delayMs > 0 ? delayMs / 1000 : undefined;
    const h = this.engine.play(id, o);
    this.onHandle?.(id, h);
  }

  /** Into the queue in time order, after any already due at the same time. */
  private hold(due: number, c: Extract<Cue, { kind: "sfx" }>): void {
    const q = this.queue;
    const slot = q[this.n]!;
    let i = this.n;
    while (i > 0 && q[i - 1]!.due > due) {
      q[i] = q[i - 1]!;
      i--;
    }
    q[i] = slot;
    this.n++;
    slot.due = due;
    slot.id = c.id;
    slot.placed = !!c.position;
    if (c.position) {
      slot.position[0] = c.position[0];
      slot.position[1] = c.position[1];
      slot.position[2] = c.position[2];
    }
    slot.pitch = c.pitch;
    slot.gain = c.gain;
    slot.variant = c.variant;
  }
}

// ------------------------------------------------------------------------ the game's sounds

/** Where things are in the world, for spatial sounds (each writes into `out`; false when unknown). */
export interface SoundPlaces {
  /** Lock `lock`'s centre on the panel. */
  lock(lock: number, out: Vec3): boolean;
  /** The mark lock `lock`'s rings line up on (its centre when it has none). */
  mark(lock: number, out: Vec3): boolean;
  lantern(out: Vec3): boolean;
  /** The middle of the box. */
  box(out: Vec3): boolean;
}

/** Where a game event happened: its lock, the rings' mark, the lantern or the box. */
export function placeOf(e: CueEvent, places: SoundPlaces): Vec3 | undefined {
  const out: Vec3 = [0, 0, 0];
  switch (e.type) {
    case "lock-open":
    case "crystallise":
    case "hint":
      return places.lock(lockOf(e), out) ? out : undefined;
    case "ring":
      return places.mark(lockOf(e), out) ? out : undefined;
    case "box-open":
      return places.box(out) ? out : undefined;
    case "tick":
    case "feel":
      return places.lantern(out) ? out : undefined;
    default:
      return undefined;
  }
}

/** What the game's sounds need of the audio engine. */
export type GameEngine = CueTarget & LoopEngine;

/** What the game's sounds need of the haptics (src/app/haptics.ts). */
export interface HapticSink {
  play(hand: Hand | "both", pattern: HapticPattern, offsetMs?: number): void;
  update(): void;
  clear(): void;
}

export interface GameSoundsDeps {
  engine: GameEngine;
  /** The frame clock (ms). */
  now: () => number;
  haptics?: HapticSink;
  /** The Warmth setting: off silences the hums and the dial ticks. */
  warmth?: () => boolean;
  places?: SoundPlaces;
  /** The app's mapper (it also places button presses); by default one that places game events. */
  mapper?: CueMapper;
  onHandle?: HandleSink;
  key?: string;
}

/**
 * The game's sounds and haptics, one method per thing that happens in a box. The box session calls
 * these; it decides when (warmth, alignment, opening), this decides how it sounds and feels:
 * one-shots go through the cue mapper (the same mapping the demo video replays), layered ones are
 * timed by the scheduler, hums follow warmth, and pulses go to the hand that holds the lantern
 * (both hands when none does). Call update() every frame.
 */
export class GameSounds {
  readonly hums: Hums;
  readonly scheduler: CueScheduler;
  private readonly mapper: CueMapper;
  private readonly one: CueEvent[] = [{ type: "none" }];
  private spec: BoxSpec | null = null;
  private holding: Hand | null = null;

  constructor(private readonly d: GameSoundsDeps) {
    const places = d.places;
    this.mapper = d.mapper ?? new CueMapper({ locate: places ? (e) => placeOf(e, places) : undefined });
    this.scheduler = new CueScheduler(d.engine, d.now, d.onHandle);
    this.hums = new Hums(d.engine, { lockAt: places ? (lock, out) => places.lock(lock, out) : undefined, key: d.key });
  }

  /** Any event (the bus's, or the box session's): its cues, timed. */
  handle(e: CueEvent): void {
    this.one[0] = e;
    this.scheduler.push(this.mapper.map(this.one));
  }

  /** A box or lesson starts: whether its locks hum (lessons and boxes 1 to 5, with Warmth on). */
  boxStart(spec: BoxSpec): void {
    this.reset();
    this.spec = spec;
    this.hums.setEnabled(humsOn(spec, this.warmthOn()));
  }

  /** Settings changed: Warmth on or off applies at once. */
  settingsChanged(): void {
    this.hums.setEnabled(humsOn(this.spec, this.warmthOn()));
  }

  /** Lock `lock`'s smoothed warmth, 0..1: its hum's level. Per frame; allocation free. */
  warmth(lock: number, value: number): void {
    this.hums.warmth(lock, value);
  }

  /** The lock the player looks at (null: none): only it hums. */
  focus(lock: number | null): void {
    this.hums.focus(lock);
  }

  /** The lantern came within `cm` (4, 3, 2, 1) of a spot: a dial tick and a tick pulse. */
  dialTick(cm: number, hand?: Hand): void {
    if (!this.warmthOn()) return;
    this.handle({ type: "tick", cm });
    this.pulse(hand, HAPTICS.tick);
  }

  /** The lantern was picked up (the bus's grab: its sound comes from there). */
  grab(hand: Hand): void {
    this.holding = hand;
    this.d.haptics?.play(hand, HAPTICS.grab);
  }

  /** The lantern was let go. */
  release(): void {
    this.holding = null;
  }

  /** The held lantern settled onto a spot: the settle snap. */
  settle(hand?: Hand): void {
    this.pulse(hand, HAPTICS.settle);
  }

  /** A lock's rings lined up (`on`) or parted: the chime and a double tap when they line up. */
  ring(lock: number, on: boolean, hand?: Hand): void {
    if (!on) return;
    this.handle({ type: "ring", lock, on });
    this.pulse(hand, HAPTICS.ring);
  }

  /**
   * The finger in the beam: `progress` toward the panel and `hold` through the hold (0..1), at the
   * index fingertip; null when it leaves. Per frame; allocation free.
   */
  finger(progress: number | null, hold = 0, at?: Vec3): void {
    this.hums.finger(progress, hold, at);
  }

  /** The finger hold completed: the piece forms (at the fingertip when given); both hums fade out. */
  crystallise(lock: number, at?: Vec3): void {
    this.hums.finger(null);
    this.hums.opened(lock);
    this.handle(at ? { type: "crystallise", lock, at } : { type: "crystallise", lock });
  }

  /** Lock `lock` opened: tick, clunk (+120 ms) and its note (+200 ms) at the lock; its hum fades; a thud. */
  lockOpened(lock: number, at?: Vec3, hand?: Hand): void {
    this.hums.opened(lock);
    this.handle(at ? { type: "lock-open", lock, at } : { type: "lock-open", lock });
    this.pulse(hand, HAPTICS.lockOpen, LOCK_OPEN_MS.clunk);
  }

  /** Every lock is open: the chord resolves, the walls open, the drawer slides, the box's tune; a roll on both hands. */
  boxOpened(seed: string, at?: Vec3): void {
    this.handle(at ? { type: "box-open", key: seed, at } : { type: "box-open", key: seed });
    this.d.haptics?.play("both", HAPTICS.boxOpen, BOX_OPEN_MS.chord);
  }

  /** A hint is shown for lock `lock`. */
  hint(lock: number): void {
    this.handle({ type: "hint", lock });
  }

  /** A lesson moves on a step: the lesson beat. */
  lessonStep(): void {
    this.handle({ type: "lesson-step" });
  }

  /** A menu opened over the box (or closed): the bed's menu low-pass, and the hums hush. */
  menuOpen(open: boolean): void {
    this.hums.hush(open);
    this.d.engine.setMusic(open ? "menu" : "calm");
  }

  /** Play ended (back to the menus): sounds and pulses still to come are dropped, hums fade. */
  reset(): void {
    this.scheduler.clear();
    this.d.haptics?.clear();
    this.hums.reset();
    this.hums.hush(false);
    this.spec = null;
    this.hums.setEnabled(false);
  }

  /** Per frame: timed sounds and pulses. */
  update(): void {
    this.scheduler.update();
    this.d.haptics?.update();
  }

  private warmthOn(): boolean {
    return this.d.warmth ? this.d.warmth() : true;
  }

  private pulse(hand: Hand | undefined, pattern: HapticPattern, offsetMs = 0): void {
    this.d.haptics?.play(hand ?? this.holding ?? "both", pattern, offsetMs);
  }
}
