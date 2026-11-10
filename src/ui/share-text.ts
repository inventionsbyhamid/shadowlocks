// What the 2D page offers to share for a box that opened, in the sender's language: a few plain lines that paste
// anywhere (a chat, a post), spoiler free, with the link last.
//   Shadow Locks · Daily Box Nov 10
//   🟨🟨🟧 4:12
//   Streak 5
//   https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4
import type { Profile } from "../core/profile";
import { type BoxResult, clockText, secondsOf, tilesOf } from "../core/result";
import { linkOf, sharedLinkUrl, squares } from "../core/share";
import { copy } from "../i18n";
import { fill } from "./copy";
import { cardTitle } from "./result-card";

/** Which share it is: today's Daily Box played for real ("Share today's result"). */
export type OfferKind = "today";

export interface ShareOffer {
  kind: OfferKind;
  /** The lines to share, the link last. */
  text: string;
  /** The link alone. */
  url: string;
}

/**
 * What the 2D page offers for result `r`, the profile as it is once the box opened, on day `today`: today's Daily Box
 * played for real (its streak); null for anything else.
 */
export function shareOffer(r: BoxResult, p: Readonly<Profile>, today: string): ShareOffer | null {
  const s = r.spec;
  if (s.kind !== "daily" || r.practice || s.day !== today) return null;
  const c = copy();
  const url = sharedLinkUrl(linkOf(r));
  const lines = [
    `${c.panels.home.title} · ${cardTitle(s)}`,
    `${squares(tilesOf(r.levels))} ${clockText(secondsOf(r.timeMs))}`,
    fill(c.menus.home.streak, { n: p.daily.streak }),
    url,
  ];
  return { kind: "today", text: lines.join("\n"), url };
}

/**
 * Today's Daily Box as the collection keeps it (a later visit, the page loaded again): its offer, or null when it is
 * not solved today or was saved before each lock's level was kept.
 */
export function todayOffer(p: Readonly<Profile>, today: string): ShareOffer | null {
  const key = `shadow-locks/daily/${today}`;
  const item = p.collection.find((c) => c.key === key);
  if (!item?.levels) return null;
  const r: BoxResult = { spec: { kind: "daily", day: today }, key, practice: false, recorded: true, timeMs: item.timeMs, hints: item.hints, levels: item.levels };
  return shareOffer(r, p, today);
}
