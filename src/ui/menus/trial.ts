// The trial screen, in the store edition's paywall update only (PAYWALL_ON; off in every v1 release):
// "Your trial: N days left" (or that it has ended, with what stays open), and "Unlock the full game":
// Buy in the installed app, where billing can sell; in a browser, "Get it on the Meta Horizon Store".
// A purchase says how it went on the panel. Pure view model and painting.
import type { Ent } from "../../core/entitlement";
import { COPY, fill } from "../copy";
import type { MenuSpec, PanelUi } from "./types";

export const TRIAL: MenuSpec = {
  node: "trial-panel",
  screen: "trial",
  keys: ["trial-back", "trial-buy", "trial-store"],
};

/** Where a purchase is: none asked, waiting on the store, bought, or the store said no or nothing. */
export type BuyState = "idle" | "buying" | "bought" | "failed";

export interface TrialView {
  days: string;
  /** The trial is over: the line on what stays open shows. */
  over: boolean;
  buy: boolean;
  store: boolean;
  status: string | null;
  disabled: string[];
}

export function trialView(ent: Ent | null, canBuy: boolean, state: BuyState): TrialView {
  const t = COPY.menus.trial;
  // Still being worked out: nothing to offer yet (the screen repaints once it is known).
  const known = ent !== null;
  const owned = ent?.kind === "owned" || ent?.kind === "unlocked" || state === "bought";
  const days = ent?.kind === "trial" ? (ent.daysLeft === 1 ? t.dayLeft : fill(t.daysLeft, { n: ent.daysLeft })) : ent?.kind === "trialOver" ? t.over : "";
  return {
    days,
    over: ent?.kind === "trialOver" && !owned,
    buy: known && canBuy && !owned,
    store: known && !canBuy && !owned,
    status: state === "bought" ? t.bought : state === "failed" ? t.failed : null,
    // One purchase at a time.
    disabled: state === "buying" ? ["trial-buy"] : [],
  };
}

export function paintTrial(ui: PanelUi, v: TrialView): void {
  ui.text("trial-days", v.days);
  ui.show("trial-days", v.days !== "");
  ui.show("trial-keeps", v.over);
  ui.show("trial-buy-slot", v.buy);
  ui.show("trial-store-slot", v.store);
  ui.show("trial-status", v.status !== null);
  if (v.status !== null) ui.text("trial-status", v.status);
}
