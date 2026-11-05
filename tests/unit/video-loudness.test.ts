import { describe, expect, it } from "vitest";
import { limiterFilter, limitPlan, linearFits, loudnessProblems, normalizeFilter, parseEbur128, parseLoudnorm, stayedLinear } from "../video/lib/loudness";

const LOUDNORM = `[Parsed_loudnorm_0 @ 0x55] 
{
	"input_i" : "-26.71",
	"input_tp" : "-8.90",
	"input_lra" : "4.30",
	"input_thresh" : "-37.02",
	"output_i" : "-14.10",
	"output_tp" : "-1.00",
	"output_lra" : "3.10",
	"output_thresh" : "-24.40",
	"normalization_type" : "dynamic",
	"target_offset" : "0.10"
}`;

const EBUR = `[Parsed_ebur128_0 @ 0x56] t: 12.4  TARGET:-23 LUFS    M: -14.2 S: -14.0     I: -14.0 LUFS       LRA:   3.2 LU  FTPK: -2.1 -2.3 dBFS  TPK: -1.2 -1.3 dBFS
[Parsed_ebur128_0 @ 0x56] Summary:

  Integrated loudness:
    I:         -14.1 LUFS
    Threshold: -24.3 LUFS

  Loudness range:
    LRA:         3.4 LU
    Threshold:  -34.3 LUFS
    LRA low:    -16.0 LUFS
    LRA high:   -12.6 LUFS

  True peak:
    Peak:       -1.2 dBFS
`;

describe("loudness", () => {
  it("reads loudnorm's measurement and ebur128's summary", () => {
    expect(parseLoudnorm(LOUDNORM)).toEqual({ I: -26.71, TP: -8.9, LRA: 4.3, thresh: -37.02, offset: 0.1 });
    expect(parseEbur128(EBUR)).toEqual({ I: -14.1, LRA: 3.4, TP: -1.2 });
    expect(() => parseEbur128("no summary")).toThrow(/summary/);
  });

  it("reads silence (no sound pack yet) as -inf, not NaN", () => {
    const silent = EBUR.replace("I:         -14.1 LUFS", "I:         -70.0 LUFS").replace("Peak:       -1.2 dBFS", "Peak:        -inf dBFS");
    expect(parseEbur128(silent)).toEqual({ I: -70, LRA: 3.4, TP: -Infinity });
  });

  it("limits peaks first when the plain gain would pass the true peak ceiling", () => {
    const m = parseLoudnorm(LOUDNORM);
    // +12.7 dB of gain would take a -8.9 dBTP peak to +3.8: limit to -1 - 12.7 - 0.5 first.
    const p = limitPlan(m, { I: -14, TP: -1 });
    expect(p.gainDb).toBeCloseTo(12.71, 6);
    expect(p.ceilingDb).toBeCloseTo(-14.21, 6);
    // At 4x the rate, so the peaks between samples are held too.
    expect(limiterFilter(p.ceilingDb as number)).toMatch(/^aresample=192000,alimiter=limit=0\.194\d+:.*,aresample=48000$/);
    // A quiet enough peak needs no limiter.
    expect(limitPlan({ ...m, TP: -20 }, { I: -14, TP: -1 }).ceilingDb).toBeNull();
  });

  it("tells whether the linear pass can reach the target without lifting the true peak over", () => {
    const m = parseLoudnorm(LOUDNORM);
    // -26.71 LUFS at -8.9 dBTP: +12.71 dB takes the peak to +3.8.
    expect(linearFits(m, { I: -14, TP: -1 })).toBe(false);
    expect(linearFits({ ...m, TP: -14 }, { I: -14, TP: -1 })).toBe(true);
  });

  it("asks loudnorm for a linear second pass with the measured values", () => {
    const f = normalizeFilter(parseLoudnorm(LOUDNORM), { I: -14, TP: -1 });
    expect(f).toContain("linear=true");
    expect(f).toContain("measured_I=-26.71:measured_TP=-8.9:measured_LRA=4.3:measured_thresh=-37.02:offset=0.1");
    expect(stayedLinear("Normalization Type:   Linear")).toBe(true);
    expect(stayedLinear("Normalization Type:   Dynamic")).toBe(false);
  });

  it("checks the result against the target", () => {
    expect(loudnessProblems({ I: -14.2, LRA: 3, TP: -1.1 }, { I: -14, TP: -1 })).toEqual([]);
    expect(loudnessProblems({ I: -15, LRA: 3, TP: -0.5 }, { I: -14, TP: -1 })).toEqual(["integrated -15 LUFS, target -14", "true peak -0.5 dBTP, ceiling -1"]);
  });
});
