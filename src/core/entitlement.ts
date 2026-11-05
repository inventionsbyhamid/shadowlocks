// What the player may play. The judge edition, and every edition while the paywall is off (all of v1),
// is fully unlocked. The store edition's paywall update gives a 7-day trial counted from the first
// launch, then the "Full game" add-on bought through Meta billing; anyone whose first launch was on an
// earlier build keeps the full game. A trial that is over keeps the Daily Box and the lessons.
// Billing is passed in (the real one wraps the Digital Goods API; `fakeBilling` stands in for tests and
// the emulator), so this module never touches the browser or the clock.
import type { Profile } from "./profile";

export type Edition = "judge" | "store";

export type Ent = { kind: "unlocked" } | { kind: "trial"; daysLeft: number } | { kind: "trialOver" } | { kind: "owned" };

export interface Billing {
  /** Billing can be asked (the installed store app); false in a plain browser. */
  available(): Promise<boolean>;
  owned(sku: string): Promise<boolean>;
  buy(sku: string): Promise<"bought" | "cancelled" | "error">;
}

/** The one permanent add-on. */
export const FULL_GAME_SKU = "full_game";
export const TRIAL_DAYS = 7;
/** Off in every v1 release; the store edition's first update turns it on. */
export const PAYWALL_ON = false;
/** The first build with the paywall: a first launch on any build below it is "owned". */
export const PAYWALL_BUILD = "2.0.0";

const MS_DAY = 86_400_000;

/** `major.minor.patch` from the start of a version string (missing parts are 0), or null. */
function versionParts(v: string): [number, number, number] | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** True only when both are versions and `a` comes before `b`; anything unreadable is not "before". */
function versionBefore(a: string, b: string): boolean {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** Billing's answer, where a failure (offline, no service) counts as not owned. */
async function ownedThroughBilling(billing: Billing): Promise<boolean> {
  try {
    return (await billing.available()) && (await billing.owned(FULL_GAME_SKU));
  } catch {
    return false;
  }
}

/**
 * The player's entitlement at `nowMs`. Judge edition or paywall off: unlocked. A first launch on a
 * build below `PAYWALL_BUILD`: owned. Billing says the full game is owned: owned. Otherwise the trial,
 * by whole days since the first launch measured to the later of `nowMs` and the latest time the profile
 * has seen, so moving the clock back never wins days back.
 */
export async function resolveEntitlement(ed: Edition, p: Profile, nowMs: number, billing: Billing, paywallOn: boolean): Promise<Ent> {
  if (ed === "judge" || !paywallOn) return { kind: "unlocked" };
  if (versionBefore(p.firstLaunch.build, PAYWALL_BUILD)) return { kind: "owned" };
  if (await ownedThroughBilling(billing)) return { kind: "owned" };
  const ref = Number.isFinite(nowMs) ? Math.max(nowMs, p.lastSeenMs) : p.lastSeenMs;
  const daysUsed = Math.max(0, Math.floor((ref - p.firstLaunch.atMs) / MS_DAY));
  const daysLeft = TRIAL_DAYS - daysUsed;
  return daysLeft > 0 ? { kind: "trial", daysLeft } : { kind: "trialOver" };
}

/** Everything is open except endless boxes once the trial is over. */
export function canPlay(e: Ent, what: "box" | "daily" | "lesson"): boolean {
  return e.kind !== "trialOver" || what !== "box";
}

/**
 * Billing for tests and the emulator. `state` is live: change it to change the answers. A purchase
 * that returns "bought" makes the full game owned; without billing, buying is an "error".
 */
export function fakeBilling(state: { available: boolean; owned: boolean; buyResult: "bought" | "cancelled" | "error" }): Billing {
  return {
    available: async () => state.available,
    owned: async (sku) => state.available && state.owned && sku === FULL_GAME_SKU,
    buy: async (sku) => {
      if (!state.available) return "error";
      if (state.buyResult === "bought" && sku === FULL_GAME_SKU) state.owned = true;
      return state.buyResult;
    },
  };
}
