// What the player may play, kept current for the menus: the edition and the paywall switch decide
// whether billing is asked at all. The judge edition, and every edition while the paywall is off
// (all of v1), is fully unlocked and never calls billing (offline after the first load). With the
// paywall on (the store edition's update, or a test build that forces it) the entitlement comes
// from the profile's first launch and billing; Buy goes through billing.
import { type Billing, canPlay, type Edition, type Ent, FULL_GAME_SKU, fakeBilling, resolveEntitlement } from "../core/entitlement";
import type { Profile } from "../core/profile";
import type { TestBilling } from "./edition";

/** No billing: a browser, and the installed app until the paywall update brings the real one. */
export const NO_BILLING: Billing = {
  available: async () => false,
  owned: async () => false,
  buy: async () => "error",
};

/** Fake billing's live state (tests change it to make the next purchase cancel or fail). */
export type FakeBillingState = { available: boolean; owned: boolean; buyResult: "bought" | "cancelled" | "error" };

/** The billing for this run: a test build's fake one when asked for, else none. */
export function billingFor(test: TestBilling | undefined): { billing: Billing; fake: FakeBillingState | null } {
  if (!test) return { billing: NO_BILLING, fake: null };
  const fake: FakeBillingState = { available: test !== "web", owned: test === "owned", buyResult: "bought" };
  return { billing: fakeBilling(fake), fake };
}

export class Access {
  /**
   * What the player may play, or null while it is being worked out (pending): nothing is assumed unlocked before
   * `refresh` lands. Without billing in the way (the judge edition, a paywall that is off) that is at once.
   */
  ent: Ent | null = null;
  /** Billing can sell here (the installed app with the paywall on). */
  canBuy = false;
  private readonly subs = new Set<() => void>();

  constructor(
    readonly edition: Edition,
    readonly paywall: boolean,
    private readonly billing: Billing,
    private readonly profile: () => Profile,
    private readonly now: () => number,
  ) {}

  /** Endless boxes may be played now: known, and not a trial that is over. */
  get canPlayBox(): boolean {
    return this.ent !== null && canPlay(this.ent, "box");
  }

  /** Whether billing is asked at all: only the store edition with the paywall on. */
  get billed(): boolean {
    return this.edition === "store" && this.paywall;
  }

  /** Work the entitlement out again (at start, as Home opens, after a purchase). Tells listeners. */
  async refresh(): Promise<Ent> {
    if (!this.billed) {
      const ent: Ent = { kind: "unlocked" };
      this.set(ent, false);
      return ent;
    }
    let can = false;
    try {
      can = await this.billing.available();
    } catch {
      can = false;
    }
    const ent = await resolveEntitlement(this.edition, this.profile(), this.now(), this.billing, this.paywall);
    this.set(ent, can);
    return ent;
  }

  /** Buy the full game. A purchase that goes through makes it owned at once. */
  async buy(): Promise<"bought" | "cancelled" | "error"> {
    if (!this.billed || !this.canBuy) return "error";
    let r: "bought" | "cancelled" | "error";
    try {
      r = await this.billing.buy(FULL_GAME_SKU);
    } catch {
      r = "error";
    }
    if (r === "bought") await this.refresh();
    return r;
  }

  /** Hear every change of the entitlement. Returns an unsubscribe. */
  onChange(fn: () => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private set(ent: Ent, canBuy: boolean): void {
    const same = JSON.stringify(ent) === JSON.stringify(this.ent) && canBuy === this.canBuy;
    this.ent = ent;
    this.canBuy = canBuy;
    if (same) return;
    for (const fn of [...this.subs]) {
      try {
        fn();
      } catch (err) {
        console.error("access listener failed", err);
      }
    }
  }
}
