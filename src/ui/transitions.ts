// Screen transitions: each menu panel has a presence spring (0 hidden, 1 shown). Entering panels
// rise into place, grow and fade in with a small springy overshoot; leaving panels sink and fade
// fast. Reduced motion turns both into a 40 ms fade. Pure numbers; the menus apply them.
import { MOTION, settledAt, type SpringState, stepToward } from "./motion";

const P = MOTION.panel;
/** Below this presence a leaving panel is hidden (no draw calls). */
const HIDE_AT = 0.02;

export class PanelMotion {
  readonly p: SpringState = { x: 0, v: 0 };
  /** Drawn at all (false once a leaving panel is gone). */
  visible = false;
  private target = 0;
  private delay = 0;
  private reduced = false;

  /** Start entering after `delayS` seconds. */
  enter(delayS: number): void {
    if (!this.visible) {
      this.p.x = 0;
      this.p.v = 0;
    }
    this.target = 1;
    this.delay = Math.max(0, delayS);
    this.visible = true;
  }

  exit(): void {
    this.target = 0;
    this.delay = 0;
  }

  /** Shown at once (no animation). */
  show(): void {
    this.target = 1;
    this.delay = 0;
    this.p.x = 1;
    this.p.v = 0;
    this.visible = true;
  }

  /** Hidden at once. */
  hide(): void {
    this.target = 0;
    this.delay = 0;
    this.p.x = 0;
    this.p.v = 0;
    this.visible = false;
  }

  /** True while entering or leaving. */
  get moving(): boolean {
    return this.visible && (this.delay > 0 || this.p.x !== this.target || this.p.v !== 0);
  }

  get entering(): boolean {
    return this.target === 1;
  }

  /** Advance by `dt` seconds; returns whether it is still moving. */
  step(dt: number, reduced: boolean): boolean {
    this.reduced = reduced;
    if (!this.visible) return false;
    let d = dt;
    if (this.delay > 0) {
      this.delay -= d;
      if (this.delay > 0) return true;
      d = -this.delay;
      this.delay = 0;
    }
    stepToward(this.p, this.target, this.target === 1 ? P.enter : P.exit, d, reduced, 1);
    if (this.target === 0 && this.p.x < HIDE_AT) {
      this.hide();
      return false;
    }
    if (this.target === 1 && settledAt(this.p, 1, 0.001)) {
      this.p.x = 1;
      this.p.v = 0;
      return false;
    }
    return true;
  }

  /** Uniform scale (overshoots a little above 1 while popping in). */
  get scale(): number {
    if (this.reduced) return 1;
    return P.scaleFrom + (1 - P.scaleFrom) * this.p.x;
  }

  /** Offset along the panel's up direction (mm): below its place while hidden. */
  get liftMm(): number {
    if (this.reduced) return 0;
    return (this.p.x - 1) * P.slideMm;
  }

  get opacity(): number {
    const k = this.reduced ? this.p.x : this.p.x * 1.8;
    return Math.min(1, Math.max(0, k));
  }
}
