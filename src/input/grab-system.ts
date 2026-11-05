// Hand input on IWSDK: per hand, what it is (hand, controller or none), whether it is tracked, its
// pinch (thumb and index tips, with hysteresis and a tracking grace) and where it pinches. IWSDK's
// grab is not used: its grab sphere sits on the palm and often takes the wrong thing, so hands pinch
// through our own detector and a controller's trigger or squeeze counts as the same pinch. Every
// hand joint is read once a frame into `handJoints` (the lantern grab and hand shadows read it too).
//
// Pointers, re-applied every frame (cheap when unchanged; survives IWSDK resetting a side): IWSDK's
// grab pointer is always off, and a hand the app says is busy (reaching for or holding the lantern)
// has its ray off, so its pinch cannot also click a button the ray points at. A hand the app says
// is holding something keeps its pinch through any tracking loss (the hand coming back decides).
//
// Frame order: InputSystem (-4) moves the pointers, HandPinchSystem (-3.2) reads the hands, then the
// app's input systems read `hands`. Allocation free per frame.
import { createSystem, Matrix4, Quaternion, Vector3, type World } from "@iwsdk/core";
import { registerAppSystem } from "../app/systems";
import { HandJoints } from "./hand-joints";
import { type PinchEdge, PinchDetector } from "./pinch";

export const SIDES = ["left", "right"] as const;
export type Side = (typeof SIDES)[number];
export type HandKind = "hand" | "controller" | "none";

/** One hand's pinch this frame. */
export interface HandPinch {
  kind: HandKind;
  tracked: boolean;
  pinching: boolean;
  edge: PinchEdge;
  /** Pinch point in world space (thumb and index tip midpoint; a controller's grip). */
  readonly point: Vector3;
  /** Index knuckle (hand) or grip (controller) in world space: carries a held object. */
  readonly anchor: Vector3;
  /** Wrist rotation in world space (hands; identity for controllers). */
  readonly rot: Quaternion;
}

const newPinch = (): HandPinch => ({
  kind: "none",
  tracked: false,
  pinching: false,
  edge: null,
  point: new Vector3(),
  anchor: new Vector3(),
  rot: new Quaternion(),
});

/** Both hands, left then right, refreshed every frame by HandPinchSystem. */
export const hands: readonly [HandPinch, HandPinch] = [newPinch(), newPinch()];

/** Every joint of both hands (world space), refreshed every frame by HandPinchSystem. */
export const handJoints = new HandJoints();

/** Is this hand busy (reaching for or holding something)? Its ray is off while it is. */
export type BusyHand = (side: 0 | 1) => boolean;

let busy: BusyHand = () => false;
let holding: BusyHand = () => false;

/** Per hand: what it is, whether it is tracked, its pinch (joints in, hysteresis) and pinch point. */
export class HandPinchSystem extends createSystem({}) {
  private readonly detectors: [PinchDetector, PinchDetector] = [new PinchDetector(), new PinchDetector()];
  private readonly wrist = new Matrix4();
  private readonly wristPos = new Vector3();
  private readonly wristScale = new Vector3();

  update(): void {
    const now = performance.now();
    const frame = this.xrFrame;
    const ref = this.renderer.xr.getReferenceSpace();
    if (frame && ref) handJoints.update(frame, ref, this.player.matrixWorld);
    else handJoints.clear();
    for (let i = 0; i < 2; i++) {
      const side = i as 0 | 1;
      const out = hands[side];
      const src = frame && ref ? this.input.xr.getPrimaryInputSource(SIDES[side]) : undefined;
      if (src?.hand) this.hand(side, now, out);
      else if (src) this.controller(side, out);
      else {
        // No hand at all (tracking lost, or no session): the detector rides out short dropouts,
        // and any dropout while the hand holds something.
        out.kind = "none";
        out.tracked = false;
        out.edge = this.detectors[side].update(now, false, Number.NaN, false, holding(side));
        out.pinching = this.detectors[side].active;
      }
    }
    for (let i = 0; i < 2; i++) {
      const side = i as 0 | 1;
      const kind = hands[side].kind;
      if (kind === "none") continue;
      const mp = this.input.xr.multiPointers[SIDES[side]];
      mp.toggleSubPointer("grab", false);
      mp.toggleSubPointer("ray", kind !== "hand" || !busy(side));
    }
  }

  private hand(i: 0 | 1, now: number, out: HandPinch): void {
    out.kind = "hand";
    const side = SIDES[i];
    // Tracked only with a pose for every joint: a headset can keep listing a hand it no longer sees.
    const tracked = handJoints.tracked(side);
    let distance = Number.NaN;
    if (tracked) {
      distance = handJoints.pinchDistance(side);
      handJoints.pinchPoint(side, out.point);
      handJoints.joint(side, "index-finger-phalanx-proximal", out.anchor);
      handJoints.pose(side, "wrist", this.wrist);
      this.wrist.decompose(this.wristPos, out.rot, this.wristScale);
    }
    const select = this.input.xr.getSelectState(side).active;
    out.edge = this.detectors[i].update(now, tracked, distance, select, holding(i));
    out.tracked = tracked;
    out.pinching = this.detectors[i].active;
  }

  /** Controllers: the trigger (select) or the squeeze is the pinch, at the grip. */
  private controller(i: 0 | 1, out: HandPinch): void {
    const side = SIDES[i];
    out.kind = "controller";
    this.detectors[i].reset();
    const sel = this.input.xr.getSelectState(side);
    const squeeze = !!this.input.xr.gamepads[side]?.getButtonPressed("xr-standard-squeeze");
    const pinching = sel.active || squeeze;
    out.edge = pinching && !out.pinching ? "start" : !pinching && out.pinching ? "end" : null;
    out.pinching = pinching;
    out.tracked = true;
    this.player.gripSpaces[side].getWorldPosition(out.point);
    out.anchor.copy(out.point);
    out.rot.identity();
  }
}

/**
 * Turn on hand input: registers HandPinchSystem (priority -3.2, "hand-pinch") through the app
 * registry, so the test hooks count it in the per-frame budget. `o.busy` says which hands have their
 * ray off (the lantern grab sets it once it exists). Call once, after the world exists.
 */
export function attachInput(world: World, o: { busy?: BusyHand } = {}): readonly [HandPinch, HandPinch] {
  if (o.busy) busy = o.busy;
  registerAppSystem(world, HandPinchSystem, { priority: -3.2, name: "hand-pinch" });
  return hands;
}

/** Change which hands count as busy (their rays go off from the next frame). */
export function setBusyHands(fn: BusyHand): void {
  busy = fn;
}

/**
 * Say which hands hold something that must ride out tracking loss (the lantern): their pinch never
 * times out while the hand is out of tracking; coming back open ends it, still closed resumes it.
 */
export function setHoldingHands(fn: BusyHand): void {
  holding = fn;
}
