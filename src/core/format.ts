/** Seconds as m:ss.s (tenths truncated), e.g. 83.44 -> "1:23.4". */
export function formatSeconds(s: number): string {
  const tenths = Math.floor(Math.max(0, s) * 10 + 1e-9);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  const sec = Math.floor(rest / 10);
  return `${m}:${sec < 10 ? "0" : ""}${sec}.${rest % 10}`;
}
