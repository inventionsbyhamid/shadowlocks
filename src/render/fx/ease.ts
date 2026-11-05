// Easing curves for the effects' timed moves (k runs 0..1). Pure, allocation-free.

export function clamp01(k: number): number {
  return k < 0 ? 0 : k > 1 ? 1 : k;
}

/** Progress of a tween that started `t` seconds ago and lasts `dur` (0..1; 1 when dur is 0). */
export function progress(t: number, dur: number): number {
  return dur <= 0 ? 1 : clamp01(t / dur);
}

export function smoothstep(a: number, b: number, x: number): number {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
}

export function outCubic(k: number): number {
  const u = 1 - k;
  return 1 - u * u * u;
}

export function inCubic(k: number): number {
  return k * k * k;
}

export function inOutCubic(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** Overshoots past 1 and comes back (a springy pop). `s` sets the overshoot (1.7 is about 10 %). */
export function outBack(k: number, s: number): number {
  const u = k - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

/** A hump: 0 at both ends, 1 in the middle. */
export function hump(k: number): number {
  return k <= 0 || k >= 1 ? 0 : Math.sin(Math.PI * k);
}
