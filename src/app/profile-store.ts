import type { BoxSnapshot, Profile } from "../core/profile";
import type { Store } from "../platform/store";
import { COPY } from "../ui/copy";
import type { FeedbackEvent } from "./bus";

export const NOT_SAVED_NOTICE = COPY.notice.notSaved;

/**
 * The player's profile in memory plus its storage. Writes never overlap: a save asked for while
 * one is running waits and then writes the latest profile once. Each write sends a copy, so later
 * changes cannot leak into a write in flight. When storage is (or becomes) memory only, the
 * notice is emitted once on the bus (the 2D page shows it) and stays in `pendingNotice` until the
 * in-headset UI shows it and calls `markNoticeShown()` (the event fires before the headset UI exists).
 */
export class ProfileStore {
  private writing: Promise<void> | null = null;
  private again = false;
  private noticed = false;
  private noticeShown = false;

  private constructor(
    private readonly store: Store,
    private readonly emit: (e: FeedbackEvent) => void,
    public readonly profile: Profile,
  ) {}

  static async open(store: Store, emit: (e: FeedbackEvent) => void): Promise<ProfileStore> {
    const ps = new ProfileStore(store, emit, await store.load());
    ps.checkPersistent();
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

  setInProgress(snapshot: BoxSnapshot | null): Promise<void> {
    this.profile.inProgress = snapshot;
    return this.save();
  }

  private checkPersistent(): void {
    if (this.noticed || this.store.persistent) return;
    this.noticed = true;
    this.emit({ type: "notice", text: NOT_SAVED_NOTICE });
  }
}
