// The voice guide's player: one spoken line at a time, a narrator rather than a sound in the box (unplaced and mono,
// so both ears hear it alike), on its own gain stage inside the effects bus (the Effects slider scales it, as it
// does the UI sounds). While a line plays the music dips VOICE_MUSIC_DUCK_DB and the hums VOICE_HUM_DUCK_DB, down in
// 50 ms and back in 300 ms, as the engine's ducks go. Also the voice's timing constants the lessons pace by.
import type { AudioEngine } from "./engine";

/**
 * The voice's level over its clips' own (made at -20 LUFS, the level the owner's audition used): the one trim to make
 * by ear on a headset.
 */
export const VOICE_GAIN_DB = 0;
/** The music dips this much under a line... */
export const VOICE_MUSIC_DUCK_DB = 8;
/** ...and the lock and fingertip hums this much. */
export const VOICE_HUM_DUCK_DB = 6;
/** A line paced for (an example's opening, a win) is given this long after its clip ends before the next line. */
export const VOICE_TAIL_MS = 400;
/** No line starts within a lock's three layers... */
export const LOCK_QUIET_MS = 800;
/** ...within this long of the ghost's click... */
export const CLICK_QUIET_MS = 300;
/** ...or from a finger hold starting to this long after its piece forms. The box's tune is quiet for its length. */
export const FINGER_QUIET_MS = 1500;

/** What ducks under the voice besides the music (the hums). */
export interface VoiceDuck {
  duck(on: boolean): void;
}

const db = (x: number) => 10 ** (x / 20);

export class VoicePlayer {
  private readonly stage: GainNode;
  private cur: { src: AudioBufferSourceNode; fade: GainNode } | null = null;

  constructor(
    private readonly engine: AudioEngine,
    private readonly hums?: VoiceDuck,
  ) {
    const c = engine.context;
    this.stage = c.createGain();
    this.stage.gain.value = db(VOICE_GAIN_DB);
    this.stage.connect(engine.effectsInput());
  }

  /** Sound can play: audio started and runs. */
  get running(): boolean {
    return this.engine.running;
  }

  /** Play `buffer` now, stopping any line before it; `ended` once it is over (by itself or hushed). */
  say(buffer: AudioBuffer, ended: () => void): void {
    this.cut(0);
    const c = this.engine.context, now = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const fade = c.createGain();
    fade.gain.setValueAtTime(1, now);
    src.connect(fade);
    fade.connect(this.stage);
    const mine = { src, fade };
    src.onended = () => {
      src.disconnect();
      fade.disconnect();
      if (this.cur === mine) {
        this.cur = null;
        this.hums?.duck(false);
      }
      ended();
    };
    this.cur = mine;
    src.start(now);
    this.engine.duckMusicFor(VOICE_MUSIC_DUCK_DB, buffer.duration);
    this.hums?.duck(true);
  }

  /** Fade the line out over `fadeMs` and stop it; the music and the hums come back up. */
  hush(fadeMs: number): void {
    if (!this.cur) return;
    this.cut(fadeMs);
    this.engine.releaseDuck();
    this.hums?.duck(false);
  }

  private cut(fadeMs: number): void {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    const now = this.engine.context.currentTime, sec = Math.max(0, fadeMs) / 1000;
    const g = cur.fade.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (sec > 0) g.linearRampToValueAtTime(0, now + sec);
    else g.setValueAtTime(0, now);
    cur.src.stop(now + sec + 0.005);
  }
}
