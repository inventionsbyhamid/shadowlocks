import { STUCK_MS, STUCK_PROGRESS } from "./constants";

/** Float slack for times added up frame by frame, and for warmth sums. */
const EPS_MS = 1e-6;
const EPS_WARMTH = 1e-9;

/**
 * Notices a player who is stuck: true once `stuckMs` (STUCK_MS unless told) pass with no lock opening and the best
 * warmth never rising STUCK_PROGRESS above where it stood at the last progress. Falling back and returning is not
 * progress. The lessons read how long it has been since the last progress (`idleMs`) for their own help lines.
 */
export class StuckWatch {
  /** Best warmth at the last progress; a new box starts from 0. */
  private mark = 0;
  private sinceMs = 0;

  constructor(private readonly stuckMs = STUCK_MS) {}

  /** How long since the last progress (ms). */
  get idleMs(): number {
    return this.sinceMs;
  }

  /** Start over, as a new box would: from no warmth, no time. */
  reset(): void {
    this.mark = 0;
    this.sinceMs = 0;
  }

  /**
   * `bestWarmth` is the highest warmth over the unopened locks this frame; `opened` is true on the frame a lock
   * opens. Returns true while the player is stuck.
   */
  update(dtMs: number, bestWarmth: number, opened: boolean): boolean {
    if (opened || bestWarmth >= this.mark + STUCK_PROGRESS - EPS_WARMTH) {
      this.mark = bestWarmth;
      this.sinceMs = 0;
      return false;
    }
    this.sinceMs += dtMs > 0 ? dtMs : 0;
    return this.sinceMs >= this.stuckMs - EPS_MS;
  }
}
