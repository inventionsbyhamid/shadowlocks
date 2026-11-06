import { describe, expect, it, vi } from "vitest";
import { Access, billingFor, NO_BILLING } from "../../src/app/access";
import type { Billing } from "../../src/core/entitlement";
import { newProfile, withProgressReset } from "../../src/core/profile";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 10, 9);

/** Billing that fails the test if anything asks it. */
const untouchable = (): Billing => ({
  available: vi.fn(async () => {
    throw new Error("billing asked");
  }),
  owned: vi.fn(async () => {
    throw new Error("billing asked");
  }),
  buy: vi.fn(async () => {
    throw new Error("billing asked");
  }),
});

describe("Access", () => {
  it("the judge edition, and any edition with the paywall off, is unlocked and never asks billing", async () => {
    const p = newProfile(T0, "2.0.0");
    for (const [ed, paywall] of [
      ["judge", true],
      ["judge", false],
      ["store", false],
    ] as const) {
      const b = untouchable();
      const a = new Access(ed, paywall, b, () => p, () => T0 + 9 * DAY);
      expect(await a.refresh()).toEqual({ kind: "unlocked" });
      expect(a.canBuy).toBe(false);
      expect(await a.buy()).toBe("error");
      expect(b.available).not.toHaveBeenCalled();
      expect(b.buy).not.toHaveBeenCalled();
    }
  });

  it("the store edition with the paywall on counts the trial and sells the full game", async () => {
    const p = newProfile(T0, "2.0.0");
    let now = T0 + 2 * DAY;
    const { billing, fake } = billingFor("app");
    const a = new Access("store", true, billing, () => p, () => now);
    const changes = vi.fn();
    a.onChange(changes);
    expect(await a.refresh()).toEqual({ kind: "trial", daysLeft: 5 });
    expect(a.canBuy).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    // Nothing changed: no second word to the listeners.
    await a.refresh();
    expect(changes).toHaveBeenCalledTimes(1);
    now = T0 + 8 * DAY;
    expect(await a.refresh()).toEqual({ kind: "trialOver" });
    fake!.buyResult = "cancelled";
    expect(await a.buy()).toBe("cancelled");
    expect(a.ent).toEqual({ kind: "trialOver" });
    fake!.buyResult = "bought";
    expect(await a.buy()).toBe("bought");
    expect(a.ent).toEqual({ kind: "owned" });
  });

  it("a browser cannot buy (the store link instead); billing that throws counts as none", async () => {
    const p = newProfile(T0, "2.0.0");
    const web = new Access("store", true, billingFor("web").billing, () => p, () => T0);
    expect(await web.refresh()).toEqual({ kind: "trial", daysLeft: 7 });
    expect(web.canBuy).toBe(false);
    expect(await web.buy()).toBe("error");
    const broken: Billing = {
      available: async () => true,
      owned: async () => false,
      buy: async () => {
        throw new Error("store down");
      },
    };
    const a = new Access("store", true, broken, () => p, () => T0);
    await a.refresh();
    expect(await a.buy()).toBe("error");
    expect(billingFor(undefined)).toEqual({ billing: NO_BILLING, fake: null });
    expect(billingFor("owned").fake).toEqual({ available: true, owned: true, buyResult: "bought" });
  });

  it("is pending until it is worked out, and a pending entitlement plays no endless box", async () => {
    const p = newProfile(T0, "2.0.0");
    const { billing, fake } = billingFor("app");
    let now = T0 + DAY;
    const store = new Access("store", true, billing, () => p, () => now);
    expect(store.ent).toBeNull();
    expect(store.canPlayBox).toBe(false);
    const asked = store.refresh();
    // Billing answers later: still pending until it does.
    expect(store.ent).toBeNull();
    await asked;
    expect(store.ent).toEqual({ kind: "trial", daysLeft: 6 });
    expect(store.canPlayBox).toBe(true);
    now = T0 + 9 * DAY;
    await store.refresh();
    expect(store.canPlayBox).toBe(false);
    fake!.owned = true;
    await store.refresh();
    expect(store.canPlayBox).toBe(true);
    // Without billing in the way (the judge edition, a paywall that is off) it is unlocked at once.
    const judge = new Access("judge", true, untouchable(), () => p, () => T0);
    expect(judge.ent).toBeNull();
    void judge.refresh();
    expect(judge.ent).toEqual({ kind: "unlocked" });
    expect(judge.canPlayBox).toBe(true);
  });

  it("resetting progress never gives back trial days", async () => {
    const p = newProfile(T0, "2.0.0");
    p.lastSeenMs = T0 + 6 * DAY;
    const reset = withProgressReset(p);
    const a = new Access("store", true, billingFor("app").billing, () => reset, () => T0 + DAY);
    expect(await a.refresh()).toEqual({ kind: "trial", daysLeft: 1 });
  });
});
