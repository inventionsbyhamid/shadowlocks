import type { InputEvent } from "../input/events";
import type { GameEvent } from "./events";
import type { Screen } from "./screens";

/**
 * Events from the app shell itself.
 * - `screen`: the screen changed (src/app/screens.ts).
 * - `notice`: a short message for the player (the 2D page and the home panel show it).
 * - `count`: a number counting up on a panel (`id`, the element) moved on, `k` of the way (0..1);
 *   `done` when it landed on its value. One object is reused for every step: copy it to keep it.
 * - `slider`: a settings slider (`id`, the key pressed) stepped to `k` of its range (0..1).
 * - `drawer`: a hand pulled the menu drawer open (a record: its sound went through GameSounds).
 */
export type UiEvent =
  | { type: "screen"; from: Screen; to: Screen }
  | { type: "notice"; text: string }
  | { type: "count"; id: string; k: number; done: boolean }
  | { type: "slider"; id: string; k: number }
  | { type: "drawer"; hand: "left" | "right" };

/** Everything visuals, sound and captions react to: hands, the shell and the box session's game events (events.ts). */
export type FeedbackEvent = InputEvent | UiEvent | GameEvent;
export type FeedbackType = FeedbackEvent["type"];
export type EventOf<T extends FeedbackType> = Extract<FeedbackEvent, { type: T }>;

type Listener = (e: FeedbackEvent) => void;

export interface Bus {
  emit(e: FeedbackEvent): void;
  on<T extends FeedbackType>(type: T, fn: (e: EventOf<T>) => void): () => void;
  /** Every event, in order (logging, test hooks). */
  onAny(fn: (e: FeedbackEvent) => void): () => void;
  /** How many listeners are subscribed now, typed and catch-all together (the soak checks a long session gathers none). */
  listeners(): number;
}

/**
 * A small typed event bus. `emit` does not allocate: listener lists are replaced, never mutated,
 * on subscribe and unsubscribe, so an emit in progress always finishes over the list it started with.
 * A listener that throws is logged and the rest still run.
 */
export function createBus(): Bus {
  const byType = new Map<FeedbackType, Listener[]>();
  let any: Listener[] = [];

  const run = (list: Listener[], e: FeedbackEvent) => {
    for (let i = 0; i < list.length; i++) {
      try {
        (list[i] as Listener)(e);
      } catch (err) {
        console.error(`bus listener for "${e.type}" failed`, err);
      }
    }
  };

  return {
    emit(e) {
      const list = byType.get(e.type);
      if (list) run(list, e);
      if (any.length) run(any, e);
    },
    on(type, fn) {
      const l = fn as Listener;
      byType.set(type, [...(byType.get(type) ?? []), l]);
      return () => {
        const list = byType.get(type);
        if (list?.includes(l)) byType.set(type, list.filter((x) => x !== l));
      };
    },
    onAny(fn) {
      any = [...any, fn];
      return () => {
        any = any.filter((x) => x !== fn);
      };
    },
    listeners() {
      let n = any.length;
      for (const list of byType.values()) n += list.length;
      return n;
    },
  };
}

/** The app's bus. */
export const bus = createBus();
export const emit = bus.emit;
export const on = bus.on;
export const onAny = bus.onAny;
export const listenerCount = bus.listeners;
