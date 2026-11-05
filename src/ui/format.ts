// Time formats for the menus (src/core/format.ts has formatSeconds with tenths).

/** Whole seconds as m:ss, rounded down: 61.9 -> "1:01". */
export function wholeSeconds(s: number): string {
  const t = Math.floor(Math.max(0, s) + 1e-9);
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}
