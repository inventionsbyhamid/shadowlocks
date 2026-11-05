import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBox, GENERATOR_VERSION, generateBox } from "../../src/core/generator";
import { SHAPES, SILHOUETTES } from "../../src/core/shapes";
import { LOOT, OWNERS } from "../../src/core/story";
import type { Box, BoxSpec, ShapeName } from "../../src/core/types";
import {
  checkCounts,
  checkFingerAndDepth,
  checkSilhouettes,
  checkInBox,
  checkRingsNest,
  checkSolvable,
  checkSpots,
  type LockStat,
  type RingStat,
  fingerAngles,
  missingShares,
  nearHorizontal,
  paramsFor,
} from "./helpers/box-checks";

const BOXES = 200;
const DAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
const SPECS: BoxSpec[] = [
  ...Array.from({ length: BOXES }, (_, i): BoxSpec => ({ kind: "box", n: i + 1 })),
  ...DAYS.map((day): BoxSpec => ({ kind: "daily", day })),
];

interface Built {
  spec: BoxSpec;
  box: Box;
  ms: number;
  attempts: number;
}
const built: Built[] = [];
const failures: Record<string, number> = {};

/** Runs a per-box check over every box and lists what failed. */
function failing(check: (b: Box) => string[]): string[] {
  return built.flatMap(({ box }) => check(box).map((e) => `${box.key}: ${e}`));
}

beforeAll(() => {
  for (const spec of SPECS) {
    const t0 = performance.now();
    const r = buildBox(spec);
    built.push({ spec, box: r.box, ms: performance.now() - t0, attempts: r.attempts });
    for (const [k, v] of Object.entries(r.failures)) failures[k] = (failures[k] ?? 0) + v;
  }
}, 600_000);

describe("generateBox", () => {
  it("builds boxes 1..200 and 30 days quickly", () => {
    const ms = built.map((b) => b.ms);
    const avg = ms.reduce((s, v) => s + v, 0) / ms.length;
    const worst = Math.max(...ms);
    const attempts = built.reduce((s, b) => s + b.attempts, 0) / built.length;
    console.log(
      `${built.length} boxes: avg ${avg.toFixed(1)} ms, worst ${worst.toFixed(1)} ms (${built.find((b) => b.ms === worst)!.box.key}); ` +
        `avg ${attempts.toFixed(2)} attempts, most ${Math.max(...built.map((b) => b.attempts))}; failed attempts by reason ${JSON.stringify(failures)}`,
    );
    expect(avg).toBeLessThan(150);
    expect(worst).toBeLessThan(1000);
  });

  it("is solvable from every spot, finger locks short exactly their piece, no spill, nothing solved from the start", () => {
    const stats: LockStat[] = [];
    const errs = failing((b) => checkSolvable(b, stats));
    const plain = stats.filter((s) => !s.finger), finger = stats.filter((s) => s.finger);
    const min = (v: number[]) => Math.min(...v).toFixed(3), max = (v: number[]) => Math.max(...v).toFixed(3);
    const worst = (f: (s: LockStat) => number) => stats.reduce((a, b) => (f(b) > f(a) ? b : a));
    console.log(`worst spill ${worst((s) => s.spill).box} lock ${worst((s) => s.spill).lock}; ` +
      `worst other scraps ${worst((s) => s.foreign).box} lock ${worst((s) => s.foreign).lock}`);
    console.log(
      `${stats.length} locks (${finger.length} finger): plain coverage min ${min(plain.map((s) => s.cov))}; ` +
        `finger with piece min ${min(finger.map((s) => s.covAll))}, without max ${max(finger.map((s) => s.cov))} ` +
        `(missing share ${min(finger.map((s) => 1 - s.cov))}..${max(finger.map((s) => 1 - s.cov))}); ` +
        `spill max ${max(stats.map((s) => s.spill))}; other scraps max ${max(stats.map((s) => s.foreign))}; ` +
        `from the start max ${max(stats.map((s) => s.atStart))}; finger locks near horizontal ` +
        `${finger.filter((s) => nearHorizontal(s.fingerAngle)).length}/${finger.length}`,
    );
    expect(errs).toEqual([]);
  });

  it("nests each lock's two ring shadows into a bullseye at its spot", () => {
    const stats: RingStat[] = [];
    expect(failing((b) => checkRingsNest(b, stats))).toEqual([]);
    expect(stats.length).toBe(265); // 1 + 2 + 2 + 1 + 3 * 2 for boxes 1-7, 193 for 8-200, 30 * 2 for the days
    console.log(
      `${stats.length} ring pairs: centres within ${Math.max(...stats.map((s) => s.offset)).toFixed(5)} ` +
        `(at most ${(100 * Math.max(...stats.map((s) => s.offsetShare))).toFixed(0)}% of the lock's bound), ` +
        `gap ${Math.min(...stats.map((s) => s.gap)).toFixed(6)}..${Math.max(...stats.map((s) => s.gap)).toFixed(6)}`,
    );
  });

  it("keeps every spot inside the envelope, apart from the others and from the start", () => {
    expect(failing(checkSpots)).toEqual([]);
  });

  it("hangs every scrap and ring inside the box", () => {
    expect(failing(checkInBox)).toEqual([]);
  });

  it("has the locks, finger locks, decoys, ringless and hidden locks boxParams asks for", () => {
    expect(failing(checkCounts)).toEqual([]);
    for (const { box } of built) expect(box.params).toEqual(paramsFor(box));
  });

  it("puts at most one silhouette in any box", () => {
    for (const { box } of built) expect(box.locks.filter((l) => SILHOUETTES.includes(l.shape)).length).toBeLessThanOrEqual(1);
  });

  it("gives every box with a hidden lock exactly one silhouette, on a hidden lock", () => {
    expect(failing(checkSilhouettes)).toEqual([]);
  });

  it("shows each classic shape in at least 10% of boxes 10 and up", () => {
    const late = built.filter((b) => b.spec.kind === "box" && b.spec.n >= 10);
    const classics = (Object.keys(SHAPES) as ShapeName[]).filter((s) => !SILHOUETTES.includes(s));
    const share = Object.fromEntries(
      classics.map((s) => [s, late.filter((b) => b.box.locks.some((l) => l.shape === s)).length / late.length]),
    );
    console.log(`classic shapes in boxes 10+: ${JSON.stringify(share, (_, v: unknown) => (typeof v === "number" ? +v.toFixed(3) : v))}`);
    for (const s of classics) expect(share[s], s).toBeGreaterThanOrEqual(0.1);
  });

  it("leaves out only pieces a finger can fill: at most 35% of the shape", () => {
    expect(failing((b) => checkFingerAndDepth(b).filter((e) => e.includes("misses")))).toEqual([]);
    const shares = built.flatMap(({ box }) => missingShares(box));
    console.log(`missing piece share ${Math.min(...shares).toFixed(3)}..${Math.max(...shares).toFixed(3)}`);
  });

  it("keeps a hidden lock's pieces within 0.45 of the panel", () => {
    expect(failing((b) => checkFingerAndDepth(b).filter((e) => e.includes("hangs")))).toEqual([]);
    expect(built.some(({ box }) => box.locks.some((l) => l.hidden))).toBe(true);
  });

  it("runs at least 90% of finger locks within 45 degrees of horizontal", () => {
    const angles = built.flatMap(({ box }) => fingerAngles(box));
    expect(angles.length).toBeGreaterThan(300);
    expect(angles.filter(nearHorizontal).length / angles.length).toBeGreaterThanOrEqual(0.9);
  });

  it("names each box by its seed key and tells its story from the word lists", () => {
    for (const { spec, box } of built) {
      expect(box.key).toBe(spec.kind === "box" ? `shadow-locks/${spec.n}` : spec.kind === "daily" ? `shadow-locks/daily/${spec.day}` : "");
      expect(box.spec).toEqual(spec);
      expect(box.mirrored).toBe(false);
      expect(OWNERS).toContain(box.owner);
      expect(LOOT).toContain(box.loot);
    }
    expect(new Set(built.map((b) => b.box.owner)).size).toBeGreaterThan(OWNERS.length / 2);
  });

  it("gives the same box twice for one spec", () => {
    for (const { spec, box } of built) expect(generateBox(spec)).toEqual(box);
  }, 600_000);

  it("gives each day its own box", () => {
    const days = built.filter((b) => b.spec.kind === "daily").map((b) => JSON.stringify(b.box.locks.map((l) => [l.shape, l.L])));
    expect(new Set(days).size).toBe(DAYS.length);
  });

  it("leaves lessons to the lesson data", () => {
    expect(() => generateBox({ kind: "lesson", id: "l1" })).toThrow();
  });
});

describe("golden boxes", () => {
  // Saves keep a box by its spec and GENERATOR_VERSION, so one spec must keep giving one box. A change that alters any
  // box (RNG call order, a constant, a shape) must bump GENERATOR_VERSION and update these hashes.
  const GOLDEN: [BoxSpec, string][] = [
    [{ kind: "box", n: 1 }, "24d94f165a8c8a00"],
    [{ kind: "box", n: 7 }, "cb2f2fc4e815eaab"],
    [{ kind: "box", n: 15 }, "e522d82306833bbb"],
    [{ kind: "daily", day: "2026-11-06" }, "7ee1ae424f16ac5a"],
  ];
  const sha = (box: Box) => createHash("sha256").update(JSON.stringify(box)).digest("hex").slice(0, 16);

  it("pins boxes 1, 7, 15 and one day at generator version 1", () => {
    expect(GENERATOR_VERSION).toBe(1);
    expect(GOLDEN.map(([spec]) => [JSON.stringify(spec), sha(generateBox(spec))])).toEqual(
      GOLDEN.map(([spec, hash]) => [JSON.stringify(spec), hash]),
    );
  });
});
