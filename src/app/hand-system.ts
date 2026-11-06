// The player's hands in the box, once a frame right after the lantern (priority -2.9, "hands"): the depth mask that
// keeps the real hand in front of the box (passthrough only), and each hand's shadow outlines from the lantern, handed
// to the box scene, which draws them in the panel's shadow mesh when it updates later in the frame (the hand holding
// the lantern casts none).
//
// It is also the box session's finger source (session-fingers.ts): this frame's finger shadow, whether a hand that can
// cast it is in tracking, and the depth of the finger over a lock's gap. The session measures the finger locks and
// runs their holds. Allocation-free per frame.
import { createSystem, type Object3D, type World } from "@iwsdk/core";
import type { V2 } from "../core/types";
import { handJoints } from "../input/grab-system";
import type { BoxScene } from "../render/box-scene";
import { HandMask } from "../render/hand-mask";
import { HandShadow } from "../render/hand-shadow";
import type { Lantern } from "./lantern-system";
import type { FingerSource } from "./session-fingers";
import { registerAppSystem } from "./systems";

export interface HandsDeps {
  scene: BoxScene;
  lantern: Lantern;
  /** The session shows the real room (the mask is off otherwise). */
  passthrough: () => boolean;
}

export class HandsInBox implements FingerSource {
  readonly mask: HandMask;
  readonly shadow = new HandShadow();
  /** This frame's hand shadows (panel, box units): every casting bone in [0, n), the finger's in finger[0, nFinger). */
  readonly outlines: V2[][] = [];
  readonly finger: V2[][] = [];
  n = 0;
  nFinger = 0;
  /**
   * The fingers' depth (box z; with two hands in the mouth, both fingers' mean), NaN with no finger in the beam. A
   * piece forms at the depth of the finger over its gap (`depthOver`), not this.
   */
  fingerZ = Number.NaN;
  /** A hand that can cast the finger (one not holding the lantern) is in tracking this frame. */
  tracked = false;

  constructor(
    world: { scene: Object3D },
    private readonly deps: HandsDeps,
  ) {
    this.mask = new HandMask(world);
  }

  /** The depth of the finger whose shadow covers the gap's sample points (HandShadow.fingerDepthOver), or NaN. */
  depthOver(gap: readonly V2[]): number {
    return this.shadow.fingerDepthOver(this.finger, this.nFinger, gap);
  }

  update(): void {
    const { scene, lantern } = this.deps;
    const holder = lantern.grab.holder;
    this.mask.enabled = this.deps.passthrough();
    this.mask.update(handJoints);
    const r = this.shadow.update(handJoints, holder, scene.root.matrixWorld, lantern.ctrl.pos, this.outlines, this.finger);
    this.n = r.n;
    this.nFinger = r.nFinger;
    this.fingerZ = r.fingerZ;
    this.tracked = (holder !== "left" && handJoints.tracked("left")) || (holder !== "right" && handJoints.tracked("right"));
    // Drawn in the panel's shadow mesh when the box updates, later this frame.
    scene.setHandShadows(this.outlines, r.n, this.shadow.depth);
  }
}

let current: HandsInBox | null = null;

export class HandSystem extends createSystem({}) {
  update(): void {
    current?.update();
  }
}

/** The hands in the box: registers HandSystem (priority -2.9, "hands", right after the lantern). Call once, after attachLantern. */
export function attachHands(world: World, deps: HandsDeps): HandsInBox {
  const hands = new HandsInBox(world, deps);
  current = hands;
  registerAppSystem(world, HandSystem, { priority: -2.9, name: "hands" });
  return hands;
}
