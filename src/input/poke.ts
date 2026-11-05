import { POKE_PRESS_M, POKE_REARM_M, PRESS_DEBOUNCE_MS } from "./constants";

/**
 * A leading-edge debounce shared by every button: a click counts only after 150 ms without any click
 * (counted or not). So a double poke, a poke that bounces, two buttons hit together, or a fingertip
 * resting on IWSDK's 2 cm press threshold and jittering across it give one press.
 */
export class PressGate {
  private last = Number.NEGATIVE_INFINITY;

  constructor(readonly debounceMs = PRESS_DEBOUNCE_MS) {}

  accept(now: number): boolean {
    const quiet = now - this.last >= this.debounceMs;
    this.last = now;
    return quiet;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/** The app's gate for every button press (spatial panels, 3D buttons, mouse on the 2D page). */
export const pressGate = new PressGate();

/**
 * Fingertip poke on one flat 3D button: presses once the fingertip is 8 mm past the face, re-arms
 * when it comes back out to 4 mm or slides off the button; every press goes through a PressGate.
 * For buttons that are not UIKit elements (UIKit buttons use IWSDK's touch pointer plus the gate).
 * No allocation.
 */
export class PokeTracker {
  /** Pushed in now (for the button's look). */
  pressed = false;
  private armed = true;

  constructor(private readonly gate: PressGate = pressGate) {}

  /**
   * One frame. `depthM`: how far the fingertip is past the button face (negative in front of it,
   * NaN when the fingertip is not tracked). `inside`: the fingertip is over the button's face.
   * Returns true when this frame is a press.
   */
  update(depthM: number, inside: boolean, now: number): boolean {
    if (!inside) {
      this.armed = true;
      this.pressed = false;
      return false;
    }
    if (Number.isNaN(depthM)) return false;
    if (depthM <= POKE_REARM_M) {
      this.armed = true;
      this.pressed = false;
      return false;
    }
    if (this.armed && depthM >= POKE_PRESS_M) {
      this.armed = false;
      this.pressed = true;
      return this.gate.accept(now);
    }
    return false;
  }
}
