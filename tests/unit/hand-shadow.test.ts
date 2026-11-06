import { describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import { centroid, elongation, segDist } from "../../src/core/geom";
import {
  type Coverage,
  isShort,
  measure,
  meets,
  prepareLock,
  RULE,
  SKIP_MISSING,
  shadowBuffers,
  shadowPolys,
} from "../../src/core/solve";
import type { V2, V3 } from "../../src/core/types";
import {
  BONES_PER_HAND,
  capsuleOutline,
  FINGER_RADIUS_CM,
  HAND_BONES,
  HandShadow,
  MAX_HAND_OUTLINES,
  MAX_MAGNIFICATION,
  MOUTH_XY,
  MOUTH_Z,
  OUTLINE_CORNERS,
  PALM_RADIUS_CM,
} from "../../src/render/hand-shadow";
import { boxMatrix, fakeJoints, type JointMap, moved, pointingHand } from "./helpers/hands";

const cov = (): Coverage => ({ cover: 0, spill: 0, spillAll: 0, gap: 0 });
const buffers = (): [V2[][], V2[][]] => [[], []];
const finite = (polys: V2[][], n: number) => polys.slice(0, n).every((p) => p.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])));
/** Twice the signed area: positive when counter-clockwise. */
const area2 = (p: V2[]) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * a[1], 0);
const convex = (p: V2[]) => {
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!, c = p[(i + 2) % p.length]!;
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-12) return false;
  }
  return true;
};
const proj = (P: V3, L: V3): V2 => {
  const k = L[2] / (L[2] - P[2]);
  return [L[0] + (P[0] - L[0]) * k, L[1] + (P[1] - L[1]) * k];
};

/** A lantern in front of the box, and a pointing hand in the box mouth halfway to the panel. */
const L: V3 = [0.05, -0.1, 1.4];
const inMouth = (): JointMap => pointingHand([0, 0, 0.5], [-1, 0, 0]);

describe("HandShadow", () => {
  it("casts every bone of a tracked hand in the mouth as a 10-corner capsule, and the index finger's last two bones as the finger", () => {
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    const r = hs.update(feed({ right: inMouth() }), null, m, L, out, finger);
    expect(BONES_PER_HAND).toBe(HAND_BONES.length);
    expect(MAX_HAND_OUTLINES).toBe(2 * BONES_PER_HAND);
    expect(r.n).toBe(BONES_PER_HAND);
    expect(r.nFinger).toBe(2);
    for (let k = 0; k < r.n; k++) {
      expect(out[k]!.length).toBe(OUTLINE_CORNERS);
      expect(area2(out[k]!)).toBeGreaterThan(0);
      expect(convex(out[k]!)).toBe(true);
    }
    expect(finite(out, r.n)).toBe(true);
    // The finger outlines are among the hand's (the same arrays), and the finger sits at the hand's depth.
    for (let k = 0; k < r.nFinger; k++) expect(out.slice(0, r.n)).toContain(finger[k]);
    expect(r.fingerZ).toBeCloseTo(0.5, 5);
    const fingerBones = HAND_BONES.filter((b) => b.finger).map((b) => `${b.a}>${b.b}`);
    expect(fingerBones).toEqual([
      "index-finger-phalanx-intermediate>index-finger-phalanx-distal",
      "index-finger-phalanx-distal>index-finger-tip",
    ]);
  });

  it("the holding hand adds no polygons", () => {
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    const right = inMouth();
    let r = hs.update(feed({ right }), "right", m, L, out, finger);
    expect([r.n, r.nFinger]).toEqual([0, 0]);
    expect(r.fingerZ).toBeNaN();
    // The other hand still casts, and only it: its finger's shadow is where its finger is, not the holder's.
    const left = moved(pointingHand([0, 0, 0.5], [1, 0, 0]), [0, 0.3, 0]);
    r = hs.update(feed({ left, right }), "right", m, L, out, finger);
    expect([r.n, r.nFinger]).toEqual([BONES_PER_HAND, 2]);
    const tip = proj(left["index-finger-tip"], L), c = centroid(finger.slice(0, 2).flat());
    expect(Math.hypot(c[0] - tip[0], c[1] - tip[1])).toBeLessThan(0.15);
    expect(c[1]).toBeGreaterThan(0.2);
    // Nobody holds the lantern: both hands cast.
    r = hs.update(feed({ left, right }), null, m, L, out, finger);
    expect([r.n, r.nFinger]).toEqual([2 * BONES_PER_HAND, 4]);
  });

  it("a hand outside the mouth (z > 1.0) adds none; a bone casts once one of its joints is in", () => {
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    const outside = pointingHand([0, 0, 1.05], [-1, 0, 0]);
    let r = hs.update(feed({ right: outside }), null, m, L, out, finger);
    expect([r.n, r.nFinger]).toEqual([0, 0]);
    // Only the index tip dips into the mouth: just the bone ending at it casts (it is a finger bone).
    const reaching = { ...outside, "index-finger-tip": [outside["index-finger-tip"][0], 0, MOUTH_Z] as V3 };
    r = hs.update(feed({ right: reaching }), null, m, L, out, finger);
    expect([r.n, r.nFinger]).toEqual([1, 1]);
    expect(finger[0]).toBe(out[0]);
  });

  it("a hand out of tracking adds none, and comes back with its next frame", () => {
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    expect(hs.update(feed({ right: inMouth() }), null, m, L, out, finger).n).toBe(BONES_PER_HAND);
    // The runtime no longer lists the hand: its last pose is never used.
    expect(hs.update(feed({}), null, m, L, out, finger)).toMatchObject({ n: 0, nFinger: 0 });
    expect(hs.update(feed({ right: inMouth() }), null, m, L, out, finger).n).toBe(BONES_PER_HAND);
  });

  it("each shadow is its capsule seen from the lantern: 0.9 cm fingers, 2 cm palm, scaled by Lz / (Lz - z), at every box size", () => {
    for (const cm of [18, 24, 30])
    for (const z of [0.15, 0.5, 0.8]) {
      const { feed, m } = fakeJoints(boxMatrix(cm));
      const hs = new HandShadow();
      const [out, finger] = buffers();
      const hand = pointingHand([0.1, 0.05, z], [-1, 0, 0], cm);
      const r = hs.update(feed({ right: hand }), null, m, L, out, finger);
      expect(r.n).toBe(BONES_PER_HAND);
      let flat = 0;
      // Outlines come in bone order.
      HAND_BONES.forEach((b, i) => {
        const za = hand[b.a][2], zb = hand[b.b][2];
        expect(hs.depth[i]).toBeCloseTo((za + zb) / 2, 5);
        if (za !== zb) return;
        // A bone lying at one depth: both ends the same size, every corner on the capsule's rim.
        flat++;
        const a = proj(hand[b.a], L), c = proj(hand[b.b], L);
        const want = ((b.palm ? PALM_RADIUS_CM : FINGER_RADIUS_CM) / cm) * (L[2] / (L[2] - za));
        // (Joint poses come as float32 world metres: about 1e-6 box units once magnified.)
        for (const p of out[i]!) expect(segDist(p, a, c)).toBeCloseTo(want, 5);
      });
      // The palm, the thumb's first bone, the index finger and the curled fingers' last bones.
      expect(flat).toBe(10);
    }
  });

  it("a hand not in the mouth's width and height (resting in the lap under the box) casts nothing", () => {
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    // Under the box, at mid-depth: every joint at z < 1, but the index finger 0.85 below the box's middle.
    expect(hs.update(feed({ right: pointingHand([0, -0.85, 0.5], [-1, 0, 0]) }), null, m, L, out, finger).n).toBe(0);
    expect(hs.update(feed({ right: pointingHand([0.9, 0, 0.5], [1, 0, 0]) }), null, m, L, out, finger).n).toBe(0);
    // Just inside the margin: it casts.
    expect(hs.update(feed({ right: pointingHand([0, -0.58, 0.5], [-1, 0, 0]) }), null, m, L, out, finger).n).toBe(BONES_PER_HAND);
    expect(MOUTH_XY).toBe(0.6);
  });

  it("a bone between where its shadow would pass 8 times its size and the mouth is held there, not dropped", () => {
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    // The lantern just in front of the box: 8x is z = 0.919. The index finger lies at 0.95, past that, in the mouth.
    const Lnear: V3 = [0, 0, 1.05], zMax = 1.05 * (1 - 1 / MAX_MAGNIFICATION);
    const r = hs.update(feed({ right: pointingHand([0.02, 0.01, 0.95], [-1, 0, 0]) }), null, m, Lnear, out, finger);
    expect(r.nFinger).toBe(2);
    expect(hs.handFingerZ[1]).toBeCloseTo(zMax, 5);
    expect(finite(finger, 2)).toBe(true);
    // Each end's shadow is 8 times its size: a finger's 0.0375 radius becomes 0.3.
    const f = finger[0]!, cx = f.reduce((s, p) => s + p[0], 0) / f.length, cy = f.reduce((s, p) => s + p[1], 0) / f.length;
    expect(Math.max(...f.map((p) => Math.hypot(p[0] - cx, p[1] - cy)))).toBeGreaterThan(0.25);
  });

  it("shares the ten corners between the two ends by arc, so a tapered bone keeps its round ends", () => {
    const out = Array.from({ length: OUTLINE_CORNERS }, (): V2 => [0, 0]);
    const c6 = new Float64Array(6);
    const cases: number[][] = [
      [0, 0, 0.04, 0.2, 0.05, 0.04], // one depth: 5 and 5
      [0, 0, 0.03, 0.08, 0, 0.1], // tilted into depth: the near end's arc is 302 degrees wide
      [0, 0, 0.1, 0.12, 0.02, 0.03],
      [0.1, -0.2, 0.05, 0.1, 0.1, 0.12],
      [0, 0, 0.02, 0.5, 0.3, 0.025],
    ];
    for (const c of cases) {
      c6.set(c);
      capsuleOutline(c6, out);
      expect(convex(out)).toBe(true);
      expect(area2(out)).toBeGreaterThan(0);
      const ends: [number, number, number][] = [[c[0]!, c[1]!, c[2]!], [c[3]!, c[4]!, c[5]!]];
      const on = (p: V2) => ends.findIndex(([x, y, r]) => Math.abs(Math.hypot(p[0] - x, p[1] - y) - r) < 1e-9);
      for (const p of out) expect(on(p)).toBeGreaterThanOrEqual(0);
      // Neighbouring corners round the same end are at most 2 pi / 7 apart: an edge's middle at most 10% of a
      // radius inside the rim (with five a side, the second case's would sit 21% inside).
      let widest = 0;
      for (let i = 0; i < out.length; i++) {
        const p = out[i]!, q = out[(i + 1) % out.length]!, e = on(p);
        if (e !== on(q)) continue;
        const [x, y] = ends[e]!;
        let d = Math.abs(Math.atan2(q[1] - y, q[0] - x) - Math.atan2(p[1] - y, p[0] - x));
        if (d > Math.PI) d = 2 * Math.PI - d;
        widest = Math.max(widest, d);
      }
      expect(widest).toBeLessThanOrEqual((2 * Math.PI) / 7 + 1e-9);
    }
  });

  it("with two free hands in the mouth, the finger over the gap gives the depth the piece forms at", () => {
    const box = generateBox({ kind: "box", n: 3 });
    const lock = box.locks.find((l) => l.finger)!;
    const s = prepareLock(lock);
    const gap = s.missingIdx.map((i) => s.inside[i]!);
    const piece = lock.target[lock.missing]!, mid = centroid(piece), a = elongation(piece).angle;
    const over = (z: number): V3 => {
      const k = (lock.L[2] - z) / lock.L[2];
      return [lock.L[0] + (mid[0] - lock.L[0]) * k, lock.L[1] + (mid[1] - lock.L[1]) * k, z];
    };
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    for (const [zGap, zOther] of [[0.5, 0.2], [0.35, 0.7]] as const) {
      // The right finger over the gap; the left one in the mouth too, away from it, at another depth.
      const right = pointingHand(over(zGap), [-Math.cos(a), -Math.sin(a), 0]);
      const left = pointingHand([-lock.center[0] * 0.8, 0.35, zOther], [1, 0, 0]);
      const r = hs.update(feed({ left, right }), null, m, lock.L, out, finger);
      expect(r.nFinger).toBe(4);
      // Both fingers' mean is between them; the finger over the gap is the one that counts.
      expect(Math.abs(r.fingerZ - zGap)).toBeGreaterThan(0.1);
      expect(hs.fingerDepthOver(finger, r.nFinger, gap)).toBeCloseTo(zGap, 5);
      // The same with the hands swapped.
      const r2 = hs.update(feed({ left: right, right: left }), null, m, lock.L, out, finger);
      expect(hs.fingerDepthOver(finger, r2.nFinger, gap)).toBeCloseTo(zGap, 5);
    }
    // No finger in the beam: none.
    const r3 = hs.update(feed({}), null, m, lock.L, out, finger);
    expect(hs.fingerDepthOver(finger, r3.nFinger, gap)).toBeNaN();
  });

  it("a bone reaching toward the lantern makes a tapered, convex outline and is held before its shadow runs off", () => {
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    // The index finger points straight out at the lantern from just inside the mouth, its tip almost touching it.
    const hand = inMouth();
    const tilted: JointMap = {
      ...hand,
      "index-finger-phalanx-intermediate": [L[0], L[1], 0.8],
      "index-finger-phalanx-distal": [L[0] + 0.01, L[1], 0.98],
      "index-finger-tip": [L[0] + 0.015, L[1], L[2] - 0.01],
    };
    const r = hs.update(feed({ right: tilted }), null, m, L, out, finger);
    expect(r.nFinger).toBe(2);
    expect(finite(out, r.n)).toBe(true);
    for (let k = 0; k < r.n; k++) expect(convex(out[k]!)).toBe(true);
    // The tip is held where its shadow is 8 times its size (z = 1.225 here): 0.015 off the lantern's axis, it lands
    // 0.12 from it with a radius of 8 x 0.0375. Unheld (k = 140) it would throw the shadow 7 units out.
    for (const p of finger[1]!) expect(Math.hypot(p[0] - L[0], p[1] - L[1])).toBeLessThan(0.5);
  });

  it("writes into the same arrays every frame", () => {
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    const r1 = hs.update(feed({ right: inMouth() }), null, m, L, out, finger);
    const polys = out.slice(0, r1.n), points = polys.map((p) => p.slice()), fingers = finger.slice(0, r1.nFinger);
    const r2 = hs.update(feed({ right: moved(inMouth(), [0.05, 0, 0.1]) }), null, m, L, out, finger);
    expect(r2).toBe(r1);
    expect(out.slice(0, r2.n)).toEqual(polys);
    for (let k = 0; k < polys.length; k++) {
      expect(out[k]).toBe(polys[k]);
      for (let j = 0; j < OUTLINE_CORNERS; j++) expect(out[k]![j]).toBe(points[k]![j]);
    }
    for (let k = 0; k < fingers.length; k++) expect(finger[k]).toBe(fingers[k]);
  });

  it("a pointing index finger at depth 0.5 fills the missing piece of box 3's finger lock from its spot", () => {
    const box = generateBox({ kind: "box", n: 3 });
    const lock = box.locks.find((l) => l.finger)!;
    expect(lock).toBeDefined();
    const s = prepareLock(lock), c = cov();
    const scraps = shadowBuffers(box.elements, SKIP_MISSING);
    const ns = shadowPolys(box.elements, lock.L, scraps, SKIP_MISSING);
    // Scraps alone: the lock is one piece short.
    expect(isShort(measure(s, scraps, ns, [], 0, c), true)).toBe(true);

    // The finger lies along the missing piece's long axis, on the rays from the spot through it, halfway to the panel.
    const piece = lock.target[lock.missing]!, mid = centroid(piece), a = elongation(piece).angle, z = 0.5;
    const k = (lock.L[2] - z) / lock.L[2];
    const at: V3 = [lock.L[0] + (mid[0] - lock.L[0]) * k, lock.L[1] + (mid[1] - lock.L[1]) * k, z];
    const { feed, m } = fakeJoints();
    const hs = new HandShadow();
    const [out, finger] = buffers();
    const r = hs.update(feed({ right: pointingHand(at, [-Math.cos(a), -Math.sin(a), 0]) }), null, m, lock.L, out, finger);
    expect(r.nFinger).toBe(2);
    measure(s, scraps, ns, finger, r.nFinger, c);
    expect(c.gap).toBeGreaterThanOrEqual(RULE.GAP_MIN);
    expect(meets(c, true)).toBe(true);

    // Moved off the gap by its own width, it no longer fills it.
    const off = hs.update(feed({ right: moved(pointingHand(at, [-Math.cos(a), -Math.sin(a), 0]), [0, 0.15, 0]) }), null, m, lock.L, out, finger);
    measure(s, scraps, ns, finger, off.nFinger, c);
    expect(meets(c, true)).toBe(false);
  });
});
