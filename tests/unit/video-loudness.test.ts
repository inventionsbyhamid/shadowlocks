import { describe, expect, it } from "vitest";
import { gainFilter, limiterFilter, loudnessProblems, nextCeilingDb, parseEbur128, peakOverDb } from "../video/lib/loudness";

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
  it("reads ebur128's summary", () => {
    expect(parseEbur128(EBUR)).toEqual({ I: -14.1, LRA: 3.4, TP: -1.2 });
    expect(() => parseEbur128("no summary")).toThrow(/summary/);
  });

  it("reads silence (no sound pack yet) as -inf, not NaN", () => {
    const silent = EBUR.replace("I:         -14.1 LUFS", "I:         -70.0 LUFS").replace("Peak:       -1.2 dBFS", "Peak:        -inf dBFS");
    expect(parseEbur128(silent)).toEqual({ I: -70, LRA: 3.4, TP: -Infinity });
  });

  it("limits peaks first when the plain gain would pass the true peak ceiling", () => {
    // The opening's mix: -22 LUFS with chimes at -1.4 dBTP. +8 dB would put the peak at +6.6.
    const mix = { I: -22, LRA: 10.7, TP: -1.4 };
    const t = { I: -14, TP: -1.5 };
    expect(peakOverDb(mix, t)).toBeCloseTo(8.1, 6);
    expect(nextCeilingDb(mix, t)).toBeCloseTo(-9.6, 6);
    // Limited there it lost 0.6 LU with its peaks: still over, so the next ceiling goes lower by that and a step more.
    const limited = { I: -22.6, LRA: 10, TP: -9.6 };
    expect(peakOverDb(limited, t)).toBeCloseTo(0.5, 6);
    expect(nextCeilingDb(limited, t)).toBeCloseTo(-10.2, 6);
    // Once it fits, no further limiting.
    expect(peakOverDb({ I: -22.65, LRA: 10, TP: -10.2 }, t)).toBeLessThanOrEqual(0);
    // At 4x the rate, so the peaks between samples are held too.
    expect(limiterFilter(-14.21)).toMatch(/^aresample=192000,alimiter=limit=0\.194\d+:.*,aresample=48000$/);
  });

  it("brings the level up with a plain gain", () => {
    expect(gainFilter(8.65)).toBe("volume=8.650dB");
  });

  it("checks the result against the target", () => {
    expect(loudnessProblems({ I: -14.2, LRA: 3, TP: -1.1 }, { I: -14, TP: -1 })).toEqual([]);
    expect(loudnessProblems({ I: -15, LRA: 3, TP: -0.5 }, { I: -14, TP: -1 })).toEqual(["integrated -15 LUFS, target -14", "true peak -0.5 dBTP, ceiling -1"]);
  });
});
