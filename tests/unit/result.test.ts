// A box's result: a tile per lock, the time in whole seconds, and the player's own bests from the collection (a Daily
// Box against every other Daily Box; a box played again against its own record). Only a recorded solve can be a best:
// a clock moved back, or the same Daily Box played again, never counts one twice; storage blocked keeps them in memory.
import { describe, expect, it, vi } from "vitest";
import { collect, solveBox } from "../../src/app/session-rules";
import { ProfileStore } from "../../src/app/profile-store";
import { generateBox } from "../../src/core/generator";
import { type CollectionItem, newProfile, type Profile } from "../../src/core/profile";
import { bestDailyMs, bestOf, type BoxResult, clockText, levelsOf, MAX_SECONDS, recordedMs, secondsOf, tileOf, tilesOf } from "../../src/core/result";
import { openStore } from "../../src/platform/store";

const item = (key: string, timeMs: number): CollectionItem => ({ key, owner: "the Clockmaker", loot: "a silver thimble", shapes: ["Key"], atMs: 0, timeMs, hints: 0 });
const daily = (day: string) => `shadow-locks/daily/${day}`;
const result = (o: Partial<BoxResult> & Pick<BoxResult, "spec" | "key">): BoxResult => ({ practice: false, recorded: true, timeMs: 60_000, hints: 0, levels: [0], ...o });

describe("a box's result", () => {
  it("gives each lock a tile: no hint, a hint, or its spot shown (the fourth hint)", () => {
    expect([0, 1, 2, 3, 4, 7].map(tileOf)).toEqual(["clear", "hinted", "hinted", "hinted", "shown", "shown"]);
    expect([Number.NaN, -1].map(tileOf)).toEqual(["clear", "clear"]);
    // Panel order, one tile per lock, from 1 to 3 locks; a save's map with gaps and bad levels.
    expect(levelsOf({}, 1)).toEqual([0]);
    expect(levelsOf({ 1: 2 }, 2)).toEqual([0, 2]);
    expect(levelsOf({ 0: 4, 2: 9, 5: 1 }, 3)).toEqual([4, 0, 4]);
    expect(levelsOf({ 0: Number.NaN, 1: -2, 2: 1.7 } as Record<number, number>, 3)).toEqual([0, 0, 1]);
    expect(tilesOf(levelsOf({ 0: 4, 2: 1 }, 3))).toEqual(["shown", "clear", "hinted"]);
  });

  it("shows its time in whole seconds, from 1 s to 99:59:59", () => {
    expect([0, 999, 1000, 61_999, 252_400].map(secondsOf)).toEqual([1, 1, 1, 61, 252]);
    expect(secondsOf(1e12)).toBe(MAX_SECONDS);
    expect(secondsOf(Number.NaN)).toBe(1);
    expect([7, 61, 252, 3599, 3723, MAX_SECONDS].map(clockText)).toEqual(["0:07", "1:01", "4:12", "59:59", "1:02:03", "99:59:59"]);
  });
});

describe("personal bests", () => {
  const collection = [item("shadow-locks/1", 50_000), item(daily("2026-11-01"), 300_000), item(daily("2026-11-02"), 221_000), item("shadow-locks/2", 40_000)];

  it("reads a box's record and the best Daily Box, leaving a day out when asked", () => {
    expect(recordedMs(collection, "shadow-locks/2")).toBe(40_000);
    expect(recordedMs(collection, "shadow-locks/9")).toBeNull();
    // Numbered boxes never count toward the Daily Box best.
    expect(bestDailyMs(collection)).toBe(221_000);
    expect(bestDailyMs(collection, daily("2026-11-02"))).toBe(300_000);
    expect(bestDailyMs([item("shadow-locks/1", 1000)])).toBeNull();
  });

  it("a Daily Box's first solve: a new best only when faster in whole seconds; the first one ever says nothing", () => {
    const spec = { kind: "daily", day: "2026-11-03" } as const, key = daily("2026-11-03");
    expect(bestOf(collection, result({ spec, key, timeMs: 200_000 }))).toEqual({ kind: "new" });
    expect(bestOf(collection, result({ spec, key, timeMs: 250_000 }))).toEqual({ kind: "best", ms: 221_000 });
    // 221.9 s is 221 s on the card: a tie, not a new best.
    expect(bestOf(collection, result({ spec, key, timeMs: 221_900 }))).toEqual({ kind: "best", ms: 221_000 });
    // As the collection is once the box opened (its own item in it): left out of its own comparison.
    expect(bestOf([...collection, item(key, 100_000)], result({ spec, key, timeMs: 100_000 }))).toEqual({ kind: "new" });
    expect(bestOf([item(key, 100_000)], result({ spec, key, timeMs: 100_000 }))).toBeNull();
  });

  it("a numbered box's first solve is its own record; practice or a box solved before shows the player's record", () => {
    expect(bestOf(collection, result({ spec: { kind: "box", n: 5 }, key: "shadow-locks/5" }))).toBeNull();
    const two = { spec: { kind: "box", n: 2 } as const, key: "shadow-locks/2" };
    expect(bestOf(collection, result({ ...two, practice: true, recorded: false, timeMs: 10_000 }))).toEqual({ kind: "best", ms: 40_000 });
    expect(bestOf(collection, result({ spec: { kind: "box", n: 9 }, key: "shadow-locks/9", practice: true, recorded: false }))).toBeNull();
    // A Daily Box played again the same day: its first solve stands, however fast this one was.
    const again = { spec: { kind: "daily", day: "2026-11-02" } as const, key: daily("2026-11-02") };
    expect(bestOf(collection, result({ ...again, recorded: false, timeMs: 1_000 }))).toEqual({ kind: "best", ms: 221_000 });
    expect(bestOf(collection, result({ spec: { kind: "lesson", id: "l1" }, key: "lesson/l1" }))).toBeNull();
  });

  it("a clock moved back never counts a Daily Box or a best twice", () => {
    const p: Profile = newProfile(0, "test");
    p.nextBox = 4;
    const solve = (day: string, ms: number) => {
      const box = generateBox({ kind: "daily", day });
      const recorded = !p.collection.some((c) => c.key === box.key);
      solveBox(p, { kind: "daily", day });
      collect(p, box, 0, ms, 0);
      return bestOf(p.collection, result({ spec: { kind: "daily", day }, key: box.key, recorded, timeMs: ms }));
    };
    expect(solve("2026-11-01", 300_000)).toBeNull();
    expect(solve("2026-11-02", 200_000)).toEqual({ kind: "new" });
    expect([p.daily.streak, p.collection.length]).toEqual([2, 2]);
    // The clock goes back to the 1st: its box again, much faster. Nothing is added, the streak holds, the best stands.
    expect(solve("2026-11-01", 5_000)).toEqual({ kind: "best", ms: 300_000 });
    expect([p.daily.streak, p.daily.lastDay, p.collection.length]).toEqual([2, "2026-11-02", 2]);
    expect(bestDailyMs(p.collection)).toBe(200_000);
  });

  it("with storage blocked the bests live in memory: the game plays on and still compares", async () => {
    // IndexedDB refuses to open (a private window, blocked site data): the store falls back to memory.
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("blocked"); } });
    try {
      const store = await ProfileStore.open(await openStore(), () => {}, { now: () => 0, build: "test" });
      expect(store.persistent).toBe(false);
      const p = store.profile;
      p.nextBox = 4;
      const box = generateBox({ kind: "daily", day: "2026-11-01" });
      solveBox(p, { kind: "daily", day: "2026-11-01" });
      collect(p, box, 0, 90_000, 0);
      await store.save();
      expect(bestOf(store.profile.collection, result({ spec: { kind: "daily", day: "2026-11-02" }, key: daily("2026-11-02"), timeMs: 80_000 }))).toEqual({ kind: "new" });
      expect(bestDailyMs(store.profile.collection)).toBe(90_000);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
