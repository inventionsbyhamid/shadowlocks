// How one keycap moves: hover glow and lift, 6 mm press travel (crisp), and a springy pop with a
// squash on release. A fingertip drives the cap through the shared FingerKey rules (it
// follows the finger down, presses at 80% of the travel that is left, acts on the way back out,
// arms only from in front); a ray presses it all the way. Pure numbers; `key-view.ts` copies them
// into UIKit each frame. Shared by every key.
import { FingerKey, KEY_EVENT } from "../render/finger-key";
import { MOTION, settledAt, type SpringState, stepToward } from "./motion";

const K = MOTION.key;
const MM_TO_M = 0.001;

export class KeyMotion {
  /** Cap height above the panel plate (mm). */
  readonly z: SpringState = { x: K.restMm, v: 0 };
  /** Squash amount: scale x is 1 + s, scale y is 1 - s. */
  readonly sq: SpringState = { x: 0, v: 0 };
  /** Glow strength, 0..1. */
  glow = 0;
  /** False once everything has come to rest; the view skips sleeping keys. */
  active = false;
  /** A latched key (a toggle that is on) rests half way down, like a latching switch. */
  private latchedOn = false;
  private hoverCount = 0;
  private downCount = 0;
  private kick = false;
  private actionIn = 0;
  /**
   * The fingertip side (metres): set `finger.dist` (fingertip centre in front of the cap's rest
   * face, NaN when none) and `finger.inside`, then call `stepFinger()` once a frame.
   */
  readonly finger = new FingerKey(K.travelMm * MM_TO_M);

  get hovered(): boolean {
    return this.hoverCount > 0;
  }

  get pressed(): boolean {
    return this.downCount > 0;
  }

  /** A pointer came near (true) or left (false). Returns true when the key was not hovered before. */
  setHover(on: boolean): boolean {
    const was = this.hoverCount > 0;
    this.hoverCount = Math.max(0, this.hoverCount + (on ? 1 : -1));
    this.active = true;
    return !was && this.hoverCount > 0;
  }

  /**
   * One frame of the fingertip: the travel is what is left from the current rest (less for a
   * latched toggle). Returns a KEY_EVENT; a click or a cancel after a press gives the springy pop.
   */
  stepFinger(): number {
    const f = this.finger;
    const wasHovered = f.hovered;
    const wasDepth = f.depth;
    f.travel = (this.restZ - (K.restMm - K.travelMm)) * MM_TO_M;
    const e = f.step();
    if (e === KEY_EVENT.click || e === KEY_EVENT.cancel) this.kick = true;
    if (e !== KEY_EVENT.none || f.hovered !== wasHovered || f.depth !== wasDepth) this.active = true;
    return e;
  }

  /** A fingertip is over the key, within 3 cm in front of the cap or pushing it. */
  get touched(): boolean {
    return this.finger.hovered || this.finger.depth > 0;
  }

  /** Run the key's action after the short delay. */
  queueAction(): void {
    this.actionIn = K.actionDelayS;
  }

  get pendingAction(): boolean {
    return this.actionIn > 0;
  }

  /** Advance the action delay by `dt`; true once, when the action is due. */
  actionDue(dt: number): boolean {
    if (this.actionIn <= 0) return false;
    this.actionIn -= dt;
    if (this.actionIn > 1e-9) return false;
    this.actionIn = 0;
    return true;
  }

  /** A pointer went down (true) or came up (false). `released` adds the squash pop. */
  setDown(on: boolean, released = false): void {
    const was = this.downCount > 0;
    this.downCount = Math.max(0, this.downCount + (on ? 1 : -1));
    if (was && this.downCount === 0 && released) this.kick = true;
    this.active = true;
  }

  get latched(): boolean {
    return this.latchedOn;
  }

  set latched(on: boolean) {
    if (on === this.latchedOn) return;
    this.latchedOn = on;
    this.active = true;
  }

  /** Where the cap rests with no finger on it (mm above the plate). */
  get restZ(): number {
    return this.latchedOn ? K.restMm - K.travelMm / 2 : K.restMm;
  }

  /** Drop every pointer and the finger (the panel is leaving); springs keep running to rest. */
  release(): void {
    this.actionIn = 0;
    const f = this.finger;
    if (this.hoverCount === 0 && this.downCount === 0 && !f.hovered && f.depth === 0) return;
    this.hoverCount = 0;
    this.downCount = 0;
    f.reset();
    this.active = true;
  }

  /** Back to rest at once (panel hidden). */
  reset(): void {
    this.hoverCount = 0;
    this.downCount = 0;
    this.kick = false;
    this.finger.reset();
    this.actionIn = 0;
    this.z.x = this.restZ;
    this.z.v = 0;
    this.sq.x = 0;
    this.sq.v = 0;
    this.glow = 0;
    this.active = false;
  }

  /** Advance by `dt` seconds; returns whether the key is still moving. */
  step(dt: number, reduced: boolean): boolean {
    if (!this.active) return false;
    const down = this.downCount > 0;
    const rest = this.restZ;
    const f = this.finger;
    const hover = this.hoverCount > 0 || f.hovered;
    let zTarget = down ? K.restMm - K.travelMm : hover ? rest + K.hoverLiftMm : rest;
    // A finger on the cap holds it where the finger is (FingerKey keeps it within the travel).
    const touching = f.depth > 0;
    if (touching && !down) zTarget = rest - f.depth / MM_TO_M;
    const goingDown = zTarget < this.z.x;
    stepToward(this.z, zTarget, goingDown ? K.down : K.up, dt, reduced, K.travelMm);

    if (reduced) {
      this.kick = false;
      this.sq.x = 0;
      this.sq.v = 0;
    } else {
      if (this.kick) {
        this.sq.v += K.squashKick;
        this.kick = false;
      }
      stepToward(this.sq, 0, K.squash, dt, false, 1);
    }

    const glowTarget = down || touching ? K.glowPressed : hover ? 1 : 0;
    if (reduced) {
      const max = dt / (MOTION.reducedMs / 1000);
      const d = glowTarget - this.glow;
      this.glow = Math.abs(d) <= max ? glowTarget : this.glow + Math.sign(d) * max;
    } else {
      this.glow += (glowTarget - this.glow) * (1 - Math.exp(-K.glowRate * dt));
    }

    const zDone = settledAt(this.z, zTarget, 0.005);
    const sqDone = settledAt(this.sq, 0, 0.0005);
    const glowDone = Math.abs(this.glow - glowTarget) < 0.002;
    if (zDone && sqDone && glowDone) {
      this.z.x = zTarget;
      this.z.v = 0;
      this.sq.x = 0;
      this.sq.v = 0;
      this.glow = glowTarget;
      this.active = false;
    }
    return this.active;
  }

  get capZ(): number {
    return this.z.x;
  }

  /** How far the cap has slid down over its front skirt (mm). */
  get capDrop(): number {
    const d = ((K.restMm - this.z.x) / K.travelMm) * K.skirtMm;
    return Math.min(K.skirtMm, Math.max(-1, d));
  }

  get scaleX(): number {
    return 1 + this.sq.x;
  }

  get scaleY(): number {
    return 1 - this.sq.x;
  }
}
