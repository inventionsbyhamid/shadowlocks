// What the box session tells the bus (src/app/bus.ts): the box starting and opening, each lock's warmth, rings,
// finger and opening, hints, the stuck watch, the gaze focus, the reward, and the lantern's feel events. Visuals,
// captions, the theatre lights and the demo video's sound mix listen; the game's own sounds come from the session
// calling GameSounds directly (sound skips these on the bus, so nothing plays twice).
//
// Events the bus keeps (the test log, the video recorder) must not change afterwards, so each one is either frozen
// and shared (made here once), made fresh when it is rare (a box key, a copied feel event), or, for the two that
// can come many frames in a row, one reused object per lock that the log copies: `warmth` and `finger`.
import type { FeelEvent } from "../feel/lantern-controller";

/** The hint levels: 1 its scraps glow, 2 its rings glow and its line shows, 3 a marker at the spot's distance, 4 a ghost lantern on the spot. */
export type HintLevel = 1 | 2 | 3 | 4;

/**
 * The game's events.
 * - `box-start` {key}: a box is in play (a new one, or one resumed).
 * - `warmth` {lock, w}: the warmth the panel shows for a lock moved (0..1; 0 with the Warmth setting off). REUSED
 *   per lock: copy it to keep it.
 * - `ring` {lock, on}: a lock's two sight rings lined up (on) or parted. Locks without rings never send it.
 * - `short` {lock}: a finger lock's scraps are in place and only its missing piece is not ("one piece short").
 * - `finger` {lock, progress}: the finger's hold on a finger lock moved on (0..1). REUSED per lock: copy it.
 * - `crystallise` {lock}: the hold is done and the missing piece forms where the finger was.
 * - `lock-open` {lock, order}: a lock opened, the `order`-th of its box (1 for the first).
 * - `box-open` {key}: every lock is open: the box opens (the theatre's cue: gold sweep, room light up).
 * - `reward-taken` {key}: the box's reward was taken (by hand, or by itself after 8 s); it went into the collection
 *   when the box opened.
 * - `hint` {lock, level}: a hint was shown for a lock.
 * - `stuck` {on}: the stuck watch lit the hint lantern (on), or the player moved on or took a hint (off).
 * - `focus` {lock}: the lock the head gaze rests on (null: none; it clears when that lock opens).
 * - `coach` {line}: the coach line's suggestion (a key of COPY.game; null: none). "controllerFinger" while a finger
 *   lock is one piece short and controllers are in use.
 * - `feel` {e}: a lantern feel event (grab, release, line, settle, unsettle, tick), copied.
 */
export type GameEvent =
  | { type: "box-start"; key: string }
  | { type: "warmth"; lock: number; w: number }
  | { type: "ring"; lock: number; on: boolean }
  | { type: "short"; lock: number }
  | { type: "finger"; lock: number; progress: number }
  | { type: "crystallise"; lock: number }
  | { type: "lock-open"; lock: number; order: number }
  | { type: "box-open"; key: string }
  | { type: "reward-taken"; key: string }
  | { type: "hint"; lock: number; level: HintLevel }
  | { type: "stuck"; on: boolean }
  | { type: "focus"; lock: number | null }
  | { type: "coach"; line: CoachLine | null }
  | { type: "feel"; e: FeelEvent };

/** The coach line's suggestions the session gives (keys of COPY.game). */
export type CoachLine = "controllerFinger";

export type GameEventType = GameEvent["type"];

/** Every game event type (sound leaves these to the session). */
export const GAME_EVENT_TYPES: ReadonlySet<string> = new Set<GameEventType>([
  "box-start",
  "warmth",
  "ring",
  "short",
  "finger",
  "crystallise",
  "lock-open",
  "box-open",
  "reward-taken",
  "hint",
  "stuck",
  "focus",
  "coach",
  "feel",
]);

/** Events that come many frames in a row: one object per lock, refilled. Whoever keeps one copies it. */
export const REUSED_EVENT_TYPES: ReadonlySet<string> = new Set<GameEventType>(["warmth", "finger"]);

/** A box has at most three locks. */
export const MAX_LOCKS = 3;

type Of<T extends GameEventType> = Extract<GameEvent, { type: T }>;

const per = <T>(make: (lock: number) => T): readonly T[] => Object.freeze(Array.from({ length: MAX_LOCKS }, (_, i) => make(i)));
const frozen = <T extends GameEvent>(e: T): T => Object.freeze(e);

/** RING[lock][on ? 1 : 0]. */
export const RING: readonly (readonly [Of<"ring">, Of<"ring">])[] = per((lock) =>
  Object.freeze([frozen({ type: "ring", lock, on: false }), frozen({ type: "ring", lock, on: true })] as const),
);
export const SHORT: readonly Of<"short">[] = per((lock) => frozen({ type: "short", lock }));
export const CRYSTALLISE: readonly Of<"crystallise">[] = per((lock) => frozen({ type: "crystallise", lock }));
/** LOCK_OPEN[lock][order - 1]. */
export const LOCK_OPEN: readonly (readonly Of<"lock-open">[])[] = per((lock) => per((k) => frozen({ type: "lock-open", lock, order: k + 1 })));
/** HINT[lock][level - 1]. */
export const HINT: readonly (readonly Of<"hint">[])[] = per((lock) =>
  Object.freeze(([1, 2, 3, 4] as const).map((level) => frozen({ type: "hint", lock, level }))),
);
/** STUCK[on ? 1 : 0]. */
export const STUCK: readonly [Of<"stuck">, Of<"stuck">] = Object.freeze([frozen({ type: "stuck", on: false }), frozen({ type: "stuck", on: true })] as const);
/** COACH[on ? 1 : 0]: the controller tip, or no line. */
export const COACH: readonly [Of<"coach">, Of<"coach">] = Object.freeze([frozen({ type: "coach", line: null }), frozen({ type: "coach", line: "controllerFinger" })] as const);
/** FOCUS[lock + 1] (FOCUS[0] is no lock). */
export const FOCUS: readonly Of<"focus">[] = Object.freeze([frozen({ type: "focus", lock: null }), ...per((lock) => frozen({ type: "focus", lock }))]);

/** The reused per-lock `warmth` and `finger` events of one session. */
export function reusedEvents(): { warmth: Of<"warmth">[]; finger: Of<"finger">[] } {
  return {
    warmth: Array.from({ length: MAX_LOCKS }, (_, lock) => ({ type: "warmth", lock, w: 0 })),
    finger: Array.from({ length: MAX_LOCKS }, (_, lock) => ({ type: "finger", lock, progress: 0 })),
  };
}
