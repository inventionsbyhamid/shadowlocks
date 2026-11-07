// The drawer's menus as view models: Home, Lessons, Collection and the trial screen.
import { describe, expect, it } from "vitest";
import type { Ent } from "../../src/core/entitlement";
import type { BoxSnapshot, CollectionItem } from "../../src/core/profile";
import { CARDS, COLLECTION, collectionView, paintCollection, titleOf } from "../../src/ui/menus/collection";
import { continueTo, DAILY_AFTER_BOX, HOME, homeView, paintHome } from "../../src/ui/menus/home";
import { EXAMPLES, LESSONS, lessonRowOf, lessonsView, paintLessons } from "../../src/ui/menus/lessons";
import { paintTrial, TRIAL, trialView } from "../../src/ui/menus/trial";
import { UI } from "../../src/ui/theme";
import { expectCleanCopy, profile, recorder } from "./helpers/ui";

const UNLOCKED: Ent = { kind: "unlocked" };
const TODAY = "2026-11-03";
const home = (over: Parameters<typeof profile>[0] = {}, i: Partial<Parameters<typeof homeView>[1]> = {}) =>
  homeView(profile(over), { behind: null, ent: UNLOCKED, today: TODAY, notice: null, ...i });

const snap = (key: string): BoxSnapshot => ({ key, lantern: [0, 0, 1.3], open: [0], crystal: [], elapsedMs: 1000, hints: 0, hintLevel: {} });
const item = (n: number): CollectionItem => ({
  key: `shadow-locks/${n}`,
  owner: `Owner ${n}`,
  loot: `loot ${n}`,
  shapes: ["Moon"],
  atMs: n * 1000,
  timeMs: 60_000,
  hints: 0,
});

describe("home", () => {
  it("offers Continue, the Daily Box, Lessons, Collection and Settings, and the trial row's place", () => {
    expect(HOME.keys).toEqual(["home-continue", "home-daily", "home-lessons", "home-collection", "home-settings", "home-trial"]);
  });

  it("a first launch starts box 1; the Daily Box waits until box 3 is solved", () => {
    const v = home();
    expect(v.continueSub).toBe("Start Box No. 1");
    expect(v.dailyOpen).toBe(false);
    expect(v.dailySub).toBe("After Box No. 3");
    expect(v.disabled).toEqual(["home-daily"]);
    expect(v.collectionSub).toBe("Empty so far");
    expect(v.lessonsSub).toBe("Watch again");
    expect(v.trial).toBeNull();
    expect(DAILY_AFTER_BOX).toBe(3);
    expect(home({ nextBox: 3 }).dailyOpen).toBe(false);
    const open = home({ nextBox: 4 });
    expect(open.dailyOpen).toBe(true);
    expect(open.disabled).toEqual([]);
    expect(open.dailySub).toBe("New today");
  });

  it("Continue names the box in progress, or what waits behind the menu", () => {
    expect(home({ nextBox: 4, current: snap("shadow-locks/4") }).continueSub).toBe("Box No. 4");
    expect(continueTo(profile({ nextBox: 4, current: snap("shadow-locks/4") }), null, UNLOCKED)).toEqual({ kind: "box", n: 4, resume: true });
    expect(continueTo(profile({ nextBox: 6 }), null, UNLOCKED)).toEqual({ kind: "box", n: 6, resume: false });
    expect(home({ nextBox: 6 }).continueSub).toBe("Start Box No. 6");
    expect(home({}, { behind: { kind: "box", n: 5 } }).continueSub).toBe("Box No. 5");
    // A Daily Box behind is the Daily key's: Continue still means the numbered box.
    expect(home({}, { behind: { kind: "daily" } }).continueSub).toBe("Start Box No. 1");
    expect(continueTo(profile({ nextBox: 3 }), { kind: "daily" }, UNLOCKED)).toEqual({ kind: "box", n: 3, resume: false });
    expect(continueTo(profile({ nextBox: 3, current: snap("shadow-locks/2") }), { kind: "daily" }, UNLOCKED)).toEqual({ kind: "box", n: 2, resume: true });
    expect(home({}, { behind: { kind: "lesson" } }).continueSub).toBe("Your lesson");
    expect(continueTo(profile(), { kind: "lesson" }, UNLOCKED)).toEqual({ kind: "back" });
  });

  it("the Daily Box shows today's state and the streak", () => {
    const daily = (d: { streak: number; lastDay: string | null }) => home({ nextBox: 9, daily: { ...d, best: d.streak, current: null } }).dailySub;
    expect(daily({ streak: 3, lastDay: "2026-11-02" })).toBe("Streak 3");
    expect(daily({ streak: 4, lastDay: TODAY })).toBe("Solved today");
    expect(daily({ streak: 0, lastDay: null })).toBe("New today");
  });

  it("counts the collection", () => {
    expect(home({ collection: [item(1)] }).collectionSub).toBe("1 reward");
    expect(home({ collection: [1, 2, 3, 4, 5].map(item) }).collectionSub).toBe("5 rewards");
  });

  it("shows the trial row only with a trial (the paywall update); a trial that is over sends Continue to it", () => {
    expect(home({}, { ent: { kind: "trial", daysLeft: 5 } }).trial).toEqual({ label: "Your trial: 5 days left", sub: "Unlock the full game" });
    expect(home({}, { ent: { kind: "trial", daysLeft: 1 } }).trial?.label).toBe("Your trial: 1 day left");
    expect(home({}, { ent: { kind: "owned" } }).trial).toBeNull();
    const over = home({ nextBox: 7 }, { ent: { kind: "trialOver" } });
    expect(over.trial).toEqual({ label: "Your trial has ended.", sub: "Unlock the full game" });
    expect(over.continueSub).toBe("Trial over");
    expect(over.dailyOpen).toBe(true);
    expect(continueTo(profile({ nextBox: 7 }), null, { kind: "trialOver" })).toEqual({ kind: "trial" });
    // What waits behind the menu (a lesson, the Daily Box) is always open.
    // A box behind is a box too: over, Continue goes to the trial screen; a lesson behind stays open.
    expect(continueTo(profile(), { kind: "box", n: 4 }, { kind: "trialOver" })).toEqual({ kind: "trial" });
    expect(continueTo(profile(), { kind: "daily" }, { kind: "trialOver" })).toEqual({ kind: "trial" });
    expect(continueTo(profile(), { kind: "lesson" }, { kind: "trialOver" })).toEqual({ kind: "back" });
  });

  it("while the entitlement is still being worked out, Continue waits (it cannot press) and there is no trial row", () => {
    const v = home({ nextBox: 4 }, { ent: null });
    expect(v.disabled).toContain("home-continue");
    expect(v.continueSub).toBe("Start Box No. 4");
    expect(v.trial).toBeNull();
    expect(continueTo(profile(), null, null)).toEqual({ kind: "wait" });
    expect(continueTo(profile(), { kind: "lesson" }, null)).toEqual({ kind: "back" });
    expect(home({ nextBox: 4 }).disabled).not.toContain("home-continue");
  });

  it("paints every line, the notice when there is one and the trial row only with a trial", () => {
    const a = recorder();
    paintHome(a.ui, home({}, { notice: "Progress will not be saved on this device." }));
    expect(a.calls).toEqual([
      "show home-notice true",
      "text home-notice-text Progress will not be saved on this device.",
      "visible home-continue-no true",
      "text home-continue-no 1",
      "text home-continue-sub Start Box No. 1",
      "text home-daily-sub After Box No. 3",
      `ink home-daily-cap ${UI.textFaint}`,
      `ink home-daily-sub ${UI.textFaint}`,
      "text home-lessons-sub Watch again",
      "text home-collection-sub Empty so far",
      "show home-trial-row false",
    ]);
    const b = recorder();
    paintHome(b.ui, home({ nextBox: 4 }, { ent: { kind: "trial", daysLeft: 6 } }));
    expect(b.calls).toContain("show home-notice false");
    expect(b.calls).toContain("show home-trial-row true");
    expect(b.calls).toContain("text home-trial-label Your trial: 6 days left");
    expect(b.calls).toContain(`ink home-daily-cap ${UI.text}`);
  });

  it("Continue carries the box's number in large, and none for a Daily Box, a lesson or the trial", () => {
    expect(home({ nextBox: 6 }).continueNo).toBe("6");
    expect(home({ nextBox: 4, current: snap("shadow-locks/4") }).continueNo).toBe("4");
    expect(home({}, { behind: { kind: "box", n: 9 } }).continueNo).toBe("9");
    expect(home({}, { behind: { kind: "daily" } }).continueNo).toBe("1");
    expect(home({}, { behind: { kind: "lesson" } }).continueNo).toBe("");
    expect(home({ nextBox: 8 }, { ent: { kind: "trialOver" } }).continueNo).toBe("");
    const a = recorder();
    paintHome(a.ui, home({}, { behind: { kind: "lesson" } }));
    expect(a.calls).toContain("visible home-continue-no false");
    expect(a.calls.some((c) => c.startsWith("text home-continue-no"))).toBe(false);
  });

  it("uses clean copy", () => {
    expectCleanCopy(home({ nextBox: 9, collection: [item(1), item(2)] }, { ent: { kind: "trial", daysLeft: 3 }, notice: "Progress reset." }));
  });
});

describe("lessons", () => {
  it("lists every example, and the tips seen so far in the order they were met", () => {
    expect(EXAMPLES).toEqual(["move", "near-far", "rings", "finger"]);
    const none = lessonsView([]);
    expect(none.rows.map((r) => [r.key, r.label])).toEqual([
      ["lesson-move", "Move the light"],
      ["lesson-near-far", "Near and far"],
      ["lesson-rings", "Sight the rings"],
      ["lesson-finger", "Lend a hand"],
    ]);
    expect(none.noTips).toBe(true);
    const some = lessonsView(["ringless", "decoys", "ringless"]);
    expect(some.rows.slice(4)).toEqual([
      { key: "tip-0", label: "No rings", kind: "tip", id: "ringless" },
      { key: "tip-1", label: "Decoys", kind: "tip", id: "decoys" },
    ]);
    expect(some.noTips).toBe(false);
    expect(lessonRowOf(some, "lesson-rings")).toMatchObject({ kind: "example", id: "rings" });
    expect(lessonRowOf(some, "tip-1")).toMatchObject({ kind: "tip", id: "decoys" });
    expect(lessonRowOf(some, "tip-2")).toBeNull();
    expect(LESSONS.keys).toEqual(["lessons-back", "lesson-move", "lesson-near-far", "lesson-rings", "lesson-finger", "tip-0", "tip-1", "tip-2", "tip-3"]);
    expectCleanCopy(lessonsView(["decoys", "ringless", "hidden", "drawer"]));
  });

  it("paints the labels, and keeps unused tip slots in their places, unseen", () => {
    const a = recorder();
    paintLessons(a.ui, lessonsView(["hidden"]));
    expect(a.calls).toContain("text tip-0-label Hidden outline");
    expect(a.calls).toContain("show lessons-tips true");
    expect(a.calls).toContain("show lessons-none false");
    expect(a.calls.filter((c) => c.startsWith("visible"))).toEqual([
      "visible tip-0-slot true",
      "visible tip-1-slot false",
      "visible tip-2-slot false",
      "visible tip-3-slot false",
    ]);
    const b = recorder();
    paintLessons(b.ui, lessonsView([]));
    expect(b.calls).toContain("show lessons-tips false");
    expect(b.calls).toContain("show lessons-none true");
  });
});

describe("collection", () => {
  it("is empty until a box is solved", () => {
    const v = collectionView([], 0);
    expect(v).toMatchObject({ count: "No rewards yet", empty: true, pager: false, cards: [] });
    expect(COLLECTION.keys).toEqual(["collection-back", "coll-newer", "coll-older"]);
  });

  it("shows the newest rewards first, three at a time, with the owner and the loot line", () => {
    const items = [1, 2, 3, 4, 5, 6, 7].map(item);
    const first = collectionView(items, 0);
    expect(CARDS).toBe(3);
    expect(first.count).toBe("7 rewards");
    expect(first.cards).toEqual([
      { title: "Box No. 7", owner: "Off the desk of Owner 7.", loot: "Inside: loot 7." },
      { title: "Box No. 6", owner: "Off the desk of Owner 6.", loot: "Inside: loot 6." },
      { title: "Box No. 5", owner: "Off the desk of Owner 5.", loot: "Inside: loot 5." },
    ]);
    expect(first).toMatchObject({ pager: true, newer: false, older: true, page: "1 to 3 of 7", disabled: ["coll-newer"] });
    const last = collectionView(items, 2);
    expect(last.cards.map((c) => c.title)).toEqual(["Box No. 1"]);
    expect(last).toMatchObject({ newer: true, older: false, page: "7 to 7 of 7", disabled: ["coll-older"] });
    expect(collectionView(items, 9).index).toBe(2);
    expect(collectionView(items, -3).index).toBe(0);
    expect(collectionView([item(1)], 0)).toMatchObject({ count: "1 reward", pager: false });
    expectCleanCopy(first);
  });

  it("names a daily reward by its day", () => {
    // The day as the language writes it (Intl): "Nov 2" in English.
    expect(titleOf("shadow-locks/daily/2026-11-02")).toBe("Daily Box Nov 2");
    expect(titleOf("shadow-locks/12")).toBe("Box No. 12");
  });

  it("paints the cards it has and keeps the empty places of a short last page", () => {
    const a = recorder();
    paintCollection(a.ui, collectionView([1, 2, 3, 4].map(item), 1));
    expect(a.calls).toContain("text coll-card-0-title Box No. 1");
    expect(a.calls).toContain("visible coll-card-0 true");
    expect(a.calls).toContain("visible coll-card-1 false");
    expect(a.calls).toContain("visible coll-card-2 false");
    expect(a.calls).toContain("show coll-pager true");
    expect(a.calls).toContain("text coll-page 4 to 4 of 4");
    // On the last page only Newer shows.
    expect(a.calls).toContain("visible coll-newer-slot true");
    expect(a.calls).toContain("visible coll-older-slot false");
  });
});

describe("trial", () => {
  it("offers Buy in the installed app and the store link on the web", () => {
    expect(TRIAL.keys).toEqual(["trial-back", "trial-buy", "trial-store"]);
    const app = trialView({ kind: "trial", daysLeft: 5 }, true, "idle");
    expect(app).toEqual({ days: "Your trial: 5 days left", over: false, buy: true, store: false, status: null, disabled: [] });
    const web = trialView({ kind: "trial", daysLeft: 5 }, false, "idle");
    expect(web).toMatchObject({ buy: false, store: true });
  });

  it("says the trial has ended and what stays open", () => {
    expect(trialView({ kind: "trialOver" }, true, "idle")).toMatchObject({ days: "Your trial has ended.", over: true, buy: true });
  });

  it("takes one purchase at a time and says how it went", () => {
    expect(trialView({ kind: "trial", daysLeft: 2 }, true, "buying").disabled).toEqual(["trial-buy"]);
    expect(trialView({ kind: "owned" }, true, "bought")).toMatchObject({ buy: false, store: false, over: false, status: "Thank you. The full game is yours." });
    expect(trialView({ kind: "trial", daysLeft: 2 }, true, "failed")).toMatchObject({ buy: true, status: "The store did not answer. Try again later." });
    expect(trialView({ kind: "trial", daysLeft: 1 }, true, "idle").days).toBe("Your trial: 1 day left");
  });

  it("paints Buy or the store link, never both", () => {
    const a = recorder();
    paintTrial(a.ui, trialView({ kind: "trial", daysLeft: 4 }, false, "idle"));
    expect(a.calls).toEqual([
      "text trial-days Your trial: 4 days left",
      "show trial-days true",
      "show trial-keeps false",
      "show trial-buy-slot false",
      "show trial-store-slot true",
      "show trial-status false",
    ]);
    expectCleanCopy(trialView({ kind: "trialOver" }, true, "failed"));
  });
});
