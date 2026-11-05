import { describe, expect, it } from "vitest";
import { type BoxSnapshot, defaultProfile, isSnapshot, migrate } from "../../src/core/profile";

const snap = (): BoxSnapshot => ({
  key: "box-3",
  lantern: [0.35, -0.3, 1.35],
  open: [0, 2],
  crystal: [{ lock: 1, z: 0.45 }],
  elapsedMs: 61_000,
  hints: 2,
  hintLevel: { 1: 2 },
});

describe("profile", () => {
  it("starts with the default settings and nothing in progress", () => {
    const p = defaultProfile();
    expect(p.settings).toEqual({
      warmth: true,
      boxSizeCm: 24,
      musicVol: 0.7,
      sfxVol: 0.9,
      reducedMotion: false,
      captions: true,
      dimming: true,
      handed: "right",
    });
    expect(p.inProgress).toBeNull();
  });

  it("starts fresh from anything that is not a version 1 profile", () => {
    for (const raw of [null, undefined, 3, "x", [], {}, { version: 2 }]) expect(migrate(raw)).toEqual(defaultProfile());
  });

  it("clamps and defaults each setting", () => {
    const p = migrate({ version: 1, settings: { boxSizeCm: 99, musicVol: -2, sfxVol: "loud", captions: false, handed: "left" } });
    expect(p.settings.boxSizeCm).toBe(30);
    expect(p.settings.musicVol).toBe(0);
    expect(p.settings.sfxVol).toBe(0.9);
    expect(p.settings.captions).toBe(false);
    expect(p.settings.handed).toBe("left");
    expect(migrate({ version: 1, settings: { boxSizeCm: 2, handed: "both" } }).settings).toMatchObject({ boxSizeCm: 18, handed: "right" });
  });

  it("keeps a real saved box through a JSON round trip", () => {
    const raw = JSON.parse(JSON.stringify({ version: 1, settings: {}, inProgress: snap() }));
    expect(migrate(raw).inProgress).toEqual(JSON.parse(JSON.stringify(snap())));
  });

  it("drops a saved box that is not the real shape (never half restored)", () => {
    expect(isSnapshot(snap())).toBe(true);
    const bad: unknown[] = [
      { ...snap(), key: "" },
      { ...snap(), lantern: [0, 0] },
      { ...snap(), lantern: [0, Number.NaN, 1] },
      { ...snap(), open: [-1] },
      { ...snap(), crystal: [{ lock: 0 }] },
      { ...snap(), elapsedMs: -5 },
      { ...snap(), hints: 1.5 },
      { ...snap(), hintLevel: { a: 1 } },
      { phase: "playing", index: 2 },
    ];
    for (const b of bad) {
      expect(isSnapshot(b), JSON.stringify(b)).toBe(false);
      expect(migrate({ version: 1, inProgress: b }).inProgress).toBeNull();
    }
  });
});
