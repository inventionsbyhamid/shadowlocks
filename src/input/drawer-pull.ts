// The menu drawer in the box's plinth: pinch its handle and pull it 4 cm or more toward the player
// and it opens (the menus then raise their panel). A poke does nothing: only a pinch that *starts*
// within the grip radius of the handle takes hold, and only the pull along the drawer's own outward
// direction counts, measured at the index knuckle (so fingers closing or opening are no pull), so
// pushing, sliding sideways or lifting never opens it, and a pinch made
// elsewhere and dragged over the handle never takes it. A short pull let go springs back closed;
// a hand lost from tracking mid pull lets go (never a release that opens). The hand holding the
// lantern never pulls it. Once open it stays open until the menus close it.
//
// Pinches use the same rules as everything else (PinchDetector: starts at 15 mm, ends at 30 mm held
// two frames, rides out short dropouts). Positions are world metres; the drawer's handle and outward
// direction come from the box each frame (a new placement or box size moves them). Per frame it
// allocates nothing.
import { Vector3 } from "@iwsdk/core";
import type { HandSide } from "./hand-joints";
import { PinchDetector } from "./pinch";

export type DrawerState = "closed" | "opening" | "open";

export const DRAWER_PULL = {
  /** Pulled this far toward the player (m), the drawer opens. */
  openM: 0.04,
  /** A pinch must start within this distance of the handle's centre (m) to take hold. */
  gripM: 0.04,
  /** The pull toward the player must be at least this many times the drift across it: a sideways swipe is no pull. */
  dominance: 2,
} as const;

/** What the drawer reads of the hands (HandJoints has it all; controllers go through an adapter). */
export interface DrawerHands {
  tracked(h: HandSide): boolean;
  /** Where the hand pinches (world); false when it has no pose. */
  pinchPoint(h: HandSide, out: Vector3): boolean;
  /** Thumb tip to index tip (m); NaN when not tracked. */
  pinchDistance(h: HandSide): number;
  /** A joint's world position (the pull follows the index knuckle); false when it has no pose. */
  joint(h: HandSide, j: XRHandJoint, out: Vector3): boolean;
}

/**
 * The pull is measured at the index knuckle, which carries what the hand holds: the fingertips' midpoint
 * swings by centimetres as the fingers close and open, and a release must never read as a pull.
 */
const KNUCKLE: XRHandJoint = "index-finger-phalanx-proximal";

/** Where the drawer is: its handle's centre and the unit direction it slides out along (world). */
export interface DrawerFrame {
  handle(out: Vector3): Vector3;
  toward(out: Vector3): Vector3;
}

export interface DrawerOptions {
  /** A hand that is busy (holding the lantern) never pulls: side 0 is left, 1 right. */
  busy?: (side: 0 | 1) => boolean;
  /** The drawer can be pulled now (false while a panel is up or the box is opening). */
  enabled?: () => boolean;
}

const SIDES: readonly [HandSide, HandSide] = ["left", "right"];

export class DrawerPull {
  state: DrawerState = "closed";
  /** How far the pull has come toward opening, 0..1 (the drawer's look follows it); 1 while open. */
  progress = 0;
  /** The hand pulling now, or null. */
  hand: HandSide | null = null;
  /** Times a hand pulled it open. */
  opened = 0;
  private who = -1;
  private readonly detectors: [PinchDetector, PinchDetector] = [new PinchDetector(), new PinchDetector()];
  private readonly at = new Vector3();
  private readonly start = new Vector3();
  private readonly handlePos = new Vector3();
  private readonly out = new Vector3();

  constructor(
    private readonly frame: DrawerFrame,
    private readonly o: DrawerOptions = {},
  ) {}

  /** One frame at `tMs`. Returns the state after it. */
  update(joints: DrawerHands, tMs: number): DrawerState {
    const enabled = this.state !== "open" && (this.o.enabled?.() ?? true);
    let started = -1;
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i]!;
      const tracked = joints.tracked(side);
      const edge = this.detectors[i]!.update(tMs, tracked, tracked ? joints.pinchDistance(side) : Number.NaN, false);
      if (i === this.who) {
        if (edge === "end" || edge === "cancel" || !this.detectors[i]!.active) this.letGo();
      } else if (edge === "start" && started < 0 && enabled && !(this.o.busy?.(i as 0 | 1) ?? false)) {
        started = i;
      }
    }
    if (!enabled) {
      if (this.state === "opening") this.letGo();
      return this.state;
    }
    if (this.who < 0 && started >= 0 && joints.pinchPoint(SIDES[started]!, this.at)) {
      const side = SIDES[started]!;
      if (this.at.distanceTo(this.frame.handle(this.handlePos)) <= DRAWER_PULL.gripM && joints.joint(side, KNUCKLE, this.start)) {
        this.who = started;
        this.hand = side;
        this.state = "opening";
        this.progress = 0;
      }
    }
    if (this.who >= 0) {
      const side = SIDES[this.who]!;
      // Out of tracking: the pull holds where it was until the hand comes back or the pinch times out.
      if (joints.joint(side, KNUCKLE, this.at)) {
        const moved = this.at.sub(this.start);
        const pulled = moved.dot(this.frame.toward(this.out));
        // The drift across the drawer's axis (up, down or sideways): what is left of the move off the axis.
        const across = Math.sqrt(Math.max(0, moved.lengthSq() - pulled * pulled));
        this.progress = Math.min(1, Math.max(0, pulled / DRAWER_PULL.openM));
        if (pulled >= DRAWER_PULL.openM && pulled >= DRAWER_PULL.dominance * across) {
          this.who = -1;
          this.hand = null;
          this.state = "open";
          this.progress = 1;
          this.opened++;
        }
      }
    }
    return this.state;
  }

  /**
   * A tap on the handle (a phone's touch: a screen cannot pull toward the player): opens it as a full pull does, counted
   * as one, when it could be pulled now. True when it opened.
   */
  tap(hand: HandSide): boolean {
    if (this.state !== "closed" || !(this.o.enabled?.() ?? true)) return false;
    this.who = -1;
    this.hand = hand;
    this.state = "open";
    this.progress = 1;
    this.opened++;
    return true;
  }

  /** Open at once (the first screen, the test hooks). Not counted as a pull. */
  open(): void {
    this.who = -1;
    this.hand = null;
    this.state = "open";
    this.progress = 1;
  }

  /** The menus closed: the drawer goes back in. A hand still pinched must let go and pinch again. */
  close(): void {
    this.who = -1;
    this.hand = null;
    this.state = "closed";
    this.progress = 0;
  }

  private letGo(): void {
    this.who = -1;
    this.hand = null;
    if (this.state === "opening") {
      this.state = "closed";
      this.progress = 0;
    }
  }
}
