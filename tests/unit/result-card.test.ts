// The result card under an opened box's reward: its name, a tile per lock, the time, the streak (a Daily Box played
// for real), the best line and the site, in the language shown; and how the reward shows it (once the reward is up,
// kept after the reward is taken, gone with the next box).
import { Group } from "@iwsdk/core";
import { afterEach, describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import { type CollectionItem, newProfile, type Profile } from "../../src/core/profile";
import type { BoxResult } from "../../src/core/result";
import { setLang, tableFor } from "../../src/i18n";
import { REWARD, Reward, type RewardHands } from "../../src/render/reward";
import { COPY } from "../../src/ui/copy";
import { CARD_SITE, resultCard } from "../../src/ui/result-card";

afterEach(() => setLang("en"));

const item = (key: string, timeMs: number): CollectionItem => ({ key, owner: "the Clockmaker", loot: "a silver thimble", shapes: ["Key"], atMs: 0, timeMs, hints: 0 });

function profile(o: { streak?: number; collection?: CollectionItem[] } = {}): Profile {
  const p = newProfile(0, "test");
  p.daily.streak = o.streak ?? 0;
  p.collection = o.collection ?? [];
  return p;
}

const result = (o: Partial<BoxResult> & Pick<BoxResult, "spec" | "key" | "levels">): BoxResult => ({ practice: false, recorded: true, timeMs: 252_400, hints: 0, ...o });

describe("the result card", () => {
  it("a Daily Box: its day, a tile per lock, the time, the streak, a new best, the site", () => {
    const p = profile({ streak: 5, collection: [item("shadow-locks/daily/2026-11-01", 300_000), item("shadow-locks/daily/2026-11-10", 252_400)] });
    const card = resultCard(result({ spec: { kind: "daily", day: "2026-11-10" }, key: "shadow-locks/daily/2026-11-10", levels: [0, 0, 2], hints: 1 }), p);
    expect(card).toEqual({
      title: "Daily Box Nov 10",
      tiles: ["clear", "clear", "hinted"],
      time: "4:12",
      lines: ["Streak 5", COPY.share.newBest],
      site: "shadowlocks.pages.dev",
    });
    expect(CARD_SITE).toBe("shadowlocks.pages.dev");
    // Slower than the best Daily Box: that best.
    const slow = resultCard(result({ spec: { kind: "daily", day: "2026-11-10" }, key: "shadow-locks/daily/2026-11-10", levels: [4], timeMs: 400_000 }), p)!;
    expect([slow.tiles, slow.time, slow.lines]).toEqual([["shown"], "6:40", ["Streak 5", "Your best 5:00"]]);
  });

  it("has one tile per lock for 1 to 3 locks, and a numbered box shows no streak and no best on its first solve", () => {
    for (const levels of [[0], [1, 0], [0, 4, 3]]) {
      const card = resultCard(result({ spec: { kind: "box", n: 12 }, key: "shadow-locks/12", levels }), profile({ streak: 3 }))!;
      expect(card.title).toBe("Box No. 12");
      expect(card.tiles).toHaveLength(levels.length);
      expect(card.lines).toEqual([]);
    }
  });

  it("a practice box shows the player's own record of it, and no streak; a lesson's box has no card", () => {
    const p = profile({ streak: 4, collection: [item("shadow-locks/12", 160_000), item("shadow-locks/daily/2026-11-09", 200_000)] });
    const box = resultCard(result({ spec: { kind: "box", n: 12 }, key: "shadow-locks/12", levels: [0, 0], practice: true, recorded: false }), p)!;
    expect(box.lines).toEqual(["Your best 2:40"]);
    const day = resultCard(result({ spec: { kind: "daily", day: "2026-11-09" }, key: "shadow-locks/daily/2026-11-09", levels: [0], practice: true, recorded: false }), p)!;
    expect([day.title, day.lines]).toEqual(["Daily Box Nov 9", ["Your best 3:20"]]);
    expect(resultCard(result({ spec: { kind: "lesson", id: "l1" }, key: "lesson/l1", levels: [0] }), p)).toBeNull();
  });

  it("a friend's box shows both results: the player's and what the friend says (with or without their hints)", () => {
    const p = profile({ collection: [item("shadow-locks/12", 160_000)] });
    const r = result({ spec: { kind: "box", n: 12 }, key: "shadow-locks/12", levels: [1, 0], hints: 1, timeMs: 178_000, practice: true, recorded: false });
    expect(resultCard(r, p, { t: 222, h: 0 })!.lines).toEqual(["Your best 2:40", "You 2:58, 1 hint", "Your friend says 3:42, no hints"]);
    expect(resultCard({ ...r, hints: 0 }, p, { t: 222, h: null })!.lines).toEqual(["Your best 2:40", "You 2:58, no hints", "Your friend says 3:42"]);
    expect(resultCard({ ...r, hints: 3 }, p, { t: 222, h: 2 })!.lines.slice(1)).toEqual(["You 2:58, 3 hints", "Your friend says 3:42, 2 hints"]);
    // Today's Daily Box from a friend's link, played for real: the streak and the best stay, both results after them.
    const d = profile({ streak: 2 });
    const own = resultCard(result({ spec: { kind: "daily", day: "2026-11-10" }, key: "shadow-locks/daily/2026-11-10", levels: [0] }), d, { t: 252, h: 1 })!;
    expect(own.lines).toEqual(["Streak 2", "You 4:12, no hints", "Your friend says 4:12, 1 hint"]);
  });

  it("is in the language shown", () => {
    setLang("de");
    const p = profile({ streak: 2, collection: [item("shadow-locks/daily/2026-11-01", 100_000)] });
    const card = resultCard(result({ spec: { kind: "daily", day: "2026-11-10" }, key: "shadow-locks/daily/2026-11-10", levels: [0] }), p)!;
    const de = tableFor("de");
    expect(card.title).toBe("Tagesbox vom 10. Nov.");
    expect(card.lines).toEqual([de.menus.home.streak.replace("{n}", "2"), de.share.best.replace("{time}", "1:40")]);
  });
});

describe("the reward shows the card", () => {
  const away: RewardHands = { point: () => false, pinching: () => false, started: () => false, busy: () => false };

  it("once the reward is up, kept after it is taken, gone with the next box; none for a box without one", () => {
    const r = new Reward(new Group());
    r.setBox(generateBox({ kind: "box", n: 3 }));
    r.rise([0.22, -0.55, 1.27]);
    const card = resultCard(result({ spec: { kind: "box", n: 3 }, key: "shadow-locks/3", levels: [0, 1] }), profile())!;
    r.setResult(card);
    expect(r.resultCard).toEqual(card);
    const run = (s: number) => {
      for (let t = 0; t < s; t += 1 / 72) r.update(1 / 72, away, true, 24, false);
    };
    run(REWARD.riseAtS);
    expect(r.result.visible).toBe(false);
    run(REWARD.riseS + 0.1);
    expect([r.up, r.result.visible]).toEqual([true, true]);
    // Under the plaque, clear of it, in the box: it stays where the reward floated.
    const p = r.position([0, 0, 0]);
    expect(r.result.position.x).toBeCloseTo(p[0], 6);
    expect(r.result.position.y).toBeLessThan(p[1] - REWARD.plaque.h / 2 - REWARD.result.h / 2);
    r.take();
    run(REWARD.takeS + 0.1);
    expect([r.group.visible, r.result.visible]).toEqual([false, true]);
    r.setBox(generateBox({ kind: "box", n: 4 }));
    expect([r.result.visible, r.resultCard]).toEqual([false, null]);
    // A box with no card (a lesson's): nothing under the reward.
    r.rise([0.22, -0.55, 1.27]);
    r.setResult(null);
    run(REWARD.riseAtS + REWARD.riseS + 0.1);
    expect([r.up, r.result.visible]).toEqual([true, false]);
  });
});
