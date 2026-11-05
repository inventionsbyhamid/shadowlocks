// Play time for timed feedback (layered sounds, haptic patterns): the sum of the frames the player
// saw. It stands still while the game is hidden (headset off, system menu, page hidden), and one long
// frame counts as at most MAX_STEP_MS, the same cap the lantern integrates with, so nothing that was
// waiting fires all at once when the game comes back.
import { MAX_STEP_MS } from "../feel/constants";

export class FrameClock {
  private ms = 0;

  /** Play time now (ms). A bound function, so it can be handed out as a clock. */
  readonly now = (): number => this.ms;

  /** One frame of `dtSec` seconds; counted only while the player can see the game. */
  step(dtSec: number, visible: boolean): void {
    if (!visible || !(dtSec > 0)) return;
    const ms = dtSec * 1000;
    this.ms += ms < MAX_STEP_MS ? ms : MAX_STEP_MS;
  }
}
