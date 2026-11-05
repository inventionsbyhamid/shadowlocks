import { describe, expect, it } from "vitest";
import {
  type Billing,
  canPlay,
  type Ent,
  fakeBilling,
  FULL_GAME_SKU,
  PAYWALL_BUILD,
  PAYWALL_ON,
  resolveEntitlement,
  TRIAL_DAYS,
} from "../../src/core/entitlement";
import { migrate, newProfile, type Profile } from "../../src/core/profile";

/** First launch of the store app. */
const T0 = Date.UTC(2026, 11, 20, 9, 0, 0);
const DAY = 86_400_000;
const HOUR = 3_600_000;

const billing = (o: Partial<Parameters<typeof fakeBilling>[0]> = {}) =>
  fakeBilling({ available: true, owned: false, buyResult: "cancelled", ...o });

/** A player whose first launch was at `atMs` on `build`. */
const installed = (build = PAYWALL_BUILD, atMs = T0): Profile => newProfile(atMs, build);

const store = (p: Profile, nowMs: number, b: Billing = billing()) => resolveEntitlement("store", p, nowMs, b, true);

describe("entitlement", () => {
  it("v1 ships with the paywall off; the trial and the add-on are fixed", () => {
    expect(PAYWALL_ON).toBe(false);
    expect(FULL_GAME_SKU).toBe("full_game");
    expect(TRIAL_DAYS).toBe(7);
    expect(PAYWALL_BUILD).toBe("2.0.0");
  });

  it("judge edition always unlocked", async () => {
    for (const paywallOn of [true, false]) {
      for (const t of [T0, T0 + 3 * DAY, T0 + 400 * DAY]) {
        for (const b of [billing(), billing({ available: false }), billing({ owned: true })]) {
          expect(await resolveEntitlement("judge", installed(), t, b, paywallOn)).toEqual({ kind: "unlocked" });
        }
      }
    }
  });

  it("paywall off always unlocked", async () => {
    for (const t of [T0, T0 + 30 * DAY]) {
      expect(await resolveEntitlement("store", installed(), t, billing({ available: false }), false)).toEqual({ kind: "unlocked" });
      expect(await resolveEntitlement("store", installed(), t, billing({ owned: true }), PAYWALL_ON)).toEqual({ kind: "unlocked" });
    }
  });

  it("trial days 7..1 then trialOver", async () => {
    const p = installed();
    const days: Ent[] = [];
    for (let d = 0; d < 7; d++) days.push(await store(p, T0 + d * DAY + 5 * HOUR));
    expect(days).toEqual([7, 6, 5, 4, 3, 2, 1].map((daysLeft) => ({ kind: "trial", daysLeft })));
    expect(await store(p, T0)).toEqual({ kind: "trial", daysLeft: 7 });
    expect(await store(p, T0 + 7 * DAY - 1)).toEqual({ kind: "trial", daysLeft: 1 });
    expect(await store(p, T0 + 7 * DAY)).toEqual({ kind: "trialOver" });
    expect(await store(p, T0 + 400 * DAY)).toEqual({ kind: "trialOver" });
  });

  it("owned via billing", async () => {
    expect(await store(installed(), T0 + DAY, billing({ owned: true }))).toEqual({ kind: "owned" });
    expect(await store(installed(), T0 + 30 * DAY, billing({ owned: true }))).toEqual({ kind: "owned" });
    // Billing that is not there (Quest Browser, not the store app) cannot vouch for a purchase.
    expect(await store(installed(), T0 + DAY, billing({ available: false, owned: true }))).toEqual({ kind: "trial", daysLeft: 6 });
  });

  it("a failing billing call falls back to the trial clock", async () => {
    const offline: Billing = {
      available: async () => true,
      owned: async () => {
        throw new Error("offline");
      },
      buy: async () => "error",
    };
    expect(await store(installed(), T0 + 2 * DAY, offline)).toEqual({ kind: "trial", daysLeft: 5 });
    const broken: Billing = { ...offline, available: () => Promise.reject(new Error("no service")) };
    expect(await store(installed(), T0 + 9 * DAY, broken)).toEqual({ kind: "trialOver" });
  });

  it("buying the full game through the fake billing makes it owned", async () => {
    const b = billing({ buyResult: "bought" });
    expect(await b.available()).toBe(true);
    expect(await b.owned(FULL_GAME_SKU)).toBe(false);
    expect(await store(installed(), T0 + 9 * DAY, b)).toEqual({ kind: "trialOver" });
    expect(await b.buy(FULL_GAME_SKU)).toBe("bought");
    expect(await b.owned(FULL_GAME_SKU)).toBe(true);
    expect(await store(installed(), T0 + 9 * DAY, b)).toEqual({ kind: "owned" });

    const cancelled = billing({ buyResult: "cancelled" });
    expect(await cancelled.buy(FULL_GAME_SKU)).toBe("cancelled");
    expect(await store(installed(), T0 + 9 * DAY, cancelled)).toEqual({ kind: "trialOver" });

    const failed = billing({ buyResult: "error" });
    expect(await failed.buy(FULL_GAME_SKU)).toBe("error");
    expect(await failed.owned(FULL_GAME_SKU)).toBe(false);

    const away = billing({ available: false, buyResult: "bought" });
    expect(await away.buy(FULL_GAME_SKU)).toBe("error");
    expect(await away.owned(FULL_GAME_SKU)).toBe(false);
    // Another add-on is not the full game.
    expect(await billing({ owned: true }).owned("hats")).toBe(false);
  });

  it("early install (build 1.x) owned when the paywall turns on", async () => {
    const late = T0 + 60 * DAY;
    for (const build of ["1.0.0", "1.4.2", "1.9.99", "0.1.0", "1.0.0-rc.1"]) {
      expect(await store(installed(build), late), build).toEqual({ kind: "owned" });
    }
    for (const build of ["2.0.0", "2.0.1", "2.1", "10.0.0", "./assets/index-Bc7f2a.js", "unknown"]) {
      expect(await store(installed(build), late), build).toEqual({ kind: "trialOver" });
    }
    // The marker survives the update: loading a 1.x profile on the paywall build keeps its first build.
    const updated = migrate(JSON.parse(JSON.stringify(installed("1.2.0", T0 - 30 * DAY))), late, PAYWALL_BUILD);
    expect(updated.firstLaunch.build).toBe("1.2.0");
    expect(await store(updated, late)).toEqual({ kind: "owned" });
  });

  it("trial never gains days from a clock rollback", async () => {
    const p = installed();
    p.lastSeenMs = T0 + 5 * DAY + HOUR; // last seen on the trial's sixth day
    const back = p.lastSeenMs - 3 * DAY; // then the device clock is moved back 3 days
    expect(await store(p, back)).toEqual({ kind: "trial", daysLeft: 2 });
    // Loading the profile with the rolled-back clock keeps the latest time seen.
    const reloaded = migrate(JSON.parse(JSON.stringify(p)), back, PAYWALL_BUILD);
    expect(reloaded.lastSeenMs).toBe(p.lastSeenMs);
    expect(await store(reloaded, back)).toEqual({ kind: "trial", daysLeft: 2 });
    // A rollback after the trial ended never reopens it.
    p.lastSeenMs = T0 + 8 * DAY;
    expect(await store(p, T0 + DAY)).toEqual({ kind: "trialOver" });
    expect(await store(p, Number.NaN)).toEqual({ kind: "trialOver" });
  });

  it("canPlay matrix", () => {
    const rows: [Ent, boolean, boolean, boolean][] = [
      [{ kind: "unlocked" }, true, true, true],
      [{ kind: "owned" }, true, true, true],
      [{ kind: "trial", daysLeft: 7 }, true, true, true],
      [{ kind: "trial", daysLeft: 1 }, true, true, true],
      [{ kind: "trialOver" }, false, true, true],
    ];
    for (const [e, box, daily, lesson] of rows) {
      expect([canPlay(e, "box"), canPlay(e, "daily"), canPlay(e, "lesson")], JSON.stringify(e)).toEqual([box, daily, lesson]);
    }
  });
});
