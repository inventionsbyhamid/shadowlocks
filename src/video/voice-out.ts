// Video builds only (VITE_VIDEO=1, never production): the voice guide's lines in a demo video render. The render's
// browser plays no sound (its audio never starts, and Web Audio runs on real time, not the frame clock), so the voice
// guide speaks into this stand-in instead of the engine: it counts as started, as on a headset after the first poke,
// times each line by its clip's length on the frame clock (performance.now, which the render steps), and keeps a
// list of what was said and cut. The render drains the list every frame (window.__nsVideoVoice) and lays the game's
// own clips into the shot's sound at those times (tests/video/lib/audio.ts).
import { createSystem } from "@iwsdk/core";
import type { VoiceOut } from "../app/voice-guide";

/** A line started (`key`: the copy key, the clip's length) or the line playing faded out over `fadeMs`. */
export type VideoVoiceLine = { kind: "say"; key: string | null; ms: number } | { kind: "hush"; fadeMs: number };

export class VideoVoiceOut implements VoiceOut {
  readonly running = true;
  /** The line playing (set once the guide exists: it names the line it starts). */
  speaker: () => string | null = () => null;
  private ended: (() => void) | null = null;
  private endAt = Infinity;
  private readonly lines: VideoVoiceLine[] = [];

  say(buffer: AudioBuffer, ended: () => void): void {
    this.finish();
    const ms = buffer.duration * 1000;
    this.lines.push({ kind: "say", key: this.speaker(), ms });
    this.ended = ended;
    this.endAt = performance.now() + ms;
  }

  hush(fadeMs: number): void {
    if (!this.ended) return;
    this.lines.push({ kind: "hush", fadeMs });
    this.endAt = Math.min(this.endAt, performance.now() + fadeMs);
  }

  release(): void {}

  /** Per frame: a line whose time is up has ended. */
  tick(): void {
    if (this.ended && performance.now() >= this.endAt) this.finish();
  }

  /** The lines said and cut since the last drain. */
  drain(): VideoVoiceLine[] {
    return this.lines.splice(0);
  }

  private finish(): void {
    const f = this.ended;
    this.ended = null;
    this.endAt = Infinity;
    f?.();
  }
}

let out: VideoVoiceOut | null = null;

/** The stand-in the sound is built with; the render drains it through `window.__nsVideoVoice`. */
export function videoVoiceOut(): VideoVoiceOut {
  out = new VideoVoiceOut();
  (window as unknown as { __nsVideoVoice?: VideoVoiceOut }).__nsVideoVoice = out;
  return out;
}

/** Ends each line on time, frame by frame. */
export class VideoVoiceSystem extends createSystem({}) {
  update(): void {
    out?.tick();
  }
}
