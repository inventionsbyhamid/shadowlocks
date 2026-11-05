import { describe, expect, it } from "vitest";
import { DIAL_TICKS_CM } from "../../src/feel/constants";
import {
  BPM,
  EIGHTH_MS,
  KEY,
  LOCK_OPEN_MS,
  MUSIC_BOX_NOTES,
  dialTickPitch,
  humSemitones,
  midiOf,
  noteFor,
  pitchClassesOf,
  scheduleBoxOpen,
  scheduleLockOpen,
  tuneFor,
} from "../../src/audio/music-box";
import { BASE_SFX_IDS, DERIVED_SFX_IDS } from "../../src/audio/manifest";

const pc = (id: string) => midiOf(id) % 12;

describe("the key", () => {
  it("is G major at 72 BPM, and an eighth note is 417 ms", () => {
    expect(KEY).toBe("G major");
    expect(BPM).toBe(72);
    expect(EIGHTH_MS).toBeCloseTo(416.667, 2);
  });

  it("the music box plays two octaves of G major, G4 to G6, every note a sound in the pack", () => {
    expect(MUSIC_BOX_NOTES).toHaveLength(15);
    expect(MUSIC_BOX_NOTES[0]).toBe("mb_g4");
    expect(MUSIC_BOX_NOTES[14]).toBe("mb_g6");
    const g = pitchClassesOf(KEY);
    for (const n of MUSIC_BOX_NOTES) {
      expect(g, n).toContain(pc(n));
      expect([...BASE_SFX_IDS, ...DERIVED_SFX_IDS] as string[], n).toContain(n);
    }
    // Rising, one scale step at a time.
    for (let i = 1; i < MUSIC_BOX_NOTES.length; i++) expect(midiOf(MUSIC_BOX_NOTES[i]!)).toBeGreaterThan(midiOf(MUSIC_BOX_NOTES[i - 1]!));
  });
});

describe("noteFor", () => {
  it("locks 0, 1 and 2 play the root, third and fifth of the box chord: G5, B5, D6", () => {
    expect([0, 1, 2].map((i) => noteFor(i, KEY))).toEqual(["mb_g5", "mb_b5", "mb_d6"]);
  });

  it("stays in the scale for any lock, in G major and in other keys", () => {
    for (const key of [KEY, "C major", "D major", "F major", "Bb major", "E minor", "A minor"]) {
      const scale = pitchClassesOf(key);
      for (let lock = 0; lock < 6; lock++) expect(scale, `${key} lock ${lock}`).toContain(pc(noteFor(lock, key)));
    }
    expect(noteFor(0, "C major")).toBe("mb_c5");
    expect(noteFor(1, "E minor")).toBe("mb_g5");
  });

  it("refuses a key it cannot read", () => {
    expect(() => noteFor(0, "H dorian")).toThrow();
  });

  it("each lock hums its note an octave down from the one lock_hum loop on G4: 0, +4, +7 semitones", () => {
    expect([0, 1, 2].map((i) => humSemitones(i))).toEqual([0, 4, 7]);
  });
});

describe("tuneFor", () => {
  const seeds = Array.from({ length: 200 }, (_, i) => `box-${i}`);

  it("is the same tune for the same seed", () => {
    for (const s of seeds.slice(0, 20)) expect(tuneFor(s)).toEqual(tuneFor(s));
  });

  it("has 6 to 8 notes from the scale between G4 and G6 and ends on the root, G5", () => {
    const lengths = new Set<number>();
    for (const s of seeds) {
      const t = tuneFor(s);
      lengths.add(t.length);
      expect(t.length, s).toBeGreaterThanOrEqual(6);
      expect(t.length, s).toBeLessThanOrEqual(8);
      for (const n of t) expect(MUSIC_BOX_NOTES as readonly string[], s).toContain(n);
      expect(t.at(-1), s).toBe("mb_g5");
    }
    expect([...lengths].sort()).toEqual([6, 7, 8]);
  });

  it("is mostly pentatonic (G A B D E) and moves in small steps", () => {
    const penta = new Set([7, 9, 11, 2, 4]);
    let notes = 0;
    let inPenta = 0;
    for (const s of seeds) {
      const t = tuneFor(s);
      for (let i = 0; i < t.length; i++) {
        notes++;
        if (penta.has(pc(t[i]!))) inPenta++;
        if (i > 0) expect(Math.abs(MUSIC_BOX_NOTES.indexOf(t[i]!) - MUSIC_BOX_NOTES.indexOf(t[i - 1]!)), s).toBeLessThanOrEqual(4);
      }
    }
    expect(inPenta / notes).toBeGreaterThan(0.8);
  });

  it("gives different boxes different tunes", () => {
    expect(new Set(seeds.map((s) => tuneFor(s).join(" "))).size).toBeGreaterThan(150);
  });
});

describe("scheduleLockOpen", () => {
  it("is the glass tick at 0 ms, the brass clunk at +120 ms and the lock's note at +200 ms", () => {
    expect(LOCK_OPEN_MS).toEqual({ tick: 0, clunk: 120, note: 200 });
    expect(scheduleLockOpen(1, 1000)).toEqual([
      { id: "glass_tick", atMs: 1000 },
      { id: "brass_clunk", atMs: 1120 },
      { id: "mb_b5", atMs: 1200 },
    ]);
    expect(scheduleLockOpen(2, 0).map((c) => c.id)).toEqual(["glass_tick", "brass_clunk", "mb_d6"]);
  });
});

describe("scheduleBoxOpen", () => {
  const s = scheduleBoxOpen("box-7", 0);
  const at = (id: string) => s.filter((c) => c.id === id).map((c) => c.atMs);

  it("rolls the chord G4 B4 D5 G5 from +500 ms, 80 ms apart, then the walls at +700 and the drawer at +1300", () => {
    expect(s.filter((c) => c.id.startsWith("mb_") && c.atMs < 1700)).toEqual([
      { id: "mb_g4", atMs: 500 },
      { id: "mb_b4", atMs: 580 },
      { id: "mb_d5", atMs: 660 },
      { id: "mb_g5", atMs: 740 },
    ]);
    expect(at("walls_hinge")).toEqual([700]);
    expect(at("drawer_slide")).toEqual([1300]);
  });

  it("then plays the box's tune in eighth notes from +1700 ms, in time order", () => {
    const tune = tuneFor("box-7");
    const notes = s.filter((c) => c.atMs >= 1700);
    expect(notes.map((c) => c.id)).toEqual(tune);
    notes.forEach((c, i) => expect(c.atMs).toBeCloseTo(1700 + i * EIGHTH_MS, 6));
    for (let i = 1; i < s.length; i++) expect(s[i]!.atMs).toBeGreaterThanOrEqual(s[i - 1]!.atMs);
  });
});

describe("dial ticks", () => {
  it("climb G A B D over the last 4, 3, 2 and 1 cm", () => {
    expect(DIAL_TICKS_CM.map(dialTickPitch)).toEqual([0, 2, 4, 7]);
    expect(dialTickPitch(9)).toBe(0);
  });
});
