import { beforeAll, describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import { area, circlePts, inPoly, polyDist, proj } from "../../src/core/geom";
import {
  BAND,
  type Coverage,
  isShort,
  type LockSamples,
  measure,
  meets,
  prepareLock,
  RULE,
  RUNTIME_STEP,
  ShadowCaster,
  SKIP_MISSING,
  shadowBuffers,
  shadowPolys,
  warmth,
  WARMTH_RANGE,
} from "../../src/core/solve";
import type { Box, Element, Lock, Piece, V2, V3 } from "../../src/core/types";

const BOXES = 50;
const boxes: Box[] = [];
const samples = new Map<Lock, LockSamples>();

beforeAll(() => {
  for (let n = 1; n <= BOXES; n++) {
    const box = generateBox({ kind: "box", n });
    boxes.push(box);
    for (const l of box.locks) samples.set(l, prepareLock(l));
  }
}, 120_000);

const cov = (): Coverage => ({ cover: 0, spill: 0, spillAll: 0, gap: 0 });
const locks = () => boxes.flatMap((box) => box.locks.map((lock) => ({ box, lock, s: samples.get(lock)! })));
const add = (a: V3, d: V3, t: number): V3 => [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** From the spot toward the start: the way a player comes in. */
const towardStart = (box: Box, l: Lock): V3 => unit([box.start[0] - l.L[0], box.start[1] - l.L[1], box.start[2] - l.L[2]]);

/** The lock's coverage with the lantern at L: every scrap but missing pieces, and these finger shadows. */
function coverageAt(box: Box, s: LockSamples, L: V3, finger: V2[][] = []): Coverage {
  const scraps: V2[][] = [];
  const n = shadowPolys(box.elements, L, scraps, SKIP_MISSING);
  return measure(s, scraps, n, finger, finger.length, cov());
}

/** The missing piece's own shadow from L, standing in for a finger that fills it exactly. */
function missingShadow(box: Box, l: Lock, L: V3): V2[][] {
  const piece = box.elements.find((e): e is Piece => e.kind === "piece" && e.lock === l.i && e.missing)!;
  return [piece.verts.map((p) => proj(p, L))];
}

const rect = (x0: number, y0: number, x1: number, y1: number): V2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
/** A two-piece lock: left and right halves of a 0.2 square; the right half is missing when `finger`. */
function squareLock(finger: boolean): Lock {
  return {
    i: 0,
    shape: "Key",
    center: [0, 0],
    size: 0.2,
    rot: 0,
    target: [rect(-0.1, -0.1, 0, 0.1), rect(0, -0.1, 0.1, 0.1)],
    L: [0, 0, 1.4],
    finger,
    missing: finger ? 1 : -1,
    fingerAngle: 0,
    mark: null,
    rings: false,
    hidden: false,
  };
}

describe("prepareLock", () => {
  it("samples the outline and its 0.04 band on the runtime grid, and lists the missing piece's points", () => {
    expect(BAND).toBe(0.04);
    let fingerLocks = 0;
    for (const { lock: l, s } of locks().slice(0, 30)) {
      expect(prepareLock(l, RUNTIME_STEP)).toEqual(s);
      const d = (pt: V2) => Math.min(...l.target.map((p) => polyDist(pt, p)));
      for (const pt of s.inside) expect(d(pt)).toBe(0);
      for (const pt of s.band) {
        expect(d(pt)).toBeGreaterThan(0);
        expect(d(pt)).toBeLessThanOrEqual(BAND);
      }
      for (const [x, y] of [...s.inside, ...s.band]) {
        expect(x).toBeGreaterThanOrEqual(s.box[0]);
        expect(y).toBeGreaterThanOrEqual(s.box[1]);
        expect(x).toBeLessThanOrEqual(s.box[2]);
        expect(y).toBeLessThanOrEqual(s.box[3]);
      }
      const want = l.finger ? s.inside.flatMap((pt, i) => (inPoly(pt, l.target[l.missing]!) ? [i] : [])) : [];
      expect(s.missingIdx).toEqual(want);
      if (l.finger) {
        fingerLocks++;
        expect(s.missingIdx.length).toBeGreaterThan(0);
        expect(s.missingIdx.length).toBeLessThan(s.inside.length);
      }
      // One point per 0.016 cell: the outline's area, give or take its edge.
      const outline = l.target.reduce((sum, p) => sum + area(p), 0);
      expect(s.inside.length * RUNTIME_STEP ** 2).toBeGreaterThan(0.75 * outline);
      expect(s.inside.length * RUNTIME_STEP ** 2).toBeLessThan(1.25 * outline);
    }
    expect(fingerLocks).toBeGreaterThan(0);
  });
});

describe("measure", () => {
  const sq = prepareLock(squareLock(true), 0.01);
  const plain = prepareLock(squareLock(false), 0.01);
  const left = rect(-0.1, -0.1, 0, 0.1), right = rect(0, -0.1, 0.1, 0.1), all = rect(-0.3, -0.3, 0.3, 0.3);
  const far = rect(0.6, 0.6, 0.8, 0.8);

  it("counts scraps for cover and spill, and the finger only for the gap and the total spill", () => {
    let c = measure(sq, [left], 1, [], 0, cov());
    expect(c).toEqual({ cover: 1, spill: 0, spillAll: 0, gap: 0 });
    c = measure(sq, [left], 1, [right], 1, cov());
    expect(c).toEqual({ cover: 1, spill: 0, spillAll: 0, gap: 1 });
    c = measure(sq, [], 0, [all], 1, cov());
    expect(c).toEqual({ cover: 0, spill: 0, spillAll: 1, gap: 1 });
    c = measure(sq, [all], 1, [], 0, cov());
    expect(c).toEqual({ cover: 1, spill: 1, spillAll: 1, gap: 1 });
  });

  it("gives a lock without a missing piece a full gap, and judges cover over every inside point", () => {
    expect(plain.missingIdx).toEqual([]);
    expect(measure(plain, [], 0, [], 0, cov()).gap).toBe(1);
    const half = measure(plain, [left], 1, [], 0, cov()).cover;
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });

  it("reads only the first n polygons of each list, and ignores shadows away from the lock", () => {
    expect(measure(sq, [left, all], 1, [right, all], 1, cov())).toEqual({ cover: 1, spill: 0, spillAll: 0, gap: 1 });
    expect(measure(sq, [far, left], 2, [far], 1, cov())).toEqual({ cover: 1, spill: 0, spillAll: 0, gap: 0 });
  });

  it("writes into out and returns it", () => {
    const out = cov();
    expect(measure(sq, [left], 1, [], 0, out)).toBe(out);
    expect(out.cover).toBe(1);
  });

  it("agrees with testing every point against every polygon", () => {
    for (const { box, lock: l, s } of locks().slice(0, 40)) {
      for (const L of [l.L, box.start, add(l.L, towardStart(box, l), 0.1)]) {
        const scraps = box.elements.filter((e) => !(e.kind === "piece" && e.missing)).map((e) => shadowOf(e, L));
        const [cx, cy] = l.center;
        const finger = l.finger ? missingShadow(box, l, add(L, [0.01, -0.02, 0], 1)) : [rect(cx - 0.3, cy - 0.01, cx + 0.3, cy + 0.01)];
        const share = (pts: V2[], polys: V2[][]) => (pts.length ? pts.filter((p) => polys.some((q) => inPoly(p, q))).length / pts.length : 0);
        const miss = new Set(s.missingIdx);
        const rest = s.inside.filter((_, i) => !miss.has(i)), gapPts = s.inside.filter((_, i) => miss.has(i));
        const want: Coverage = {
          cover: share(rest, scraps),
          spill: share(s.band, scraps),
          spillAll: share(s.band, [...scraps, ...finger]),
          gap: gapPts.length ? share(gapPts, [...scraps, ...finger]) : 1,
        };
        expect(coverageAt(box, s, L, finger)).toEqual(want);
      }
    }
  });
});

/** An element's shadow from L the slow way, straight from geom.ts. */
function shadowOf(e: Element, L: V3): V2[] {
  return (e.kind === "ring" ? circlePts(e.c, e.nrm, e.rOut, 14) : e.verts).map((p) => proj(p, L));
}

describe("the solve rule", () => {
  it("opens every lock of boxes 1..50 at its spot; a finger lock only with its piece's shadow as the finger", () => {
    const errs: string[] = [];
    const stat = { cover: 1, spill: 0, spillAll: 0, gapWith: 1, gapWithout: 0 };
    for (const { box, lock: l, s } of locks()) {
      const c = coverageAt(box, s, l.L);
      stat.cover = Math.min(stat.cover, c.cover);
      stat.spill = Math.max(stat.spill, c.spill);
      if (l.finger) {
        stat.gapWithout = Math.max(stat.gapWithout, c.gap);
        if (meets(c, true)) errs.push(`${box.key} lock ${l.i} opens without the finger: ${JSON.stringify(c)}`);
        if (!isShort(c, true)) errs.push(`${box.key} lock ${l.i} not short without the finger: ${JSON.stringify(c)}`);
        const f = coverageAt(box, s, l.L, missingShadow(box, l, l.L));
        stat.gapWith = Math.min(stat.gapWith, f.gap);
        stat.spillAll = Math.max(stat.spillAll, f.spillAll);
        if (!meets(f, true)) errs.push(`${box.key} lock ${l.i} stays shut with the finger: ${JSON.stringify(f)}`);
        if (isShort(f, true)) errs.push(`${box.key} lock ${l.i} short with the finger`);
      } else {
        stat.spillAll = Math.max(stat.spillAll, c.spillAll);
        if (!meets(c, false)) errs.push(`${box.key} lock ${l.i} stays shut: ${JSON.stringify(c)}`);
        if (isShort(c, false)) errs.push(`${box.key} lock ${l.i} is a plain lock called short`);
      }
    }
    console.log(
      `${locks().length} locks at their spots: cover min ${stat.cover.toFixed(3)}, spill max ${stat.spill.toFixed(3)}, ` +
        `spillAll max ${stat.spillAll.toFixed(3)}; finger gap with the piece min ${stat.gapWith.toFixed(3)}, ` +
        `without max ${stat.gapWithout.toFixed(3)}`,
    );
    expect(errs).toEqual([]);
  });

  it("opens no lock from the start", () => {
    let worst = 0;
    const errs: string[] = [];
    for (const { box, lock: l, s } of locks()) {
      const c = coverageAt(box, s, box.start);
      worst = Math.max(worst, c.cover);
      if (meets(c, l.finger)) errs.push(`${box.key} lock ${l.i} opens from the start: ${JSON.stringify(c)}`);
    }
    console.log(`from the start: cover max ${worst.toFixed(3)}`);
    expect(errs).toEqual([]);
  });

  it("meets all four checks, the gap only for a finger lock", () => {
    const c = (cover: number, spill: number, spillAll: number, gap: number): Coverage => ({ cover, spill, spillAll, gap });
    expect(RULE).toEqual({ COVER_MIN: 0.92, SPILL_MAX: 0.25, SPILL_ALL_MAX: 0.55, GAP_MIN: 0.78 });
    expect(meets(c(0.92, 0.25, 0.55, 0.78), true)).toBe(true);
    expect(meets(c(0.919, 0, 0, 1), true)).toBe(false);
    expect(meets(c(1, 0.251, 0.3, 1), false)).toBe(false);
    expect(meets(c(1, 0, 0.551, 1), false)).toBe(false);
    expect(meets(c(1, 0, 0, 0.779), true)).toBe(false);
    expect(meets(c(1, 0, 0, 0), false)).toBe(true);
  });

  it("calls a finger lock short when cover and spill are met but the gap is not", () => {
    const c = (cover: number, spill: number, gap: number): Coverage => ({ cover, spill, spillAll: spill, gap });
    expect(isShort(c(0.95, 0.1, 0.5), true)).toBe(true);
    expect(isShort(c(0.95, 0.1, 0.5), false)).toBe(false);
    expect(isShort(c(0.95, 0.1, 0.78), true)).toBe(false);
    expect(isShort(c(0.91, 0.1, 0.5), true)).toBe(false);
    expect(isShort(c(0.95, 0.26, 0.5), true)).toBe(false);
  });
});

describe("warmth", () => {
  const c = (cover: number, spillAll: number): Coverage => ({ cover, spill: 0, spillAll, gap: 1 });

  it("follows cover and total spill within 0.2 of the spot, and is 0 beyond", () => {
    expect(WARMTH_RANGE).toBe(0.2);
    expect(warmth(c(1, 0), 0)).toBe(1);
    expect(warmth(c(1, 0), 0.2)).toBe(1);
    expect(warmth(c(1, 0), 0.2001)).toBe(0);
    expect(warmth(c(0.4, 0), 0)).toBe(0);
    expect(warmth(c(0.3, 0), 0)).toBe(0);
    expect(warmth(c(0.66, 0.275), 0.1)).toBeCloseTo(0.25, 12);
    expect(warmth(c(0.79, 0.11), 0)).toBeCloseTo(0.6, 12); // 0.75 from cover times 0.8 from spill
    expect(warmth(c(1, 0.55), 0)).toBe(0);
    expect(warmth(c(1, 0.7), 0)).toBe(0);
  });

  it("is 0 at 0.21 from each spot of boxes 1..50 and above 0.8 at it", () => {
    let low = 1;
    for (const { box, lock: l, s } of locks()) {
      const away = add(l.L, towardStart(box, l), 0.21);
      expect(warmth(coverageAt(box, s, away), 0.21)).toBe(0);
      const w = warmth(coverageAt(box, s, l.L), 0);
      low = Math.min(low, w);
      expect(w, `${box.key} lock ${l.i}`).toBeGreaterThan(0.8);
    }
    console.log(`warmth at the spot: min ${low.toFixed(3)}`);
  });

  it("is warmest at the spot along the line in from 0.2 away (10 samples)", () => {
    // Every sample from 0.044 out is cooler than the spot. The one 0.022 away may already be as warm (1): a lock
    // whose scraps hang near the panel, met from the side its rays run, opens a few millimetres early (box 35's
    // hidden Arrow, a finger lock).
    const errs: string[] = [], ties: string[] = [];
    let strict = 0;
    for (const { box, lock: l, s } of locks()) {
      const dir = towardStart(box, l);
      const w = Array.from({ length: 10 }, (_, k) => {
        const d = WARMTH_RANGE * (1 - k / 9);
        return warmth(coverageAt(box, s, add(l.L, dir, d)), d);
      });
      if (w.slice(0, 9).every((v) => v < w[9]!)) strict++;
      else if (w.slice(0, 8).every((v) => v < w[9]!) && w[8]! <= w[9]! && w[9] === 1) ties.push(`${box.key} lock ${l.i}`);
      else errs.push(`${box.key} lock ${l.i}: ${w.map((v) => v.toFixed(3)).join(" ")}`);
    }
    console.log(`strictly warmest at the spot: ${strict}/${locks().length}; as warm 0.022 away: ${ties.join(", ") || "none"}`);
    expect(errs).toEqual([]);
    expect(ties.length).toBeLessThanOrEqual(Math.ceil(locks().length / 100));
  });
});

describe("shadowPolys", () => {
  it("casts every element from L, rings as 14-gons of their outer radius, missing pieces skipped on request", () => {
    for (const box of boxes.slice(0, 10)) {
      const L = box.locks[0]!.L, out: V2[][] = [];
      expect(shadowPolys(box.elements, L, out)).toBe(box.elements.length);
      box.elements.forEach((e, k) => expect(out[k]).toEqual(shadowOf(e, L)));
      const kept = box.elements.filter((e) => !(e.kind === "piece" && e.missing)), skip: V2[][] = [];
      expect(shadowPolys(box.elements, L, skip, SKIP_MISSING)).toBe(kept.length);
      kept.forEach((e, k) => expect(skip[k]).toEqual(shadowOf(e, L)));
      kept.forEach((e, k) => e.kind === "ring" && expect(skip[k]).toHaveLength(14));
    }
  });

  it("writes into out: same arrays across 100 calls, none new after the first", () => {
    const box = boxes[BOXES - 1]!, out: V2[][] = [];
    const n = shadowPolys(box.elements, box.start, out, SKIP_MISSING);
    const polys = out.slice(), pts = out.map((p) => p.slice());
    for (let t = 0; t < 100; t++) {
      const L: V3 = [box.start[0] - 0.004 * t, box.start[1] + 0.002 * t, box.start[2] - 0.001 * t];
      expect(shadowPolys(box.elements, L, out, SKIP_MISSING)).toBe(n);
      expect(out.length).toBe(polys.length);
      for (let k = 0; k < n; k++) {
        expect(out[k]).toBe(polys[k]);
        expect(out[k]!.length).toBe(pts[k]!.length);
        for (let j = 0; j < pts[k]!.length; j++) expect(out[k]![j]).toBe(pts[k]![j]);
      }
      if (t % 25 === 0) {
        const kept = box.elements.filter((e) => !(e.kind === "piece" && e.missing));
        kept.forEach((e, k) => expect(out[k]).toEqual(shadowOf(e, L)));
      }
    }
  });

  it("casts into a buffer sized by shadowBuffers without making any array, even the first time", () => {
    const box = boxes[BOXES - 1]!;
    for (const opts of [undefined, SKIP_MISSING]) {
      const out = shadowBuffers(box.elements, opts);
      const polys = out.slice(), pts = out.map((p) => p.slice());
      const n = shadowPolys(box.elements, box.locks[1]!.L, out, opts);
      expect(n).toBe(polys.length);
      expect(out.length).toBe(n);
      for (let k = 0; k < n; k++) {
        expect(out[k]).toBe(polys[k]);
        expect(out[k]!.length).toBe(pts[k]!.length);
        out[k]!.forEach((p, j) => expect(p).toBe(pts[k]![j]));
      }
    }
  });
});

describe("ShadowCaster", () => {
  it("casts exactly what shadowPolys does (to the bit), into the same views every call, and measures the same", () => {
    for (const box of boxes.slice(0, 15)) {
      for (const opts of [undefined, SKIP_MISSING]) {
        const caster = new ShadowCaster(box.elements, opts);
        const views = caster.polys.map((p) => p.slice());
        const ref = shadowBuffers(box.elements, opts);
        for (const L of [box.start, ...box.locks.map((l) => l.L), [0.01, -0.2, 1.2] as V3]) {
          const n = caster.cast(L);
          expect(n).toBe(shadowPolys(box.elements, L, ref, opts));
          for (let k = 0; k < n; k++) {
            expect(caster.polys[k]!.length).toBe(ref[k]!.length);
            caster.polys[k]!.forEach((p, j) => {
              expect(p).toBe(views[k]![j]);
              expect([p[0], p[1]]).toEqual([ref[k]![j]![0], ref[k]![j]![1]]);
            });
          }
        }
      }
      // measure reads the views as it reads plain arrays.
      const lock = box.locks[0]!, s = samples.get(lock)!;
      const caster = new ShadowCaster(box.elements, SKIP_MISSING), ref = shadowBuffers(box.elements, SKIP_MISSING);
      const a = measure(s, caster.polys, caster.cast(lock.L), [], 0, { cover: 0, spill: 0, spillAll: 0, gap: 0 });
      const b = measure(s, ref, shadowPolys(box.elements, lock.L, ref, SKIP_MISSING), [], 0, { cover: 0, spill: 0, spillAll: 0, gap: 0 });
      expect(a).toEqual(b);
    }
  });
});

describe("performance", () => {
  it("measures one lock at its spot in under 0.3 ms on average over 1000 runs", () => {
    // The lock with the most sample points, with its finger in place when it has one.
    const { box, lock: l, s } = locks().reduce((a, b) => (b.s.inside.length + b.s.band.length > a.s.inside.length + a.s.band.length ? b : a));
    const scraps = shadowBuffers(box.elements, SKIP_MISSING);
    const n = shadowPolys(box.elements, l.L, scraps, SKIP_MISSING);
    const finger = l.finger ? missingShadow(box, l, l.L) : [];
    const out = cov();
    for (let i = 0; i < 300; i++) measure(s, scraps, n, finger, finger.length, out);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) measure(s, scraps, n, finger, finger.length, out);
    const avg = (performance.now() - t0) / 1000;

    // A whole frame of box 50: cast every scrap, then measure each lock with a finger shadow near it.
    const last = boxes[BOXES - 1]!, buf = shadowBuffers(last.elements, SKIP_MISSING), ls = last.locks.map((k) => samples.get(k)!);
    const fingers = last.locks.map((k) => (k.finger ? missingShadow(last, k, k.L) : [rect(-0.02, -0.02, 0.02, 0.02)]));
    const frame = (t: number) => {
      const L = add(last.locks[t % last.locks.length]!.L, [0.001, 0, 0], t % 7);
      const m = shadowPolys(last.elements, L, buf, SKIP_MISSING);
      for (let k = 0; k < ls.length; k++) measure(ls[k]!, buf, m, fingers[k]!, fingers[k]!.length, out);
    };
    for (let t = 0; t < 300; t++) frame(t);
    const t1 = performance.now();
    for (let t = 0; t < 1000; t++) frame(t);
    const perFrame = (performance.now() - t1) / 1000;
    console.log(
      `measure: ${(avg * 1000).toFixed(1)} us per lock (${box.key} lock ${l.i}, ${s.inside.length} inside + ${s.band.length} band ` +
        `points, ${n} scraps); a frame of ${last.key} (${last.locks.length} locks, ${castCount(last)} scraps): ${(perFrame * 1000).toFixed(1)} us`,
    );
    expect(avg).toBeLessThan(0.3);
  });
});

/** How many shadows a box casts once its missing pieces are skipped. */
const castCount = (box: Box) => box.elements.filter((e) => !(e.kind === "piece" && e.missing)).length;
