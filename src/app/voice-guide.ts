// The voice guide: the game speaks the line the coach chip shows. The chip is the caption, so the voice never says
// anything the chip does not show, and a line with no clip (or a language with no voice, or the Voice guide off) is
// text only. The rules (plan: the onboarding and voice proposal, section 3.3):
// - A line is said the first time it shows (in its step, or its replay); a line coming back is not said again, unless
//   it is an idle nudge coming back, which is said at most IDLE_REPEATS times a step.
// - One line at a time: when the chip moves on, the line playing fades out over STALE_FADE_MS and the next one starts
//   NEXT_GAP_MS later (the music and the hums stay dipped in between). Doing what a line asks moves the chip on, so it ends the line. An idle line never interrupts a
//   line, and is dropped within IDLE_AFTER_MS of one ending.
// - Quiet windows (a lock's layers, the ghost's click, the box's tune, the finger lock's moment): a line waits for the
//   window's end, if it is still the chip's.
// - Audio not started yet (the store app enters XR with no gesture): the line waits, and is said when audio starts if
//   it is still shown and under UNLOCK_HOLD_MS old. A clip still decoding is waited for READY_WAIT_MS at most.
// - Hidden (headset off, app in the background): the line stops; seen again, it is said again from the start
//   BACK_AFTER_MS later, if still shown. Time is play time: it stands still while hidden.
// Per frame: `update` compares the chip's line and show count with the last ones and one time against the next wake-up
// (a number; Infinity when nothing waits), and allocates nothing. Everything else runs on a change of line, a timer,
// a clip ending or a setting.
import type { LifecycleAudio } from "./lifecycle";
import type { LineWhy } from "./lessons-director";
import { keyOfLine } from "./voice-lines";

/** Why a line is on the chip: the director's reasons, or a tip (or the session's suggestion) outside the lessons. */
export type VoiceWhy = LineWhy | "tip";

/** A line that loses the chip fades out over this long... */
export const STALE_FADE_MS = 120;
/** ...and the next one starts this long after that. */
export const NEXT_GAP_MS = 250;
/** An idle nudge is said at most this many times a step (its first showing included). */
export const IDLE_REPEATS = 2;
/** An idle nudge is not said within this long of a line ending. */
export const IDLE_AFTER_MS = 6000;
/** A line shown before audio starts is still said when it starts, if it is under this old. */
export const UNLOCK_HOLD_MS = 10_000;
/** A line whose clip is still decoding waits this long for it at most. */
export const READY_WAIT_MS = 1500;
/** Seen again after being hidden, the line is said again from its start after this long. */
export const BACK_AFTER_MS = 1000;
/** Switching the Voice guide off fades the line out over this long. */
export const OFF_FADE_MS = 300;
/** The record of lines said keeps this many, the latest (a lesson says about 20). */
export const SAID_KEPT = 64;
/** How often a waiting line checks again (audio started, its clip decoded). */
const POLL_MS = 100;

/** Where the voice is heard (voice.ts VoicePlayer on the audio engine). */
export interface VoiceOut {
  /** Sound can play now (audio started and running). */
  readonly running: boolean;
  /** Start `buffer` (the line before it is already stopped); `ended` when it is over, by itself or stopped. */
  say(buffer: AudioBuffer, ended: () => void): void;
  /**
   * Fade the line playing out over `fadeMs` and stop it. `hold`: another line is queued to follow, so the music and
   * the hums stay dipped until it starts (or `release`).
   */
  hush(fadeMs: number, hold?: boolean): void;
  /** The line held for will not start: with none playing, the music and the hums come back up. */
  release(): void;
}

/** The clips (voice-pack.ts VoicePack). */
export interface VoiceClips {
  /** The manifest has a clip for `key`. */
  known(key: string): boolean;
  /** `key`'s clip loaded (or is loading). */
  has(key: string): boolean;
  ms(key: string): number;
  buffer(key: string): AudioBuffer | null;
  want(keys: readonly string[]): unknown;
}

export interface VoiceGuideDeps {
  out: VoiceOut;
  /** Play time (ms): it stands still while the app is hidden. */
  now(): number;
  /** The Voice guide setting. */
  enabled(): boolean;
  /** The language the chip shows. */
  lang(): string;
  /** The voice can be heard at all (the effects volume, which the voice sits under, is above 0). */
  audible?(): boolean;
  warn?(message: string): void;
}

export class VoiceGuide {
  /** The lines said, in order, by copy key: the latest SAID_KEPT (tests and the test hooks read it). */
  readonly said: string[] = [];
  private clips: VoiceClips | null = null;
  private line: string | null = null;
  private shows = -1;
  private scope = -1;
  private visible = true;
  /** The line on the chip, by copy key, and why it shows. */
  private key: string | null = null;
  private why: VoiceWhy | null = null;
  /** The line playing, its clip's turn (an `ended` from an older one is ignored), and when the last one ended. */
  private playing: string | null = null;
  private token = 0;
  private lastEnd = -Infinity;
  /** A line waiting to start: its key, from when, since when it waits (audio, decode), and its decode deadline. */
  private pending: string | null = null;
  private startAt = Infinity;
  private shownAt = 0;
  private readyBy = 0;
  private quietUntil = -Infinity;
  /** The next time `update` has something to do (Infinity: nothing waits). */
  private wakeAt = Infinity;
  /** A line stopped by hiding, to say again once seen. */
  private resumeKey: string | null = null;
  /** Idle nudges said in this step, by key. */
  private readonly idleSaid = new Map<string, number>();
  private readonly warned = new Set<string>();
  private prepared: readonly string[] = [];

  constructor(private readonly deps: VoiceGuideDeps) {}

  /** The pack's clips (null: none, text only). */
  setClips(clips: VoiceClips | null): void {
    this.clips = clips;
    if (clips && this.prepared.length) clips.want(this.prepared);
  }

  /** The line playing now, by copy key, or null. */
  get speaking(): string | null {
    return this.playing;
  }

  /**
   * How long line `key` (a copy key, as the chip shows it) runs when spoken now, or 0: the Voice guide off, a language
   * with no voice, no clip, or the effects volume at 0 (the lessons are not slowed for silence). The lessons' pacing
   * waits for it.
   */
  ms(key: string): number {
    return this.voiced() && this.clips && (this.deps.audible?.() ?? true) ? this.clips.ms(key) : 0;
  }

  /** The lines a part of a lesson needs, by copy key: decoded now, the rest dropped. */
  prepare(keys: readonly string[]): void {
    this.prepared = keys;
    this.clips?.want(keys);
  }

  /** A quiet window from now, `ms` long: no line starts in it. */
  quiet(ms: number): void {
    const until = this.deps.now() + ms;
    if (until <= this.quietUntil) return;
    this.quietUntil = until;
    if (this.pending && this.wakeAt < until) this.wakeAt = until;
  }

  /** The settings changed: the Voice guide switched off fades the line out at once (the chip keeps it). */
  settingsChanged(): void {
    if (this.voiced()) return;
    this.wakeAt = Infinity;
    this.resumeKey = null;
    if (this.pending !== null) this.drop();
    if (this.playing) this.stop(OFF_FADE_MS);
  }

  /**
   * Per frame: the chip's line (English, as shown: a phone's or the controllers' wording), why, whether it has shown
   * before in its step, its show count (a new showing of the same words counts), the step (a new one starts the idle
   * counts over) and whether the app is seen. Allocates nothing.
   */
  update(line: string | null, why: VoiceWhy | null, again: boolean, shows: number, scope: number, visible: boolean): void {
    if (visible !== this.visible) this.seen(visible);
    if (line !== this.line || shows !== this.shows) this.changed(line, why, again, shows, scope);
    if (this.wakeAt !== Infinity && this.deps.now() >= this.wakeAt) this.wake();
  }

  private voiced(): boolean {
    return this.deps.enabled() && this.deps.lang() === "en";
  }

  /** A new line on the chip (or none): the old one stops, the new one is said if the rules allow. */
  private changed(line: string | null, why: VoiceWhy | null, again: boolean, shows: number, scope: number): void {
    this.line = line;
    this.shows = shows;
    if (scope !== this.scope) {
      this.scope = scope;
      this.idleSaid.clear();
    }
    const key = line === null ? null : keyOfLine(line);
    const was = this.playing;
    this.key = key;
    this.why = key === null ? null : why;
    const held = this.pending !== null;
    this.pending = null;
    this.wakeAt = Infinity;
    this.resumeKey = null;
    if (was !== null && was === key) return;
    const now = this.deps.now();
    const say = key !== null && this.sayable(key, why, again, was !== null, now);
    // The line playing stops; the dips under it stay down only when the new one is queued to follow.
    if (was !== null) this.stop(STALE_FADE_MS, say);
    else if (held && !say) this.deps.out.release();
    if (say && key !== null) this.queue(key, was !== null ? now + STALE_FADE_MS + NEXT_GAP_MS : now, now);
  }

  /** Line `key` showing now (why, again, with a line playing until now) is to be said. */
  private sayable(key: string, why: VoiceWhy | null, again: boolean, cut: boolean, now: number): boolean {
    if (!this.voiced() || !this.clips) return false;
    if (!this.clips.has(key)) {
      if (!this.clips.known(key) && !this.warned.has(key)) {
        this.warned.add(key);
        this.deps.warn?.(`voice: no clip for ${key}; text only`);
      }
      return false;
    }
    // A nudge never interrupts, never follows a line closely, and comes back at most IDLE_REPEATS times a step.
    if (why === "idle") return !cut && now - this.lastEnd >= IDLE_AFTER_MS && (this.idleSaid.get(key) ?? 0) < IDLE_REPEATS;
    return !again;
  }

  /** The waiting line is given up: the dips held for it come back up. */
  private drop(): void {
    this.pending = null;
    this.deps.out.release();
  }

  /** Line `key` to start at `at` (or once a quiet window, audio or its clip allows). */
  private queue(key: string, at: number, now: number): void {
    this.pending = key;
    this.startAt = at;
    this.shownAt = now;
    this.readyBy = now + READY_WAIT_MS;
    if (!this.clips!.buffer(key)) this.clips!.want(this.prepared.includes(key) ? this.prepared : [...this.prepared, key]);
    this.wakeAt = Math.max(at, this.quietUntil, now);
  }

  /** A timer is due: start the waiting line if everything allows, else wait again (or give it up). */
  private wake(): void {
    const key = this.pending, now = this.deps.now();
    this.wakeAt = Infinity;
    if (key === null || !this.clips) return;
    if (now < this.startAt || now < this.quietUntil) {
      this.wakeAt = Math.max(this.startAt, this.quietUntil);
      return;
    }
    if (!this.deps.out.running) {
      if (now - this.shownAt > UNLOCK_HOLD_MS) this.drop();
      else {
        // Its clip gets its own wait once audio starts.
        this.readyBy = now + READY_WAIT_MS;
        this.wakeAt = now + POLL_MS;
      }
      return;
    }
    const b = this.clips.buffer(key);
    if (!b) {
      if (now > this.readyBy) this.drop();
      else this.wakeAt = now + POLL_MS;
      return;
    }
    this.pending = null;
    this.start(key, b);
  }

  private start(key: string, b: AudioBuffer): void {
    const turn = ++this.token;
    this.playing = key;
    if (this.why === "idle") this.idleSaid.set(key, (this.idleSaid.get(key) ?? 0) + 1);
    if (this.said.length >= SAID_KEPT) this.said.shift();
    this.said.push(key);
    this.deps.out.say(b, () => {
      if (turn !== this.token) return;
      this.playing = null;
      this.lastEnd = this.deps.now();
    });
  }

  /** The line playing stops, over `fadeMs`; `hold`: another is queued to follow, so the dips stay down. */
  private stop(fadeMs: number, hold = false): void {
    this.token++;
    this.playing = null;
    this.lastEnd = this.deps.now();
    this.deps.out.hush(fadeMs, hold);
  }

  /**
   * Hidden: the line stops. Seen again: it is said again from its start, if still shown. The lifecycle says so as it
   * happens (voiceHearsLifecycle): a headset taken off may run no frame while hidden. `update`'s flag is a fallback.
   */
  seen(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      if (this.playing === null) return;
      this.resumeKey = this.playing;
      this.stop(0);
      return;
    }
    const key = this.resumeKey;
    this.resumeKey = null;
    if (key === null || key !== this.key || !this.voiced() || !this.clips?.has(key)) return;
    const now = this.deps.now();
    this.queue(key, now + BACK_AFTER_MS, now);
  }
}

/**
 * The lifecycle's audio hook (`audio`: the engine), with the voice guide told first when the app is hidden and last
 * when it is seen again, as it happens.
 */
export function voiceHearsLifecycle(audio: LifecycleAudio, voice: Pick<VoiceGuide, "seen">): LifecycleAudio {
  return {
    suspend() {
      voice.seen(false);
      audio.suspend();
    },
    resume() {
      audio.resume();
      voice.seen(true);
    },
  };
}
