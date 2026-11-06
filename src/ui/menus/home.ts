// Home, on the open drawer: Continue (gold foil: back to the box behind the menu, else the box in
// progress, else the next one), the Daily Box (opens once box 3 is solved), Lessons, Collection
// and Settings; the storage notice when progress cannot be saved; and, in the store edition's
// paywall update only, the trial row. Pure view model and painting.
import { canPlay, type Ent } from "../../core/entitlement";
import type { Profile } from "../../core/profile";
import { copy, count } from "../../i18n";
import { fill } from "../copy";
import { UI } from "../theme";
import { boxNumberOf } from "./collection";
import type { Behind, MenuSpec, PanelUi } from "./types";

export const HOME: MenuSpec = {
  node: "home-panel",
  screen: "home",
  keys: ["home-continue", "home-daily", "home-lessons", "home-collection", "home-settings", "home-trial"],
};

/** The Daily Box opens once this box is solved. */
export const DAILY_AFTER_BOX = 3;

/** The Daily Box is open: box 3 is solved (the next numbered box is past it). */
export function dailyOpen(p: Readonly<Profile>): boolean {
  return p.nextBox > DAILY_AFTER_BOX;
}

/** Where Continue goes. */
export type ContinueTo =
  | { kind: "back" }
  | { kind: "box"; n: number; resume: boolean }
  /** The trial is over: endless boxes wait behind the trial screen. */
  | { kind: "trial" };

export function continueTo(p: Readonly<Profile>, behind: Behind, ent: Ent): ContinueTo {
  if (behind) return { kind: "back" };
  if (!canPlay(ent, "box")) return { kind: "trial" };
  const n = p.current ? boxNumberOf(p.current.key) : null;
  return n !== null ? { kind: "box", n, resume: true } : { kind: "box", n: p.nextBox, resume: false };
}

export interface HomeView {
  /** The big numeral on Continue: the numbered box it goes to, or "" (a Daily Box, a lesson, the trial). */
  continueNo: string;
  continueSub: string;
  dailyOpen: boolean;
  dailySub: string;
  lessonsSub: string;
  collectionSub: string;
  /** The trial row (the paywall update), or null when there is no trial. */
  trial: { label: string; sub: string } | null;
  /** The storage notice (or a one-off line such as "Progress reset."), or null. */
  notice: string | null;
  /** Keys that move but never click (the Daily Box before box 3). */
  disabled: string[];
}

export interface HomeInput {
  behind: Behind;
  ent: Ent;
  /** Today's day key on this device. */
  today: string;
  notice: string | null;
}

function continueSub(p: Readonly<Profile>, i: HomeInput): string {
  const m = copy().menus.home;
  const b = i.behind;
  if (b) return b.kind === "box" ? fill(m.continueSub, { n: b.n }) : b.kind === "daily" ? m.backToDaily : m.backToLesson;
  const to = continueTo(p, null, i.ent);
  if (to.kind === "trial") return m.trialOver;
  if (to.kind === "box") return fill(to.resume ? m.continueSub : m.startSub, { n: to.n });
  return "";
}

function continueNo(p: Readonly<Profile>, i: HomeInput): string {
  const b = i.behind;
  if (b) return b.kind === "box" ? String(b.n) : "";
  const to = continueTo(p, null, i.ent);
  return to.kind === "box" ? String(to.n) : "";
}

function dailySub(p: Readonly<Profile>, today: string): string {
  const m = copy().menus.home;
  if (!dailyOpen(p)) return m.dailyLocked;
  if (p.daily.lastDay === today) return m.dailyDone;
  if (p.daily.streak > 0) return fill(m.streak, { n: p.daily.streak });
  return m.dailyNew;
}

function trialRow(ent: Ent): HomeView["trial"] {
  const t = copy().menus.trial;
  if (ent.kind === "trial") return { label: count(ent.daysLeft, t.daysLeft), sub: t.unlock };
  if (ent.kind === "trialOver") return { label: t.over, sub: t.unlock };
  return null;
}

export function homeView(p: Readonly<Profile>, i: HomeInput): HomeView {
  const m = copy().menus.home;
  const n = p.collection.length;
  const open = dailyOpen(p);
  return {
    continueNo: continueNo(p, i),
    continueSub: continueSub(p, i),
    dailyOpen: open,
    dailySub: dailySub(p, i.today),
    lessonsSub: m.lessons,
    collectionSub: n === 0 ? m.collectionEmpty : count(n, m.rewards),
    trial: trialRow(i.ent),
    notice: i.notice,
    disabled: open ? [] : ["home-daily"],
  };
}

export function paintHome(ui: PanelUi, v: HomeView): void {
  ui.show("home-notice", v.notice !== null);
  if (v.notice !== null) ui.text("home-notice-text", v.notice);
  ui.visible("home-continue-no", v.continueNo !== "");
  if (v.continueNo !== "") ui.text("home-continue-no", v.continueNo);
  ui.text("home-continue-sub", v.continueSub);
  ui.text("home-daily-sub", v.dailySub);
  // Locked, the Daily Box reads as such: faint lettering on the darker cap the menus give it.
  ui.ink("home-daily-cap", v.dailyOpen ? UI.text : UI.textFaint);
  ui.ink("home-daily-sub", v.dailyOpen ? UI.textOnGraphiteDim : UI.textFaint);
  ui.text("home-lessons-sub", v.lessonsSub);
  ui.text("home-collection-sub", v.collectionSub);
  ui.show("home-trial-row", v.trial !== null);
  if (v.trial) {
    ui.text("home-trial-label", v.trial.label);
    ui.text("home-trial-sub", v.trial.sub);
  }
}
