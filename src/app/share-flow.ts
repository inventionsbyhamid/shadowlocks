// A shared link opened: which box it plays and how. Today's Daily Box is the player's own Daily Box once (open to
// them, not solved yet today): then it is their Daily Box, resumed from their save, and its solve counts as any
// Daily Box's does, once. Anything else (another day's Daily Box, a numbered box, today's once solved or still locked)
// plays as practice: never saved, solved or collected, so the player's progress, streak and collection stay as they
// were. A link names no free text and reaches no server: it is only the address the player opened.
//
// A new player (Lesson 1 not done) does Lesson 1 first, resumed at its step after a reload, and gets the friend's box
// in place of lesson 2. The friend's practice box's Next goes on to lesson 2 when it is not done yet, else Home: never to
// another box. Its reward shows both results (the friend's as their link says it).
import { dailyUnlocked, todayKey } from "../core/daily";
import { GENERATOR_VERSION } from "../core/generator";
import type { Profile } from "../core/profile";
import { type SharedLink, targetKey } from "../core/share";
import type { BoxSpec } from "../core/types";

export type SharedRoute = { kind: "daily" } | { kind: "practice"; spec: BoxSpec };

/** Where `link` goes for the player whose profile is `p`, on day `today` (their local day). */
export function sharedRoute(link: SharedLink, p: Readonly<Profile>, today: string): SharedRoute {
  const t = link.target;
  if (t.kind === "daily" && t.day === today && dailyUnlocked(p) && (p.daily.lastDay === null || p.daily.lastDay < today)) return { kind: "daily" };
  // The sender's box, by the generator version that built it (only versions this generator still builds get through).
  const gen = link.g !== null && link.g !== GENERATOR_VERSION ? { gen: link.g } : {};
  const spec: BoxSpec = t.kind === "box" ? { kind: "box", n: t.n, ...gen } : { kind: "daily", day: t.day, ...gen };
  return { kind: "practice", spec };
}

export interface ShareFlowDeps {
  link: SharedLink;
  profiles: { readonly profile: Readonly<Profile> };
  game: { play(spec: BoxSpec, snap: null, practice: boolean): void; playDaily(nowMs: number): void };
  /** Wall-clock ms (Date.now). */
  now: () => number;
  /** The lessons, for a new player's Lesson 1 first. */
  lessons?: { start(id: "l1", o: { step?: number }): void };
  /** A new player may go into Lesson 1 now (false: a test build keeps the lessons away). */
  lessonsFirst?: () => boolean;
  /** The friend's practice box's Next: lesson 2 when it is not done, else Home. */
  after?: () => void;
}

/** The friend's result as their link says it. */
export interface FriendResult {
  /** Whole seconds. */
  t: number;
  /** Hints, or null when the link has none. */
  h: number | null;
}

/** The shared link the page opened with: it starts its box once the game is up. */
export class ShareFlow {
  private routed: SharedRoute | null = null;
  private waiting = false;

  constructor(private readonly d: ShareFlowDeps) {}

  get link(): SharedLink {
    return this.d.link;
  }

  /** The shared box's seed key (whatever version built it). */
  get key(): string {
    return targetKey(this.d.link.target);
  }

  /** Where the link went (null until start). */
  get route(): SharedRoute | null {
    return this.routed;
  }

  /** Where the link goes now, for the player as their profile is. */
  routeNow(): SharedRoute {
    return sharedRoute(this.d.link, this.d.profiles.profile, todayKey(this.d.now()));
  }

  /** Lesson 1 plays first (a new player); the link's box comes when it is done. */
  get lessonFirst(): boolean {
    return this.waiting;
  }

  /** Start: Lesson 1 first for a new player (at its saved step), else the link's box now. */
  start(): void {
    const p = this.d.profiles.profile, l = this.d.lessons;
    if (l && !p.lessons.l1 && (this.d.lessonsFirst?.() ?? true)) {
      this.waiting = true;
      const step = p.lessons.step;
      l.start("l1", { step: step?.id === "l1" ? step.index : 0 });
      return;
    }
    this.play();
  }

  /** Lesson 1 is done: the link's box now, in place of lesson 2 (true), once; false when the link waits for nothing. */
  afterLesson(): boolean {
    if (!this.waiting) return false;
    this.waiting = false;
    this.play();
    return true;
  }

  /** The plate's Next for the box in play: the flow's own (true) for the friend's practice box only. */
  next(s: { readonly practice: boolean; readonly box: { readonly key: string } | null }): boolean {
    if (!s.practice || s.box?.key !== this.key) return false;
    this.d.after?.();
    return true;
  }

  /** The friend's result for the box with seed key `key`: theirs for the link's box when it names a time, else null. */
  friendFor(key: string): FriendResult | null {
    const l = this.d.link;
    return key === this.key && l.t !== null ? { t: l.t, h: l.h } : null;
  }

  /** Play the link's box: the player's own Daily Box, else the shared box as practice. */
  private play(): void {
    const r = (this.routed = this.routeNow());
    if (r.kind === "daily") this.d.game.playDaily(this.d.now());
    else this.d.game.play(r.spec, null, true);
  }
}
