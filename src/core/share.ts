// Shared links: a query string on the public host's own page, never a new path (the service worker answers every
// navigation with index.html, so they open offline too), naming a numbered box or a Daily Box's day and the sender's
// result: their time in whole seconds, their hints and the generator version that built their box.
//   https://shadowlocks.pages.dev/?box=12&t=222&h=0&g=4
//   https://shadowlocks.pages.dev/?day=2026-11-10&t=252&h=1&g=4
// No free text, no name, no id, no other site: only numbers and a day, each checked on its own. A bad value is dropped
// and the box still opens; a link naming no box is no shared link (`?box=N` alone stays the field flag). Times can be
// edited by anyone, which is fine: the receiver is told "your friend says", and nothing is stored or ranked.
import { PUBLIC_ORIGIN } from "../platform/site-origin";
import { BUILDABLE_VERSIONS, genOf, seedKey } from "./generator";
import { isDayKey } from "./profile";
import { type BoxResult, MAX_SECONDS, secondsOf, type Tile } from "./result";

/** What a link shares: a numbered box, or a Daily Box by its day. */
export type ShareTarget = { kind: "box"; n: number } | { kind: "daily"; day: string };

export interface SharedLink {
  target: ShareTarget;
  /** The sender's time in whole seconds (1 to MAX_SECONDS), or null when the link has none (or a bad one). */
  t: number | null;
  /** Their hints (0 to MAX_LINK_HINTS), or null. */
  h: number | null;
  /** The generator version that built their box (one this generator can still build), or null. */
  g: number | null;
}

/** The most hints a link names: three locks, four hints each. A box with more says this many. */
export const MAX_LINK_HINTS = 12;

/** The years a link's day may be in. */
const FIRST_YEAR = 2026;
const LAST_YEAR = 2099;

/** The one value of `name`, or null when it is missing or given more than once. */
function one(q: URLSearchParams, name: string): string | null {
  const all = q.getAll(name);
  return all.length === 1 ? all[0]! : null;
}

function wholeIn(v: string | null, re: RegExp, lo: number, hi: number): number | null {
  if (v === null || !re.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
}

function boxOf(v: string | null): number | null {
  return wholeIn(v, /^[1-9]\d{0,5}$/, 1, 999_999);
}

function dayOf(v: string | null): string | null {
  if (v === null || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !isDayKey(v)) return null;
  const y = Number(v.slice(0, 4));
  return y >= FIRST_YEAR && y <= LAST_YEAR ? v : null;
}

/**
 * The shared link in a page address's query (`location.search`), or null: no box or day named (or only bad ones), or
 * `?box=N` with nothing of a result (the field flag). A box and a day both named: the box.
 */
export function parseSharedLink(search: string): SharedLink | null {
  const q = new URLSearchParams(search);
  const n = boxOf(one(q, "box")), day = dayOf(one(q, "day"));
  const shared = q.has("day") || q.has("t") || q.has("h") || q.has("g");
  let target: ShareTarget;
  if (n !== null && shared) target = { kind: "box", n };
  else if (day !== null) target = { kind: "daily", day };
  else return null;
  const g = wholeIn(one(q, "g"), /^[1-9]\d{0,2}$/, 1, 999);
  return {
    target,
    t: wholeIn(one(q, "t"), /^[1-9]\d{0,5}$/, 1, MAX_SECONDS),
    h: wholeIn(one(q, "h"), /^(0|[1-9]\d?)$/, 0, MAX_LINK_HINTS),
    g: g !== null && BUILDABLE_VERSIONS.includes(g) ? g : null,
  };
}

/** The link's address on `origin` (the public host): the target, then t, h and g where they are given. */
export function sharedLinkUrl(link: SharedLink, origin: string = PUBLIC_ORIGIN): string {
  const parts = [link.target.kind === "box" ? `box=${link.target.n}` : `day=${link.target.day}`];
  if (link.t !== null) parts.push(`t=${link.t}`);
  if (link.h !== null) parts.push(`h=${link.h}`);
  if (link.g !== null) parts.push(`g=${link.g}`);
  return `${origin}/?${parts.join("&")}`;
}

/** The link for a box's result: its box or day, the time in whole seconds, the hints, the version it was built by. */
export function linkOf(r: BoxResult): SharedLink {
  const s = r.spec;
  if (s.kind === "lesson") throw new Error("a lesson's box is not shared");
  const target: ShareTarget = s.kind === "box" ? { kind: "box", n: s.n } : { kind: "daily", day: s.day };
  return { target, t: secondsOf(r.timeMs), h: Math.min(MAX_LINK_HINTS, Math.max(0, Math.floor(r.hints))), g: genOf(s) };
}

/** The seed key of a link's box (seedKey: the same for every generator version). */
export function targetKey(t: ShareTarget): string {
  return seedKey(t.kind === "box" ? { kind: "box", n: t.n } : { kind: "daily", day: t.day });
}

/**
 * Meta's Web Launch: an address that sends an https link from a computer or phone to the Meta Quest browser
 * (developers.meta.com/vr/documentation/web/web-launch).
 */
export function webLaunchUrl(link: string): string {
  const target = new URL(link);
  if (target.protocol !== "https:") throw new TypeError("Web Launch takes https links only");
  const u = new URL("https://www.oculus.com/open_url/");
  u.searchParams.set("url", target.toString());
  return u.toString();
}

/** The shared text's square for a tile (the result card draws the same colours). */
export const SQUARES: Readonly<Record<Tile, string>> = { clear: "🟨", hinted: "🟧", shown: "🟥" };

/** A square per lock, in panel order. */
export function squares(tiles: readonly Tile[]): string {
  return tiles.map((t) => SQUARES[t]).join("");
}
