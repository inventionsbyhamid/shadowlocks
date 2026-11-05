// Captions for sound cues (the Captions setting): short words such as "Lock opens" or "Rings line up"
// on a strip just in front of the box, leaning toward where the sound came from (lock sounds by the
// lock, lantern sounds by the lantern, the rest in the middle). The audio engine reports every sound
// with a manifest caption it is asked to play, even muted ones (`AudioEngine` option `onCaption`);
// only the sounds whose meaning a player might miss get one (`captionFor`), in the game's own words.
// Two at most; each fades in and out over 300 ms, and one pushed out by a newer one fades out first.
// Pure: the game's caption strip draws them.
import { COPY } from "./copy";

/**
 * The sounds that carry meaning a player might miss: a lock opens (one caption for its three
 * layers), the box opens, a hint appears, the rings line up. Every other sound shows the same
 * thing where the player looks, so it has no caption (no flicker of words several times a second).
 */
const CAPTIONED: ReadonlyMap<string, string> = new Map([
  ["brass_clunk", COPY.captions.lockOpen],
  ["walls_hinge", COPY.captions.boxOpens],
  ["hint_reveal", COPY.captions.hint],
  ["ring_chime", COPY.captions.ringsLine],
]);

/** The caption sound `soundId` shows, or null for none. */
export function captionFor(soundId: string): string | null {
  return CAPTIONED.get(soundId) ?? null;
}

export const CAPTIONS = {
  /** Fade in and out (s). Opacity only, so reduced motion keeps it. */
  fadeS: 0.3,
  /** Fully shown for this long (s). */
  holdS: 1.4,
  /**
   * Caption text size (mm) on the near strip and on a far strip (farther away, so larger); the
   * chip's side padding, border, dot and the gap after it (mm).
   */
  fontMm: 11,
  farFontMm: 12,
  padMm: 10,
  borderMm: 1,
  dotMm: 5,
  dotGapMm: 6,
  /** Inter bold is about this wide per character, in ems (estimate for laying chips out). */
  emPerChar: 0.6,
} as const;

/** Where a caption sits on the strip. */
export type CaptionPlace = "lock" | "lantern" | "centre";

const LOCK_SOUNDS = new Set(["glass_tick", "brass_clunk", "ring_chime", "thread_shimmer", "crystallise", "lock_hum"]);
const LANTERN_SOUNDS = new Set(["lantern_pick", "lantern_set", "lantern_creak", "dial_tick"]);

/** Sounds made at a lock sit by the lock; the lantern's by the lantern; everything else centred. */
export function captionPlace(soundId: string): CaptionPlace {
  if (LOCK_SOUNDS.has(soundId)) return "lock";
  return LANTERN_SOUNDS.has(soundId) ? "lantern" : "centre";
}

export interface Caption {
  active: boolean;
  id: string;
  text: string;
  /** Preferred centre along the strip (mm from its middle). */
  x: number;
  /** Seconds along its fade in, hold and fade out (a refresh or a push out moves it). */
  age: number;
  alpha: number;
  /** Bumped when the caption changes, so the painter knows to update its text. */
  serial: number;
  /**
   * The push that last started or refreshed it: the lower of two is the older caption. One that
   * waited keeps its own push's number, not the moment it came in.
   */
  started: number;
  /** A newer caption waiting for this one to fade out, and when it was pushed (to replace the older wait). */
  next: { id: string; text: string; x: number; at: number } | null;
}

const blank = (): Caption => ({ active: false, id: "", text: "", x: 0, age: 0, alpha: 0, serial: 0, started: 0, next: null });

const FADE_OUT_AT = CAPTIONS.fadeS + CAPTIONS.holdS;
const TOTAL = CAPTIONS.fadeS * 2 + CAPTIONS.holdS;

export class CaptionQueue {
  readonly slots: [Caption, Caption] = [blank(), blank()];
  private pushes = 0;

  /** Show `text` (the sound `id`'s caption) centred at `x` mm along the strip. */
  push(id: string, text: string, x: number): void {
    this.pushes++;
    const same = this.slots.find((s) => s.active && s.text === text);
    if (same) {
      // Already up: keep it fully shown for another hold (no stacking). One fading out comes back
      // from where it is, without a jump.
      same.x = x;
      same.started = this.pushes;
      if (same.age > FADE_OUT_AT) same.age = same.alpha * CAPTIONS.fadeS;
      else if (same.age > CAPTIONS.fadeS) same.age = CAPTIONS.fadeS;
      // A caption that was waiting for it waits for the other one instead.
      const n = same.next;
      same.next = null;
      if (n) this.pushOut(n.id, n.text, n.x, n.at);
      return;
    }
    const waiting = this.slots.find((s) => s.next?.text === text);
    if (waiting?.next) {
      waiting.next.x = x;
      return;
    }
    this.pushOut(id, text, x, this.pushes);
  }

  /**
   * Into a free slot; else the oldest one without a wait fades out from where it is, then this
   * takes its place. If both already wait, the newer of the two waits is kept and the older replaced.
   */
  private pushOut(id: string, text: string, x: number, at: number): void {
    const free = this.slots.find((s) => !s.active);
    if (free) {
      this.start(free, id, text, x, at);
      return;
    }
    const [a, b] = this.slots;
    let slot: Caption;
    // Oldest by when it started or was last refreshed (a refresh or a push out rewinds the age).
    if (!a.next && !b.next) slot = a.started <= b.started ? a : b;
    else if (!a.next) slot = a;
    else if (!b.next) slot = b;
    else slot = a.next.at <= b.next.at ? a : b;
    if (slot.age < FADE_OUT_AT) slot.age = TOTAL - slot.alpha * CAPTIONS.fadeS;
    slot.next = { id, text, x, at };
  }

  private start(s: Caption, id: string, text: string, x: number, at: number): void {
    s.active = true;
    s.id = id;
    s.text = text;
    s.x = x;
    s.age = 0;
    s.alpha = 0;
    s.serial++;
    s.started = at;
    s.next = null;
  }

  /** Advance the fades. Allocation free. */
  step(dt: number): void {
    const d = Math.max(0, dt);
    const fade = CAPTIONS.fadeS;
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i] as Caption;
      if (!s.active) continue;
      s.age += d;
      if (s.age >= TOTAL) {
        s.active = false;
        s.alpha = 0;
        const n = s.next;
        if (n) this.start(s, n.id, n.text, n.x, n.at);
        continue;
      }
      s.alpha = s.age < fade ? s.age / fade : s.age > FADE_OUT_AT ? (TOTAL - s.age) / fade : 1;
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.active = false;
      s.alpha = 0;
      s.next = null;
    }
  }

  get any(): boolean {
    return this.slots[0].active || this.slots[1].active;
  }
}

/** Estimated chip width (mm) for `text`: characters at `fontMm`, the dot, padding and border. */
export function chipWidthMm(text: string, fontMm: number = CAPTIONS.fontMm): number {
  const c = CAPTIONS;
  return text.length * fontMm * c.emPerChar + c.dotMm + c.dotGapMm + (c.padMm + c.borderMm) * 2;
}

/**
 * Centres (mm) for one or two chips on a strip `half` mm either side of its middle: each as near its
 * preferred x as the strip allows, and two pushed apart evenly when they would come closer than `gap`.
 */
export function layoutCaptions(
  x0: number,
  w0: number,
  two: boolean,
  x1: number,
  w1: number,
  half: number,
  gap: number,
  out: Float64Array,
): Float64Array {
  const clamp = (x: number, w: number) => Math.min(half - w / 2, Math.max(-half + w / 2, x));
  let a = clamp(x0, w0);
  let b = two ? clamp(x1, w1) : 0;
  if (two) {
    const need = (w0 + w1) / 2 + gap;
    if (Math.abs(b - a) < need) {
      const mid = (a + b) / 2;
      const leftFirst = a <= b;
      a = mid + (leftFirst ? -need / 2 : need / 2);
      b = mid + (leftFirst ? need / 2 : -need / 2);
      // Back inside the strip, keeping the spacing.
      const lo = Math.min(a - w0 / 2, b - w1 / 2);
      const hi = Math.max(a + w0 / 2, b + w1 / 2);
      const shift = lo < -half ? -half - lo : hi > half ? half - hi : 0;
      a += shift;
      b += shift;
    }
  }
  out[0] = a;
  out[1] = b;
  return out;
}
