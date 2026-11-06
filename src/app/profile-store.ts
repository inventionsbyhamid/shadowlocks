import type { BoxSnapshot, Profile } from "../core/profile";
import type { Store } from "../platform/store";
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

/**
 * The player's profile in memory plus its storage. Opening writes the profile back at once, so the
 * first-launch marker and the latest time seen are stored even if nothing else is saved this launch.
 * Every write records the latest time seen (`lastSeenMs` never moves back). Writes never overlap: a
 * save asked for while one is running waits and then writes the latest profile once. Each write sends
 * a copy, so later changes cannot leak into a write in flight. When storage is (or becomes) memory
 * only, the notice is emitted once on the bus (the 2D page shows it) and stays in `pendingNotice` until
 * the in-headset UI shows it and calls `markNoticeShown()` (the event fires before the headset UI exists).
 */
export class ProfileStore {
  private writing: Promise<void> | null = null;
  private again = false;
  private noticed = false;
  private noticeShown = false;

  private constructor(
    private readonly store: Store,
    private readonly emit: (e: FeedbackEvent) => void,
    private readonly env: ProfileEnv,
    public readonly profile: Profile,
  ) {}

  static async open(store: Store, emit: (e: FeedbackEvent) => void, env: ProfileEnv): Promise<ProfileStore> {
    const ps = new ProfileStore(store, emit, env, await store.load(env.now(), env.build));
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

  /** Write the current profile (coalesced with any write already waiting). */
  save(): Promise<void> {
    if (this.writing) {
      this.again = true;
      return this.writing;
    }
    this.writing = (async () => {
      try {
        do {
          this.again = false;
          this.markSeen();
          try {
            await this.store.save(JSON.parse(JSON.stringify(this.profile)) as Profile);
          } catch (err) {
            console.warn("could not save progress", err);
          }
          this.checkPersistent();
        } while (this.again);
      } finally {
        this.writing = null;
      }
    })();
    return this.writing;
  }

  /** Set (or clear) the numbered box in progress and save. */
  setCurrent(snapshot: BoxSnapshot | null): Promise<void> {
    this.profile.current = snapshot;
    return this.save();
  }

  /** Set (or clear) the Daily Box in progress and save. */
  setDailyCurrent(snapshot: BoxSnapshot | null): Promise<void> {
    this.profile.daily.current = snapshot;
    return this.save();
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
