import { beforeAll, describe, expect, it } from "vitest";
import { buildBox, generateBox } from "../../src/core/generator";
import { LOOT, OWNERS } from "../../src/core/story";
import type { Box, BoxSpec } from "../../src/core/types";
import {
  checkCounts,
  checkFingerAndDepth,
  checkHidden,
  checkInBox,
  checkSolvable,
  checkSpots,
  type LockStat,
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

  it("makes hidden locks silhouettes while one is unused", () => {
    expect(failing(checkHidden)).toEqual([]);
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
    const angles = built.flatMap(({ box }) => box.locks.filter((l) => l.finger).map((l) => l.fingerAngle));
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
