// Loudness for delivery: measure with ffmpeg's loudnorm (EBU R128), then a second, linear pass to
// the target (a plain gain, no dynamic processing), after a peak limiter when the gain would push the
// true peak over the ceiling; verified with ebur128 (integrated, loudness range, true peak).
// Pure: argument builders and parsers; ffrun.ts runs them.

export interface LoudnormMeasure {
  I: number;
  TP: number;
  LRA: number;
  thresh: number;
  offset: number;
}

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

/** Pass one: measure only (the JSON block loudnorm prints at the end). */
export function measureArgs(input: string, t: LoudnessTarget): string[] {
  return [
    "-hide_banner", "-nostats", "-i", input,
    "-af", `loudnorm=I=${t.I}:TP=${t.TP}:LRA=${t.LRA ?? 11}:print_format=json`,
    "-f", "null", "-",
  ];
}

export function parseLoudnorm(stderr: string): LoudnormMeasure {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("loudnorm printed no measurement");
  const j = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  const n = (k: string) => {
    const v = Number(j[k]);
    if (!Number.isFinite(v)) throw new Error(`loudnorm measurement ${k} is ${j[k]}`);
    return v;
  };
  return { I: n("input_i"), TP: n("input_tp"), LRA: n("input_lra"), thresh: n("input_thresh"), offset: n("target_offset") };
}

/**
 * The gain the target needs, and the sample-peak ceiling a limiter must hold before that gain so the
 * true peak ends at or under the target's (with `marginDb` for inter-sample peaks). null: no limiter.
 */
export function limitPlan(m: LoudnormMeasure, t: LoudnessTarget, marginDb = 0.5): { gainDb: number; ceilingDb: number | null } {
  const gainDb = t.I - m.I;
  const peakAfter = m.TP + gainDb;
  if (peakAfter <= t.TP) return { gainDb, ceilingDb: null };
  return { gainDb, ceilingDb: Math.max(-24, t.TP - gainDb - marginDb) };
}

/**
 * A peak limiter at `ceilingDb`, without loudness compensation. It works at 4x the rate, so the peaks
 * between samples (the true peak loudnorm and ebur128 measure) are held too, not only the samples.
 */
export function limiterFilter(ceilingDb: number): string {
  const lin = Math.min(1, Math.max(0.0625, 10 ** (ceilingDb / 20)));
  return `aresample=192000,alimiter=limit=${lin.toFixed(5)}:attack=4:release=60:level=false,aresample=48000`;
}

/** Whether loudnorm's linear pass can reach `t` from `m`: the gain must not lift the true peak over. */
export function linearFits(m: LoudnormMeasure, t: LoudnessTarget): boolean {
  return m.TP + (t.I - m.I) <= t.TP;
}

/** Pass two: linear loudnorm with the measured values, back to 48 kHz. */
export function normalizeFilter(m: LoudnormMeasure, t: LoudnessTarget): string {
  return (
    `loudnorm=I=${t.I}:TP=${t.TP}:LRA=${t.LRA ?? 11}:measured_I=${m.I}:measured_TP=${m.TP}:measured_LRA=${m.LRA}` +
    `:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true:print_format=summary,aresample=48000`
  );
}

/** Whether loudnorm stayed linear (it falls back to dynamic when the true peak cannot be met). */
export function stayedLinear(stderr: string): boolean {
  return !/Normalization Type:\s*Dynamic/i.test(stderr);
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
