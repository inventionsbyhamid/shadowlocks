// One flash budget for everything that brightens (lock-open glows, celebrations, panel flares). A
// flash may start only when no flash of any kind started in the last MIN_GAP_S, so there are never
// more than 3 a second (comfort: no strobing). Sources that are refused wait their turn. A flash due
// a known time ahead (the box opening, 0.7 s after its last lock) is reserved: nothing else starts in
// the gap before it, so the climax always gets its full flash.

/** Shortest time between two flashes, in seconds (just over a third of a second). */
export const MIN_GAP_S = 0.34;
/** A reservation also keeps this much more clear before it: its flash may come a frame early. */
const RESERVE_SLACK_S = 0.1;

export class FlashBudget {
  /** Seconds since the last flash started (large when none). */
  private readonly since = new Float64Array([1e9]);
  /** Seconds until the reserved flash (negative once due); NaN when none is reserved. */
  private readonly until = new Float64Array([Number.NaN]);
  /** Flashes started so far (tests count them). */
  started = 0;

  /** Advance the clock (once per frame, before any source asks). */
  step(dt: number): void {
    const d = dt > 0 ? dt : 0;
    this.since[0] = (this.since[0] as number) + d;
    this.until[0] = (this.until[0] as number) - d;
  }

  /**
   * A flash `inS` from now must have its turn (the box opening after its last lock): until it is claimed, no other
   * flash starts in the gap before it. Not claimed within MIN_GAP_S after its time, it lapses.
   */
  reserve(inS: number): void {
    this.until[0] = inS;
  }

  /** True when a flash may start now (and it counts as started). */
  take(): boolean {
    const u = this.until[0] as number;
    if (u === u) {
      if (u < -MIN_GAP_S) this.until[0] = Number.NaN;
      else if (u <= MIN_GAP_S + RESERVE_SLACK_S) return false;
    }
    if ((this.since[0] as number) < MIN_GAP_S) return false;
    this.since[0] = 0;
    this.started++;
    return true;
  }

  /** The reserved flash itself (or any flash, when none is reserved): the reservation ends, then it takes as take() does. */
  claim(): boolean {
    this.until[0] = Number.NaN;
    return this.take();
  }

  /** Forget the last flash and any reservation (a warm-up's flash does not count). */
  reset(): void {
    this.since[0] = 1e9;
    this.until[0] = Number.NaN;
    this.started = 0;
  }
}
