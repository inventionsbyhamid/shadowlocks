// A shared link opened: which box it plays and how. Today's Daily Box is the player's own Daily Box once (open to
// them, not solved yet today): then it is their Daily Box, resumed from their save, and its solve counts as any
// Daily Box's does, once. Anything else (another day's Daily Box, a numbered box, today's once solved or still locked)
// plays as practice: never saved, solved or collected, so the player's progress, streak and collection stay as they
// were. A link names no free text and reaches no server: it is only the address the player opened.
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
}

/** The shared link the page opened with: it starts its box once the game is up. */
export class ShareFlow {
  private routed: SharedRoute | null = null;

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

  /** Play the link's box: the player's own Daily Box, else the shared box as practice. */
  start(): void {
    const r = (this.routed = this.routeNow());
    if (r.kind === "daily") this.d.game.playDaily(this.d.now());
    else this.d.game.play(r.spec, null, true);
  }
}
