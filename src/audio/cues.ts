import type { FeedbackEvent } from "../app/bus";
import type { Vec3 } from "../core/types";
import type { AudioEngine, PlayHandle, PlayOptions } from "./engine";
import type { MusicState, SfxId, StingId } from "./manifest";

/**
 * Bus events (hands, the shell, and the box session's game events once it has them) as cue input.
 * Events are read only through `type` and a few optional fields (`id`, `to`, `k`, `done`, and an
 * `at` position), so this file does not depend on how each event is declared. The cue logic stays
 * pure: the demo video's mix replays it from the recorded events.
 */
export type CueEvent = FeedbackEvent | { type: string; [key: string]: unknown };

export type Cue =
  | { kind: "sfx"; id: SfxId; position?: Vec3; pitch?: number; gain?: number; variant?: number }
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

const unit = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function positionOf(e: { [k: string]: unknown }): Vec3 | undefined {
  const at = e.at;
  if (Array.isArray(at) && at.length === 3 && at.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return [at[0], at[1], at[2]];
  }
  return undefined;
}

export interface CueMapperOptions {
  /**
   * Finds where an event happened in the world (a button id to a position, say) when the event
   * itself carries no `at`. Spatial sounds use it.
   */
  locate?: (event: CueEvent) => Vec3 | undefined;
}

/**
 * Turns events into cues. Music cues are emitted whenever the wanted state may have changed; the
 * engine ignores repeats. The box session's game events (lock open, rings, hints...) join this
 * mapping with the sound wiring.
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

  /** A spatial sound at the event's own `at`, else wherever `locate` puts it, else head-locked. */
  private sfxAt(out: Cue[], id: SfxId, e: CueEvent, extra?: Partial<PlayOptions>): void {
    const position = positionOf(e) ?? this.opts.locate?.(e);
    out.push(position ? { kind: "sfx", id, position, ...extra } : { kind: "sfx", id, ...extra });
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

/** Sends cues to the engine. An sfx cue carries the play options itself, so nothing is allocated here. */
export function applyCues(engine: CueTarget, cues: readonly Cue[], onHandle?: HandleSink): void {
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    if (c.kind === "sfx") {
      const h = engine.play(c.id, c);
      onHandle?.(c.id, h);
    } else if (c.kind === "sting") engine.sting(c.id);
    else engine.setMusic(c.state);
  }
}

/** Returns a handler for batches of events: wire it to the bus (and the box session's events). */
export function attachCues(engine: CueTarget, mapper = new CueMapper(), onHandle?: HandleSink): (events: readonly CueEvent[]) => void {
  return (events) => applyCues(engine, mapper.map(events), onHandle);
}
