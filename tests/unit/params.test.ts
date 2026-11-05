import { describe, expect, it } from "vitest";
import { boxParams, dailyParams } from "../../src/core/params";
import { LOOT, OWNERS } from "../../src/core/story";

// n: [locks, fingerLocks, decoys, ringless, hidden], straight from the difficulty table.
const TABLE: Record<number, [number, number, number, number, number]> = {
  1: [1, 0, 2, 0, 0],
  2: [2, 0, 6, 0, 0],
  3: [2, 1, 8, 0, 0],
  4: [2, 1, 10, 1, 0],
  5: [3, 1, 12, 1, 1],
  6: [3, 1, 13, 1, 1],
  7: [3, 1, 14, 1, 1],
  8: [3, 2, 15, 2, 2],
  9: [3, 2, 16, 2, 2],
  10: [3, 2, 16, 2, 2],
  11: [3, 2, 16, 2, 2],
  12: [3, 2, 16, 2, 2],
  13: [3, 2, 16, 2, 2],
  14: [3, 2, 16, 2, 2],
  15: [3, 2, 16, 2, 3],
  16: [3, 2, 16, 2, 3],
  17: [3, 2, 16, 2, 3],
  18: [3, 2, 16, 2, 3],
  19: [3, 2, 16, 2, 3],
  20: [3, 2, 16, 2, 3],
};

describe("boxParams", () => {
  it.each(Object.keys(TABLE).map(Number))("box %i matches the table", (n) => {
    const [locks, fingerLocks, decoys, ringless, hidden] = TABLE[n]!;
    const p = boxParams(n);
    expect({ locks: p.locks, fingerLocks: p.fingerLocks, decoys: p.decoys, ringless: p.ringless, hidden: p.hidden }).toEqual({
      locks,
      fingerLocks,
      decoys,
      ringless,
      hidden,
    });
    expect(p.tilt).toBeCloseTo(Math.min(0.03 + 0.012 * n, 0.14), 12);
    expect(p.amp).toBeCloseTo(Math.min(0.4 + 0.06 * n, 1), 12);
  });

  it("caps tilt at 0.14 and amp at 1 from box 10", () => {
    expect(boxParams(9).tilt).toBeCloseTo(0.138, 12);
    expect(boxParams(10).tilt).toBe(0.14);
    expect(boxParams(10).amp).toBe(1);
    expect(boxParams(500).amp).toBe(1);
  });

  it("keeps the last row for every box after 20", () => {
    for (const n of [21, 50, 199, 1000]) expect(boxParams(n)).toEqual(boxParams(20));
  });

  it("refuses box numbers below 1 and fractions", () => {
    expect(() => boxParams(0)).toThrow(RangeError);
    expect(() => boxParams(2.5)).toThrow(RangeError);
  });

  it("gives the daily box the box 7 settings", () => {
    expect(dailyParams()).toEqual(boxParams(7));
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
