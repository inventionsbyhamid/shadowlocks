// Where the index fingertips are, only while they are really tracked. For a hand, the index tip
// joint is read from the XR frame with fillPoses (into a buffer kept here, no allocation); a joint
// without a pose (the hand left tracking) reports no fingertip, so a key pressed when tracking was
// lost is let go instead of turning into a click when the hand comes back. A controller uses its
// target ray (IWSDK's index tip space follows it); its target ray space goes through the same
// fillPoses check, so a controller out of tracking has no fingertip either. Positions are in world
// space. The one source for every fingertip key (src/ui/fingertips.ts shares it). Where the frame's hand joint read
// (src/input/hand-joints.ts) already has the tip from the same fillPoses result, it is taken from there: one fillPoses
// fewer per hand, the same numbers.
import type { Matrix4, Object3D, Vector3, World } from "@iwsdk/core";

/** A joint read this frame that may already hold a hand's index tip (HandJoints.indexTipIn). */
export interface TipReads {
  /** The tip's raw pose position in `ref` into `out`, true, when read from `src` in `frame`; false otherwise. */
  indexTipIn(src: XRInputSource, tip: XRSpace, frame: XRFrame, ref: XRReferenceSpace, out: Vector3): boolean;
}

/** Where the fingertips are (world space). */
export interface FingertipSource {
  /** Write fingertip `hand` (0 left, 1 right) into `out`; false when that hand has none tracked. */
  read(hand: number, out: Vector3): boolean;
  /** Drop any listeners it holds. */
  dispose?(): void;
}

interface XrLike {
  getFrame?(): XRFrame | null;
  getReferenceSpace?(): XRReferenceSpace | null;
  getSession?(): XRSession | null;
}

/** XRFrame with the hand input module's fillPoses (not in every typing). */
interface PoseFrame {
  fillPoses?(spaces: XRSpace[], baseSpace: XRSpace, transforms: Float32Array): boolean;
}

interface PlayerLike {
  matrixWorld: Matrix4;
  updateWorldMatrix?(parents: boolean, children: boolean): void;
  indexTipSpaces?: { left: Object3D; right: Object3D };
}

/** Per hand: the input source it was found on, and the joint space array fillPoses reads. */
interface HandSlot {
  source: XRInputSource | null;
  spaces: XRSpace[];
  hand: boolean;
}

const SIDES: readonly XRHandedness[] = ["left", "right"];

/** Fingertips from the live XR frame (see the module comment); `joints`, the frame's joint read, when there is one. */
export function xrFingertips(world: World, joints?: TipReads): FingertipSource {
  const w = world as unknown as { renderer?: { xr?: XrLike }; player?: PlayerLike };
  const slots: HandSlot[] = [
    { source: null, spaces: [], hand: false },
    { source: null, spaces: [], hand: false },
  ];
  const pose = new Float32Array(16);
  let session: XRSession | null = null;
  let listed = -1;
  /** Controllers' target rays go through fillPoses (off once it throws for a non-joint space). */
  let rayCheck = true;
  const changed = () => {
    listed = -1;
  };

  /** Find each side's primary source (on a new session or after inputsourceschange). */
  const refresh = (s: XRSession) => {
    for (let h = 0; h < 2; h++) {
      const slot = slots[h] as HandSlot;
      slot.source = null;
      slot.spaces = [];
      slot.hand = false;
      const sources = s.inputSources;
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i] as XRInputSource;
        if (src.handedness !== SIDES[h]) continue;
        if (src.hand) {
          const tip = src.hand.get("index-finger-tip");
          if (tip) {
            slot.source = src;
            slot.spaces = [tip];
            slot.hand = true;
            break;
          }
        } else if (!slot.source) {
          slot.source = src;
          slot.spaces = [src.targetRaySpace];
        }
      }
    }
  };

  return {
    read(hand, out) {
      const xr = w.renderer?.xr;
      const frame = xr?.getFrame?.() ?? null;
      const ref = xr?.getReferenceSpace?.() ?? null;
      const s = xr?.getSession?.() ?? null;
      if (!frame || !ref || !s) return false;
      if (s !== session) {
        session?.removeEventListener("inputsourceschange", changed);
        session = s;
        listed = -1;
        s.addEventListener("inputsourceschange", changed);
      }
      if (listed !== 1) {
        refresh(s);
        listed = 1;
      }
      const slot = slots[hand] as HandSlot;
      if (!slot.source) return false;
      const player = w.player;
      if (slot.hand) {
        if (!joints?.indexTipIn(slot.source, slot.spaces[0] as XRSpace, frame, ref, out)) {
          // No pose for the joint this frame: the hand is not tracked.
          const f = frame as unknown as PoseFrame;
          if (!f.fillPoses || !f.fillPoses(slot.spaces, ref, pose)) return false;
          out.set(pose[12] as number, pose[13] as number, pose[14] as number);
        }
        if (player) out.applyMatrix4(player.matrixWorld);
        return true;
      }
      // A controller: IWSDK keeps its index tip space on the target ray. No pose for that ray this
      // frame: out of tracking. A browser whose fillPoses takes only hand joints skips the check.
      const space = player?.indexTipSpaces ? (hand === 0 ? player.indexTipSpaces.left : player.indexTipSpaces.right) : undefined;
      if (!space) return false;
      if (rayCheck && slot.spaces.length > 0) {
        const f = frame as unknown as PoseFrame;
        try {
          if (f.fillPoses && !f.fillPoses(slot.spaces, ref, pose)) return false;
        } catch {
          rayCheck = false;
        }
      }
      space.getWorldPosition(out);
      return true;
    },
    dispose() {
      session?.removeEventListener("inputsourceschange", changed);
      session = null;
    },
  };
}

