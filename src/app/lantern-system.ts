// The lantern in play, once a frame right after the hands are read (hand-pinch, -3.2): the feel's view of the box
// shown (its spots, its ring lines lined up or not), the lantern grab, and the bus told when a hand picks the lantern
// up, lets it go, or drops out of tracking while holding it. The box session (game layer) takes the ctx (open locks)
// and the feel events from here. Allocation free per frame.
import { createSystem, type World } from "@iwsdk/core";
import type { Box, V3 } from "../core/types";
import { type FeelEvent, LanternController } from "../feel/lantern-controller";
import { LanternCtxBuilder } from "../feel/lantern-ctx";
import { type HandPinch, handJoints, hands, setBusyHands, setHoldingHands } from "../input/grab-system";
import type { InputEvent } from "../input/events";
import type { HandJoints } from "../input/hand-joints";
import { LanternGrab } from "../input/lantern-grab";
import type { BoxScene } from "../render/box-scene";
import type { LanternView } from "../render/lantern-view";
import { emit } from "./bus";
import { registerAppSystem } from "./systems";

// The bus keeps what it is given (the test log does): one frozen event per hand, never a new object per frame.
const GRAB: Readonly<Record<"left" | "right", InputEvent>> = {
  left: Object.freeze({ type: "grab", hand: "left" }),
  right: Object.freeze({ type: "grab", hand: "right" }),
};
const RELEASE: Readonly<Record<"left" | "right", InputEvent>> = {
  left: Object.freeze({ type: "release", hand: "left" }),
  right: Object.freeze({ type: "release", hand: "right" }),
};
const LOST: Readonly<Record<"left" | "right", InputEvent>> = {
  left: Object.freeze({ type: "tracking-lost", hand: "left" }),
  right: Object.freeze({ type: "tracking-lost", hand: "right" }),
};

export type FeelListener = (e: FeelEvent) => void;

/** What the lantern needs of the box scene (BoxScene has it all). */
export type LanternBoxScene = Pick<BoxScene, "box" | "size" | "root"> & {
  readonly lantern: Pick<LanternView, "getPos" | "setPos" | "flare" | "ripple" | "setBrightness">;
};

export class Lantern {
  readonly ctrl: LanternController;
  readonly grab: LanternGrab;
  readonly feel = new LanternCtxBuilder();
  /** The box the ctx was built for (undefined: none yet). */
  private shown: Box | null | undefined = undefined;
  private listeners: FeelListener[] = [];
  private readonly tmp: V3 = [0, 0, 0];
  /**
   * While frozen (a lesson's example parks the lantern in its cradle) no hand can take it: grabs, holds and feel
   * events wait; `place` still moves it. A hold is let go when freezing (`freeze`).
   */
  private frozenNow = false;
  /** Put away while a menu is up over the box: not held, not grabbable (its view is hidden by the app). */
  private awayNow = false;
  /** The box waits, hidden, for the session's first placement: nothing takes the lantern or moves it. */
  private unplacedNow = false;

  /** `o` swaps the app's hands for scripted ones (tests). */
  constructor(
    readonly scene: LanternBoxScene,
    o: { pinches?: readonly [HandPinch, HandPinch]; joints?: HandJoints } = {},
  ) {
    this.ctrl = new LanternController(scene.lantern.getPos([0, 0, 0]));
    this.grab = new LanternGrab(this.ctrl, o.joints ?? handJoints, scene, o.pinches ?? hands);
  }

  /** Put the lantern at `p` (box units; never deeper than the box front). A hand holding it holds on. */
  place(p: Readonly<V3>): void {
    this.grab.place(p);
  }

  get frozen(): boolean {
    return this.frozenNow;
  }

  /** Freeze the lantern out of every hand (letting a hold go at `tMs`), or let hands take it again. */
  freeze(on: boolean, tMs: number): void {
    if (on && !this.frozenNow) this.grab.drop(tMs, this.feel.ctx);
    this.frozenNow = on;
  }

  /** Hear every feel event (pooled objects: copy what you keep). Returns an unsubscribe. */
  onFeel(fn: FeelListener): () => void {
    this.listeners = [...this.listeners, fn];
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  /** The lantern is at rest (LanternController.atRest): not held, settled, or held by a deliberate hand. */
  get atRest(): boolean {
    return this.ctrl.atRest;
  }

  /** Put away while a menu is up over the box. */
  get away(): boolean {
    return this.awayNow;
  }

  /**
   * A menu came up over the box (true) or went (false). Going away, a hand holding the lantern lets go
   * of it where it stands (the release is told at once); while away nothing moves it and no pinch takes
   * it. Back, it carries on from where it stood.
   */
  setAway(away: boolean, tMs: number): void {
    if (away === this.awayNow) return;
    if (away && this.grab.holder) {
      this.grab.drop(tMs, this.feel.ctx);
      // One frame now, so the release goes out with this change, not when the menu closes.
      this.update(tMs);
    }
    this.awayNow = away;
  }

  /** The box waits, hidden, for the session's first placement. */
  get unplaced(): boolean {
    return this.unplacedNow;
  }

  /**
   * The box waits (true), hidden, for the session's first placement, or it is placed (false). While it waits, no hand
   * takes the lantern where the box will not be: a hold is let go (none can be under way: it was hidden from the start).
   */
  setUnplaced(on: boolean, tMs: number): void {
    if (on === this.unplacedNow) return;
    if (on && this.grab.holder) {
      this.grab.drop(tMs, this.feel.ctx);
      this.update(tMs);
    }
    this.unplacedNow = on;
  }

  update(tMs: number): void {
    if (this.awayNow || this.unplacedNow) return;
    const scene = this.scene;
    if (scene.box !== this.shown) {
      // A new box: a hand holding the lantern lets go of it first (it is put at the new box's start, not carried
      // there at the hand's offset), then the new box's spots and lines, and the lantern where the scene put it.
      this.grab.drop(tMs, this.feel.ctx);
      this.shown = scene.box;
      this.feel.setBox(scene.box);
      this.grab.place(scene.lantern.getPos(this.tmp));
    }
    const ctx = this.feel.update(this.ctrl.pos, scene.size * 100);
    if (this.frozenNow) return;
    const grab = this.grab;
    grab.update(tMs, ctx);
    // In the order they happened: a hand lost, its hold let go, another hand taking the lantern.
    if (grab.lostBy) emit(LOST[grab.lostBy]);
    if (grab.releasedBy) emit(RELEASE[grab.releasedBy]);
    if (grab.grabbedBy) emit(GRAB[grab.grabbedBy]);
    const list = this.listeners;
    for (let k = 0; k < grab.eventCount; k++) {
      const e = grab.events[k]!;
      for (let i = 0; i < list.length; i++) list[i]!(e);
    }
  }
}

let current: Lantern | null = null;

export class LanternSystem extends createSystem({}) {
  update(): void {
    current?.update(performance.now());
  }
}

/**
 * The lantern for the box scene: registers LanternSystem (priority -3, "lantern", right after hand-pinch) and the
 * hands' hooks (a hand or controller reaching for or holding the lantern has its ray off; the holding hand's pinch rides out
 * tracking loss). Call once, after attachInput.
 */
export function attachLantern(world: World, scene: BoxScene): Lantern {
  const lantern = new Lantern(scene);
  current = lantern;
  // Put away under a menu, the lantern keeps no hand busy: both rays work on the panel.
  setBusyHands((side) => !lantern.away && lantern.grab.busy(side));
  setHoldingHands((side) => lantern.grab.holding(side));
  registerAppSystem(world, LanternSystem, { priority: -3, name: "lantern" });
  return lantern;
}
