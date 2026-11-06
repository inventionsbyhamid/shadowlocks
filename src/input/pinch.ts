import { PINCH_END_M, PINCH_START_M, TRACKING_GRACE_MS } from "./constants";

/**
 * What a pinch did this frame:
 * - `start` / `end`: the hand closed / opened (a release that counts: it lets go).
 * - `resume`: tracking came back within the grace time with the fingers still together (keep
 *   holding).
 * - `cancel`: tracking was gone too long; the pinch is over, but not as a release (never a release).
 */
export type PinchEdge = "start" | "end" | "resume" | "cancel" | null;

/** A pinch ends only after the hand has been open this many frames in a row. */
export const PINCH_END_FRAMES = 2;

/**
 * Pinch from the thumb and index fingertip distance, with hysteresis: starts at <= 15 mm, ends at
 * >= 30 mm held for two frames in a row (one occluded frame must not let go).
 * The runtime's own pinch (WebXR select) may also start one while the fingertips are under 30 mm
 * apart, but never ends one: a held object only drops when the fingers clearly open. Survives short
 * tracking dropouts (back open: ends at once, never resumes); after a long one, waits for an open
 * hand before the next pinch.
 */
export class PinchDetector {
  /** Pinching now. */
  active = false;
  private lostAt = -1;
  /** After a cancel: no new pinch until the hand has been seen open. */
  private blocked = false;
  private openFrames = 0;

  /**
   * One frame. `tracked`: the hand has a pose. `distanceM`: thumb tip to index tip, NaN when the
   * runtime gives no joints. `select`: the runtime's own pinch for this hand. `hold`: the pinch
   * holds something that must ride out any tracking loss (the lantern): while it is set the pinch
   * never times out of tracking; the hand coming back decides (open ends it at once, still closed
   * resumes it).
   */
  update(now: number, tracked: boolean, distanceM: number, select: boolean, hold = false): PinchEdge {
    if (!tracked) {
      if (this.lostAt < 0) this.lostAt = now;
      if (this.active && !hold && now - this.lostAt > TRACKING_GRACE_MS) {
        this.active = false;
        this.blocked = true;
        this.openFrames = 0;
        return "cancel";
      }
      return null;
    }
    const wasLost = this.lostAt >= 0;
    this.lostAt = -1;

    const joints = Number.isFinite(distanceM);
    const open = joints ? distanceM >= PINCH_END_M : !select;
    if (this.blocked) {
      if (open && !select) this.blocked = false;
      return null;
    }
    if (this.active) {
      if (!open) {
        this.openFrames = 0;
        return wasLost ? "resume" : null;
      }
      // Back from a dropout already open: let go now (a held object must not follow an open hand).
      if (wasLost || ++this.openFrames >= PINCH_END_FRAMES) {
        this.active = false;
        this.openFrames = 0;
        return "end";
      }
      return null;
    }
    const closed = joints ? distanceM <= PINCH_START_M || (select && distanceM < PINCH_END_M) : select;
    if (closed) {
      this.active = true;
      return "start";
    }
    return null;
  }

  reset(): void {
    this.active = false;
    this.lostAt = -1;
    this.blocked = false;
    this.openFrames = 0;
  }
}
