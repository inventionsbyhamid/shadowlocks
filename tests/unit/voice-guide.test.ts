// The voice guide's rules (voice-guide.ts) on a fake voice output and fake clips, on its own play clock: it says the
// line the chip shows, the first time it shows (idle lines may come back, at most twice a step), one line at a time,
// never in a quiet window, never when the Voice guide is off, the language shown has no voice or the clip is missing;
// a hidden app stops the line and says it again when seen; a line shown before audio starts waits for it (10 s at most).
import { describe, expect, it, vi } from "vitest";
import {
  BACK_AFTER_MS,
  IDLE_AFTER_MS,
  NEXT_GAP_MS,
  OFF_FADE_MS,
  READY_WAIT_MS,
  SAID_KEPT,
  STALE_FADE_MS,
  UNLOCK_HOLD_MS,
  type VoiceClips,
  VoiceGuide,
  type VoiceWhy,
} from "../../src/app/voice-guide";
import { COPY } from "../../src/ui/copy";

const C = COPY.lessons;
const buf = (key: string) => ({ key, duration: 3 }) as unknown as AudioBuffer;

function rig(o: { missing?: string[]; undecoded?: string[]; lang?: string } = {}) {
  let t = 0;
  const plays: { key: string; at: number }[] = [];
  const hushes: { fade: number; at: number; hold: boolean }[] = [];
  let ended: (() => void) | null = null;
  const out = {
    running: true,
    say: vi.fn((b: AudioBuffer, done: () => void) => {
      plays.push({ key: (b as unknown as { key: string }).key, at: t });
      ended = done;
    }),
    hush: vi.fn((fade: number, hold = false) => hushes.push({ fade, at: t, hold })),
    release: vi.fn(),
  };
  const undecoded = new Set(o.undecoded ?? []);
  const clips: VoiceClips = {
    known: (k) => !(o.missing ?? []).includes(k),
    has: (k) => !(o.missing ?? []).includes(k),
    ms: (k) => ((o.missing ?? []).includes(k) ? 0 : 3000),
    buffer: (k) => (undecoded.has(k) || (o.missing ?? []).includes(k) ? null : buf(k)),
    want: vi.fn(),
  };
  const env = { on: true, lang: o.lang ?? "en" };
  const warn = vi.fn();
  const g = new VoiceGuide({ out, now: () => t, enabled: () => env.on, lang: () => env.lang, warn });
  g.setClips(clips);
  /** What the chip shows, as Lessons hands it over every frame. */
  const chip = { line: null as string | null, why: null as VoiceWhy | null, again: false, shows: 0, scope: 0, visible: true };
  const show = (line: string | null, why: VoiceWhy | null = "step", again = false) => {
    chip.line = line;
    chip.why = why;
    chip.again = again;
    chip.shows++;
  };
  const run = (ms: number) => {
    for (const end = t + ms; t < end; ) {
      t += 16;
      g.update(chip.line, chip.why, chip.again, chip.shows, chip.scope, chip.visible);
    }
  };
  /** The line playing ends by itself. */
  const finish = () => {
    const e = ended;
    ended = null;
    e?.();
  };
  return { g, out, clips, plays, hushes, env, chip, show, run, finish, warn, undecoded, now: () => t };
}

describe("VoiceGuide", () => {
  it("says a line the first time it shows, and not when it comes back to the chip", () => {
    const r = rig();
    r.show(C.goal);
    r.run(32);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.goal"]);
    r.finish();
    r.run(IDLE_AFTER_MS + 100);
    r.show(C.moveIdle, "idle");
    r.run(32);
    r.finish();
    // The goal back once the player gets warmer: shown again, not said again.
    r.show(C.goal, "step", true);
    r.run(2000);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.goal", "lessons.moveIdle"]);
    expect(r.g.said).toEqual(["lessons.goal", "lessons.moveIdle"]);
  });

  it("says one line at a time: a stale line fades out, the new one follows after a short gap", () => {
    const r = rig();
    r.show(C.watchRings, "example");
    r.run(32);
    // The chip moves on while the line is still playing (the player did what it asked, or the step moved on).
    r.show(C.lineUp, "example");
    r.run(16);
    expect(r.hushes.at(-1)!.fade).toBe(STALE_FADE_MS);
    const changed = r.now();
    r.run(STALE_FADE_MS + NEXT_GAP_MS + 32);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.watchRings", "lessons.lineUp"]);
    expect(r.plays[1]!.at - changed).toBeGreaterThanOrEqual(STALE_FADE_MS + NEXT_GAP_MS - 16);
    // A blank chip (a menu up) stops the line too.
    r.show(null, null);
    r.run(16);
    expect(r.hushes.length).toBe(2);
  });

  it("keeps the dips down when a cut line has another queued to follow, and lets them up when none does", () => {
    const r = rig();
    r.show(C.watchRings, "example");
    r.run(32);
    r.show(C.lineUp, "example");
    r.run(16);
    expect(r.hushes.at(-1)!.hold).toBe(true);
    r.run(STALE_FADE_MS + NEXT_GAP_MS + 32);
    expect(r.plays.length).toBe(2);
    // A blank chip: nothing follows.
    r.show(null, null);
    r.run(16);
    expect(r.hushes.at(-1)!.hold).toBe(false);
    // A line coming back (not said again) follows nothing either.
    r.show(C.goal);
    r.run(32);
    r.show(C.goal, "step", true);
    r.show(C.pickUp, "step", true);
    r.run(16);
    expect(r.hushes.at(-1)!.hold).toBe(false);
    // A follower dropped before it starts (the chip moved on again inside a quiet window) lets the dips up.
    r.show(C.watch, "example");
    r.run(32);
    r.g.quiet(800);
    r.show(C.watchNearFar, "example");
    r.run(16);
    expect(r.hushes.at(-1)!.hold).toBe(true);
    const released = r.out.release.mock.calls.length;
    r.show(null, null);
    r.run(16);
    expect(r.out.release.mock.calls.length).toBe(released + 1);
  });

  it("says an idle line on its first showing and when it comes back, at most twice a step; never over a line or right after one", () => {
    const r = rig();
    r.show(C.goal);
    r.run(32);
    // A nudge while the goal still plays: it never interrupts (the goal stops: the chip moved on).
    r.show(C.moveIdle, "idle");
    r.run(1000);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.goal"]);
    r.finish();
    // A nudge within 6 s of a line ending is dropped too.
    // (The goal ended as the first nudge took the chip, about 1 s ago.)
    r.show(C.goal, "step", true);
    r.run(IDLE_AFTER_MS - 2500);
    r.show(C.moveIdle, "idle", true);
    r.run(500);
    expect(r.plays.length).toBe(1);
    // Later on, the nudge comes back twice and is said each time; a third time it is not.
    for (let i = 0; i < 3; i++) {
      r.show(C.goal, "step", true);
      r.run(IDLE_AFTER_MS + 100);
      r.show(C.moveIdle, "idle", true);
      r.run(100);
      r.finish();
      r.run(IDLE_AFTER_MS + 100);
    }
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.goal", "lessons.moveIdle", "lessons.moveIdle"]);
    // A new step starts the count over.
    r.chip.scope++;
    r.show(C.moveIdle, "idle", true);
    r.run(100);
    expect(r.plays.length).toBe(4);
  });

  it("waits out a quiet window (a lock's layers, the box's tune) if the line is still the chip's", () => {
    const r = rig();
    r.g.quiet(800);
    r.show(C.lockOpen, "win");
    r.run(700);
    expect(r.plays).toEqual([]);
    r.run(200);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.lockOpen"]);
    expect(r.plays[0]!.at).toBeGreaterThanOrEqual(800);
    // A line whose chip moves on during the window is never said.
    r.finish();
    r.g.quiet(1500);
    r.show(C.watchNearFar, "example");
    r.run(500);
    r.show(null, null);
    r.run(2000);
    expect(r.plays.length).toBe(1);
  });

  it("plays nothing with the Voice guide off, and fades a line out the moment it is switched off", () => {
    const r = rig();
    r.env.on = false;
    r.show(C.pickUp);
    r.run(500);
    expect(r.plays).toEqual([]);
    expect(r.g.ms("lessons.pickUp")).toBe(0);
    r.env.on = true;
    expect(r.g.ms("lessons.pickUp")).toBe(3000);
    r.show(C.goal);
    r.run(32);
    expect(r.plays.length).toBe(1);
    r.env.on = false;
    r.g.settingsChanged();
    expect(r.hushes.at(-1)!.fade).toBe(OFF_FADE_MS);
    r.show(C.moveIdle, "idle");
    r.run(500);
    expect(r.plays.length).toBe(1);
  });

  it("is text only for a line with no clip (warned once) and in a language with no voice", () => {
    const r = rig({ missing: ["lessons.goal"] });
    r.show(C.goal);
    r.run(500);
    r.show(C.pickUp);
    r.run(100);
    r.show(C.goal);
    r.run(500);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.pickUp"]);
    expect(r.g.ms("lessons.goal")).toBe(0);
    expect(r.warn).toHaveBeenCalledTimes(1);
    const de = rig({ lang: "de" });
    de.show(C.goal);
    de.run(500);
    expect(de.plays).toEqual([]);
    expect(de.g.ms("lessons.goal")).toBe(0);
    // No pack at all: text only.
    const none = rig();
    none.g.setClips(null);
    none.show(C.goal);
    none.run(500);
    expect(none.plays).toEqual([]);
    expect(none.g.ms("lessons.goal")).toBe(0);
  });

  it("waits for a clip still decoding, up to 1.5 s, then leaves the line as text", () => {
    const r = rig({ undecoded: ["lessons.goal", "lessons.watch"] });
    r.show(C.goal);
    r.run(500);
    expect(r.plays).toEqual([]);
    expect(r.clips.want).toHaveBeenCalled();
    r.undecoded.delete("lessons.goal");
    r.run(200);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.goal"]);
    r.finish();
    r.show(C.watch, "example");
    r.run(READY_WAIT_MS + 100);
    r.undecoded.delete("lessons.watch");
    r.run(500);
    expect(r.plays.length).toBe(1);
  });

  it("stops the line while the app is hidden, and says it again from the start a second after it is seen", () => {
    const r = rig();
    r.show(C.goal);
    r.run(500);
    r.chip.visible = false;
    r.run(16);
    expect(r.hushes.at(-1)!.fade).toBe(0);
    r.run(5000);
    r.chip.visible = true;
    r.run(BACK_AFTER_MS - 100);
    expect(r.plays.length).toBe(1);
    r.run(200);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.goal", "lessons.goal"]);
    // A line that had ended is not said again.
    r.finish();
    r.chip.visible = false;
    r.run(100);
    r.chip.visible = true;
    r.run(2000);
    expect(r.plays.length).toBe(2);
  });

  it("holds a line shown before audio starts and says it at the first pinch, if still shown and under 10 s old", () => {
    const r = rig();
    r.out.running = false;
    r.show(C.pickUp);
    r.run(3000);
    expect(r.plays).toEqual([]);
    r.out.running = true;
    r.run(300);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.pickUp"]);
    r.finish();
    // Too late: a line held more than 10 s is dropped.
    r.out.running = false;
    r.show(C.goal);
    r.run(UNLOCK_HOLD_MS + 500);
    r.out.running = true;
    r.run(1000);
    expect(r.plays.length).toBe(1);
  });

  it("keeps only the latest lines in its record of what was said", () => {
    const r = rig();
    for (let i = 0; i < SAID_KEPT + 20; i++) {
      r.show(i % 2 ? C.goal : C.pickUp);
      r.run(STALE_FADE_MS + NEXT_GAP_MS + 32);
    }
    expect(r.plays.length).toBe(SAID_KEPT + 20);
    expect(r.g.said.length).toBe(SAID_KEPT);
    expect(r.g.said.at(-1)).toBe(r.plays.at(-1)!.key);
  });

  it("says a tip once a box, and decodes only what a step needs", () => {
    const r = rig();
    r.show(C.tips.decoys, "tip");
    r.run(32);
    r.finish();
    r.show(null, null);
    r.run(100);
    r.show(C.tips.decoys, "tip", true);
    r.run(500);
    expect(r.plays.map((p) => p.key)).toEqual(["lessons.tips.decoys"]);
    r.g.prepare(["lessons.goal", "lessons.moveIdle"]);
    expect(r.clips.want).toHaveBeenLastCalledWith(["lessons.goal", "lessons.moveIdle"]);
  });
});
