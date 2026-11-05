/** `x` held to 0..1; NaN counts as 0 (a level or volume that went wrong is silence, never noise). */
export function clamp01(x: number): number {
  return x > 1 ? 1 : x > 0 ? x : 0;
}
