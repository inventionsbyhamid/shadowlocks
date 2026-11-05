/**
 * What the hands did, as the input systems report it to the bus.
 * - `hover` / `press`: a button (by id). Presses are debounced (one per 150 ms across buttons).
 * - `grab` / `release`: the lantern picked up / let go by `hand` (any reason: release, tracking
 *   loss). Sound starts on a grab, as on a press (browsers need a gesture).
 * - `tracking-lost`: a hand holding something was out of tracking for more than 150 ms.
 */
export type InputEvent =
  | { type: "hover"; id: string }
  | { type: "press"; id: string }
  | { type: "grab"; hand: "left" | "right" }
  | { type: "release"; hand: "left" | "right" }
  | { type: "tracking-lost"; hand: "left" | "right" };
