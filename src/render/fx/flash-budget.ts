// One flash budget for everything that brightens (lock-open glows, celebrations, panel flares). A
// flash may start only when no flash of any kind started in the last MIN_GAP_S, so there are never
// more than 3 a second (comfort: no strobing). Sources that are refused wait their turn.

/** Shortest time between two flashes, in seconds (just over a third of a second). */
export const MIN_GAP_S = 0.34;

export class FlashBudget {
  /** Seconds since the last flash started (large when none). */
  private readonly since = new Float64Array([1e9]);
  /** Flashes started so far (tests count them). */
  started = 0;

  /** Advance the clock (once per frame, before any source asks). */
  step(dt: number): void {
    this.since[0] = (this.since[0] as number) + (dt > 0 ? dt : 0);
  }

  /** True when a flash may start now (and it counts as started). */
  take(): boolean {
    if ((this.since[0] as number) < MIN_GAP_S) return false;
    this.since[0] = 0;
    this.started++;
    return true;
  }

  /** Forget the last flash (a warm-up's flash does not count). */
  reset(): void {
    this.since[0] = 1e9;
    this.started = 0;
  }
}
