import { describe, expect, it } from "vitest";
import { BLOCK, type BoxKind, boxKind, boxParams, boxParamsV3, dailyParams, KINDS_FROM, rhythmBlock, silhouetteCount } from "../../src/core/params";
import { LOOT, OWNERS } from "../../src/core/story";
import type { BoxParams } from "../../src/core/types";

type Row = [number, number, number, number, number];
// n: [locks, fingerLocks, decoys, ringless, hidden], straight from the difficulty table: boxes 1 to 9.
const TABLE: Record<number, Row> = {
  1: [1, 0, 2, 0, 0],
  2: [2, 0, 6, 0, 0],
  3: [2, 1, 8, 0, 0],
  4: [2, 1, 10, 1, 0],
  5: [3, 1, 12, 1, 1],
  6: [3, 1, 13, 1, 1],
  7: [3, 1, 14, 1, 1],
  8: [3, 2, 15, 2, 2],
  9: [3, 2, 16, 2, 2],
};
// Version 3's rows from box 10, which saves made under it are rebuilt with.
const V3_LATE = (n: number): Row => (n <= 14 ? [3, 2, 16, 2, 2] : [3, 2, 16, 2, 3]);
// Each kind's row from box 10 (a breather by its locks).
const KIND_ROWS: Record<string, Row> = {
  standard: [3, 2, 16, 2, 2],
  silhouettes: [3, 1, 14, 1, 3],
  fingers: [3, 3, 14, 0, 1],
  expert: [3, 2, 16, 3, 1],
  "breather-1": [1, 1, 8, 0, 1],
  "breather-2": [2, 1, 10, 0, 1],
};
const rowOf = (p: BoxParams): Row => [p.locks, p.fingerLocks, p.decoys, p.ringless, p.hidden];
/** Hard boxes, and the easy ones between them. */
const HIGH: BoxKind[] = ["silhouettes", "fingers", "expert"];

describe("boxParams", () => {
  it.each(Object.keys(TABLE).map(Number))("box %i matches the table, in both generator versions", (n) => {
    expect(rowOf(boxParams(n))).toEqual(TABLE[n]);
    expect(boxParamsV3(n)).toEqual(boxParams(n));
    expect(boxKind(n)).toBe("standard");
  });

  it.each([1, 5, 9, 10, 11, 15, 40, 500])("box %i's lean and reach follow the curve, capped from box 10", (n) => {
    for (const p of [boxParams(n), boxParamsV3(n)]) {
      expect(p.tilt).toBeCloseTo(Math.min(0.03 + 0.012 * n, 0.14), 12);
      expect(p.amp).toBeCloseTo(Math.min(0.4 + 0.06 * n, 1), 12);
    }
    expect(boxParams(9).tilt).toBeCloseTo(0.138, 12);
    expect(boxParams(10).tilt).toBe(0.14);
  });

  it("from box 10, each box has its kind's settings", () => {
    for (let n = 10; n <= 400; n++) {
      const kind = boxKind(n), p = boxParams(n);
      const key = kind === "breather" ? `breather-${p.locks}` : kind;
      expect(rowOf(p), `box ${n} (${kind})`).toEqual(KIND_ROWS[key]);
    }
  });

  it("keeps version 3's curve for saves: flat from box 10, three hidden outlines from box 15", () => {
    for (const n of [10, 14, 15, 20, 199, 1000]) expect(rowOf(boxParamsV3(n))).toEqual(V3_LATE(n));
  });

  it("refuses box numbers below 1 and fractions", () => {
    for (const f of [boxParams, boxParamsV3, boxKind]) {
      expect(() => f(0)).toThrow(RangeError);
      expect(() => f(2.5)).toThrow(RangeError);
    }
  });

  it("gives the daily box the box 7 settings, as before the box kinds", () => {
    expect(dailyParams()).toEqual(boxParams(7));
    expect(dailyParams()).toEqual(boxParamsV3(7));
  });
});

describe("box kinds", () => {
  it("opens with a silhouettes box at 10, its expert box at 12 and a single big lock to breathe at 13", () => {
    expect(Array.from({ length: 6 }, (_, i) => boxKind(10 + i))).toEqual(["silhouettes", "standard", "expert", "breather", "fingers", "standard"]);
    expect(boxParams(13).locks).toBe(1);
  });

  it("every kind appears in boxes 10 to 60, every block holds each once (standard twice)", () => {
    const seen = new Set(Array.from({ length: 51 }, (_, i) => boxKind(10 + i)));
    expect([...seen].sort()).toEqual(["breather", "expert", "fingers", "silhouettes", "standard"]);
    for (let k = 0; k < 200; k++) {
      expect([...rhythmBlock(k).kinds].sort(), `block ${k}`).toEqual(["breather", "expert", "fingers", "silhouettes", "standard", "standard"]);
    }
  });

  it("goes up and down: hard and easy boxes take turns, the breather follows the expert box, experts 4 to 8 apart", () => {
    const kinds = Array.from({ length: 1200 }, (_, i) => boxKind(KINDS_FROM + i));
    kinds.forEach((k, i) => expect(HIGH.includes(k), `box ${KINDS_FROM + i} (${k})`).toBe(i % 2 === 0));
    const experts = kinds.flatMap((k, i) => (k === "expert" ? [i] : []));
    for (const i of experts) expect(kinds[i + 1] ?? "breather").toBe("breather");
    for (let j = 1; j < experts.length; j++) expect(experts[j]! - experts[j - 1]!).toBeGreaterThanOrEqual(4);
    for (let j = 1; j < experts.length; j++) expect(experts[j]! - experts[j - 1]!).toBeLessThanOrEqual(8);
  });

  it("is chosen by seed: the blocks after the first vary, and the same block is always the same", () => {
    const patterns = new Set(Array.from({ length: 80 }, (_, k) => JSON.stringify(rhythmBlock(k + 1))));
    expect(patterns.size).toBe(8);
    for (let k = 0; k < 40; k++) expect(rhythmBlock(k)).toEqual(rhythmBlock(k));
    const breathers = Array.from({ length: 200 }, (_, k) => rhythmBlock(k).breatherLocks);
    expect(breathers.filter((l) => l === 1).length / 200).toBeGreaterThan(0.35);
    expect(breathers.filter((l) => l === 2).length / 200).toBeGreaterThan(0.35);
    expect(BLOCK).toBe(6);
  });

  it("shows two silhouettes in a silhouettes box, one in any other box with a hidden outline, none before box 5", () => {
    for (let n = 1; n <= 300; n++) {
      const want = boxKind(n) === "silhouettes" ? 2 : n >= 5 ? 1 : 0;
      expect(silhouetteCount(n), `box ${n}`).toBe(want);
    }
  });
});

describe("story", () => {
  const MOCK_OWNERS = ["the Clockmaker", "the Archivist", "Madame Rook", "the Harbour Master", "Professor Vane", "the Twins", "Old Saffron",
    "the Cartographer", "the Night Clerk", "Baron Ashgrove", "the Lamplighter", "Mother Quill", "the Bookbinder", "Captain Ilse Marr"];
  const MOCK_LOOT = ["the harbour ledger", "a ruby the size of a thumbnail", "the second key", "a roll of bearer bonds", "the vault schedule",
    "a photograph of the guard rota", "a brass cipher disc", "the Ashgrove seal", "a night train ticket to Lisbon", "the deposit box number",
    "a wax cylinder recording", "the blueprints for the east wing"];

  it("keeps the mock's owners and loot and adds 10 more of each", () => {
    expect(OWNERS.slice(0, MOCK_OWNERS.length)).toEqual(MOCK_OWNERS);
    expect(LOOT.slice(0, MOCK_LOOT.length)).toEqual(MOCK_LOOT);
    expect(OWNERS).toHaveLength(MOCK_OWNERS.length + 10);
    expect(LOOT).toHaveLength(MOCK_LOOT.length + 10);
    expect(new Set(OWNERS).size).toBe(OWNERS.length);
    expect(new Set(LOOT).size).toBe(LOOT.length);
  });

  it("has no dashes of any kind", () => {
    for (const s of [...OWNERS, ...LOOT]) expect(s).not.toMatch(/[-‐-―−]/);
  });
});
