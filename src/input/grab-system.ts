// Hand input on IWSDK: per hand, what it is (hand, controller or none), whether it is tracked, its
// pinch (thumb and index tips, with hysteresis and a tracking grace) and where it pinches. IWSDK's
// grab is not used: its grab sphere sits on the palm and often takes the wrong thing, so hands pinch
// through our own detector and a controller's trigger or squeeze counts as the same pinch.
//
// Pointers, re-applied every frame (cheap when unchanged; survives IWSDK resetting a side): IWSDK's
// grab pointer is always off, and a hand the app says is busy (reaching for or holding the lantern)
// has its ray off, so its pinch cannot also click a button the ray points at.
//
// Frame order: InputSystem (-4) moves the pointers, HandPinchSystem (-3.2) reads the hands, then the
// app's input systems read `hands`. Allocation free per frame.
import { createSystem, Matrix4, Quaternion, Vector3, type World } from "@iwsdk/core";
import { registerAppSystem } from "../app/systems";
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

/** Is this hand busy (reaching for or holding something)? Its ray is off while it is. */
export type BusyHand = (side: 0 | 1) => boolean;

let busy: BusyHand = () => false;

type FillPoses = (spaces: XRSpace[], base: XRSpace, transforms: Float32Array) => boolean;

/** Per hand: what it is, whether it is tracked, its pinch (joints in, hysteresis) and pinch point. */
export class HandPinchSystem extends createSystem({}) {
  private readonly detectors: [PinchDetector, PinchDetector] = [new PinchDetector(), new PinchDetector()];
  private readonly sources: [XRInputSource | null, XRInputSource | null] = [null, null];
  private readonly spaces: [XRSpace[], XRSpace[]] = [[], []];
  private readonly poses = new Float32Array(64);
  private readonly thumb = new Vector3();
  private readonly index = new Vector3();
  private readonly wrist = new Matrix4();
  private readonly wristPos = new Vector3();
  private readonly wristScale = new Vector3();

  update(): void {
    const now = performance.now();
    const frame = this.xrFrame;
    const ref = this.renderer.xr.getReferenceSpace();
    for (let i = 0; i < 2; i++) {
      const side = i as 0 | 1;
      const out = hands[side];
      const src = frame && ref ? this.input.xr.getPrimaryInputSource(SIDES[side]) : undefined;
      if (src?.hand && frame && ref) this.hand(side, src, frame, ref, now, out);
      else if (src) this.controller(side, out);
      else {
        // No hand at all (tracking lost, or no session): the detector rides out short dropouts.
        out.kind = "none";
        this.sources[side] = null;
        out.tracked = false;
        out.edge = this.detectors[side].update(now, false, Number.NaN, false);
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

  private hand(i: 0 | 1, src: XRInputSource, frame: XRFrame, ref: XRReferenceSpace, now: number, out: HandPinch): void {
    out.kind = "hand";
    if (this.sources[i] !== src) {
      this.sources[i] = src;
      const hand = src.hand as XRHand;
      const thumb = hand.get("thumb-tip");
      const index = hand.get("index-finger-tip");
      const wrist = hand.get("wrist");
      const knuckle = hand.get("index-finger-phalanx-proximal");
      this.spaces[i] = thumb && index && wrist && knuckle ? [thumb, index, wrist, knuckle] : [];
    }
    const spaces = this.spaces[i];
    const fill = (frame as XRFrame & { fillPoses?: FillPoses }).fillPoses;
    // Tracked only with poses for the fingertips and the wrist: a headset can keep listing a hand
    // it no longer sees.
    let tracked = false;
    if (spaces.length === 4 && fill) {
      try {
        tracked = fill.call(frame, spaces, ref, this.poses);
      } catch {
        tracked = false;
      }
    }
    let distance = Number.NaN;
    if (tracked) {
      const p = this.poses;
      this.thumb.set(p[12]!, p[13]!, p[14]!);
      this.index.set(p[28]!, p[29]!, p[30]!);
      distance = this.thumb.distanceTo(this.index);
      out.point.copy(this.thumb).add(this.index).multiplyScalar(0.5).applyMatrix4(this.player.matrixWorld);
      out.anchor.set(p[60]!, p[61]!, p[62]!).applyMatrix4(this.player.matrixWorld);
      this.wrist.fromArray(p, 32).premultiply(this.player.matrixWorld);
      this.wrist.decompose(this.wristPos, out.rot, this.wristScale);
    }
    const select = this.input.xr.getSelectState(SIDES[i]).active;
    out.edge = this.detectors[i].update(now, tracked, distance, select);
    out.tracked = tracked;
    out.pinching = this.detectors[i].active;
  }

  /** Controllers: the trigger (select) or the squeeze is the pinch, at the grip. */
  private controller(i: 0 | 1, out: HandPinch): void {
    const side = SIDES[i];
    out.kind = "controller";
    this.sources[i] = null;
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
