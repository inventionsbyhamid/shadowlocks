import { FINGER_GRACE_MS, FINGER_HOLD_MS } from "./constants";

export type FingerHoldState = "idle" | "holding" | "done";

/** Float slack for times added up frame by frame. */
const EPS_MS = 1e-6;

/**
 * A finger lock completes once the finger has met the gap for FINGER_HOLD_MS. Drops shorter than FINGER_GRACE_MS
 * pause the count without resetting it (the same grace keeps `done` through a flicker); a longer drop, or the
 * hand leaving tracking, starts it over from zero.
 */
export class FingerHold {
  private heldMs = 0;
  private gapMs = 0;

  /** 0..1 toward done. */
  get progress(): number {
    return this.heldMs / FINGER_HOLD_MS;
  }

  update(dtMs: number, meets: boolean, tracked: boolean): FingerHoldState {
    const dt = dtMs > 0 ? dtMs : 0;
    if (!tracked) {
      this.heldMs = 0;
      this.gapMs = 0;
      return "idle";
    }
    if (meets) {
      this.gapMs = 0;
      this.heldMs += dt;
      if (this.heldMs >= FINGER_HOLD_MS - EPS_MS) this.heldMs = FINGER_HOLD_MS;
    } else if (this.heldMs > 0) {
      this.gapMs += dt;
      if (this.gapMs >= FINGER_GRACE_MS - EPS_MS) {
        this.heldMs = 0;
        this.gapMs = 0;
      }
    }
    return this.heldMs >= FINGER_HOLD_MS ? "done" : this.heldMs > 0 ? "holding" : "idle";
  }
}
