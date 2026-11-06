// The player's hands in the box, once a frame right after the lantern (priority -2.9, "hands"): the depth mask that
// keeps the real hand in front of the box (passthrough only), and each hand's shadow outlines from the lantern, handed
// to the box scene, which draws them in the panel's shadow mesh when it updates later in the frame (the hand holding
// the lantern casts none). With controllers and no free hand's finger in the beam, a held controller casts a
// fingertip-sized stand-in finger along its aim (HandShadow.castStandIn), so every finger lock can be done with
// controllers too.
//
// It is also the box session's finger source (session-fingers.ts): this frame's finger shadow, a counter that moves
// only when that shadow changed, whether a hand that can cast it is in tracking, whether controllers are in use, the
// fingertip, and the depth of the finger over a lock's gap. The session measures the finger locks and runs their
// holds. Allocation-free per frame.
import { createSystem, type Object3D, Vector3, type World } from "@iwsdk/core";
import type { V2, V3, Vec3 } from "../core/types";
import { handJoints, hands } from "../input/grab-system";
import type { BoxScene } from "../render/box-scene";
import { HandMask } from "../render/hand-mask";
import { HandShadow, OUTLINE_CORNERS, SIDES, STAND_IN } from "../render/hand-shadow";
import { worldToBox } from "../render/placement";
import type { Lantern } from "./lantern-system";
import type { FingerSource } from "./session-fingers";
import { registerAppSystem } from "./systems";

export interface HandsDeps {
  scene: BoxScene;
  lantern: Lantern;
  /** The session shows the real room (the mask is off otherwise). */
  passthrough: () => boolean;
  /** Each controller's target ray (the player's ray spaces): its origin is the controller's front, it aims along -z. */
  rays?: { readonly left: Object3D; readonly right: Object3D };
}

/** The finger outlines whose corners the change counter compares, at most (both hands' two bones, or a stand-in). */
const MAX_COMPARED = 4;

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
  /** Moves whenever the finger's shadow changed since the last frame. */
  version = 0;
  /** A hand that can cast the finger (one not holding the lantern, or a controller's stand-in) is in tracking. */
  tracked = false;
  /** Controllers are in use. */
  controllers = false;
  /** The hand (0 left, 1 right) whose controller casts the stand-in finger this frame, or -1. */
  standInBy = -1;
  private readonly last = new Float64Array(MAX_COMPARED * OUTLINE_CORNERS * 2);
  private lastCount = 0;
  private readonly front = new Vector3();
  private readonly back = new Vector3();
  private readonly at = new Vector3();
  private readonly box: V3 = [0, 0, 0];

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

  /** The casting fingertip (world metres): the stand-in's front, or the hand's index fingertip. */
  tip(out: Vec3): boolean {
    if (this.nFinger === 0) return false;
    if (this.standInBy >= 0) this.at.copy(this.front);
    else if (!handJoints.joint(SIDES[this.shadow.fingerHand[0]!]!, "index-finger-tip", this.at)) return false;
    out[0] = this.at.x;
    out[1] = this.at.y;
    out[2] = this.at.z;
    return true;
  }

  update(): void {
    const { scene, lantern } = this.deps;
    const holder = lantern.grab.holder;
    this.mask.enabled = this.deps.passthrough();
    this.mask.update(handJoints);
    const L = lantern.ctrl.pos, m = scene.root.matrixWorld;
    const r = this.shadow.update(handJoints, holder, m, L, this.outlines, this.finger);
    this.controllers = hands[0].kind === "controller" || hands[1].kind === "controller";
    this.standInBy = -1;
    if (r.nFinger === 0 && this.controllers) this.standIn(holder === "left" ? 0 : holder === "right" ? 1 : -1, L);
    this.n = r.n;
    this.nFinger = r.nFinger;
    this.fingerZ = r.fingerZ;
    this.tracked =
      this.standInBy >= 0 || (holder !== "left" && handJoints.tracked("left")) || (holder !== "right" && handJoints.tracked("right"));
    this.countChange();
    // Drawn in the panel's shadow mesh when the box updates, later this frame.
    scene.setHandShadows(this.outlines, r.n, this.shadow.depth);
  }

  /** A held controller (not the one holding the lantern) casts the stand-in finger along its aim, if in the mouth. */
  private standIn(holder: number, L: Readonly<V3>): void {
    const rays = this.deps.rays, m = this.deps.scene.root.matrixWorld, s = this.shadow.standIn;
    if (!rays) return;
    for (let h = 0; h < 2; h++) {
      const p = hands[h as 0 | 1];
      if (h === holder || p.kind !== "controller" || !p.tracked) continue;
      const ray = h === 0 ? rays.left : rays.right;
      ray.updateWorldMatrix(true, false);
      const e = ray.matrixWorld.elements;
      // The ray's origin is the controller's front; it aims along its -z axis.
      let ax = -e[8]!, ay = -e[9]!, az = -e[10]!;
      const k = 1 / (Math.sqrt(ax * ax + ay * ay + az * az) || 1);
      ax *= k;
      ay *= k;
      az *= k;
      const past = STAND_IN.pastCm / 100, len = STAND_IN.lengthCm / 100;
      this.front.set(e[12]! + ax * past, e[13]! + ay * past, e[14]! + az * past);
      this.back.set(this.front.x - ax * len, this.front.y - ay * len, this.front.z - az * len);
      worldToBox(m, this.front, this.box);
      s[0] = this.box[0];
      s[1] = this.box[1];
      s[2] = this.box[2];
      worldToBox(m, this.back, this.box);
      s[3] = this.box[0];
      s[4] = this.box[1];
      s[5] = this.box[2];
      if (this.shadow.castStandIn(h as 0 | 1, m, L, this.outlines, this.finger).nFinger > 0) {
        this.standInBy = h;
        return;
      }
    }
  }

  /** The change counter moves when the finger outlines' count or any corner changed since the last frame. */
  private countChange(): void {
    const n = Math.min(this.nFinger, MAX_COMPARED), last = this.last;
    let changed = n !== this.lastCount;
    let o = 0;
    for (let k = 0; k < n; k++) {
      const poly = this.finger[k]!;
      for (let j = 0; j < OUTLINE_CORNERS; j++, o += 2) {
        const p = poly[j]!;
        if (p[0] !== last[o] || p[1] !== last[o + 1]) {
          changed = true;
          last[o] = p[0];
          last[o + 1] = p[1];
        }
      }
    }
    this.lastCount = n;
    if (changed) this.version++;
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
