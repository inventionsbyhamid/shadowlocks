// The result card an opened box shows under its reward, in the language shown: the box's name, a tile per lock (no
// hint, a hint, the spot shown; never which shape it was), the time, the Daily Box's streak, the player's best and the
// site's name. Made to be read in a system screenshot or a cast: the headset's way to share (the 2D page has the share
// button). Built once when the box opens and again when the language changes, never per frame.
import { formatDay } from "../i18n";
import { copy } from "../i18n";
import type { Profile } from "../core/profile";
import { bestOf, type BoxResult, clockText, secondsOf, type Tile, tilesOf } from "../core/result";
import { PUBLIC_ORIGIN } from "../platform/site-origin";
import { fill } from "./copy";

/** What the card shows, every word in the language shown. */
export interface ResultCard {
  /** "Daily Box Nov 10", "Box No. 12". */
  title: string;
  /** One per lock, in panel order. */
  tiles: Tile[];
  /** "4:12". */
  time: string;
  /** The streak (a Daily Box played for real), the best line, and what a shared link adds. */
  lines: string[];
  /** The site's name: "shadowlocks.pages.dev". */
  site: string;
}

/** The public host, as the card names it. */
export const CARD_SITE = new URL(PUBLIC_ORIGIN).host;

/** A box's name on its card: "Box No. 12", or the Daily Box with its day ("Daily Box Nov 10"). */
export function cardTitle(spec: BoxResult["spec"]): string {
  const c = copy();
  if (spec.kind === "box") return fill(c.game.boxNo, { n: spec.n });
  if (spec.kind === "daily") return fill(c.menus.collection.daily, { day: formatDay(spec.day) });
  return "";
}

/**
 * The card for a box that opened with result `r`, the profile as it is once the box opened (streak, collection); null
 * for a lesson's box (the lessons have their own words).
 */
export function resultCard(r: BoxResult, p: Readonly<Profile>): ResultCard | null {
  if (r.spec.kind === "lesson") return null;
  const c = copy();
  const lines: string[] = [];
  if (r.spec.kind === "daily" && !r.practice) lines.push(fill(c.menus.home.streak, { n: p.daily.streak }));
  const best = bestOf(p.collection, r);
  if (best?.kind === "new") lines.push(c.share.newBest);
  else if (best) lines.push(fill(c.share.best, { time: clockText(secondsOf(best.ms)) }));
  return { title: cardTitle(r.spec), tiles: tilesOf(r.levels), time: clockText(secondsOf(r.timeMs)), lines, site: CARD_SITE };
}
