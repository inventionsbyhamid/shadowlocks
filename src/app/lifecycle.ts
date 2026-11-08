import type { BoxSnapshot } from "../core/profile";

/** Where a box session is: the lifecycle saves only one that is not finished. */
export type Phase = "playing" | "finished";

/** WebXR session visibility, plus "non-immersive" when no XR session is running. */
export type XrVisibility = "visible" | "visible-blurred" | "hidden" | "non-immersive";

/** The part of a box session the lifecycle drives (the box session fits). */
export interface LifecycleSession {
  readonly phase: Phase;
  pause(now: number): void;
  resume(now: number): void;
  snapshot(now: number): BoxSnapshot;
}

export interface LifecycleAudio {
  suspend(): void;
  resume(): void;
}

export interface LifecycleDeps {
  /** Store the box in progress (null clears it). */
  persist(inProgress: BoxSnapshot | null): void;
  audio?: LifecycleAudio;
}

export const SAVE_DEBOUNCE_MS = 1000;

/**
 * Pauses the box and sound whenever the player cannot see it (headset off, system menu, page hidden,
 * XR ended) and resumes when they can, so clocks only count time the player had. Saves the box in
 * progress at most 1 s after a change, and at once when it is hidden.
 *
 * Never writes on its own initiative over a saved box it did not start: until a session is attached,
 * hiding saves nothing (the player may still be choosing "Continue").
 */
export class Lifecycle {
  private docHidden = false;
  private xr: XrVisibility = "non-immersive";
  /** A menu is up over the box: the box waits (sound does not). */
  private heldByMenu = false;
  private current: LifecycleSession | null = null;
  private pausedByUs = false;
  private audioSuspended = false;
  private dirty = false;
  private dueAt = Number.POSITIVE_INFINITY;
  private lastSavedNull: boolean | null = null;

  constructor(
    private readonly deps: LifecycleDeps,
    private readonly debounceMs = SAVE_DEBOUNCE_MS,
  ) {}

  get active(): boolean {
    return !this.docHidden && this.xr === "visible";
  }

  /** A menu is up over the box (the drawer is open while a box or lesson waits). */
  get held(): boolean {
    return this.heldByMenu;
  }

  /** The session's clock runs: the player can see it and no menu is up over it. */
  private get running(): boolean {
    return this.active && !this.heldByMenu;
  }

  get session(): LifecycleSession | null {
    return this.current;
  }

  /**
   * A menu came up over the box (true) or went away (false). While held the box is paused (its
   * clock stops) and saved at once; sound keeps playing (the menus click). It runs again once the
   * menu is gone and the player can see it.
   */
  setHeld(held: boolean, now: number): void {
    if (held === this.heldByMenu) return;
    const was = this.running;
    this.heldByMenu = held;
    this.runChanged(was, now);
    if (held) this.flush(now, true);
  }

  setAudio(audio: LifecycleAudio | undefined): void {
    this.deps.audio = audio;
  }

  /** Start tracking a session (null when it ends or is dropped). A session attached while hidden is paused. */
  attach(session: LifecycleSession | null, now: number): void {
    this.current = session;
    this.pausedByUs = false;
    if (session) {
      if (this.running) session.resume(now);
      else {
        session.pause(now);
        this.pausedByUs = true;
      }
    }
    this.markDirty(now);
  }

  /**
   * Let the session go unsaved, paused (its clock stops): what it would save is out of date (another window moved its
   * save on; shell.ts). It stays paused until a box is attached again.
   */
  release(now: number): void {
    const s = this.current;
    if (s && !this.pausedByUs) s.pause(now);
    this.current = null;
    this.pausedByUs = false;
    this.dirty = false;
    this.dueAt = Number.POSITIVE_INFINITY;
  }

  setDocumentHidden(hidden: boolean, now: number): void {
    const was = this.active;
    const run = this.running;
    this.docHidden = hidden;
    this.changed(was, run, now);
  }

  setXrVisibility(v: XrVisibility, now: number): void {
    const was = this.active;
    const run = this.running;
    this.xr = v;
    this.changed(was, run, now);
  }

  /** Something worth saving changed; save within the debounce time. */
  markDirty(now: number): void {
    this.dirty = true;
    if (this.dueAt === Number.POSITIVE_INFINITY) this.dueAt = now + this.debounceMs;
  }

  /** Call every frame. Allocation-free unless a save is due. */
  tick(now: number): void {
    if (now >= this.dueAt) this.flush(now);
  }

  /** Save now if anything changed; `force` also saves an unchanged running session (its clock moved). */
  flush(now: number, force = false): void {
    this.dueAt = Number.POSITIVE_INFINITY;
    const s = this.current;
    const live = s !== null && s.phase !== "finished";
    if (!this.dirty && !(force && live)) return;
    this.dirty = false;
    if (!live && this.lastSavedNull === true) return;
    this.lastSavedNull = !live;
    this.deps.persist(live ? s.snapshot(now) : null);
  }

  /** Seen or not changed (`was`: active before, `wasRunning`: the box ran before): the box, sound and a save. */
  private changed(was: boolean, wasRunning: boolean, now: number): void {
    this.runChanged(wasRunning, now);
    const is = this.active;
    if (was === is) return;
    if (!is) {
      if (this.deps.audio && !this.audioSuspended) {
        this.deps.audio.suspend();
        this.audioSuspended = true;
      }
      this.flush(now, true);
    } else if (this.deps.audio && this.audioSuspended) {
      this.deps.audio.resume();
      this.audioSuspended = false;
    }
  }

  /** The box pauses when it stops running (hidden, or under a menu) and resumes when it runs again. */
  private runChanged(was: boolean, now: number): void {
    const is = this.running;
    if (was === is) return;
    if (!is) {
      if (this.current) {
        this.current.pause(now);
        this.pausedByUs = true;
      }
    } else if (this.current && this.pausedByUs) {
      this.current.resume(now);
      this.pausedByUs = false;
    }
  }
}
