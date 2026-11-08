import { type BoxSnapshot, migrate, type Profile, withProgressReset } from "../core/profile";
import type { Store, Stored } from "../platform/store";
import { COPY } from "../ui/copy";
import type { FeedbackEvent } from "./bus";

export const NOT_SAVED_NOTICE = COPY.notice.notSaved;

/** What the profile store needs from the app: the wall clock and this build's version. */
export interface ProfileEnv {
  /** Wall-clock ms since the epoch (Date.now in the app). */
  now(): number;
  /** This build's version (APP_VERSION): a first launch records it. */
  build: string;
}

/** A write tries again this often on top of a profile another window only opened on (see ProfileStore). */
const WRITE_TRIES = 4;

const copy = (p: Profile): Profile => JSON.parse(JSON.stringify(p)) as Profile;
/** The profile as the loader gives it back: every field in its place and order, so two copies compare as text. */
const canonical = (p: Profile): Profile => migrate(copy(p), 0, p.firstLaunch.build);
/** What a profile holds, the latest time seen left out (opening a window moves only that). */
const content = (p: Profile): string => JSON.stringify({ ...canonical(p), lastSeenMs: 0 });

/** The save a box or lesson in the lap goes to. */
export type Slot = "box" | "daily" | "lesson";

/**
 * Whether `slot`'s save differs between `before` and `after`: another window played that box on, solved it or played
 * another (the box in progress), or went on with the lessons. Both as the loader gives them (onAdopt's).
 */
export function slotMoved(before: Profile, after: Profile, slot: Slot): boolean {
  const of = (p: Profile) => (slot === "box" ? p.current : slot === "daily" ? p.daily.current : p.lessons);
  return JSON.stringify(of(before)) !== JSON.stringify(of(after));
}

/**
 * The player's profile in memory plus its storage. Opening writes the profile back at once, so the
 * first-launch marker and the latest time seen are stored even if nothing else is saved this launch.
 * Every write records the latest time seen (`lastSeenMs` never moves back). Writes never overlap: a
 * save asked for while one is running waits and then writes the latest profile once. Each write sends
 * a copy, so later changes cannot leak into a write in flight. When storage is (or becomes) memory
 * only, the notice is emitted once on the bus (the 2D page shows it) and stays in `pendingNotice` until
 * the in-headset UI shows it and calls `markNoticeShown()` (the event fires before the headset UI exists).
 *
 * Other windows of the site (the hosted link open in two tabs) share the storage, and a window never writes over a
 * newer profile: the stored profile carries a revision that every write moves on, and a write goes through only on top
 * of the revision this window last read or wrote (platform/store.ts). When another window has written since:
 * - if it changed nothing but the latest time seen (it only opened), this window's write goes on top of it;
 * - else this window's write is refused and the stored profile is taken as this window's own, in place (everything
 *   that reads the profile holds this object). What this window had changed since it last wrote is dropped, and the
 *   `onAdopt` listeners hear of it (the shell lets a box in play go when its save moved on, and the settings follow).
 * The window also looks again (`refresh`) whenever its page is seen again.
 *
 * Why refuse rather than merge: the windows are one player's, who plays in one at a time (one XR session), so the
 * newest stored profile is the one they played in last. A window's unsaved changes are at most its last second's
 * (saves come within a second of a change, and at once when the page is hidden), and a window that has not looked
 * since another wrote is one the player left: its last word, its box saved on the way out, belongs to a moment the
 * player has moved on from. Taking the newest profile needs no rule per field, and never moves progress back.
 * One window alone (the store and Competition apps) never meets another's write and behaves as before.
 */
export class ProfileStore {
  private running: Promise<void> | null = null;
  private again = false;
  private look = false;
  private noticed = false;
  private noticeShown = false;
  /** The profile as this window last read or wrote it (at revision `rev`). */
  private base: Profile;
  private readonly adopters = new Set<(before: Profile) => void>();

  private constructor(
    private readonly store: Store,
    private readonly emit: (e: FeedbackEvent) => void,
    private readonly env: ProfileEnv,
    public readonly profile: Profile,
    private rev: number,
  ) {
    this.base = copy(profile);
  }

  static async open(store: Store, emit: (e: FeedbackEvent) => void, env: ProfileEnv): Promise<ProfileStore> {
    const { profile, rev } = await store.load(env.now(), env.build);
    const ps = new ProfileStore(store, emit, env, profile, rev);
    ps.checkPersistent();
    // Not awaited: the game starts without waiting on a disk write; later saves queue behind it.
    void ps.save();
    return ps;
  }

  get persistent(): boolean {
    return this.store.persistent;
  }

  /** The storage notice while the headset has not shown it yet, else null. */
  get pendingNotice(): string | null {
    return this.noticed && !this.noticeShown ? NOT_SAVED_NOTICE : null;
  }

  markNoticeShown(): void {
    this.noticeShown = true;
  }

  /**
   * Hear when another window's profile is taken in place of this one's: `before` is this window's as it last read or
   * wrote it. Both as the loader gives them (fields in order). Returns a function that stops listening.
   */
  onAdopt(fn: (before: Profile) => void): () => void {
    this.adopters.add(fn);
    return () => this.adopters.delete(fn);
  }

  /** Write the current profile (coalesced with any write already waiting). */
  save(): Promise<void> {
    this.again = true;
    return this.run();
  }

  /**
   * Look at the stored profile again (the page is seen again): a profile another window has changed since is taken in
   * place of this one's. After any write in flight, and before one asked for meanwhile.
   */
  refresh(): Promise<void> {
    this.look = true;
    return this.run();
  }

  /** Set (or clear) the numbered box in progress and save. */
  setCurrent(snapshot: BoxSnapshot | null): Promise<void> {
    this.profile.current = snapshot;
    return this.save();
  }

  /** Start progress over (settings, the first launch and the latest time seen stay) and save. */
  resetProgress(): Promise<void> {
    Object.assign(this.profile, withProgressReset(this.profile));
    return this.save();
  }

  /** Set (or clear) the Daily Box in progress and save. */
  setDailyCurrent(snapshot: BoxSnapshot | null): Promise<void> {
    this.profile.daily.current = snapshot;
    return this.save();
  }

  /** Looks and writes, one at a time; a look first when both wait. */
  private run(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        while (this.look || this.again) {
          if (this.look) {
            this.look = false;
            await this.reread();
          } else {
            this.again = false;
            this.markSeen();
            await this.write();
            this.checkPersistent();
          }
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async reread(): Promise<void> {
    try {
      this.take(await this.store.load(this.env.now(), this.env.build));
    } catch (err) {
      console.warn("could not read progress", err);
    }
  }

  private async write(): Promise<void> {
    try {
      for (let i = 0; i < WRITE_TRIES; i++) {
        const p = copy(this.profile);
        const rev = await this.store.save(p, this.rev);
        if (rev !== null) {
          this.rev = rev;
          this.base = p;
          return;
        }
        // Another window wrote first: this write goes on top of a window that only opened, else it is refused.
        if (this.take(await this.store.load(this.env.now(), this.env.build))) return;
      }
      console.warn("could not save progress: another window keeps writing");
    } catch (err) {
      console.warn("could not save progress", err);
    }
  }

  /**
   * The stored profile, as read. When another window has written since this one last read or wrote: if it changed
   * more than the latest time seen, it is taken in place of this window's (true); else this window moves on to its
   * revision, its own changes kept to go on top (false). False too when nothing was written since.
   */
  private take(stored: Stored): boolean {
    if (stored.rev === this.rev) return false;
    const theirs = stored.profile;
    if (content(theirs) === content(this.base)) {
      this.rev = stored.rev;
      if (theirs.lastSeenMs > this.profile.lastSeenMs) this.profile.lastSeenMs = theirs.lastSeenMs;
      return false;
    }
    const before = canonical(this.base);
    Object.assign(this.profile, theirs);
    this.rev = stored.rev;
    this.base = copy(theirs);
    for (const fn of [...this.adopters]) {
      try {
        fn(before);
      } catch (err) {
        console.error("profile listener failed", err);
      }
    }
    return true;
  }

  private markSeen(): void {
    const t = this.env.now();
    if (Number.isFinite(t) && t > this.profile.lastSeenMs) this.profile.lastSeenMs = t;
  }

  private checkPersistent(): void {
    if (this.noticed || this.store.persistent) return;
    this.noticed = true;
    this.emit({ type: "notice", text: NOT_SAVED_NOTICE });
  }
}
