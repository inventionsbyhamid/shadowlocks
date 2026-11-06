// The player's hands in the box, once a frame right after the lantern (priority -2.9, "hands"): the depth mask that
// keeps the real hand in front of the box (passthrough only), and each hand's shadow outlines from the lantern, handed
// to the box scene, which draws them in the panel's shadow mesh when it updates later in the frame (the hand holding
// the lantern casts none).
//
// Until the box session exists, this also runs the box's finger locks: each measured with this frame's finger
// polygons, held through its FingerLockLoop, crystallised when done. The box session takes that part over (it
// measures every lock anyway) and keeps the loops; nothing else here depends on it. Allocation-free per frame.
import { createSystem, type Object3D, type World } from "@iwsdk/core";
import { type Coverage, type LockSamples, measure, meets, prepareLock, SKIP_MISSING, shadowBuffers, shadowPolys } from "../core/solve";
import type { Box, Lock, V2, V3 } from "../core/types";
import { MAX_STEP_MS } from "../feel/constants";
import { handJoints } from "../input/grab-system";
import type { HandSide } from "../input/hand-joints";
import type { BoxScene } from "../render/box-scene";
import { crystallise } from "../render/fx/crystallise";
import { HandMask } from "../render/hand-mask";
import { HandShadow } from "../render/hand-shadow";
import { FingerLockLoop } from "./finger-lock";
import type { Lantern } from "./lantern-system";
import { registerAppSystem } from "./systems";

export interface HandsDeps {
  scene: BoxScene;
  lantern: Lantern;
  /** The session shows the real room (the mask is off otherwise). */
  passthrough: () => boolean;
  reducedMotion: () => boolean;
}

/** A finger lock of the box shown, as the hand system runs it until the box session takes it over. */
export interface FingerLockEntry {
  readonly lock: Lock;
  readonly samples: LockSamples;
  readonly loop: FingerLockLoop;
  /** This frame's coverage, with the finger. */
  readonly coverage: Coverage;
  /** This frame's coverage meets the rule (finger included). */
  meets: boolean;
}

/** The depth a piece hangs at in the generated box: where to crystallise when no finger depth is known. */
function pieceDepth(box: Box, lock: Lock): number {
  for (const e of box.elements) {
    if (e.kind === "piece" && e.lock === lock.i && e.piece === lock.missing) return e.verts.reduce((s, v) => s + v[2], 0) / e.verts.length;
  }
  return 0.5;
}

export class HandsInBox {
  readonly mask: HandMask;
  readonly shadow = new HandShadow();
  /** This frame's hand shadows (panel, box units): every casting bone in [0, n), the finger's in finger[0, nFinger). */
  readonly outlines: V2[][] = [];
  readonly finger: V2[][] = [];
  n = 0;
  nFinger = 0;
  /** The finger's depth (box z), NaN with no finger in the beam. */
  fingerZ = Number.NaN;
  /** The box's finger locks (made per box). */
  locks: FingerLockEntry[] = [];
  /** The box the finger locks were made for (undefined: none yet). */
  private shown: Box | null | undefined = undefined;
  private scraps: V2[][] = [];

  constructor(
    world: { scene: Object3D },
    private readonly deps: HandsDeps,
  ) {
    this.mask = new HandMask(world);
  }

  update(dtMs: number): void {
    const { scene, lantern } = this.deps;
    const holder = lantern.grab.holder;
    this.mask.enabled = this.deps.passthrough();
    this.mask.update(handJoints);
    const L = lantern.ctrl.pos;
    const r = this.shadow.update(handJoints, holder, scene.root.matrixWorld, L, this.outlines, this.finger);
    this.n = r.n;
    this.nFinger = r.nFinger;
    this.fingerZ = r.fingerZ;
    // Drawn in the panel's shadow mesh when the box updates, later this frame.
    scene.setHandShadows(this.outlines, r.n, this.shadow.depth);
    if (scene.box !== this.shown) this.setBox(scene.box);
    this.driveFingerLocks(dtMs, holder, L);
  }

  // --- Interim finger-lock driver: the box session takes this over (it measures every lock anyway) and keeps the
  // --- FingerLockLoops; it then deletes this method, setBox, `locks` and pieceDepth, and nothing else changes.

  /** Each unopened finger lock measured with this frame's finger and held through its loop; done opens it. */
  private driveFingerLocks(dtMs: number, holder: HandSide | null, L: V3): void {
    const locks = this.locks, box = this.shown;
    if (!box || !locks.length) return;
    const tracked = (holder !== "left" && handJoints.tracked("left")) || (holder !== "right" && handJoints.tracked("right"));
    let ns = -1;
    for (let i = 0; i < locks.length; i++) {
      const e = locks[i]!;
      if (e.loop.open) continue;
      if (ns < 0) ns = shadowPolys(box.elements, L, this.scraps, SKIP_MISSING);
      measure(e.samples, this.scraps, ns, this.finger, this.nFinger, e.coverage);
      e.meets = meets(e.coverage, true);
      if (e.loop.update(dtMs, e.coverage, tracked) === "done") this.deps.lantern.feel.setOpen(e.lock.i, true);
    }
  }

  private setBox(box: Box | null): void {
    this.shown = box;
    this.scraps = box ? shadowBuffers(box.elements, SKIP_MISSING) : [];
    this.locks = box
      ? box.locks
          .filter((l) => l.finger)
          .map((lock) => ({
            lock,
            samples: prepareLock(lock),
            coverage: { cover: 0, spill: 0, spillAll: 0, gap: 0 },
            meets: false,
            // The box session plays sound.game.crystallise here when it takes this loop over.
            loop: new FingerLockLoop(() =>
              crystallise(this.deps.scene, lock, Number.isFinite(this.fingerZ) ? this.fingerZ : pieceDepth(box, lock), {
                reducedMotion: this.deps.reducedMotion(),
              }),
            ),
          }))
      : [];
  }
}

let current: HandsInBox | null = null;

export class HandSystem extends createSystem({}) {
  update(delta: number): void {
    // Frame time in ms, a hitch counted as at most MAX_STEP_MS (as the lantern does).
    current?.update(Math.min(Math.max(delta * 1000, 0), MAX_STEP_MS));
  }
}

/** The hands in the box: registers HandSystem (priority -2.9, "hands", right after the lantern). Call once, after attachLantern. */
export function attachHands(world: World, deps: HandsDeps): HandsInBox {
  const hands = new HandsInBox(world, deps);
  current = hands;
  registerAppSystem(world, HandSystem, { priority: -2.9, name: "hands" });
  return hands;
}
