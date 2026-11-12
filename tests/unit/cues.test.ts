import { describe, expect, it } from "vitest";
import { FrameClock } from "../../src/app/frame-clock";
import { HAPTICS, Haptics, type HapticSession } from "../../src/app/haptics";
import { CueMapper, GameSounds, HINT_GLOW_GAIN, type Cue, type SoundPlaces } from "../../src/audio/cues";
import type { LoopHandle, LoopOptions, PlayOptions } from "../../src/audio/engine";
import { HUM_FADE_MS, HUM_STEP, humsOn } from "../../src/audio/hums";
import type { MusicState, SfxId } from "../../src/audio/manifest";
import { EIGHTH_MS, scheduleBoxOpen, TUNE_DUCK_DB, tuneFor } from "../../src/audio/music-box";
import { DIRECT_MS, LOOKAHEAD_MS } from "../../src/audio/scheduler";
import type { BoxSpec, Vec3 } from "../../src/core/types";
import { MAX_STEP_MS } from "../../src/feel/constants";

const FRAME = 1000 / 72;

/** A loop the fake engine hands out: records what the hums ask of it. */
class FakeLoop implements LoopHandle {
  gains: number[] = [];
  pitches: number[] = [];
  positions: Vec3[] = [];
  stoppedWith: number | null = null;
  constructor(
    readonly id: string,
    readonly o: LoopOptions,
  ) {}
  get playing(): boolean {
    return this.stoppedWith === null;
  }
  setGain(g: number): void {
    this.gains.push(g);
  }
  setPitch(s: number): void {
    this.pitches.push(s);
  }
  setPosition(p: Vec3): void {
    this.positions.push([p[0], p[1], p[2]]);
  }
  stop(fadeMs = 0): void {
    this.stoppedWith = fadeMs;
  }
}

interface Played {
  id: string;
  at: number;
  delayMs: number;
  start: number;
  position?: Vec3;
  pitch?: number;
  gain?: number;
  duckDb?: number;
}

/** Records what the game asks of the audio engine, on a clock the test moves. */
class FakeEngine {
  t = 0;
  played: Played[] = [];
  loops: FakeLoop[] = [];
  music: MusicState[] = [];
  ready = true;
  play(id: SfxId, o: PlayOptions = {}) {
    const delayMs = (o.delay ?? 0) * 1000;
    this.played.push({
      id,
      at: this.t,
      delayMs,
      start: this.t + delayMs,
      ...(o.position ? { position: [o.position[0], o.position[1], o.position[2]] as Vec3 } : {}),
      ...(o.pitch !== undefined ? { pitch: o.pitch } : {}),
      ...(o.gain !== undefined ? { gain: o.gain } : {}),
      ...(o.duckDb !== undefined ? { duckDb: o.duckDb } : {}),
    });
    return { stop() {} };
  }
  sting() {}
  setMusic(s: MusicState) {
    this.music.push(s);
  }
  canLoop(): boolean {
    return this.ready;
  }
  loop(id: SfxId, o: LoopOptions = {}): LoopHandle | null {
    if (!this.ready) return null;
    const l = new FakeLoop(id, o);
    this.loops.push(l);
    return l;
  }
  ids(): string[] {
    return this.played.map((p) => p.id);
  }
}

const LOCKS: Vec3[] = [
  [-0.05, 1.0, -1.9],
  [0, 1.05, -1.9],
  [0.05, 1.0, -1.9],
];
const places: SoundPlaces = {
  lock: (i, out) => {
    const p = LOCKS[i];
    if (!p) return false;
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    return true;
  },
  mark: (i, out) => places.lock(i, out),
  lantern: (out) => {
    out[0] = 0;
    out[1] = 1.02;
    out[2] = -1.75;
    return true;
  },
  box: (out) => {
    out[0] = 0;
    out[1] = 1.0;
    out[2] = -1.8;
    return true;
  },
};

function setup(o: { warmth?: boolean; session?: HapticSession | null; places?: SoundPlaces } = {}) {
  const engine = new FakeEngine();
  const pulses: { hand: string; v: number; ms: number; t: number }[] = [];
  const pad = (hand: string) => ({ handedness: hand, gamepad: { hapticActuators: [{ pulse: (v: number, ms: number) => pulses.push({ hand, v, ms, t: engine.t }) }] } });
  const session: HapticSession | null = o.session === undefined ? { inputSources: [pad("left"), pad("right")] } : o.session;
  const haptics = new Haptics(() => session, () => engine.t);
  let warmthOn = o.warmth ?? true;
  const game = new GameSounds({ engine, now: () => engine.t, haptics, warmth: () => warmthOn, places: o.places ?? places });
  const run = (ms: number) => {
    const end = engine.t + ms;
    while (engine.t < end - 1e-9) {
      engine.t = Math.min(end, engine.t + FRAME);
      game.update();
    }
  };
  return { engine, game, pulses, run, setWarmth: (v: boolean) => (warmthOn = v) };
}

const box = (n: number): BoxSpec => ({ kind: "box", n });

describe("a lock opening", () => {
  it("plays the glass tick at once, the brass clunk at +120 ms and the lock's note at +200 ms, at the lock", () => {
    const { engine, game, run } = setup();
    engine.t = 1000;
    game.boxStart(box(1));
    game.lockOpened(0);
    run(400);
    const layers = engine.played.filter((p) => ["glass_tick", "brass_clunk", "mb_g5"].includes(p.id));
    expect(layers.map((p) => p.id)).toEqual(["glass_tick", "brass_clunk", "mb_g5"]);
    [0, 120, 200].forEach((ms, i) => expect(layers[i]!.start - 1000).toBeCloseTo(ms, 6));
    for (const p of layers) {
      expect(p.position).toEqual(LOCKS[0]);
      // All three go to the engine at once and start exactly on the audio clock.
      expect(p.at).toBe(1000);
      expect(p.delayMs).toBeLessThanOrEqual(DIRECT_MS);
    }
  });

  it("each lock plays its own chord tone", () => {
    const { engine, game, run } = setup();
    game.boxStart(box(1));
    for (const lock of [1, 2]) game.lockOpened(lock);
    run(400);
    expect(engine.ids().filter((id) => id.startsWith("mb_"))).toEqual(["mb_b5", "mb_d6"]);
  });

  it("an explicit position wins over the lock's", () => {
    const { engine, game, run } = setup();
    game.lockOpened(1, [1, 2, 3]);
    run(300);
    expect(engine.played.map((p) => p.position)).toEqual([[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
  });

  it("fades that lock's hum out over 150 ms and it does not hum again", () => {
    const { engine, game } = setup();
    game.boxStart(box(2));
    game.warmth(0, 0.8);
    const hum = engine.loops[0]!;
    game.lockOpened(0);
    expect(hum.stoppedWith).toBe(HUM_FADE_MS);
    game.warmth(0, 1);
    expect(engine.loops).toHaveLength(1);
  });

  it("thuds the holding hand with the clunk (1.0 for 60 ms at +120 ms)", () => {
    const { engine, game, pulses, run } = setup();
    game.grab("left");
    pulses.length = 0;
    engine.t = 500;
    game.lockOpened(2);
    run(300);
    expect(pulses.map((p) => [p.hand, p.v, p.ms])).toEqual([["left", 1, 60]]);
    // On the first frame at or after +120 ms.
    expect(pulses[0]!.t).toBeGreaterThanOrEqual(620);
    expect(pulses[0]!.t).toBeLessThan(620 + FRAME);
  });
});

describe("the box opening", () => {
  it("plays the chord, the walls, the drawer and the box's tune on time, never far ahead", () => {
    const { engine, game, run } = setup();
    engine.t = 2000;
    game.boxOpened("box-7");
    run(7000);
    const want = scheduleBoxOpen("box-7", 2000);
    expect(engine.played.map((p) => p.id)).toEqual(want.map((c) => c.id));
    engine.played.forEach((p, i) => {
      expect(p.start).toBeCloseTo(want[i]!.atMs, 6);
      expect(p.delayMs).toBeLessThanOrEqual(LOOKAHEAD_MS);
    });
    // The tune runs in eighth notes at 72 BPM.
    const tune = engine.played.filter((p) => p.start >= 2000 + 1700);
    expect(tune[1]!.start - tune[0]!.start).toBeCloseTo(EIGHTH_MS, 6);
  });

  it("asks the music to dip 4 dB under every note of the box's tune, and under nothing else of the opening", () => {
    const { engine, game, run } = setup();
    game.boxOpened("box-7");
    run(7000);
    const ducked = engine.played.filter((p) => p.duckDb !== undefined);
    expect(ducked.map((p) => p.id)).toEqual(tuneFor("box-7"));
    expect(ducked.every((p) => p.duckDb === TUNE_DUCK_DB && p.start >= 1700 - 1e-6)).toBe(true);
    expect(TUNE_DUCK_DB).toBe(4);
    // The same cues when the mapper's are applied at once (the bus path): the tune's carry the dip.
    const cues = new CueMapper().map([{ type: "box-open", key: "box-7" }]) as Extract<Cue, { kind: "sfx" }>[];
    expect(cues.filter((c) => c.duckDb === TUNE_DUCK_DB).map((c) => c.delayMs)).toEqual(
      scheduleBoxOpen("box-7", 0)
        .filter((s) => s.atMs >= 1700)
        .map((s) => s.atMs),
    );
  });

  it("rolls six pulses from 0.2 to 0.8 over 600 ms on both hands", () => {
    const { game, pulses, run } = setup();
    game.boxOpened("box-1");
    run(2000);
    const right = pulses.filter((p) => p.hand === "right");
    expect(right.map((p) => p.v)).toEqual(HAPTICS.boxOpen.map((p) => p.intensity));
    expect(Math.abs(right.at(-1)!.t - right[0]!.t - 600)).toBeLessThan(FRAME);
    expect(pulses.filter((p) => p.hand === "left")).toHaveLength(6);
  });

  it("hidden half way, it picks up where it was: the late notes never all fire on one frame", () => {
    const engine = new FakeEngine();
    const clock = new FrameClock();
    const game = new GameSounds({ engine, now: clock.now });
    const frame = (dtSec: number, visible = true): number => {
      const before = engine.played.length;
      clock.step(dtSec, visible);
      engine.t = clock.now();
      game.update();
      return engine.played.length - before;
    };
    game.boxOpened("box-7");
    // 2.2 s: the chord, walls, drawer and the tune's first notes.
    for (let i = 0; i < 158; i++) frame(1 / 72);
    const heard = engine.played.length;
    expect(heard).toBeGreaterThan(7);
    const tune = tuneFor("box-7");
    expect(heard).toBeLessThan(6 + tune.length);
    // 10 s with the headset off: frames may still come (system menu), none of them count...
    for (let i = 0; i < 720; i++) expect(frame(1 / 72, false)).toBe(0);
    // ...and the first frame back, 10 s after the last, counts as one capped step.
    const perFrame = [frame(10)];
    for (let i = 0; i < 400; i++) perFrame.push(frame(1 / 72));
    expect(engine.played).toHaveLength(scheduleBoxOpen("box-7", 0).length);
    expect(Math.max(...perFrame)).toBeLessThanOrEqual(1);
    // The rest of the tune keeps its eighth notes.
    const rest = engine.played.slice(heard);
    for (let i = 1; i < rest.length; i++) expect(rest[i]!.start - rest[i - 1]!.start).toBeCloseTo(EIGHTH_MS, 6);
  });

  it("leaving the box drops what is still to come", () => {
    const { engine, game, run } = setup();
    game.boxOpened("box-3");
    run(600);
    const before = engine.played.length;
    game.reset();
    run(6000);
    expect(engine.played.length).toBe(before);
  });
});

describe("hums", () => {
  it("are on for lessons and boxes 1 to 5 when warmth is on, and off by default from box 6", () => {
    expect(humsOn({ kind: "lesson", id: "l1" }, true)).toBe(true);
    for (let n = 1; n <= 5; n++) expect(humsOn(box(n), true), `box ${n}`).toBe(true);
    for (const n of [6, 7, 40]) expect(humsOn(box(n), true), `box ${n}`).toBe(false);
    expect(humsOn({ kind: "daily", day: "2026-11-06" }, true)).toBe(false);
    expect(humsOn(box(1), false)).toBe(false);
    expect(humsOn(null, true)).toBe(false);
  });

  it("box 6 makes no hum however warm a lock gets", () => {
    const { engine, game } = setup();
    game.boxStart(box(6));
    game.warmth(0, 1);
    game.warmth(1, 0.7);
    expect(engine.loops).toHaveLength(0);
  });

  it("one looped lock_hum per lock, pitched to its note an octave down, gain = warmth", () => {
    const { engine, game } = setup();
    game.boxStart(box(3));
    game.warmth(0, 0.4);
    game.warmth(1, 0.5);
    game.warmth(2, 0.6);
    expect(engine.loops.map((l) => [l.id, l.o.pitch])).toEqual([
      ["lock_hum", 0],
      ["lock_hum", 4],
      ["lock_hum", 7],
    ]);
    expect(engine.loops.map((l) => l.o.position)).toEqual(LOCKS);
    expect(engine.loops.map((l) => l.gains.at(-1))).toEqual([0.4, 0.5, 0.6]);
  });

  it("change gain only past a small step, and ramp to zero keeping the loop for when it warms again", () => {
    const { engine, game } = setup();
    game.boxStart(box(1));
    game.warmth(1, 0.5);
    const hum = engine.loops[0]!;
    game.warmth(1, 0.5 + HUM_STEP / 2);
    game.warmth(1, 0.5 - HUM_STEP / 2);
    expect(hum.gains).toEqual([0.5]);
    game.warmth(1, 0.6);
    expect(hum.gains).toEqual([0.5, 0.6]);
    game.warmth(1, 1.4);
    expect(hum.gains.at(-1)).toBe(1);
    game.warmth(1, 0);
    expect(hum.gains.at(-1)).toBe(0);
    expect(hum.playing).toBe(true);
    game.warmth(1, 0);
    game.warmth(1, 0.4);
    expect(engine.loops).toHaveLength(1);
    expect(hum.gains).toEqual([0.5, 0.6, 1, 0, 0.4]);
  });

  it("only the focused lock hums; a focus switch ramps levels, never rebuilds a hum", () => {
    const { engine, game } = setup();
    game.boxStart(box(1));
    game.focus(2);
    game.warmth(0, 0.9);
    expect(engine.loops).toHaveLength(0);
    game.warmth(2, 0.3);
    expect(engine.loops.map((l) => l.o.pitch)).toEqual([7]);
    game.focus(0);
    const [two, zero] = engine.loops;
    expect(two!.gains.at(-1)).toBe(0);
    expect(zero!.o.pitch).toBe(0);
    expect(zero!.gains.at(-1)).toBe(0.9);
    game.focus(2);
    game.focus(null);
    expect(engine.loops).toHaveLength(2);
    expect(two!.gains).toEqual([0.3, 0, 0.3]);
    expect(zero!.gains).toEqual([0.9, 0, 0.9]);
    expect(engine.loops.every((l) => l.playing)).toBe(true);
  });

  it("follow their lock when the box moves mid-hum, without restarting", () => {
    const where: Vec3[] = LOCKS.map((p) => [p[0], p[1], p[2]]);
    const moving: SoundPlaces = {
      ...places,
      lock: (i, out) => {
        const p = where[i];
        if (!p) return false;
        out[0] = p[0];
        out[1] = p[1];
        out[2] = p[2];
        return true;
      },
    };
    const { engine, game } = setup({ places: moving });
    game.boxStart(box(1));
    game.warmth(0, 0.6);
    const hum = engine.loops[0]!;
    game.update();
    expect(hum.positions).toEqual([]);
    // Recentered 5 cm to the left.
    where[0] = [LOCKS[0]![0] - 0.05, LOCKS[0]![1], LOCKS[0]![2]];
    game.update();
    expect(hum.positions).toEqual([where[0]]);
    game.update();
    expect(hum.positions).toHaveLength(1);
    expect(engine.loops).toHaveLength(1);
  });

  it("go quiet when warmth is turned off mid-box, and come back when it is on", () => {
    const { engine, game, setWarmth } = setup();
    game.boxStart(box(1));
    game.warmth(0, 0.7);
    setWarmth(false);
    game.settingsChanged();
    expect(engine.loops[0]!.playing).toBe(false);
    game.warmth(0, 0.7);
    expect(engine.loops).toHaveLength(1);
    setWarmth(true);
    game.settingsChanged();
    game.warmth(0, 0.7);
    expect(engine.loops).toHaveLength(2);
  });

  it("start once audio runs, if a lock was already warm before", () => {
    const { engine, game } = setup();
    engine.ready = false;
    game.boxStart(box(1));
    game.warmth(0, 0.5);
    expect(engine.loops).toHaveLength(0);
    engine.ready = true;
    game.warmth(0, 0.5);
    expect(engine.loops).toHaveLength(1);
  });

  it("the fingertip hum follows the finger: 0.3 + 0.7 x progress, rising 2 semitones over the hold", () => {
    const { engine, game } = setup();
    game.boxStart(box(9));
    game.finger(0, 0, [0, 1, -1.8]);
    const hum = engine.loops[0]!;
    expect(hum.id).toBe("fingertip_hum");
    expect(hum.o.position).toEqual([0, 1, -1.8]);
    expect(hum.gains.at(-1)).toBeCloseTo(0.3, 9);
    game.finger(1, 0.5, [0, 1, -1.79]);
    expect(hum.gains.at(-1)).toBeCloseTo(1, 9);
    expect(hum.pitches.at(-1)).toBeCloseTo(1, 9);
    expect(hum.positions).toEqual([[0, 1, -1.79]]);
    game.finger(null);
    expect(hum.stoppedWith).toBe(HUM_FADE_MS);
  });

  it("both hums fade out over 150 ms as the piece crystallises, and the lock stays quiet after", () => {
    const { engine, game } = setup();
    game.boxStart(box(2));
    game.warmth(1, 0.7);
    game.finger(0.8, 1, [0, 1, -1.8]);
    const [lockHum, fingerHum] = engine.loops;
    game.crystallise(1);
    expect([lockHum!.stoppedWith, fingerHum!.stoppedWith]).toEqual([HUM_FADE_MS, HUM_FADE_MS]);
    game.warmth(1, 0.9);
    expect(engine.loops).toHaveLength(2);
    expect(engine.ids()).toEqual(["crystallise"]);
  });

  it("the fingertip hum stays off while the finger is still in the beam after the piece forms", () => {
    const { engine, game } = setup();
    game.boxStart(box(2));
    game.finger(0.8, 1, [0, 1, -1.8]);
    game.crystallise(0);
    // The session keeps reporting the finger, still in the beam: the ting rings out alone.
    for (let i = 0; i < 10; i++) game.finger(0.9, 1, [0, 1, -1.8]);
    expect(engine.loops).toHaveLength(1);
    // Once the finger leaves, a new finger in the beam hums again.
    game.finger(null);
    game.finger(0.2, 0, [0, 1, -1.8]);
    expect(engine.loops).toHaveLength(2);
    expect(engine.loops[1]!.id).toBe("fingertip_hum");
  });

  it("wait for audio before working out where a lock is", () => {
    let asked = 0;
    const counting: SoundPlaces = {
      ...places,
      lock: (i, out) => {
        asked++;
        return places.lock(i, out);
      },
    };
    const { engine, game } = setup({ places: counting });
    engine.ready = false;
    game.boxStart(box(1));
    for (let i = 0; i < 30; i++) game.warmth(0, 0.5);
    expect(asked).toBe(0);
    engine.ready = true;
    game.warmth(0, 0.5);
    expect(asked).toBe(1);
    expect(engine.loops).toHaveLength(1);
  });
});

describe("menus", () => {
  it("play the bed through the menu low-pass and hush the hums; back in the box they return", () => {
    const { engine, game } = setup();
    game.boxStart(box(1));
    game.warmth(0, 0.6);
    const hum = engine.loops[0]!;
    game.menuOpen(true);
    expect(engine.music.at(-1)).toBe("menu");
    expect(hum.gains.at(-1)).toBe(0);
    game.warmth(0, 0.6);
    expect(hum.gains.at(-1)).toBe(0);
    game.menuOpen(false);
    expect(engine.music.at(-1)).toBe("calm");
    expect(hum.gains).toEqual([0.6, 0, 0.6]);
    expect(engine.loops).toHaveLength(1);
  });
});

describe("the lantern and the rings", () => {
  it("dial ticks climb G A B D at the lantern and tick the holding hand", () => {
    const { engine, game, pulses } = setup();
    game.grab("right");
    pulses.length = 0;
    for (const cm of [4, 3, 2, 1]) {
      engine.t += 200;
      game.dialTick(cm);
    }
    expect(engine.played.map((p) => [p.id, p.pitch])).toEqual([
      ["dial_tick", 0],
      ["dial_tick", 2],
      ["dial_tick", 4],
      ["dial_tick", 7],
    ]);
    expect(engine.played[0]!.position).toEqual([0, 1.02, -1.75]);
    expect(pulses.map((p) => [p.hand, p.v, p.ms])).toEqual(Array(4).fill(["right", 0.15, 10]));
  });

  it("warmth off suppresses the dial ticks", () => {
    const { engine, game } = setup({ warmth: false });
    game.dialTick(2);
    expect(engine.played).toHaveLength(0);
  });

  it("a new box takes the lantern from the hand silently; the next release sounds again", () => {
    const { engine, game } = setup();
    game.handle({ type: "grab", hand: "right" });
    game.boxStart(box(2));
    game.muteRelease();
    game.handle({ type: "release", hand: "right" });
    expect(engine.ids()).toEqual(["lantern_pick"]);
    game.handle({ type: "grab", hand: "right" });
    game.handle({ type: "release", hand: "right" });
    expect(engine.ids()).toEqual(["lantern_pick", "lantern_pick", "lantern_set"]);
    // Muted for a release that never came: the next grab ends it.
    game.muteRelease();
    game.handle({ type: "grab", hand: "left" });
    game.handle({ type: "release", hand: "left" });
    expect(engine.ids().slice(-2)).toEqual(["lantern_pick", "lantern_set"]);
  });

  it("the rings lining up chime once and double tap 80 ms apart; parting is silent", () => {
    const { engine, game, pulses, run } = setup();
    game.grab("right");
    pulses.length = 0;
    engine.t = 100;
    game.ring(1, true);
    run(200);
    game.ring(1, false);
    expect(engine.ids()).toEqual(["ring_chime"]);
    expect(engine.played[0]!.position).toEqual(LOCKS[1]);
    expect(pulses.map((p) => [p.v, p.ms])).toEqual([[0.4, 15], [0.4, 15]]);
    expect(pulses[1]!.t - pulses[0]!.t).toBeGreaterThanOrEqual(80);
    expect(pulses[1]!.t - pulses[0]!.t).toBeLessThan(80 + FRAME);
  });

  it("grab and settle pulse as listed, on the hand that holds the lantern", () => {
    const { game, pulses } = setup();
    game.grab("left");
    game.settle();
    expect(pulses.map((p) => [p.hand, p.v, p.ms])).toEqual([
      ["left", 0.3, 20],
      ["left", 0.6, 30],
    ]);
  });

  it("hints, a formed piece and a lesson beat play their sounds; the lesson beat at half gain", () => {
    const { engine, game } = setup();
    game.hint(0);
    game.crystallise(1, [0, 1, -1.7]);
    game.lessonStep();
    game.coachLine();
    expect(engine.played.map((p) => [p.id, p.gain])).toEqual([
      ["hint_reveal", undefined],
      ["crystallise", undefined],
      ["lesson_step", 0.5],
      ["ui_hover", undefined],
    ]);
    expect(engine.played[1]!.position).toEqual([0, 1, -1.7]);
  });

  it("the theatre's lights going down and coming up play their sounds, head-locked", () => {
    const { engine, game } = setup();
    game.theatre(false);
    game.theatre(true);
    expect(engine.played.map((p) => [p.id, p.position])).toEqual([
      ["theatre_dim", undefined],
      ["theatre_up", undefined],
    ]);
  });

  it("a hint plays at its lock, or at the hint lantern and 6 dB down for the stuck glow", () => {
    const { engine, game } = setup();
    game.hint(2);
    game.hint(0, [0.2, 1.1, -1.7], HINT_GLOW_GAIN);
    expect(engine.played.map((p) => [p.id, p.position, p.gain])).toEqual([
      ["hint_reveal", LOCKS[2], undefined],
      ["hint_reveal", [0.2, 1.1, -1.7], HINT_GLOW_GAIN],
    ]);
    expect(20 * Math.log10(HINT_GLOW_GAIN)).toBeCloseTo(-6, 9);
  });
});

describe("haptics", () => {
  it("are the patterns the design lists", () => {
    expect(HAPTICS.grab).toEqual([{ at: 0, intensity: 0.3, ms: 20 }]);
    expect(HAPTICS.tick).toEqual([{ at: 0, intensity: 0.15, ms: 10 }]);
    expect(HAPTICS.ring).toEqual([
      { at: 0, intensity: 0.4, ms: 15 },
      { at: 80, intensity: 0.4, ms: 15 },
    ]);
    expect(HAPTICS.settle).toEqual([{ at: 0, intensity: 0.6, ms: 30 }]);
    expect(HAPTICS.lockOpen).toEqual([{ at: 0, intensity: 1, ms: 60 }]);
    expect(HAPTICS.boxOpen).toHaveLength(6);
    expect(HAPTICS.boxOpen.map((p) => p.at)).toEqual([0, 120, 240, 360, 480, 600]);
    HAPTICS.boxOpen.forEach((p, i) => expect(p.intensity).toBeCloseTo(0.2 + (0.6 * i) / 5, 9));
  });

  it("pulse the hand's controller through hapticActuators[0]", () => {
    const calls: [number, number][] = [];
    const h = new Haptics(
      () => ({ inputSources: [{ handedness: "right", gamepad: { hapticActuators: [{ pulse: (v: number, ms: number) => calls.push([v, ms]) }] } }] }),
      () => 0,
    );
    h.pulse("right", 0.5, 25);
    h.pulse("left", 0.5, 25);
    h.pulse("right", 3, -4);
    expect(calls).toEqual([
      [0.5, 25],
      [1, 0],
    ]);
  });

  it("are a silent no-op without a gamepad: no session, tracked hands, no actuators, a refused pulse", async () => {
    const sessions: (HapticSession | null)[] = [
      null,
      { inputSources: [] },
      { inputSources: [{ handedness: "right", gamepad: null }] },
      { inputSources: [{ handedness: "right" }] },
      { inputSources: [{ handedness: "right", gamepad: {} }] },
      { inputSources: [{ handedness: "right", gamepad: { hapticActuators: [] } }] },
      { inputSources: [{ handedness: "right", gamepad: { hapticActuators: [{}] } }] },
      { inputSources: [{ handedness: "right", gamepad: { hapticActuators: [{ pulse: () => Promise.reject(new Error("no")) }] } }] },
    ];
    for (const s of sessions) {
      const h = new Haptics(() => s, () => 0);
      expect(() => {
        h.pulse("right", 1, 60);
        h.play("both", HAPTICS.ring);
        h.update();
      }).not.toThrow();
    }
    await new Promise((r) => setTimeout(r, 0));
  });

  it("fire a pattern's later pulses on time after frames with none waiting, and none after a clear", () => {
    const calls: number[] = [];
    let t = 0;
    const h = new Haptics(
      () => ({ inputSources: [{ handedness: "right", gamepad: { hapticActuators: [{ pulse: () => calls.push(t) }] } }] }),
      () => t,
    );
    for (; t < 50; t += 10) h.update();
    expect(calls).toEqual([]);
    h.play("right", HAPTICS.ring);
    expect(calls).toEqual([50]);
    for (; t <= 200; t += 10) h.update();
    expect(calls).toEqual([50, 130]);
    // Queued, then dropped (play ended): nothing fires, and the next pattern's pulses still do.
    h.play("right", HAPTICS.ring);
    h.clear();
    for (; t <= 400; t += 10) h.update();
    expect(calls).toEqual([50, 130, 210]);
    h.play("right", HAPTICS.ring);
    for (; t <= 600; t += 10) h.update();
    expect(calls).toEqual([50, 130, 210, 410, 490]);
  });

  it("a game with no session at all still plays its sounds", () => {
    const { engine, game } = setup({ session: null });
    game.grab("right");
    game.dialTick(1);
    expect(engine.ids()).toEqual(["dial_tick"]);
  });
});

describe("game events as cues (pure, so the video mix replays them)", () => {
  const sfx = (cues: readonly Cue[]) => cues.flatMap((c) => (c.kind === "sfx" ? [[c.id, c.delayMs ?? 0]] : []));

  it("maps a lock opening to its three layers with their delays", () => {
    expect(sfx(new CueMapper().map([{ type: "lock-open", lock: 2 }]))).toEqual([
      ["glass_tick", 0],
      ["brass_clunk", 120],
      ["mb_d6", 200],
    ]);
  });

  it("maps the box opening, the rings, a hint, a formed piece, a lesson beat and a dial tick", () => {
    const m = new CueMapper();
    expect(sfx(m.map([{ type: "box-open", key: "box-7" }]))).toEqual(scheduleBoxOpen("box-7", 0).map((c) => [c.id, c.atMs]));
    expect(sfx(m.map([{ type: "ring", lock: 0, on: true }, { type: "ring", lock: 0, on: false }]))).toEqual([["ring_chime", 0]]);
    expect(sfx(m.map([{ type: "hint", lock: 0, level: 1 }]))).toEqual([["hint_reveal", 0]]);
    expect(sfx(m.map([{ type: "crystallise", lock: 0 }]))).toEqual([["crystallise", 0]]);
    expect(m.map([{ type: "lesson-step" }])).toEqual([{ kind: "sfx", id: "lesson_step", gain: 0.5 }]);
    // A new coach line: the soft wooden tick of a fingertip on a key, head-locked.
    expect(m.map([{ type: "coach-line" }])).toEqual([{ kind: "sfx", id: "ui_hover" }]);
    expect(m.map([{ type: "feel", e: { type: "tick", lock: 0, cm: 2 } }])).toEqual([{ kind: "sfx", id: "dial_tick", pitch: 4 }]);
  });

  it("skips an event whose lock is missing or not a whole number from 0, with one warning", () => {
    const warnings: string[] = [];
    const m = new CueMapper({ warn: (w) => warnings.push(w) });
    for (const lock of [undefined, -1, 1.5, Number.NaN, "2"]) {
      expect(m.map([{ type: "lock-open", lock }]), String(lock)).toHaveLength(0);
      expect(m.map([{ type: "ring", lock, on: true }])).toHaveLength(0);
    }
    expect(m.map([{ type: "hint" }, { type: "crystallise", lock: null }])).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("lock-open");
    expect(sfx(m.map([{ type: "lock-open", lock: 1 }]))).toEqual([
      ["glass_tick", 0],
      ["brass_clunk", 120],
      ["mb_b5", 200],
    ]);
  });
});

describe("play time (the app's frame clock)", () => {
  it("counts only frames the player saw, and one long frame as at most MAX_STEP_MS", () => {
    const c = new FrameClock();
    c.step(1 / 72, true);
    expect(c.now()).toBeCloseTo(1000 / 72, 9);
    c.step(1 / 72, false);
    c.step(30, false);
    expect(c.now()).toBeCloseTo(1000 / 72, 9);
    c.step(30, true);
    expect(c.now()).toBeCloseTo(1000 / 72 + MAX_STEP_MS, 9);
    c.step(-1, true);
    c.step(Number.NaN, true);
    expect(c.now()).toBeCloseTo(1000 / 72 + MAX_STEP_MS, 9);
  });
});
