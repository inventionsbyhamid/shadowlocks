// Plays cues on time. A layer due within DIRECT_MS (a lock opening's clunk and note) goes to the
// engine at once and starts exactly on the audio clock, which stops with the audio when the game is
// hidden. A later one (the box opening's tune, seconds long) waits on the app's frame clock, which
// also stops while the game is hidden, and reaches the engine LOOKAHEAD_MS before its time: so a
// long sequence never holds pool voices far ahead, and one hidden mid-way picks up where it was
// instead of firing every late note on one frame.
import type { Vec3 } from "../core/types";
import type { Cue, CueTarget, HandleSink } from "./cues";
import type { PlayOptions } from "./engine";
import type { SfxId } from "./manifest";

/** Layers due this soon go straight to the audio clock. */
export const DIRECT_MS = 200;
/** Later layers reach the engine this long before their time, then start exactly on the audio clock. */
export const LOOKAHEAD_MS = 50;
const QUEUE = 48;

interface Pending {
  due: number;
  id: SfxId;
  position: Vec3;
  placed: boolean;
  pitch: number | undefined;
  gain: number | undefined;
  variant: number | undefined;
  duckDb: number | undefined;
}

/**
 * Plays cues, holding the later ones until just before their time on `now` (the frame clock, ms).
 * Allocation free: a fixed queue kept in time order, and one options object reused for every play.
 */
export class CueScheduler {
  private readonly queue: Pending[] = Array.from({ length: QUEUE }, () => ({
    due: 0,
    id: "glass_tick" as SfxId,
    position: [0, 0, 0] as Vec3,
    placed: false,
    pitch: undefined,
    gain: undefined,
    variant: undefined,
    duckDb: undefined,
  }));
  private n = 0;
  private readonly opts: PlayOptions = {};

  constructor(
    private readonly engine: CueTarget,
    private readonly now: () => number,
    private readonly onHandle?: HandleSink,
  ) {}

  /** Sounds still waiting for their time. */
  get pending(): number {
    return this.n;
  }

  push(cues: readonly Cue[]): void {
    let t = Number.NaN;
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i]!;
      if (c.kind === "sting") this.engine.sting(c.id);
      else if (c.kind === "music") this.engine.setMusic(c.state);
      else {
        const d = c.delayMs ?? 0;
        // A full queue (never in play) hands the sound to the audio clock rather than dropping it.
        if (d <= DIRECT_MS || this.n === QUEUE) this.play(c.id, c.position, c.pitch, c.gain, c.variant, d, c.duckDb);
        else {
          if (Number.isNaN(t)) t = this.now();
          this.hold(t + d, c);
        }
      }
    }
  }

  /** Per frame: hand the engine every sound due within the lookahead, exactly timed. */
  update(): void {
    if (this.n === 0) return;
    const t = this.now();
    const q = this.queue;
    while (this.n > 0 && q[0]!.due - t <= LOOKAHEAD_MS) {
      const p = q[0]!;
      this.play(p.id, p.placed ? p.position : undefined, p.pitch, p.gain, p.variant, p.due - t, p.duckDb);
      for (let i = 1; i < this.n; i++) q[i - 1] = q[i]!;
      q[this.n - 1] = p;
      this.n--;
    }
  }

  /** Drop every sound still waiting (play ended, a new box). */
  clear(): void {
    this.n = 0;
  }

  private play(
    id: SfxId,
    position: Vec3 | undefined,
    pitch: number | undefined,
    gain: number | undefined,
    variant: number | undefined,
    delayMs: number,
    duckDb: number | undefined,
  ): void {
    const o = this.opts;
    o.position = position;
    o.pitch = pitch;
    o.gain = gain;
    o.variant = variant;
    o.duckDb = duckDb;
    o.delay = delayMs > 0 ? delayMs / 1000 : undefined;
    const h = this.engine.play(id, o);
    this.onHandle?.(id, h);
  }

  /** Into the queue in time order, after any already due at the same time. */
  private hold(due: number, c: Extract<Cue, { kind: "sfx" }>): void {
    const q = this.queue;
    const slot = q[this.n]!;
    let i = this.n;
    while (i > 0 && q[i - 1]!.due > due) {
      q[i] = q[i - 1]!;
      i--;
    }
    q[i] = slot;
    this.n++;
    slot.due = due;
    slot.id = c.id;
    slot.placed = !!c.position;
    if (c.position) {
      slot.position[0] = c.position[0];
      slot.position[1] = c.position[1];
      slot.position[2] = c.position[2];
    }
    slot.pitch = c.pitch;
    slot.gain = c.gain;
    slot.variant = c.variant;
    slot.duckDb = c.duckDb;
  }
}
