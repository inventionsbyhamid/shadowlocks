import { describe, expect, it } from "vitest";
import { ENVELOPE } from "../../src/core/envelope";
import { GENERATOR_VERSION } from "../../src/core/generator";
import { area, elongation, proj } from "../../src/core/geom";
import {
  buildLessonLock,
  LESSON_1,
  LESSON_2,
  LESSON_TWINS,
  type LessonId,
  type LessonLock,
  lessonPlan,
  mirrorLock,
} from "../../src/core/lessons-data";
import { ringOffset, RING_ON } from "../../src/core/rings";
import { MOON_OUTLINE, SHAPES } from "../../src/core/shapes";
import { BAND, type Coverage, isShort, measure, meets, prepareLock, shadowPolys, SKIP_MISSING } from "../../src/core/solve";
import type { Box, Element, Lock, Piece, Ring, V2, V3 } from "../../src/core/types";

const cov = (): Coverage => ({ cover: 0, spill: 0, spillAll: 0, gap: 0 });

/** How well `elements` fill `lock` from L, a finger filling `finger` (the missing piece's outline) if given. */
function coverage(lock: Lock, elements: Element[], L: V3, finger: V2[][] = []): Coverage {
  const out: V2[][] = [];
  const n = shadowPolys(elements, L, out, SKIP_MISSING);
  return measure(prepareLock(lock), out, n, finger, finger.length, cov());
}

/** The missing piece's own outline on the panel: a finger that fills it exactly. */
const fingerFill = (lock: Lock): V2[][] => (lock.missing >= 0 ? [lock.target[lock.missing]!] : []);

const pieces = (els: Element[], lock: number) => els.filter((e): e is Piece => e.kind === "piece" && e.lock === lock);
const rings = (els: Element[], lock: number) => els.filter((e): e is Ring => e.kind === "ring" && e.lock === lock);
const flip3 = (p: V3): V3 => [-p[0], p[1], p[2]];

/**
 * Every way a lesson's box can stand during the lesson: each lock with a twin either in its twin's layout (during that
 * lock's example) or in the player's (the box itself). Yields each lock's elements as they hang then.
 */
function layouts(box: Box, twins: (LessonLock | null)[]): { twin: boolean[]; elements: Element[] }[] {
  const ks = twins.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
  const out: { twin: boolean[]; elements: Element[] }[] = [];
  for (let mask = 0; mask < 1 << ks.length; mask++) {
    const twin = box.locks.map(() => false);
    ks.forEach((k, j) => (twin[k] = (mask & (1 << j)) !== 0));
    const elements = box.locks.flatMap((l) => (twin[l.i] ? twins[l.i]!.elements : box.elements.filter((e) => e.kind !== "decoy" && e.lock === l.i)));
    out.push({ twin, elements });
  }
  return out;
}

const PLANS: { id: LessonId; mirrored: boolean }[] = [
  { id: "l1", mirrored: false },
  { id: "l2", mirrored: false },
  { id: "l1", mirrored: true },
  { id: "l2", mirrored: true },
];

describe("buildLessonLock", () => {
  it("hangs each piece on the rays from the spot at its own depth, so from the spot it casts its outline exactly", () => {
    const L: V3 = [0.1, -0.3, 1.3];
    const { lock, elements } = buildLessonLock("Diamond", [0.05, 0.1], 0.3, L, [0.2, 0.4, 0.5, 0.7], { i: 1, rot: 0.3 });
    expect(lock).toMatchObject({ i: 1, shape: "Diamond", center: [0.05, 0.1], size: 0.3, rot: 0.3, L, finger: false, missing: -1 });
    expect(lock.rings).toBe(false);
    expect(lock.mark).toBeNull();
    expect(lock.hidden).toBe(false);
    expect(lock.target).toHaveLength(SHAPES.Diamond.length);
    const ps = pieces(elements, 1);
    expect(ps.map((p) => p.piece)).toEqual([0, 1, 2, 3]);
    ps.forEach((p, j) => {
      expect(p.missing).toBe(false);
      for (const v of p.verts) expect(v[2]).toBeCloseTo([0.2, 0.4, 0.5, 0.7][j]!, 12);
      p.verts.forEach((v, k) => {
        const s = proj(v, L), t = lock.target[j]![k]!;
        expect(s[0]).toBeCloseTo(t[0], 12);
        expect(s[1]).toBeCloseTo(t[1], 12);
      });
    });
    // The outline is the shape turned by rot and scaled about its centre.
    const c = Math.cos(0.3), s = Math.sin(0.3), [x, y] = SHAPES.Diamond[1]![1]!;
    expect(lock.target[1]![1]![0]).toBeCloseTo(0.05 + (x * c - y * s) * 0.3, 12);
    expect(lock.target[1]![1]![1]).toBeCloseTo(0.1 + (x * s + y * c) * 0.3, 12);
    expect(meets(coverage(lock, elements, L), false)).toBe(true);
  });

  it("makes the Moon one scrap from its single outline", () => {
    const { lock, elements } = buildLessonLock("MoonOutline", [0, 0], 0.4, [0, -0.3, 1.3], [0.5]);
    expect(lock.shape).toBe("Moon");
    expect(elements).toHaveLength(1);
    expect(lock.target).toHaveLength(1);
    expect(lock.target[0]).toHaveLength(MOON_OUTLINE.length);
  });

  it("keeps the two-scrap Arrow to the lessons: no generated box can pick it, and the generator's goldens are untouched", () => {
    const { lock, elements } = buildLessonLock("ArrowInTwo", [0, 0], 0.3, [0.1, -0.3, 1.4], [0.7, 0.2]);
    // A lesson lock names the shape it outlines; the shape library and its names know only the Arrow.
    expect(lock.shape).toBe("Arrow");
    expect(elements).toHaveLength(2);
    expect(Object.keys(SHAPES)).not.toContain("ArrowInTwo");
    expect(Object.keys(SHAPES)).not.toContain("MoonOutline");
    // Its two pieces cover exactly what the Arrow's four do.
    const area4 = SHAPES.Arrow.reduce((s, p) => s + area(p), 0);
    const area2 = lock.target.reduce((s, p) => s + area(p), 0) / (0.3 * 0.3);
    expect(area2).toBeCloseTo(area4, 9);
    // The goldens: generated boxes are pinned by tests/unit/generator.test.ts; the lessons' version is the same.
    expect(GENERATOR_VERSION).toBe(3);
  });

  it("refuses a depth list that does not match the pieces", () => {
    expect(() => buildLessonLock("Diamond", [0, 0], 0.3, [0, -0.3, 1.3], [0.3, 0.4])).toThrow(RangeError);
  });

  it("hangs two sight rings on the line from the spot through the mark: a bullseye from the spot only", () => {
    const L: V3 = [0.2, -0.35, 1.25], mark: V2 = [-0.3, -0.25];
    const { lock, elements } = buildLessonLock("Hourglass", [0, 0.1], 0.3, L, [0.3, 0.4, 0.5, 0.6], {
      rings: { mark, depths: [0.6, 0.25] },
    });
    expect(lock.rings).toBe(true);
    expect(lock.mark).toEqual(mark);
    const rs = rings(elements, 0);
    expect(rs).toHaveLength(2);
    expect(rs.map((r) => r.c[2])).toEqual([0.6, 0.25]);
    expect(ringOffset(lock, rs, L)).toBeLessThan(1e-9);
    // Seen from the spot the shallow ring's shadow holds the deep one's in its hole, as the generator sizes them.
    const shadowR = (r: Ring) => [(r.rOut * L[2]) / (L[2] - r.c[2]), (r.rIn * L[2]) / (L[2] - r.c[2])];
    const [shallow, deep] = rs.map(shadowR) as [number[], number[]];
    expect(shallow[0]).toBeCloseTo(0.044, 12);
    expect(deep[0]).toBeLessThan(shallow[1]!);
    for (const r of rs) {
      const d: V3 = [L[0] - r.c[0], L[1] - r.c[1], L[2] - r.c[2]], l = Math.hypot(...d);
      r.nrm.forEach((v, k) => expect(v).toBeCloseTo(d[k]! / l, 12));
    }
    // Off the line, the rings part.
    expect(ringOffset(lock, rs, [L[0] + 0.1, L[1], L[2]])).toBeGreaterThan(RING_ON);
    expect(() =>
      buildLessonLock("Hourglass", [0, 0.1], 0.3, L, [0.3, 0.4, 0.5, 0.6], { rings: { mark, depths: [0.3, 0.25] } }),
    ).toThrow(RangeError);
  });

  it("leaves a finger lock's missing piece marked, and aims the finger along it", () => {
    const L: V3 = [0.2, -0.3, 1.35];
    const { lock, elements } = buildLessonLock("Crown", [0, 0], 0.4, L, [0.3, 0.3, 0.4, 0.5, 0.4], { missing: 3 });
    expect(lock).toMatchObject({ finger: true, missing: 3 });
    expect(lock.fingerAngle).toBeCloseTo(elongation(lock.target[3]!).angle, 12);
    expect(pieces(elements, 0).map((p) => p.missing)).toEqual([false, false, false, true, false]);
    expect(isShort(coverage(lock, elements, L), true)).toBe(true);
    expect(meets(coverage(lock, elements, L, fingerFill(lock)), true)).toBe(true);
  });
});

describe("mirrorLock", () => {
  it("keeps the outline and mark, reflects the spot across the box's middle and hangs the scraps again at the same depths", () => {
    const t = buildLessonLock("Key", [0.05, -0.2], 0.34, [0.22, -0.4, 1.2], [0.3, 0.35, 0.45, 0.55, 0.62, 0.68], {
      i: 2,
      rings: { mark: [0.3, -0.27], depths: [0.6, 0.27] },
    });
    const m = mirrorLock(t);
    expect(m.lock).toEqual({ ...t.lock, L: [-0.22, -0.4, 1.2] });
    expect(m.elements).toHaveLength(t.elements.length);
    m.elements.forEach((e, k) => {
      const o = t.elements[k]!;
      expect(e.kind).toBe(o.kind);
      if (e.kind === "piece" && o.kind === "piece") {
        expect([e.lock, e.piece, e.missing]).toEqual([o.lock, o.piece, o.missing]);
        e.verts.forEach((v, j) => expect(v[2]).toBeCloseTo(o.verts[j]![2], 12));
      }
      if (e.kind === "ring" && o.kind === "ring") {
        expect(e.c[2]).toBeCloseTo(o.c[2], 12);
        expect(e.rOut).toBeCloseTo(o.rOut, 12);
        expect(e.rIn).toBeCloseTo(o.rIn, 12);
      }
    });
    // The twins meet at mirrored spots, and neither at the other's.
    expect(meets(coverage(t.lock, t.elements, t.lock.L), false)).toBe(true);
    expect(meets(coverage(m.lock, m.elements, m.lock.L), false)).toBe(true);
    expect(meets(coverage(m.lock, m.elements, t.lock.L), false)).toBe(false);
    expect(meets(coverage(t.lock, t.elements, m.lock.L), false)).toBe(false);
    expect(ringOffset(m.lock, rings(m.elements, 2), m.lock.L)).toBeLessThan(1e-9);
    // Mirroring twice gives the lock back; another axis reflects across it.
    const back = mirrorLock(m);
    back.elements.forEach((e, k) => {
      const o = t.elements[k]!;
      if (e.kind === "piece" && o.kind === "piece") e.verts.forEach((v, j) => v.forEach((x, a) => expect(x).toBeCloseTo(o.verts[j]![a]!, 12)));
    });
    expect(mirrorLock(t, 0.1).lock.L[0]).toBeCloseTo(-0.02, 12);
  });
});

describe("the lesson boxes", () => {
  it("lesson 1: a Moon from one scrap, an arrow from two scraps at depths 0.2 and 0.7, a Key with sight rings", () => {
    const b = LESSON_1;
    expect(b.spec).toEqual({ kind: "lesson", id: "l1" });
    expect(b.mirrored).toBe(false);
    expect(b.locks.map((l) => l.i)).toEqual([0, 1, 2]);
    expect(b.locks.map((l) => l.shape)).toEqual(["Moon", "Arrow", "Key"]);
    expect(pieces(b.elements, 0)).toHaveLength(1);
    expect(b.elements.filter((e) => e.kind !== "decoy" && e.lock === 0)).toHaveLength(1);
    const two = pieces(b.elements, 1);
    expect(two).toHaveLength(2);
    expect(two.map((p) => p.verts[0]![2]).sort()).toEqual([0.2, 0.7]);
    expect(b.locks[2]!.rings).toBe(true);
    expect(rings(b.elements, 2)).toHaveLength(2);
    expect(b.locks.slice(0, 2).every((l) => !l.rings && !l.finger && !l.hidden)).toBe(true);
    expect(b.elements.some((e) => e.kind === "decoy")).toBe(false);
    expect(b.start).toEqual([...ENVELOPE.START]);
    expect(b.params).toMatchObject({ locks: 3, fingerLocks: 0, decoys: 0, ringless: 2, hidden: 0 });
    expect(LESSON_TWINS.l1[0]).toBeNull();
    expect(LESSON_TWINS.l1[1]).not.toBeNull();
    expect(LESSON_TWINS.l1[2]).not.toBeNull();
  });

  it("lesson 2: a Crown short of a prong that runs within 30 degrees of horizontal, the lantern starting on its spot", () => {
    const b = LESSON_2;
    expect(b.spec).toEqual({ kind: "lesson", id: "l2" });
    expect(b.locks).toHaveLength(1);
    const l = b.locks[0]!;
    expect(l).toMatchObject({ shape: "Crown", finger: true, rings: false, hidden: false });
    expect(Math.abs(l.fingerAngle)).toBeLessThanOrEqual(Math.PI / 6);
    expect(Math.abs(elongation(l.target[l.missing]!).angle)).toBeLessThanOrEqual(Math.PI / 6);
    expect(b.start).toEqual(l.L);
    expect(b.params).toMatchObject({ locks: 1, fingerLocks: 1, decoys: 0 });
    expect(LESSON_TWINS.l2[0]).not.toBeNull();
  });

  it("each lesson lock meets at its spot and not at the start, however the other examples stand", () => {
    for (const { id, mirrored } of PLANS) {
      const { box, twins } = lessonPlan(id, mirrored);
      for (const { twin, elements } of layouts(box, twins)) {
        for (const lock of box.locks) {
          const at = `${id}${mirrored ? " mirrored" : ""} lock ${lock.i} (twins ${twin})`;
          if (twin[lock.i]) continue;
          const f = fingerFill(lock);
          expect(meets(coverage(lock, elements, lock.L, f), lock.finger), at).toBe(true);
          expect(meets(coverage(lock, elements, box.start), lock.finger), at + " at the start").toBe(false);
          if (lock.finger) expect(isShort(coverage(lock, elements, lock.L), true), at).toBe(true);
        }
      }
    }
  });

  it("the mirrored twins meet at mirrored spots, and the player's lock never at its twin's", () => {
    for (const { id, mirrored } of PLANS) {
      const { box, twins } = lessonPlan(id, mirrored);
      for (const { twin, elements } of layouts(box, twins)) {
        for (const lock of box.locks) {
          const t = twins[lock.i];
          if (!t || !twin[lock.i]) continue;
          const at = `${id}${mirrored ? " mirrored" : ""} twin ${lock.i} (twins ${twin})`;
          expect(t.lock.L).toEqual([-lock.L[0], lock.L[1], lock.L[2]]);
          const f = fingerFill(t.lock);
          expect(meets(coverage(t.lock, elements, t.lock.L, f), t.lock.finger), at).toBe(true);
          const mine = box.elements.filter((e) => e.kind !== "decoy" && e.lock === lock.i);
          const others = elements.filter((e) => e.kind === "decoy" || e.lock !== lock.i);
          expect(meets(coverage(lock, [...others, ...mine], t.lock.L, f), lock.finger), at + " from the twin's spot").toBe(false);
        }
      }
    }
  });

  it("from each spot no other lock's scraps or rings come near the outline, and sight rings line up only there", () => {
    for (const { id, mirrored } of PLANS) {
      const { box, twins } = lessonPlan(id, mirrored);
      for (const { twin, elements } of layouts(box, twins)) {
        for (const lock of box.locks) {
          const own = twin[lock.i] ? twins[lock.i]!.lock : lock;
          const others = elements.filter((e) => e.kind === "decoy" || e.lock !== lock.i);
          const c = coverage(own, others, own.L);
          const at = `${id}${mirrored ? " mirrored" : ""} lock ${lock.i} (twins ${twin})`;
          expect(c.cover, at).toBe(0);
          expect(c.spill, at).toBe(0);
          if (own.rings) {
            const rs = rings(elements, lock.i);
            expect(ringOffset(own, rs, own.L), at).toBeLessThan(1e-9);
            expect(ringOffset(own, rs, box.start), at).toBeGreaterThan(RING_ON);
          }
        }
      }
    }
  });

  it("keeps every spot (the twins' too) in the seated envelope, apart from each other and from the start", () => {
    const E = ENVELOPE;
    for (const { id, mirrored } of PLANS) {
      const { box, twins } = lessonPlan(id, mirrored);
      const spots = [...box.locks.map((l) => l.L), ...twins.flatMap((t) => (t ? [t.lock.L] : []))];
      for (const L of spots) {
        expect(L[2]).toBeGreaterThanOrEqual(E.LZ[0]);
        expect(L[2]).toBeLessThanOrEqual(E.LZ[1]);
        expect(Math.abs(L[0])).toBeLessThanOrEqual(E.LX_MAX);
        expect(L[1]).toBeGreaterThanOrEqual(E.LY[0]);
        expect(L[1]).toBeLessThanOrEqual(E.LY[1]);
      }
      const d = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const mine = box.locks.map((l) => l.L);
      for (let a = 0; a < mine.length; a++) for (let b = a + 1; b < mine.length; b++) expect(d(mine[a]!, mine[b]!)).toBeGreaterThanOrEqual(E.SPOT_MIN_SEP);
      if (id === "l1") for (const L of mine) expect(d(L, box.start)).toBeGreaterThanOrEqual(E.SPOT_MIN_SEP);
      // A twin's spot is well away from the player's, so copying the ghost does not solve it.
      box.locks.forEach((l) => twins[l.i] && expect(d(l.L, twins[l.i]!.lock.L)).toBeGreaterThanOrEqual(0.3));
    }
  });

  it("hangs every scrap and ring inside the box, clear of each other", () => {
    for (const { id, mirrored } of PLANS) {
      const { box, twins } = lessonPlan(id, mirrored);
      for (const { twin, elements } of layouts(box, twins)) {
        const bb = elements.map((e): [V3, V3] => {
          if (e.kind === "ring") return [[e.c[0] - e.rOut, e.c[1] - e.rOut, e.c[2] - e.rOut], [e.c[0] + e.rOut, e.c[1] + e.rOut, e.c[2] + e.rOut]];
          const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
          for (const v of e.verts) for (let a = 0; a < 3; a++) {
            lo[a] = Math.min(lo[a]!, v[a]!);
            hi[a] = Math.max(hi[a]!, v[a]!);
          }
          return [lo, hi];
        });
        bb.forEach(([lo, hi]) => {
          expect(Math.max(Math.abs(lo[0]), Math.abs(hi[0]), Math.abs(lo[1]), Math.abs(hi[1]))).toBeLessThanOrEqual(ENVELOPE.IN_BOX_XY);
          expect(lo[2]).toBeGreaterThanOrEqual(ENVELOPE.PIECE_Z[0]);
          expect(hi[2]).toBeLessThanOrEqual(ENVELOPE.PIECE_Z[1]);
        });
        // Scraps of different locks (and rings) never share space: their boxes, grown by a scrap's thickness, stay apart.
        const g = 0.01;
        for (let a = 0; a < elements.length; a++) {
          for (let b = a + 1; b < elements.length; b++) {
            const ea = elements[a]!, eb = elements[b]!;
            if (ea.kind === "piece" && eb.kind === "piece" && ea.lock === eb.lock) continue;
            const [la, ha] = bb[a]!, [lb, hb] = bb[b]!;
            const apart = [0, 1, 2].some((k) => la[k]! - g > hb[k]! || lb[k]! - g > ha[k]!);
            expect(apart, `${id}${mirrored ? " mirrored" : ""} (twins ${twin}): elements ${a} and ${b} overlap`).toBe(true);
          }
        }
      }
    }
  });
});

describe("lessonPlan", () => {
  it("mirrors the box and its twins for a left-handed player, and hands out the same objects each time", () => {
    for (const id of ["l1", "l2"] as const) {
      const a = lessonPlan(id, false), m = lessonPlan(id, true);
      expect(lessonPlan(id, true)).toBe(m);
      expect(a.box).toBe(id === "l1" ? LESSON_1 : LESSON_2);
      expect(a.twins).toBe(LESSON_TWINS[id]);
      expect(m.box.mirrored).toBe(true);
      expect(m.box.start).toEqual(flip3(a.box.start));
      m.box.locks.forEach((l, i) => expect(l.L).toEqual(flip3(a.box.locks[i]!.L)));
      m.twins.forEach((t, i) => {
        if (!t) return expect(a.twins[i]).toBeNull();
        expect(t.lock.L).toEqual(flip3(a.twins[i]!.lock.L));
        expect(t.elements).toHaveLength(a.twins[i]!.elements.length);
      });
    }
    expect(BAND).toBe(0.04);
  });
});
