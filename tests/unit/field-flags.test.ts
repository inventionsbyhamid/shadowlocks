import { describe, expect, it } from "vitest";
import { disableMultiview, FrameStats, readFieldFlags, startBox } from "../../src/app/field-flags";
import { recordingName, recordSeconds } from "../../src/app/hand-recorder";

describe("field test flags", () => {
  it("are off unless the address names them", () => {
    expect(readFieldFlags("")).toEqual({ perf: false, multiview: true });
    expect(readFieldFlags("?perf=1")).toEqual({ perf: true, multiview: true });
    expect(readFieldFlags("?perf")).toEqual({ perf: true, multiview: true });
    expect(readFieldFlags("?perf=0&multiview=0")).toEqual({ perf: false, multiview: false });
    expect(readFieldFlags("?multiview=off&perf=ON")).toEqual({ perf: true, multiview: false });
    expect(readFieldFlags("?multiview=1")).toEqual({ perf: false, multiview: true });
  });

  it("multiview off hides only the multiview extension", () => {
    const seen: string[] = [];
    const renderer = { extensions: { has: (name: string) => (seen.push(name), true) } };
    disableMultiview(renderer);
    expect(renderer.extensions.has("OCULUS_multiview")).toBe(false);
    expect(renderer.extensions.has("OVR_multiview2")).toBe(true);
    expect(seen).toEqual(["OVR_multiview2"]);
  });
});

describe("frame stats", () => {
  it("reports frame rate, slow frames and JS time over the window", () => {
    const s = new FrameStats(100);
    let t = 0;
    for (let i = 0; i <= 100; i++) {
      // Every tenth frame takes twice as long.
      t += i % 10 === 0 ? 1000 / 45 : 1000 / 90;
      s.frame(t, i % 10 === 0 ? 4 : 1);
    }
    const r = s.summary();
    expect(r.frames).toBe(100);
    expect(r.fps).toBeGreaterThan(80);
    expect(r.fps).toBeLessThan(83);
    expect(r.frameP95).toBeCloseTo(1000 / 45, 3);
    expect(r.jsAvg).toBeCloseTo(1.3, 6);
    expect(r.jsP95).toBe(4);
  });

  it("keeps only the newest frames", () => {
    const s = new FrameStats(10);
    let t = 0;
    for (let i = 0; i <= 50; i++) {
      t += i < 40 ? 20 : 10;
      s.frame(t, 0);
    }
    expect(s.summary().frames).toBe(10);
    expect(s.summary().fps).toBeCloseTo(100, 6);
  });
});

describe("start box switch", () => {
  it("reads ?box=N, a whole number from 1, and nothing else", () => {
    expect(startBox("")).toBeNull();
    expect(startBox("?perf=1")).toBeNull();
    expect(startBox("?box=5")).toBe(5);
    expect(startBox("?perf=1&box=12")).toBe(12);
    for (const bad of ["?box", "?box=0", "?box=-2", "?box=1.5", "?box=five", "?box=05"]) expect(startBox(bad), bad).toBeNull();
  });
});

describe("hand recording switch", () => {
  it("reads seconds from the address, off unless named", () => {
    expect(recordSeconds("")).toBe(0);
    expect(recordSeconds("?perf=1")).toBe(0);
    expect(recordSeconds("?record")).toBe(60);
    expect(recordSeconds("?record=1")).toBe(60);
    expect(recordSeconds("?record=90")).toBe(90);
    expect(recordSeconds("?record=2")).toBe(5);
    expect(recordSeconds("?record=9999")).toBe(120);
    expect(recordSeconds("?record=120")).toBe(120);
    expect(recordSeconds("?record=0")).toBe(0);
    expect(recordSeconds("?record=soon")).toBe(0);
  });

  it("names files by local date and time", () => {
    expect(recordingName(new Date(2026, 10, 14, 9, 5, 7))).toBe("shadow-locks-hands-20261114-090507.json");
  });
});
