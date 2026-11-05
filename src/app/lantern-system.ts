// The lantern in play, once a frame right after the hands are read (hand-pinch, -3.2): the feel's view of the box
// shown (its spots, its ring lines lined up or not), the lantern grab, and the bus told when a hand picks the lantern
// up, lets it go, or drops out of tracking while holding it. The box session (game layer) takes the ctx (open locks)
// and the feel events from here. Allocation free per frame.
import { createSystem, type World } from "@iwsdk/core";
import type { Box, V3 } from "../core/types";
import { type FeelEvent, LanternController } from "../feel/lantern-controller";
import { LanternCtxBuilder } from "../feel/lantern-ctx";
import { handJoints, setBusyHands, setHoldingHands } from "../input/grab-system";
import type { InputEvent } from "../input/events";
import { LanternGrab } from "../input/lantern-grab";
import type { BoxScene } from "../render/box-scene";
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

export class Lantern {
  readonly ctrl: LanternController;
  readonly grab: LanternGrab;
  readonly feel = new LanternCtxBuilder();
  /** The box the ctx was built for (undefined: none yet). */
  private shown: Box | null | undefined = undefined;
  private listeners: FeelListener[] = [];
  private readonly tmp: V3 = [0, 0, 0];

  constructor(readonly scene: BoxScene) {
    this.ctrl = new LanternController(scene.lantern.getPos([0, 0, 0]));
    this.grab = new LanternGrab(this.ctrl, handJoints, scene);
  }

  /** Put the lantern at `p` (box units; never deeper than the box front). A hand holding it holds on. */
  place(p: Readonly<V3>): void {
    this.grab.place(p);
  }

  /** Hear every feel event (pooled objects: copy what you keep). Returns an unsubscribe. */
  onFeel(fn: FeelListener): () => void {
    this.listeners = [...this.listeners, fn];
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  update(tMs: number): void {
    const scene = this.scene;
    if (scene.box !== this.shown) {
      // A new box: its spots and lines, and the lantern where the scene put it (the box's start).
      this.shown = scene.box;
      this.feel.setBox(scene.box);
      this.grab.place(scene.lantern.getPos(this.tmp));
    }
    const ctx = this.feel.update(this.ctrl.pos, scene.size * 100);
    const grab = this.grab;
    grab.update(tMs, ctx);
    if (grab.grabbedBy) emit(GRAB[grab.grabbedBy]);
    if (grab.lostBy) emit(LOST[grab.lostBy]);
    if (grab.releasedBy) emit(RELEASE[grab.releasedBy]);
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
 * hands' hooks (a hand reaching for or holding the lantern has its ray off; the holding hand's pinch rides out
 * tracking loss). Call once, after attachInput.
 */
export function attachLantern(world: World, scene: BoxScene): Lantern {
  const lantern = new Lantern(scene);
  current = lantern;
  setBusyHands((side) => lantern.grab.busy(side));
  setHoldingHands((side) => lantern.grab.holding(side));
  registerAppSystem(world, LanternSystem, { priority: -3, name: "lantern" });
  return lantern;
}
