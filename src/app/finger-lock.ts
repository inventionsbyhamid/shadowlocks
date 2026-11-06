// A finger lock's completion: with the scraps in place and the finger's shadow filling the gap (the solve rule,
// `meets` with the finger), held for 0.6 s through FingerHold's grace, the lock is done: it stays done whatever the
// hand does next, and its crystallise runs once. A hand out of tracking never counts, however well its last pose
// filled the gap; a drop shorter than the grace pauses the count, a longer one starts it over.
//
// The box session owns one loop per finger lock, made through its finger seam (session-fingers.ts), and feeds it the
// lock's coverage with this frame's finger. Allocation-free per frame.
import { type Coverage, meets } from "../core/solve";
import { FINGER_GRACE_MS } from "../feel/constants";
import { FingerHold, type FingerHoldState } from "../feel/finger-hold";

export type FingerLockState = FingerHoldState;

/** Float slack for times added up frame by frame (as FingerHold's). */
const EPS_MS = 1e-6;

export class FingerLockLoop {
  /** The crystallise started when the lock was done, or null before. */
  crystal: Promise<void> | null = null;
  private readonly hold = new FingerHold();
  private current: FingerLockState = "idle";
  private lostMs = 0;

  /** `onDone` runs once, on the frame the lock is done: it starts the crystallise. */
  constructor(private readonly onDone: () => Promise<void> | void) {}

  get state(): FingerLockState {
    return this.current;
  }

  /** The lock is done (open), for good. */
  get open(): boolean {
    return this.current === "done";
  }

  /** 0..1 toward done. */
  get progress(): number {
    return this.current === "done" ? 1 : this.hold.progress;
  }

  /**
   * One frame: `coverage` is the lock's with this frame's finger polygons, `tracked` whether a hand that can cast
   * the finger (any hand not holding the lantern) is in tracking.
   */
  update(dtMs: number, coverage: Coverage, tracked: boolean): FingerLockState {
    if (this.current === "done") return "done";
    const dt = dtMs > 0 ? dtMs : 0;
    this.lostMs = tracked ? 0 : this.lostMs + dt;
    const s = this.hold.update(dt, tracked && meets(coverage, true), this.lostMs < FINGER_GRACE_MS - EPS_MS);
    this.current = s;
    if (s === "done") {
      const run = this.onDone();
      this.crystal = run instanceof Promise ? run : Promise.resolve();
    }
    return s;
  }
}
