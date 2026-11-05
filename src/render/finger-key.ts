// A key that follows the fingertip, shared by every fingertip key in the game so every key
// feels one way. The cap travels with the finger (the fingertip's distance to the cap face, minus
// the fingertip's radius), `press` fires when it is 80 % of the way down, the action fires on the
// way back out once the finger is 3 mm past the cap's rest face, and only then can it press again.
// So nothing fires before the finger visually touches the cap, and a double poke is one press. It
// arms only while a fingertip is over the key and clear in front of it, so a hand already behind
// the key, or sliding in low from the side (from the next key), cannot press it. Tracking loss lets
// go. Pure (no three.js).

export const FINGER_KEY = {
  /** Fingertip radius: the finger's surface touches the cap when its centre is this far out (m). */
  fingerRadius: 0.008,
  /** Press at this share of the cap's travel. */
  pressAt: 0.8,
  /** Back out this far past the rest face to fire the action and re-arm (m). */
  rearm: 0.003,
  /** A fingertip this close in front (and over the cap) hovers it (m). */
  hoverRange: 0.03,
} as const;

/** What one frame of a finger key did. */
export const KEY_EVENT = { none: 0, hoverIn: 1, press: 2, click: 3, cancel: 4 } as const;

export class FingerKey {
  /**
   * Inputs, set before each step: the fingertip centre's distance in front of the cap's rest face
   * (metres, negative once pushed past it; NaN when no fingertip), and whether it is over the cap.
   * Fields, not arguments: V8 boxes loose doubles passed to calls it does not inline.
   */
  dist = Number.NaN;
  inside = false;
  /** Cap travel now (0..travel, metres), following the finger. */
  depth = 0;
  /** Pressed (past 80 %) and waiting for the finger to come back out. */
  pressed = false;
  /** A fingertip hovers the cap. */
  hovered = false;
  private armed = false;

  /** `travel` (m) may change between steps: a latched toggle has less of it left. */
  constructor(public travel: number) {}

  /** One frame. Returns a KEY_EVENT. */
  step(): number {
    const d = this.dist;
    const over = d === d && this.inside;
    const wasHovered = this.hovered;
    this.hovered = over && d <= FINGER_KEY.fingerRadius + FINGER_KEY.hoverRange;
    if (!over) {
      this.depth = 0;
      this.armed = false;
      const wasPressed = this.pressed;
      this.pressed = false;
      return wasPressed ? KEY_EVENT.cancel : KEY_EVENT.none;
    }
    const push = FINGER_KEY.fingerRadius - d;
    this.depth = push <= 0 ? 0 : push >= this.travel ? this.travel : push;
    const clear = d >= FINGER_KEY.fingerRadius + FINGER_KEY.rearm;
    if (this.pressed) {
      if (!clear) return KEY_EVENT.none;
      this.pressed = false;
      this.armed = true;
      return KEY_EVENT.click;
    }
    if (clear) this.armed = true;
    if (this.armed && this.depth >= FINGER_KEY.pressAt * this.travel) {
      this.pressed = true;
      this.armed = false;
      return KEY_EVENT.press;
    }
    return this.hovered && !wasHovered ? KEY_EVENT.hoverIn : KEY_EVENT.none;
  }

  /** Forget the finger (the key closed). */
  reset(): void {
    this.dist = Number.NaN;
    this.inside = false;
    this.depth = 0;
    this.pressed = false;
    this.hovered = false;
    this.armed = false;
  }
}

/** How far behind a key's face (beyond its travel) a fingertip stops counting: 10 mm. */
export const BEHIND_SLACK = 0.01;

/**
 * Which fingertip drives a key: among those over it and not too far behind its face (more than its
 * travel and 10 mm behind is a hand resting under the panel, or a poke gone through it), the one
 * nearest the cap. `dist[i]` is fingertip i's distance in front of the cap face (m), `over[i]`
 * whether it is over the key. Returns the chosen distance, or NaN for none.
 */
export function nearestFinger(n: number, dist: ArrayLike<number>, over: ArrayLike<number>, travel: number): number {
  const behind = -(travel + BEHIND_SLACK);
  let best = Number.NaN;
  for (let i = 0; i < n; i++) {
    if (!over[i]) continue;
    const d = dist[i] as number;
    if (d !== d || d < behind) continue;
    if (best !== best || d < best) best = d;
  }
  return best;
}
