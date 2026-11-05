import { emit } from "../app/bus";
import { type PressGate, pressGate } from "./poke";

/** Anything that dispatches pointer events: UIKit elements, IWSDK interactables, Object3Ds. */
interface PointerTarget {
  addEventListener(type: "pointerenter" | "click", listener: () => void): void;
}

/**
 * Wire a spatial button: `hover` on the bus when a fingertip, ray or mouse comes over it, and
 * `onPress` on a click (IWSDK's touch pointer for a poke, the pinch ray, the 2D mouse), at most one
 * press per 150 ms across all buttons (double pokes, two buttons hit together).
 */
export function bindButton(target: PointerTarget, id: string, onPress: () => void, gate: PressGate = pressGate): void {
  target.addEventListener("pointerenter", () => emit({ type: "hover", id }));
  target.addEventListener("click", () => {
    if (gate.accept(performance.now())) onPress();
  });
}
