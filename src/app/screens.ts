import { emit as appEmit, type FeedbackEvent } from "./bus";

/**
 * The screens: the drawer's menus (home, lessons, collection, settings, the reset confirm, the
 * trial) and play (a box or lesson in the lap, the drawer shut, no panel).
 */
export type Screen = "boot" | "home" | "lessons" | "collection" | "settings" | "reset" | "trial" | "play";

export const SCREENS: readonly Screen[] = ["boot", "home", "lessons", "collection", "settings", "reset", "trial", "play"];

/** The screens that raise a menu panel on the open drawer. */
export const MENU_SCREENS: readonly Screen[] = ["home", "lessons", "collection", "settings", "reset", "trial"];

export const isMenuScreen = (s: Screen): boolean => MENU_SCREENS.includes(s);

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
