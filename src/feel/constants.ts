// Feel tuning: the single place for the lantern, finger hold, gaze and stuck numbers. Distances are in box
// units unless named _CM, times in ms unless named otherwise. The jitter bot tunes these and only these.

/** Lantern spring (rad/s), critically damped: it trails a moving hand by 2 / omega = 80 ms and never overshoots a step. */
export const SPRING_OMEGA = 25;
/** On release the lantern goes back to where it was this long before the pinch opened (opening drifts it ~1 cm). */
export const RELEASE_LOOKBACK_MS = 150;

/** "Deliberate": the filtered hand speed stays under this (cm/s)... */
export const SPEED_GATE_CMPS = 4;
/** ...for this long. Only then may the line lock or the settle engage. */
export const SPEED_GATE_MS = 200;
/**
 * Time constant of the low-pass on the smoothed hand's velocity (as a vector) that the gate reads. Averaging the
 * vector cancels tremor, which keeps changing direction, while a real move keeps its direction and gets through.
 * 100 ms passes 3 mm of white noise, 10 Hz tremor and a 2 Hz wobble; a sweep still closes the gate within ~0.6 cm.
 */
export const SPEED_FILTER_MS = 100;
/**
 * An assist also needs its target held this long first: the smoothed hand inside SETTLE_RADIUS of the same spot,
 * or the same lock's line the nearest aligned one. The dwell counts whatever the gate says, so it outlasts the
 * gate's lag: a fast sweep or a release drift that starts from a deliberate rest just outside the radius (or
 * beside a line) is caught by the gate before the dwell is up. Keep it at or above the gate's close time for a
 * 10 cm/s move from rest (122 ms at 90 Hz, about 130 ms in continuous time, with SPEED_FILTER_MS = 100) whenever
 * SPEED_FILTER_MS is retuned.
 */
export const ASSIST_DWELL_MS = 150;

/** While the ring line holds the lantern, hand motion across the line moves it this much. */
export const LINE_SIDEWAYS_GAIN = 0.2;
/** Pulling the hand this far off the line breaks free. */
export const LINE_BREAK_CM = 4;

/** A deliberate hand this close to an unopened spot makes the held lantern settle onto it. */
export const SETTLE_RADIUS = 0.1;
/** The hand must pull this many settle radii away to take the lantern back. */
export const SETTLE_RELEASE_MULT = 1.5;
/** How long the lantern takes to ease onto the spot. */
export const SETTLE_EASE_MS = 250;

/** A pinch starting this close to the lantern grabs it. */
export const GRAB_RADIUS_CM = 6;

/** A finger lock completes once the finger has met the gap this long... */
export const FINGER_HOLD_MS = 600;
/** ...where tracking drops shorter than this do not reset it. */
export const FINGER_GRACE_MS = 100;

/**
 * A lock opens once the lantern has met its rule this long while at rest (LanternController.atRest: not held,
 * settled, or held by a deliberate hand, the speed gate above); moving, the dwell starts over. So the shadows click
 * together soon after the lantern comes to rest on its spot, while no sweep opens a lock, even one along the lock's
 * ray, where the rule holds for half a second at 5 cm/s.
 */
export const OPEN_DWELL_MS = 150;

/** Head gaze on a new lock this long moves the focus to it. */
export const GAZE_DWELL_MS = 400;

/** The player is stuck after this long with no lock opening... */
export const STUCK_MS = 90000;
/** ...and the best warmth never rising this much. */
export const STUCK_PROGRESS = 0.1;

/** A dial tick plays as the lantern comes within each of these distances of the nearest unopened spot... */
export const DIAL_TICKS_CM: readonly number[] = [4, 3, 2, 1];
/** ...and each one is ready to play again once the lantern is this much further out than it. */
export const TICK_REARM_CM = 0.5;

/** Longest frame step the lantern integrates; a longer hitch counts as this long (no jumps in the timers). */
export const MAX_STEP_MS = 100;

/**
 * The lantern never goes deeper than the box's open front (box z): the shadows are cast from it onto the panel, which
 * needs it in front of every scrap and ring (they hang at z <= 0.75), or they flip and run off to infinity. The game
 * gives it as LanternCtx.minZ and clamps placed lanterns to it.
 */
export const LANTERN_MIN_Z = 1;
