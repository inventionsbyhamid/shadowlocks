// Hand shadows: the player's real hand in the lantern's beam casts shadows on the back panel, so hands play shadow
// puppets, and an index finger can fill a finger lock's missing piece. Each bone of a tracked hand is a capsule (a
// sphere swept along the bone: 0.9 cm for finger bones, 2 cm for the palm). A hand is in the box mouth when its index
// finger is (a joint of it at box z <= 1, within the box's width and height and a little margin: a hand resting in
// the lap under the box is not). Then each bone with a joint at z <= 1 casts its capsule from the lantern as a
// 10-corner outline on the panel (box units): the convex hull of its two ends' shadows, each end a circle of its
// radius times Lz / (Lz - z), so a finger near the panel casts small and one near the lantern casts large. The index
// finger's last two bones (intermediate and distal) are the finger, the only part the solve rule counts (measure's
// `finger`); the whole hand still casts.
//
// The hand holding the lantern casts nothing: its fingers sit a couple of centimetres from the light and would black
// out the panel. A bone end nearer the lantern than where its shadow would be MAX_MAGNIFICATION times its size is
// held there (by then the shadow covers the panel; at the lantern it runs off to infinity), and nothing behind the
// panel casts.
//
// Pure geometry on the one joint read a frame (HandJoints, world space) through the box's matrix. Every outline is
// preallocated per bone slot and handed out by reference: nothing is allocated per frame.
//
// A HandShadow casts tracked hands' bones (HAND_BONES at FINGER_RADIUS_CM and PALM_RADIUS_CM) unless it is given a
// bone table of its own (ShadowBones): the lessons' ghost hand casts its own slimmer, tapered bones that way, so its
// shadow matches the hand drawn.
import type { Matrix4 } from "@iwsdk/core";
import { inPoly } from "../core/geom";
import { FINGER_RADIUS_CM } from "../core/solve";
import type { V2, V3 } from "../core/types";
import { HAND_JOINTS, type HandJoints, type HandSide, JOINT_COUNT } from "../input/hand-joints";

/** A hand casts only inside the box mouth: bones with a joint at box z <= this (the open front). */
export const MOUTH_Z = 1.0;
/** ...and only once its index finger is within this of the box's middle across and up (half the box and 2.4 cm). */
export const MOUTH_XY = 0.6;
/** Capsule radii (cm): finger bones (the solve rule's finger, core/solve.ts), and the palm. */
export { FINGER_RADIUS_CM };
export const PALM_RADIUS_CM = 2;
/** Corners of each bone's shadow outline. */
export const OUTLINE_CORNERS = 10;
/** A bone end reaching toward the lantern is held where its shadow is this many times its size. */
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

/** The two hands, left then right: index 0 and 1 in every per-hand table here and in the hand mask. */
export const SIDES: readonly HandSide[] = ["left", "right"];
const jointIndex = (j: XRHandJoint): number => HAND_JOINTS.indexOf(j);
/** Per bone: its two joints' indices into a hand's joint table (HAND_JOINTS order). */
export const BONE_A = Int32Array.from(HAND_BONES, (b) => jointIndex(b.a));
export const BONE_B = Int32Array.from(HAND_BONES, (b) => jointIndex(b.b));
/** The joints any bone uses, read once a frame per hand. */
const USED: readonly XRHandJoint[] = HAND_JOINTS.filter((j) => HAND_BONES.some((b) => b.a === j || b.b === j));
const USED_INDEX = Int32Array.from(USED, jointIndex);
/** The index finger's joints that say whether the hand is in the mouth. */
const INDEX_JOINTS = Int32Array.from(
  ["index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"] as XRHandJoint[],
  jointIndex,
);
/**
 * The bones a HandShadow casts, as it reads them: per bone its two joints (indices into a hand's joint table), its
 * radius in metres at each end (the shadow of a tapered capsule is the hull of two circles), and whether it is one of
 * the finger's bones (outFinger).
 */
export interface ShadowBones {
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly ra: Float64Array;
  readonly rb: Float64Array;
  readonly finger: Uint8Array;
}

/** A tracked hand's bones: HAND_BONES, a finger's at FINGER_RADIUS_CM and the palm's at PALM_RADIUS_CM. */
export const TRACKED_BONES: ShadowBones = {
  a: BONE_A,
  b: BONE_B,
  ra: Float64Array.from(HAND_BONES, (b) => (b.palm ? PALM_RADIUS_CM : FINGER_RADIUS_CM) / 100),
  rb: Float64Array.from(HAND_BONES, (b) => (b.palm ? PALM_RADIUS_CM : FINGER_RADIUS_CM) / 100),
  finger: Uint8Array.from(HAND_BONES, (b) => (b.finger ? 1 : 0)),
};

/** The joints a bone table uses (indices into a hand's joint table, ascending). */
function usedJoints(bones: ShadowBones): Int32Array {
  const used = new Set<number>([...bones.a, ...bones.b]);
  return Int32Array.from([...used].sort((x, y) => x - y));
}

/** Corners of a circle outline (the cos and sin of each corner's angle). */
const CIRCLE_COS = Float64Array.from({ length: OUTLINE_CORNERS }, (_, i) => Math.cos((2 * Math.PI * i) / OUTLINE_CORNERS));
const CIRCLE_SIN = Float64Array.from({ length: OUTLINE_CORNERS }, (_, i) => Math.sin((2 * Math.PI * i) / OUTLINE_CORNERS));
/** The corners' arcs: OUTLINE_CORNERS - 2 steps shared by the two ends (the tangent edges join them). */
const ARC_STEPS = OUTLINE_CORNERS - 2;

/**
 * The shadow outline of a capsule whose ends cast circles c = [ax, ay, ra, bx, by, rb]: ten corners on the rim of the
 * two circles' convex hull, counter-clockwise. Each end's arc runs between the two tangent lines, and the eight arc
 * steps are shared between the two arcs so the longest step is as short as it can be (at most 2 pi / 7, so an edge's
 * middle falls at most 10% of a radius inside the rim; 7.6% for a bone at one depth); when one circle holds the
 * other (a bone pointing at the lantern), the larger circle. The circles come in a typed array so no float is boxed
 * at the call. Allocation-free.
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
  // The tangent points sit at angle alpha from the axis u (a to b) on both circles: cos(alpha) = (ra - rb) / d. b's
  // arc runs from -alpha to alpha (2 alpha wide), a's from alpha to 2 pi - alpha (2 pi - 2 alpha wide).
  const ux = dx / d, uy = dy / d, c = (ra - rb) / d, s = Math.sqrt(1 - c * c), alpha = Math.acos(c);
  const spanB = 2 * alpha, spanA = 2 * Math.PI - spanB;
  let kb = 1;
  for (let k = 2; k < ARC_STEPS; k++) {
    if (Math.max(spanB / k, spanA / (ARC_STEPS - k)) < Math.max(spanB / kb, spanA / (ARC_STEPS - kb))) kb = k;
  }
  const ka = ARC_STEPS - kb;
  // Each arc's corners by turning a unit vector (one cos and sin a step), b's from -alpha, a's from alpha.
  let step = spanB / kb, cs = Math.cos(step), sn = Math.sin(step);
  let vx = c, vy = -s, i = 0;
  for (let j = 0; j <= kb; j++, i++) {
    const p = out[i]!;
    p[0] = bx + rb * (vx * ux - vy * uy);
    p[1] = by + rb * (vx * uy + vy * ux);
    const nx = vx * cs - vy * sn;
    vy = vx * sn + vy * cs;
    vx = nx;
  }
  step = spanA / ka;
  cs = Math.cos(step);
  sn = Math.sin(step);
  vx = c;
  vy = s;
  for (let j = 0; j <= ka; j++, i++) {
    const p = out[i]!;
    p[0] = ax + ra * (vx * ux - vy * uy);
    p[1] = ay + ra * (vx * uy + vy * ux);
    const nx = vx * cs - vy * sn;
    vy = vx * sn + vy * cs;
    vx = nx;
  }
}

/** What HandShadow.update wrote: outlines in out[0..n) and outFinger[0..nFinger), the finger's mean depth. */
export interface HandShadowResult {
  n: number;
  nFinger: number;
  /**
   * The fingers' mean box z (their bones' ends, as cast), NaN with no finger in the beam. With two hands in the mouth
   * this is between them: fingerDepthOver picks the one that fills a gap.
   */
  fingerZ: number;
}

/**
 * Read the joints any bone uses of one tracked hand into `out` (x, y, z each, HAND_JOINTS order): world metres, or
 * box units through the box matrix `m` (worldToBox's sum, written out so no float crosses a call). Joints no bone
 * uses (of HAND_BONES, or the joints `used` lists) are left as they were. False when the hand is not tracked.
 */
export function readHand(joints: HandJoints, side: HandSide, m: Matrix4 | null, out: Float64Array, used: Int32Array = USED_INDEX): boolean {
  const w = joints.positions(side);
  if (!w) return false;
  if (!m) {
    for (let k = 0; k < used.length; k++) {
      const o = used[k]! * 3;
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
  for (let k = 0; k < used.length; k++) {
    const o = used[k]! * 3;
    const dx = w[o]! - tx, dy = w[o + 1]! - ty, dz = w[o + 2]! - tz;
    out[o] = (e0 * dx + e1 * dy + e2 * dz) / s2;
    out[o + 1] = (e4 * dx + e5 * dy + e6 * dz) / s2;
    out[o + 2] = (e8 * dx + e9 * dy + e10 * dz) / s2;
  }
  return true;
}

/** True when one of the hand's index finger joints (box units, as readHand left them) is in the box mouth. */
function inMouth(box: Float64Array): boolean {
  for (let k = 0; k < INDEX_JOINTS.length; k++) {
    const o = INDEX_JOINTS[k]! * 3;
    const x = box[o]!, y = box[o + 1]!, z = box[o + 2]!;
    if (z <= MOUTH_Z && x <= MOUTH_XY && x >= -MOUTH_XY && y <= MOUTH_XY && y >= -MOUTH_XY) return true;
  }
  return false;
}

/**
 * A held controller's stand-in finger (no free hand's finger in the beam): a fingertip-sized capsule along the
 * controller's aim, from this far past its front back a finger's length (an index finger's last two bones).
 */
export const STAND_IN = { pastCm: 2, lengthCm: 4.5 } as const;

/** True when the box point (x, y, z) is in the box mouth (MOUTH_Z deep, within MOUTH_XY of the middle). */
function pointInMouth(x: number, y: number, z: number): boolean {
  return z <= MOUTH_Z && x <= MOUTH_XY && x >= -MOUTH_XY && y <= MOUTH_XY && y >= -MOUTH_XY;
}

export class HandShadow {
  /** Each outline's depth this frame, by output index: its bone's mean box z as cast (for the penumbra). */
  readonly depth: Float32Array;
  /** Outlines each hand cast this frame: left, then right. */
  readonly cast = new Int32Array(2);
  /** Each hand's finger depth this frame (its finger bones' mean box z as cast), NaN with no finger in the beam. */
  readonly handFingerZ = new Float64Array([Number.NaN, Number.NaN]);
  /** Which hand (0 left, 1 right) cast each finger outline, by its index in outFinger. */
  readonly fingerHand: Int8Array;
  /** A stand-in finger's two ends (box units: front x, y, z, then back x, y, z), as castStandIn reads them. */
  readonly standIn = new Float64Array(6);
  private readonly standInOutline: V2[] = Array.from({ length: OUTLINE_CORNERS }, (): V2 => [0, 0]);
  /** One outline per bone slot (hand * bones + bone), handed out by reference. */
  private readonly outlines: V2[][];
  private readonly box = new Float64Array(JOINT_COUNT * 3);
  /** One bone's two shadow circles for capsuleOutline. */
  private readonly circles = new Float64Array(6);
  private readonly result: HandShadowResult = { n: 0, nFinger: 0, fingerZ: Number.NaN };
  /** The joints the bones use, read once a frame per hand. */
  private readonly used: Int32Array;

  /** Casts `bones` (a tracked hand's by default). */
  constructor(private readonly bones: ShadowBones = TRACKED_BONES) {
    const n = bones.a.length;
    this.used = bones === TRACKED_BONES ? USED_INDEX : usedJoints(bones);
    this.outlines = Array.from({ length: 2 * n }, () => Array.from({ length: OUTLINE_CORNERS }, (): V2 => [0, 0]));
    this.depth = new Float32Array(2 * n + 1);
    let fingers = 0;
    for (let i = 0; i < n; i++) fingers += bones.finger[i]!;
    this.fingerHand = new Int8Array(2 * fingers + 1);
  }

  /** Outlines both hands can cast in a frame: twice the bones. */
  get maxOutlines(): number {
    return this.outlines.length;
  }

  /**
   * This frame's hand shadows with the lantern at `L` (box units): every casting bone's outline into out[0..n), the
   * finger's also into outFinger[0..nFinger) (the same arrays). `m` is the box root's world matrix (box units to
   * world). The `holder` hand casts nothing, nor a hand whose index finger is not in the mouth. Returns the same
   * result object every call.
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
    this.handFingerZ[0] = Number.NaN;
    this.handFingerZ[1] = Number.NaN;
    if (Lz > 0) {
      const e = m.elements;
      // Metres per box unit: the matrix is a turn and one uniform scale.
      const scale = Math.sqrt(e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!);
      const zMax = Lz * (1 - 1 / MAX_MAGNIFICATION);
      const box = this.box, cc = this.circles, bones = this.bones, nb = bones.a.length;
      for (let h = 0; h < 2; h++) {
        const side = SIDES[h]!;
        if (side === holder || !readHand(joints, side, m, box, this.used) || !inMouth(box)) continue;
        const n0 = n;
        let hzSum = 0, hzCount = 0;
        for (let i = 0; i < nb; i++) {
          const ia = bones.a[i]! * 3, ib = bones.b[i]! * 3;
          const ax = box[ia]!, ay = box[ia + 1]!, az = box[ia + 2]!;
          const bx = box[ib]!, by = box[ib + 1]!, bz = box[ib + 2]!;
          if (!(az <= MOUTH_Z || bz <= MOUTH_Z)) continue;
          // Behind the panel nothing casts: cut the bone at z = 0.
          if (az < 0 && bz < 0) continue;
          const dx = bx - ax, dy = by - ay, dz = bz - az;
          const t0 = az < 0 ? -az / dz : 0, t1 = bz < 0 ? -az / dz : 1;
          // An end nearer the lantern than zMax is held at zMax (its shadow at most MAX_MAGNIFICATION times its size).
          const pax = ax + dx * t0, pay = ay + dy * t0, paz = Math.min(az + dz * t0, zMax);
          const pbx = ax + dx * t1, pby = ay + dy * t1, pbz = Math.min(az + dz * t1, zMax);
          const ka = Lz / (Lz - paz), kb = Lz / (Lz - pbz);
          // Each end's radius in box units (a tapered bone cut at the panel keeps its taper).
          const ra = bones.ra[i]! / scale, rb = bones.rb[i]! / scale;
          const poly = this.outlines[h * nb + i]!;
          cc[0] = Lx + (pax - Lx) * ka;
          cc[1] = Ly + (pay - Ly) * ka;
          cc[2] = (ra + (rb - ra) * t0) * ka;
          cc[3] = Lx + (pbx - Lx) * kb;
          cc[4] = Ly + (pby - Ly) * kb;
          cc[5] = (ra + (rb - ra) * t1) * kb;
          capsuleOutline(cc, poly);
          out[n] = poly;
          this.depth[n] = (paz + pbz) / 2;
          n++;
          if (bones.finger[i]) {
            this.fingerHand[nf] = h;
            outFinger[nf++] = poly;
            hzSum += paz + pbz;
            hzCount += 2;
          }
        }
        this.cast[h] = n - n0;
        if (hzCount) this.handFingerZ[h] = hzSum / hzCount;
        zSum += hzSum;
        zCount += hzCount;
      }
    }
    const r = this.result;
    r.n = n;
    r.nFinger = nf;
    r.fingerZ = zCount ? zSum / zCount : Number.NaN;
    return r;
  }

  /**
   * After update, with no hand's finger in the beam: a held controller's stand-in finger (hand `h`) cast from L like a
   * finger bone (radius FINGER_RADIUS_CM, cut at the panel, held to MAX_MAGNIFICATION) between `standIn`'s ends, into
   * out[n] and outFinger[nFinger] of the same result, when either end is in the box mouth. Returns the result (the same
   * object update returned), unchanged when the stand-in is out of the mouth. Allocation-free.
   */
  castStandIn(h: 0 | 1, m: Matrix4, L: Readonly<V3>, out: V2[][], outFinger: V2[][]): HandShadowResult {
    const r = this.result, s = this.standIn;
    const Lx = L[0], Ly = L[1], Lz = L[2];
    const ax = s[0]!, ay = s[1]!, az = s[2]!, bx = s[3]!, by = s[4]!, bz = s[5]!;
    if (!(Lz > 0) || r.nFinger > 0 || !(pointInMouth(ax, ay, az) || pointInMouth(bx, by, bz))) return r;
    if (az < 0 && bz < 0) return r;
    const e = m.elements;
    const rFinger = FINGER_RADIUS_CM / 100 / Math.sqrt(e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!);
    const zMax = Lz * (1 - 1 / MAX_MAGNIFICATION);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const t0 = az < 0 ? -az / dz : 0, t1 = bz < 0 ? -az / dz : 1;
    const pax = ax + dx * t0, pay = ay + dy * t0, paz = Math.min(az + dz * t0, zMax);
    const pbx = ax + dx * t1, pby = ay + dy * t1, pbz = Math.min(az + dz * t1, zMax);
    const ka = Lz / (Lz - paz), kb = Lz / (Lz - pbz), cc = this.circles, poly = this.standInOutline;
    cc[0] = Lx + (pax - Lx) * ka;
    cc[1] = Ly + (pay - Ly) * ka;
    cc[2] = rFinger * ka;
    cc[3] = Lx + (pbx - Lx) * kb;
    cc[4] = Ly + (pby - Ly) * kb;
    cc[5] = rFinger * kb;
    capsuleOutline(cc, poly);
    const z = (paz + pbz) / 2;
    out[r.n] = poly;
    this.depth[r.n] = z;
    r.n++;
    this.cast[h] = this.cast[h]! + 1;
    this.fingerHand[0] = h;
    outFinger[0] = poly;
    r.nFinger = 1;
    this.handFingerZ[h] = z;
    r.fingerZ = z;
    return r;
  }

  /**
   * The depth of the finger that fills a gap: of the hands whose finger cast this frame (outFinger[0..nFinger) as
   * update wrote it), the one whose finger shadow holds the most of `gap`'s points (a lock's missing piece's
   * samples), the nearer to the gap's middle on a tie; its finger depth (box z). NaN with no finger in the beam. Run
   * when a finger lock completes, not per frame.
   */
  fingerDepthOver(finger: readonly V2[][], nFinger: number, gap: readonly V2[]): number {
    let gx = 0, gy = 0;
    for (const p of gap) {
      gx += p[0] / gap.length;
      gy += p[1] / gap.length;
    }
    let best = -1, bestHits = -1, bestD = Infinity;
    for (let h = 0; h < 2; h++) {
      if (!Number.isFinite(this.handFingerZ[h]!)) continue;
      let hits = 0, cx = 0, cy = 0, corners = 0;
      for (const p of gap) {
        for (let k = 0; k < nFinger; k++) {
          if (this.fingerHand[k] === h && inPoly(p, finger[k]!)) {
            hits++;
            break;
          }
        }
      }
      for (let k = 0; k < nFinger; k++) {
        if (this.fingerHand[k] !== h) continue;
        for (const q of finger[k]!) {
          cx += q[0];
          cy += q[1];
          corners++;
        }
      }
      const d = Math.hypot(cx / corners - gx, cy / corners - gy);
      if (hits > bestHits || (hits === bestHits && d < bestD)) {
        best = h;
        bestHits = hits;
        bestD = d;
      }
    }
    return best < 0 ? Number.NaN : this.handFingerZ[best]!;
  }
}
