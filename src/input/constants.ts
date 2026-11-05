// Hand input tuning shared by every input module. Distances in metres, times in ms. Feel tuning for
// the lantern (spring, settle, line lock) lives in src/feel/constants.ts.

/** A pinch starts when the thumb and index fingertips are this close... */
export const PINCH_START_M = 0.015;
/** ...and ends only when they are this far apart again (hysteresis, so a held lantern does not drop). */
export const PINCH_END_M = 0.03;

/**
 * One Euro filter for a held object. It runs on millimetres, so `beta` is per mm/s: a still hand is
 * smoothed at about 1.2 to 5 Hz, a moving hand opens the filter to well over 100 Hz (under 1 mm of lag).
 */
export const ONE_EURO = { minCutoff: 1.2, beta: 0.8, dCutoff: 1.0 } as const;

/** Fingertip poke on a flat button: presses this far past the face... */
export const POKE_PRESS_M = 0.008;
/** ...and re-arms once back out to this depth. */
export const POKE_REARM_M = 0.004;
/** At most one press per this long, across all buttons (double pokes, two buttons hit at once). */
export const PRESS_DEBOUNCE_MS = 150;

/** A hand out of tracking longer than this lets go of what it holds (shorter dropouts are ridden out). */
export const TRACKING_GRACE_MS = 150;
