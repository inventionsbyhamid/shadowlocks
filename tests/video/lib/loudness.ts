// Loudness for delivery: measured with ffmpeg's ebur128 (ITU BS.1770, the meter the delivery is checked with), then a
// plain gain to the target, after a peak limiter when the gain would push the true peak over the ceiling. Not
// loudnorm: its own meter reads a sparse, peaky mix (chimes over a quiet bed) almost 1 LU louder than ebur128 does,
// so a gain worked out from it lands short of the target every time.
// Pure: argument builders and parsers; ffrun.ts runs them.

export interface Ebur128 {
  /** Integrated loudness, LUFS. */
  I: number;
  /** Loudness range, LU. */
  LRA: number;
  /** True peak, dBTP. */
  TP: number;
}

export interface LoudnessTarget {
  I: number;
  TP: number;
  LRA?: number;
}

/** How far (dB) the plain gain to the target would lift the true peak over the ceiling (0 or less: it fits). */
export function peakOverDb(m: Ebur128, t: LoudnessTarget): number {
  return m.TP + (t.I - m.I) - t.TP;
}

/**
 * The next limiter ceiling (dBFS) for a mix measured `m` (the input, or the input limited at the last ceiling, whose
 * true peak then sits at that ceiling): lower by what the gain would still put over, and `stepDb` more for the
 * loudness the limiter takes with the peaks. A few steps settle it: the integrated loudness moves far less than the
 * peaks.
 */
export function nextCeilingDb(m: Ebur128, t: LoudnessTarget, stepDb = 0.1): number {
  return Math.max(-30, m.TP - peakOverDb(m, t) - stepDb);
}

/** A plain gain (linear: no dynamics). */
export function gainFilter(db: number): string {
  return `volume=${db.toFixed(3)}dB`;
}

/**
 * A peak limiter at `ceilingDb`, without loudness compensation. It works at 4x the rate, so the peaks
 * between samples (the true peak loudnorm and ebur128 measure) are held too, not only the samples.
 */
export function limiterFilter(ceilingDb: number): string {
  const lin = Math.min(1, Math.max(0.0625, 10 ** (ceilingDb / 20)));
  return `aresample=192000,alimiter=limit=${lin.toFixed(5)}:attack=4:release=60:level=false,aresample=48000`;
}

export function ebur128Args(input: string): string[] {
  return ["-hide_banner", "-nostats", "-i", input, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"];
}

/** The Summary block of ebur128 (the last one printed). */
export function parseEbur128(stderr: string): Ebur128 {
  const at = stderr.lastIndexOf("Summary:");
  if (at < 0) throw new Error("ebur128 printed no summary");
  const tail = stderr.slice(at);
  const grab = (re: RegExp, what: string) => {
    const m = re.exec(tail);
    if (!m) throw new Error(`ebur128 summary has no ${what}`);
    // Silence (no sound pack yet) peaks at -inf.
    return m[1] === "-inf" ? -Infinity : Number(m[1]);
  };
  return {
    I: grab(/I:\s+(-?[\d.]+|-inf)\s+LUFS/, "integrated loudness"),
    LRA: grab(/LRA:\s+(-?[\d.]+)\s+LU\b/, "loudness range"),
    TP: grab(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS/, "true peak"),
  };
}

/** Problems with a measured result against the target (empty when it meets it). */
export function loudnessProblems(r: Ebur128, t: LoudnessTarget, toleranceLu = 0.5): string[] {
  const out: string[] = [];
  if (Math.abs(r.I - t.I) > toleranceLu) out.push(`integrated ${r.I} LUFS, target ${t.I}`);
  if (r.TP > t.TP + 0.05) out.push(`true peak ${r.TP} dBTP, ceiling ${t.TP}`);
  return out;
}
