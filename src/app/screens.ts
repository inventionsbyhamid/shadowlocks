import { emit as appEmit, type FeedbackEvent } from "./bus";

/** The screens so far: the first screen (home), settings, and play (a box in the lap, no panel). */
export type Screen = "boot" | "home" | "settings" | "play";

export const SCREENS: readonly Screen[] = ["boot", "home", "settings", "play"];

export interface Screens {
  current(): Screen;
  /** Move to `to`; false when already there or not allowed. */
  go(to: Screen): boolean;
}

/**
 * The screen state machine. `boot` is only the starting screen; any other move is allowed.
 * Each move emits one `screen` event. A move asked for while listeners of another move are still
 * running waits until they finish, so every listener sees moves in order and `current()` always
 * matches the event being handled.
 */
export function createScreens(emit: (e: FeedbackEvent) => void, initial: Screen = "boot"): Screens {
  let current = initial;
  let moving = false;
  const queued: Screen[] = [];

  const apply = (to: Screen) => {
    const from = current;
    current = to;
    emit({ type: "screen", from, to });
  };

  return {
    current: () => current,
    go(to) {
      if (to === "boot") {
        console.warn("screens: cannot go back to boot");
        return false;
      }
      const last = queued.length ? queued[queued.length - 1] : current;
      if (to === last) return false;
      if (moving) {
        queued.push(to);
        return true;
      }
      moving = true;
      try {
        apply(to);
        while (queued.length) {
          const next = queued.shift() as Screen;
          if (next !== current) apply(next);
        }
      } finally {
        moving = false;
        queued.length = 0;
      }
      return true;
    },
  };
}

/** The app's screens. */
export const screens = createScreens(appEmit);
export const go = (to: Screen): void => {
  screens.go(to);
};
export const currentScreen = (): Screen => screens.current();
