// Hand shadows: the player's real hand in the lantern's beam casts shadows on the back panel, so hands play shadow
// puppets, and an index finger can fill a finger lock's missing piece. Each bone of a tracked hand is a capsule (a
// sphere swept along the bone: 0.9 cm for finger bones, 2 cm for the palm). A bone with a joint in the box mouth
// (box z <= 1) casts it from the lantern as a 10-corner outline on the panel (box units): the convex hull of its two
// ends' shadows, each end a circle of its radius times Lz / (Lz - z), so a finger near the panel casts small and
// one near the lantern casts large. The index finger's last two bones (intermediate and distal) are the finger, the
// only part the solve rule counts (measure's `finger`); the whole hand still casts.
//
// The hand holding the lantern casts nothing: its fingers sit a couple of centimetres from the light and would black
// out the panel. A bone reaching toward the lantern is cut where its shadow would be MAX_MAGNIFICATION times its
// size (by then it covers the panel; at the lantern it runs off to infinity), and nothing behind the panel casts.
//
// Pure geometry on the one joint read a frame (HandJoints, world space) through the box's matrix. Every outline is
// preallocated per bone slot and handed out by reference: nothing is allocated per frame.
import type { Matrix4 } from "@iwsdk/core";
import type { V2, V3 } from "../core/types";
import { HAND_JOINTS, type HandJoints, type HandSide, JOINT_COUNT } from "../input/hand-joints";

/** A hand casts only inside the box mouth: bones with a joint at box z <= this (the open front). */
export const MOUTH_Z = 1.0;
/** Capsule radii (cm): finger bones, and the palm. */
export const FINGER_RADIUS_CM = 0.9;
export const PALM_RADIUS_CM = 2;
/** Corners of each bone's shadow outline. */
export const OUTLINE_CORNERS = 10;
/** A bone reaching toward the lantern is cut where its shadow is this many times its size. */
export const MAX_MAGNIFICATION = 8;

export interface HandBone {
  a: XRHandJoint;
  b: XRHandJoint;
  /** A palm capsule (PALM_RADIUS_CM), else a finger's (FINGER_RADIUS_CM). */
  palm: boolean;
  /** One of the index finger's last two bones: what fills a finger lock's gap. */
  finger: boolean;
}

const bone = (a: XRHandJoint, b: XRHandJoint, palm = false, finger = false): HandBone => ({ a, b, palm, finger });
const digit = (name: "middle" | "ring" | "pinky"): HandBone[] => [
  bone(`${name}-finger-phalanx-proximal`, `${name}-finger-phalanx-intermediate`),
  bone(`${name}-finger-phalanx-intermediate`, `${name}-finger-phalanx-distal`),
  bone(`${name}-finger-phalanx-distal`, `${name}-finger-tip`),
];

/**
 * The bones each hand casts, in this order: the palm as three wide capsules from the wrist to the index, middle and
 * little finger knuckles, then the thumb and every finger segment.
 */
export const HAND_BONES: readonly HandBone[] = [
  bone("wrist", "index-finger-phalanx-proximal", true),
  bone("wrist", "middle-finger-phalanx-proximal", true),
  bone("wrist", "pinky-finger-phalanx-proximal", true),
  bone("thumb-metacarpal", "thumb-phalanx-proximal"),
  bone("thumb-phalanx-proximal", "thumb-phalanx-distal"),
  bone("thumb-phalanx-distal", "thumb-tip"),
  bone("index-finger-phalanx-proximal", "index-finger-phalanx-intermediate"),
  bone("index-finger-phalanx-intermediate", "index-finger-phalanx-distal", false, true),
  bone("index-finger-phalanx-distal", "index-finger-tip", false, true),
  ...digit("middle"),
  ...digit("ring"),
  ...digit("pinky"),
];
export const BONES_PER_HAND = HAND_BONES.length;
/** Outlines both hands can cast in a frame. */
export const MAX_HAND_OUTLINES = 2 * BONES_PER_HAND;

const SIDES: readonly HandSide[] = ["left", "right"];
const jointIndex = (j: XRHandJoint): number => HAND_JOINTS.indexOf(j);
/** Per bone: its joints' indices into a hand's joint table, and its radius kind. */
const BONE_A = Int32Array.from(HAND_BONES, (b) => jointIndex(b.a));
const BONE_B = Int32Array.from(HAND_BONES, (b) => jointIndex(b.b));
/** The joints any bone uses, read once a frame per hand. */
const USED: readonly XRHandJoint[] = HAND_JOINTS.filter((j) => HAND_BONES.some((b) => b.a === j || b.b === j));
const USED_INDEX = Int32Array.from(USED, jointIndex);

/** Corners of a circle outline (the cos and sin of each corner's angle). */
const CIRCLE_COS = Float64Array.from({ length: OUTLINE_CORNERS }, (_, i) => Math.cos((2 * Math.PI * i) / OUTLINE_CORNERS));
const CIRCLE_SIN = Float64Array.from({ length: OUTLINE_CORNERS }, (_, i) => Math.sin((2 * Math.PI * i) / OUTLINE_CORNERS));

/**
 * The shadow outline of a capsule whose ends cast circles c = [ax, ay, ra, bx, by, rb]: ten corners on the rim of the
 * two circles' convex hull, counter-clockwise. Five corners go round each end, between the two tangent lines; when
 * one circle holds the other (a bone pointing at the lantern), the larger circle. The circles come in a typed array
 * so no float is boxed at the call. Allocation-free.
 */
export function capsuleOutline(c6: Float64Array, out: V2[]): void {
  const ax = c6[0]!, ay = c6[1]!, ra = c6[2]!, bx = c6[3]!, by = c6[4]!, rb = c6[5]!;
  const dx = bx - ax, dy = by - ay, d = Math.sqrt(dx * dx + dy * dy);
  if (!(d > Math.abs(ra - rb))) {
    const big = ra >= rb, cx = big ? ax : bx, cy = big ? ay : by, r = big ? ra : rb;
    for (let i = 0; i < OUTLINE_CORNERS; i++) {
      const p = out[i]!;
      p[0] = cx + r * CIRCLE_COS[i]!;
      p[1] = cy + r * CIRCLE_SIN[i]!;
    }
    return;
  }
  // The tangent points sit at angle alpha from the axis u (a to b) on both circles: cos(alpha) = (ra - rb) / d.
  const ux = dx / d, uy = dy / d, c = (ra - rb) / d, s = Math.sqrt(1 - c * c);
  // b's end runs from -alpha to alpha in four steps of alpha / 2; a's from alpha to 2 pi - alpha in steps of
  // (pi - alpha) / 2. Half-angle values, so no trigonometry: cos(alpha / 2) = sqrt((1 + c) / 2).
  const cb = Math.sqrt((1 + c) / 2), sb = Math.sqrt((1 - c) / 2);
  let vx = c, vy = -s;
  for (let i = 0; i < 5; i++) {
    const p = out[i]!;
    p[0] = bx + rb * (vx * ux - vy * uy);
    p[1] = by + rb * (vx * uy + vy * ux);
    const nx = vx * cb - vy * sb;
    vy = vx * sb + vy * cb;
    vx = nx;
  }
  // (pi - alpha) / 2 has cos sb and sin cb.
  vx = c;
  vy = s;
  for (let i = 5; i < OUTLINE_CORNERS; i++) {
    const p = out[i]!;
    p[0] = ax + ra * (vx * ux - vy * uy);
    p[1] = ay + ra * (vx * uy + vy * ux);
    const nx = vx * sb - vy * cb;
    vy = vx * cb + vy * sb;
    vx = nx;
  }
}

/** What HandShadow.update wrote: outlines in out[0..n) and outFinger[0..nFinger), the finger's mean depth. */
export interface HandShadowResult {
  n: number;
  nFinger: number;
  /** The finger's mean box z (its bones' ends, as cut), NaN with no finger in the beam. */
  fingerZ: number;
}

/**
 * Read the joints any bone uses of one tracked hand into `out` (x, y, z each, HAND_JOINTS order): world metres, or
 * box units through the box matrix `m` (worldToBox's sum, written out so no float crosses a call). Joints no bone
 * uses are left as they were. False when the hand is not tracked.
 */
export function readHand(joints: HandJoints, side: HandSide, m: Matrix4 | null, out: Float64Array): boolean {
  const w = joints.positions(side);
  if (!w) return false;
  if (!m) {
    for (let k = 0; k < USED_INDEX.length; k++) {
      const o = USED_INDEX[k]! * 3;
      out[o] = w[o]!;
      out[o + 1] = w[o + 1]!;
      out[o + 2] = w[o + 2]!;
    }
    return true;
  }
  // The box matrix is a turn and one uniform scale: each box axis is a column, so a point's box coordinates are
  // its offset from the panel dotted with each column over the scale squared.
  const e = m.elements;
  const e0 = e[0]!, e1 = e[1]!, e2 = e[2]!, e4 = e[4]!, e5 = e[5]!, e6 = e[6]!, e8 = e[8]!, e9 = e[9]!, e10 = e[10]!;
  const tx = e[12]!, ty = e[13]!, tz = e[14]!, s2 = e0 * e0 + e1 * e1 + e2 * e2;
  for (let k = 0; k < USED_INDEX.length; k++) {
    const o = USED_INDEX[k]! * 3;
    const dx = w[o]! - tx, dy = w[o + 1]! - ty, dz = w[o + 2]! - tz;
    out[o] = (e0 * dx + e1 * dy + e2 * dz) / s2;
    out[o + 1] = (e4 * dx + e5 * dy + e6 * dz) / s2;
    out[o + 2] = (e8 * dx + e9 * dy + e10 * dz) / s2;
  }
  return true;
}

export class HandShadow {
  /** Each outline's depth this frame, by output index: its bone's mean box z as cut (for the penumbra). */
  readonly depth = new Float32Array(MAX_HAND_OUTLINES);
  /** Outlines each hand cast this frame: left, then right. */
  readonly cast = new Int32Array(2);
  /** One outline per bone slot (hand * BONES_PER_HAND + bone), handed out by reference. */
  private readonly outlines: V2[][] = Array.from({ length: MAX_HAND_OUTLINES }, () =>
    Array.from({ length: OUTLINE_CORNERS }, (): V2 => [0, 0]),
  );
  private readonly box = new Float64Array(JOINT_COUNT * 3);
  /** One bone's two shadow circles for capsuleOutline. */
  private readonly circles = new Float64Array(6);
  private readonly result: HandShadowResult = { n: 0, nFinger: 0, fingerZ: Number.NaN };

  /**
   * This frame's hand shadows with the lantern at `L` (box units): every casting bone's outline into out[0..n), the
   * finger's also into outFinger[0..nFinger) (the same arrays). `m` is the box root's world matrix (box units to
   * world). The `holder` hand casts nothing. Returns the same result object every call.
   */
  update(
    joints: HandJoints,
    holder: HandSide | null,
    m: Matrix4,
    L: Readonly<V3>,
    out: V2[][],
    outFinger: V2[][],
  ): HandShadowResult {
    let n = 0, nf = 0, zSum = 0, zCount = 0;
    const Lx = L[0], Ly = L[1], Lz = L[2];
    this.cast[0] = 0;
    this.cast[1] = 0;
    if (Lz > 0) {
      const e = m.elements;
      // Metres per box unit: the matrix is a turn and one uniform scale.
      const scale = Math.sqrt(e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!);
      const rFinger = FINGER_RADIUS_CM / 100 / scale, rPalm = PALM_RADIUS_CM / 100 / scale;
      const zMax = Lz * (1 - 1 / MAX_MAGNIFICATION);
      const box = this.box, cc = this.circles;
      for (let h = 0; h < 2; h++) {
        const side = SIDES[h]!;
        if (side === holder || !readHand(joints, side, m, box)) continue;
        const n0 = n;
        for (let i = 0; i < BONES_PER_HAND; i++) {
          const ia = BONE_A[i]! * 3, ib = BONE_B[i]! * 3;
          const ax = box[ia]!, ay = box[ia + 1]!, az = box[ia + 2]!;
          const bx = box[ib]!, by = box[ib + 1]!, bz = box[ib + 2]!;
          if (!(az <= MOUTH_Z || bz <= MOUTH_Z)) continue;
          // Cut the bone to 0 <= z <= zMax.
          const dz = bz - az;
          let t0 = 0, t1 = 1;
          if (dz === 0) {
            if (az < 0 || az > zMax) continue;
          } else {
            const tPanel = -az / dz, tLamp = (zMax - az) / dz;
            if (dz > 0) {
              if (tPanel > t0) t0 = tPanel;
              if (tLamp < t1) t1 = tLamp;
            } else {
              if (tLamp > t0) t0 = tLamp;
              if (tPanel < t1) t1 = tPanel;
            }
            if (!(t0 <= t1)) continue;
          }
          const dx = bx - ax, dy = by - ay;
          const pax = ax + dx * t0, pay = ay + dy * t0, paz = az + dz * t0;
          const pbx = ax + dx * t1, pby = ay + dy * t1, pbz = az + dz * t1;
          const ka = Lz / (Lz - paz), kb = Lz / (Lz - pbz);
          const r = HAND_BONES[i]!.palm ? rPalm : rFinger;
          const poly = this.outlines[h * BONES_PER_HAND + i]!;
          cc[0] = Lx + (pax - Lx) * ka;
          cc[1] = Ly + (pay - Ly) * ka;
          cc[2] = r * ka;
          cc[3] = Lx + (pbx - Lx) * kb;
          cc[4] = Ly + (pby - Ly) * kb;
          cc[5] = r * kb;
          capsuleOutline(cc, poly);
          out[n] = poly;
          this.depth[n] = (paz + pbz) / 2;
          n++;
          if (HAND_BONES[i]!.finger) {
            outFinger[nf++] = poly;
            zSum += paz + pbz;
            zCount += 2;
          }
        }
        this.cast[h] = n - n0;
      }
    }
    const r = this.result;
    r.n = n;
    r.nFinger = nf;
    r.fingerZ = zCount ? zSum / zCount : Number.NaN;
    return r;
  }
}
