import { GAZE_DWELL_MS } from "./constants";

/** Float slack for times added up frame by frame. */
const EPS_MS = 1e-6;

/**
 * Which lock is in focus. Head gaze resting on another lock for GAZE_DWELL_MS moves the focus to it; looking at
 * nothing (null) keeps the focus where it is. Any break in the gaze restarts the dwell.
 */
export class GazeFocus {
  private focus: number | null = null;
  private candidate: number | null = null;
  private dwellMs = 0;

  /** `hit` is the lock the head ray hits this frame, or null. Returns the lock in focus. */
  update(dtMs: number, hit: number | null): number | null {
    if (hit === null || hit === this.focus) {
      this.candidate = null;
      this.dwellMs = 0;
      return this.focus;
    }
    if (hit !== this.candidate) {
      this.candidate = hit;
      this.dwellMs = 0;
    }
    this.dwellMs += dtMs > 0 ? dtMs : 0;
    if (this.dwellMs >= GAZE_DWELL_MS - EPS_MS) {
      this.focus = hit;
      this.candidate = null;
      this.dwellMs = 0;
    }
    return this.focus;
  }
}
