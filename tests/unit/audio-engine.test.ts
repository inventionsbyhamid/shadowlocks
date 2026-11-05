import { describe, expect, it } from "vitest";
import type { FakeGain, FakePanner, FakeSource } from "./helpers/fake-audio";
import { makeRig } from "./helpers/audio-fixture";
import type { AudioManifest, SfxId } from "../../src/audio/manifest";

const id = (s: string) => s as SfxId;
const cents = (src: FakeSource) => 1200 * Math.log2(src.playbackRate.value);
const active = (ctx: { sources: FakeSource[] }) => ctx.sources.filter((s) => s.startedAt !== null && s.stoppedAt === null);

describe("unlock", () => {
  it("stays silent while resume is pending and plays only once it resolves", async () => {
    const r = await makeRig({ unlock: false });
    r.ctx.resumeMode = "pending";
    const p = r.engine.unlock();
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(0);
    r.ctx.finishResume();
    await p;
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(1);
  });

  it("a rejected resume leaves the engine locked and does not throw", async () => {
    const r = await makeRig({ unlock: false });
    r.ctx.resumeMode = "reject";
    await expect(r.engine.unlock()).resolves.toBeUndefined();
    r.engine.play("ui_press");
    r.engine.setMusic("calm");
    expect(r.ctx.sources).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes("could not start"))).toBe(true);
  });

  it("is silent after a visibility resume until the context is running again", async () => {
    const r = await makeRig();
    r.engine.suspend();
    r.ctx.resumeMode = "pending";
    r.engine.resume();
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(0);
    r.ctx.finishResume();
    await Promise.resolve();
    await Promise.resolve();
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(1);
  });

  it("is silent before unlock and does not queue stale sounds", async () => {
    const r = await makeRig({ unlock: false });
    r.engine.play("ui_press");
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(0);
    await r.engine.unlock();
    expect(r.ctx.resumeCalls).toBe(1);
    expect(r.ctx.sources).toHaveLength(0);
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(1);
  });
});

describe("variants and jitter", () => {
  it("rotates variants without an immediate repeat", async () => {
    const r = await makeRig();
    for (let i = 0; i < 6; i++) {
      r.engine.play("ui_press");
      r.ctx.currentTime += 1;
    }
    const files = r.ctx.sources.map((s) => ["press_a", "press_b", "press_c"].find((f) => r.buf(f) === (s.buffer as unknown)));
    expect(files).toEqual(["press_a", "press_b", "press_c", "press_a", "press_b", "press_c"]);
  });

  it("applies pitch jitter inside the manifest range and the pitch option in semitones", async () => {
    const hi = await makeRig({ random: () => 1 });
    hi.engine.play("brass_clunk");
    expect(cents(hi.ctx.sources[0]!)).toBeCloseTo(150, 5);
    const lo = await makeRig({ random: () => 0 });
    lo.engine.play("brass_clunk", { pitch: 2 });
    expect(cents(lo.ctx.sources[0]!)).toBeCloseTo(-150 + 200, 5);
  });

  it("applies gain jitter and gain option", async () => {
    const r = await makeRig({ random: () => 1 });
    r.engine.play("brass_clunk", { gain: 0.5 });
    const voiceGain = [...r.ctx.sources[0]!.out][0] as FakeGain;
    expect(voiceGain.gain.value).toBeCloseTo(10 ** (1.5 / 20) * 0.5, 5);
  });
});

describe("cooldown", () => {
  it("drops a retrigger inside the cooldown and allows it after", async () => {
    const r = await makeRig();
    r.engine.play("ui_press");
    r.ctx.currentTime += 0.02;
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(1);
    r.ctx.currentTime += 0.03;
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(2);
  });
});

describe("voice pool", () => {
  it("never exceeds 16 voices and steals the oldest", async () => {
    const r = await makeRig();
    for (let i = 0; i < 17; i++) {
      r.ctx.currentTime += 0.001;
      r.engine.play("lantern_pick");
    }
    expect(r.ctx.sources).toHaveLength(17);
    expect(active(r.ctx)).toHaveLength(16);
    expect(r.ctx.sources[0]!.stoppedAt).not.toBeNull();
    expect(r.ctx.sources[16]!.stoppedAt).toBeNull();
    expect(r.engine.activeVoices).toBe(16);
  });

  it("honours the per-sound voice cap", async () => {
    const r = await makeRig();
    for (let i = 0; i < 3; i++) {
      r.ctx.currentTime += 0.1;
      r.engine.play("brass_clunk");
    }
    expect(active(r.ctx)).toHaveLength(2);
    expect(r.ctx.sources[0]!.stoppedAt).not.toBeNull();
  });

  it("frees a voice when its source ends", async () => {
    const r = await makeRig();
    r.engine.play("lantern_pick");
    expect(r.engine.activeVoices).toBe(1);
    r.ctx.sources[0]!.end();
    expect(r.engine.activeVoices).toBe(0);
  });

  it("ignores an ended event from a stolen source", async () => {
    const r = await makeRig();
    for (let i = 0; i < 17; i++) {
      r.ctx.currentTime += 0.001;
      r.engine.play("lantern_pick");
    }
    r.ctx.sources[0]!.end();
    expect(r.engine.activeVoices).toBe(16);
  });
});

describe("spatial", () => {
  it("reuses pooled panners and never creates one per play", async () => {
    const r = await makeRig();
    const before = r.ctx.panners.length;
    expect(before).toBeGreaterThanOrEqual(16);
    for (let i = 0; i < 40; i++) {
      r.ctx.currentTime += 0.1;
      r.engine.play("lantern_pick", { position: [0.1, 0.2, -0.3] });
    }
    expect(r.ctx.panners.length).toBe(before);
  });

  it("places an HRTF sound at the position with the design's distance model", async () => {
    const r = await makeRig();
    r.engine.play("lantern_pick", { position: [0.1, 0.2, -0.3] });
    const hrtf = r.ctx.panners.filter((p) => p.panningModel === "HRTF");
    const used = hrtf.find((p) => p.positionX.value === 0.1) as FakePanner;
    expect(used).toBeDefined();
    expect([used.positionY.value, used.positionZ.value]).toEqual([0.2, -0.3]);
    expect(used.distanceModel).toBe("inverse");
    expect(used.refDistance).toBe(0.3);
    expect(used.rolloffFactor).toBe(1);
  });

  it("routes panned sounds through an equal-power panner", async () => {
    const r = await makeRig();
    r.engine.play("ui_press", { position: [0.05, 0, -0.4] });
    const eq = r.ctx.panners.find((p) => p.panningModel === "equalpower" && p.positionX.value === 0.05);
    expect(eq).toBeDefined();
  });

  it("bypasses panners in mono mode and without a position", async () => {
    const r = await makeRig();
    r.engine.play("lantern_pick");
    const g1 = [...r.ctx.sources[0]!.out][0] as FakeGain;
    expect([...g1.out].some((n) => n.kind === "panner")).toBe(false);
    r.engine.setMono(true);
    r.ctx.currentTime += 1;
    r.engine.play("lantern_pick", { position: [1, 0, 0] });
    const g2 = [...r.ctx.sources[1]!.out][0] as FakeGain;
    expect([...g2.out].some((n) => n.kind === "panner")).toBe(false);
  });

  it("adds a low-pass when the manifest asks for one", async () => {
    const r = await makeRig();
    r.engine.play("thread_shimmer", { position: [0, 0, -0.8] });
    const g = [...r.ctx.sources[0]!.out][0] as FakeGain;
    const lp = [...g.out].find((n) => n.kind === "filter") as unknown as { frequency: { value: number } };
    expect(lp.frequency.value).toBe(5000);
  });

  it("sets the listener pose", async () => {
    const r = await makeRig();
    r.engine.setListener({ position: [1, 2, 3], forward: [0, 0, -1], up: [0, 1, 0] });
    expect([r.ctx.listener.positionX.value, r.ctx.listener.positionY.value, r.ctx.listener.positionZ.value]).toEqual([1, 2, 3]);
    expect(r.ctx.listener.forwardZ.value).toBe(-1);
    expect(r.ctx.listener.upY.value).toBe(1);
  });
});

describe("missing ids", () => {
  it("is a no-op with one warning per id and never throws", async () => {
    const r = await makeRig();
    expect(() => {
      r.engine.play(id("ui_hover"));
      r.engine.play(id("ui_hover"));
      r.engine.play(id("nope_nothing"));
    }).not.toThrow();
    expect(r.ctx.sources).toHaveLength(0);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toContain("ui_hover");
  });
});

describe("derived sounds", () => {
  it("plays music-box notes pitched from one sample, keeping the sample's tuning", async () => {
    const r = await makeRig();
    const notes = ["mb_g5", "mb_fs5", "mb_a5", "lesson_step"] as const;
    const semis = [0, -1, 2, 0];
    for (const n of notes) {
      r.ctx.currentTime += 1;
      r.engine.play(n);
    }
    for (let i = 0; i < notes.length; i++) {
      expect(cents(r.ctx.sources[i]!)).toBeCloseTo(-7 + semis[i]! * 100, 5);
      expect(r.ctx.sources[i]!.buffer).toBe(r.buf("note_g5"));
    }
  });

  it("a derived sound with a companion is pitched and also plays the companion", async () => {
    const r = await makeRig();
    r.engine.play(id("tick_with_crystal"));
    expect(r.ctx.sources).toHaveLength(2);
    expect(cents(r.ctx.sources[0]!)).toBeCloseTo(1000, 5);
    expect(r.ctx.sources[1]!.buffer).toBe(r.buf("cmax_a"));
  });

  it("a reversed derived sound plays a reversed copy of its source", async () => {
    const r = await makeRig();
    r.engine.play(id("chime_reversed"));
    const b = r.ctx.sources[0]!.buffer as unknown as { length: number; data: Float32Array[] };
    expect(b).not.toBe(r.buf("bloom_a"));
    expect(b.data[0]![b.length - 1]).toBe(0.5);
    expect(b.data[0]![b.length - 2]).toBe(0.25);
  });
});

describe("volumes", () => {
  const busOf = (r: Awaited<ReturnType<typeof makeRig>>, name: string) => r.engine.busGain(name);

  it("scales buses and silences at 0", async () => {
    const r = await makeRig();
    r.engine.setVolumes({ music: 0, sfx: 0 });
    expect(busOf(r, "music").gain.value).toBe(0);
    expect(busOf(r, "sfx").gain.value).toBe(0);
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(0);
    r.engine.setVolumes({ music: 1, sfx: 0.5 });
    expect(busOf(r, "music").gain.value).toBeCloseTo(0.55, 5);
    expect(busOf(r, "sfx").gain.value).toBeCloseTo(0.5, 5);
  });

  it("clamps out of range volumes", async () => {
    const r = await makeRig();
    r.engine.setVolumes({ music: -3, sfx: 7 });
    expect(busOf(r, "music").gain.value).toBe(0);
    expect(busOf(r, "sfx").gain.value).toBe(1);
  });
});

describe("suspend and resume", () => {
  it("suspends the context, ignores plays while suspended, and resumes", async () => {
    const r = await makeRig();
    r.engine.suspend();
    expect(r.ctx.suspendCalls).toBe(1);
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(0);
    r.engine.resume();
    await Promise.resolve();
    expect(r.ctx.resumeCalls).toBe(2);
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(1);
  });

  it("does not resume before the first unlock", async () => {
    const r = await makeRig({ unlock: false });
    r.engine.resume();
    expect(r.ctx.resumeCalls).toBe(0);
  });
});

describe("ducking from sounds", () => {
  it("ducks music by the manifest amount while the sound plays", async () => {
    const r = await makeRig();
    r.engine.play("walls_hinge");
    const ev = r.duckEvents();
    const lows = ev.filter((e) => e.type === "linear" && e.value !== 1);
    expect(lows[0]!.value).toBeCloseTo(10 ** (-4 / 20), 5);
  });
});

describe("suspendWhenHidden", () => {
  it("suspends on hide and resumes on show", async () => {
    const { suspendWhenHidden } = await import("../../src/audio/engine");
    const r = await makeRig();
    let handler: () => void = () => {};
    const doc = {
      hidden: false,
      addEventListener: (_: string, h: () => void) => {
        handler = h;
      },
    };
    suspendWhenHidden(r.engine, doc as never);
    doc.hidden = true;
    handler();
    expect(r.ctx.suspendCalls).toBe(1);
    doc.hidden = false;
    handler();
    expect(r.ctx.resumeCalls).toBe(2);
  });
});


describe("play handle, variants and captions", () => {
  it("returns a reusable handle that fades the sound out", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 1;
    const h = r.engine.play("lantern_pick");
    r.ctx.currentTime = 1.1;
    h.stop();
    const src = r.ctx.sources[0]!;
    expect(src.stoppedAt).toBeCloseTo(1.1 + 0.04 + 0.005, 5);
    const gain = [...src.out][0] as FakeGain;
    expect(gain.gain.events.some((e) => e.type === "linear" && e.value === 0 && Math.abs(e.time - 1.14) < 1e-9)).toBe(true);
    // the handle is the voice's own object: no per-play allocation. Once the sound ends its
    // voice is free again, and the next sound on that voice hands out the same object.
    src.end();
    r.ctx.currentTime = 3;
    const sources = r.ctx.sources.length;
    expect(r.engine.play("lantern_pick")).toBe(h);
    expect(r.ctx.sources).toHaveLength(sources + 1);
  });

  it("stop on a finished sound or a missing id does nothing", async () => {
    const r = await makeRig();
    const h = r.engine.play("lantern_pick");
    r.ctx.sources[0]!.end();
    expect(() => h.stop()).not.toThrow();
    expect(() => r.engine.play(id("nope")).stop()).not.toThrow();
  });

  it("plays a forced variant without moving the rotation", async () => {
    const r = await makeRig();
    r.engine.play("ui_press", { variant: 2 });
    r.ctx.currentTime += 1;
    r.engine.play("ui_press");
    expect(r.ctx.sources[0]!.buffer).toBe(r.buf("press_c"));
    expect(r.ctx.sources[1]!.buffer).toBe(r.buf("press_a"));
  });

  it("a derived sound can use one variant of its source, pitched", async () => {
    const r = await makeRig();
    r.engine.play(id("tock_low"));
    expect(r.ctx.sources[0]!.buffer).toBe(r.buf("tock_a"));
    expect(cents(r.ctx.sources[0]!)).toBeCloseTo(-200, 5);
  });

  it("sends captions even when effects are muted, on cooldown or before unlock", async () => {
    const captions: [string, string][] = [];
    const r = await makeRig({ unlock: false, captions });
    r.engine.play("brass_clunk");
    await r.engine.unlock();
    r.engine.setVolumes({ music: 1, sfx: 0 });
    r.engine.play("brass_clunk");
    r.engine.setVolumes({ music: 1, sfx: 1 });
    r.engine.play("brass_clunk");
    r.engine.play("brass_clunk"); // cooldown
    expect(captions).toHaveLength(4);
    expect(captions[0]).toEqual(["brass_clunk", "Clunk"]);
    expect(r.ctx.sources).toHaveLength(1);
  });

  it("sends the caption when the file failed to load, and the companion's caption before unlock", async () => {
    const captions: [string, string][] = [];
    const r = await makeRig({
      unlock: false,
      captions,
      tweak: (m) => {
        m.sfx.glass_tick!.caption = "Tick";
        m.sfx.crystallise!.caption = "Piece formed";
        m.sfx.hint_reveal = { ...m.sfx.glass_tick!, files: ["missing_file"], caption: "Hint" };
      },
    });
    r.buffers.delete("missing_file");
    await r.engine.loadSfx(r.manifest, { buffers: r.buffers, fetchData: async () => Promise.reject(new Error("404")) });
    r.engine.play("hint_reveal");
    r.engine.play(id("tick_with_crystal"));
    expect(captions).toEqual([["hint_reveal", "Hint"], ["tick_with_crystal", "Tick"], ["crystallise", "Piece formed"]]);
    expect(r.ctx.sources).toHaveLength(0);
  });

  it("does not send captions for sounds without one", async () => {
    const captions: [string, string][] = [];
    const r = await makeRig({ captions });
    r.engine.play("lantern_pick");
    expect(captions).toHaveLength(0);
  });
});

describe("voice steal", () => {
  it("fades the stolen sound over 5 ms through the voice's own chain, then starts the new one", async () => {
    const r = await makeRig();
    for (let i = 0; i < 16; i++) {
      r.ctx.currentTime += 0.001;
      r.engine.play("lantern_pick", { position: [0.1, 0, -0.3] });
    }
    const old = r.ctx.sources[0]!;
    const voiceGain = [...old.out][0] as FakeGain;
    const panner = [...voiceGain.out][0] as FakePanner;
    expect(panner.kind).toBe("panner");
    r.ctx.currentTime = 0.017;
    r.engine.play("lantern_pick", { position: [0.1, 0, -0.3] });
    const next = r.ctx.sources[16]!;
    // the old sound is still wired to its voice gain (and so its panner), not straight to a bus
    expect([...old.out][0]).toBe(voiceGain);
    expect([...next.out][0]).toBe(voiceGain);
    expect(old.stoppedAt).toBeCloseTo(0.017 + 0.005, 6);
    expect(next.startedAt).toBeCloseTo(0.017 + 0.005, 6);
    expect(voiceGain.gain.at(0.017)).toBeCloseTo(1, 5);
    expect(voiceGain.gain.at(0.0195)).toBeCloseTo(0.5, 2);
    expect(voiceGain.gain.at(0.023)).toBeCloseTo(1, 5); // the new sound's level, once the fade is done
    old.end();
    expect(old.out.size).toBe(0);
    expect(r.engine.activeVoices).toBe(16);
  });
});

describe("low-pass", () => {
  it("is off for a sound whose manifest entry has no lowpassHz", async () => {
    const r = await makeRig({ tweak: (m) => delete m.sfx.thread_shimmer!.lowpassHz });
    r.engine.play("thread_shimmer", { position: [0, 0, -0.8] });
    const g = [...r.ctx.sources[0]!.out][0] as FakeGain;
    expect([...g.out].some((n) => n.kind === "filter")).toBe(false);
  });
});

describe("stings from the manifest", () => {
  it("ducks music by the sting's own duckMusicDb", async () => {
    const r = await makeRig({ tweak: (m) => (m.music.sting_solve!.duckMusicDb = 9) });
    r.engine.sting("solve");
    const low = r.duckEvents().find((e) => e.type === "linear" && e.value !== 1)!;
    expect(low.value).toBeCloseTo(10 ** (-9 / 20), 5);
  });
});

describe("ambience", () => {
  const withRoom = (m: AudioManifest) => {
    m.buses.ambience = 0.3;
    m.sfx.amb_room = { ...m.sfx.glass_tick!, files: ["room_a"], bus: "ambience", loop: true, maxVoices: 1, gainDb: -2 };
  };
  const roomSources = (r: Awaited<ReturnType<typeof makeRig>>) => r.ctx.sources.filter((s) => s.buffer === (r.buf("room_a") as unknown));

  it("is off by default and loops the room tone on its own bus when turned on", async () => {
    const r = await makeRig({ tweak: withRoom });
    expect(roomSources(r)).toHaveLength(0);
    r.engine.setAmbience(true);
    const [src] = roomSources(r);
    expect(src!.loop).toBe(true);
    const gain = [...src!.out][0] as FakeGain;
    expect([...gain.out][0]).toBe(r.engine.busGain("ambience"));
    r.ctx.currentTime = 2;
    expect(gain.gain.value).toBeCloseTo(10 ** (-2 / 20), 5);
    expect(r.engine.busGain("ambience").gain.value).toBeCloseTo(0.3, 5);
    // never takes a pooled voice, so it cannot be stolen
    expect(r.engine.activeVoices).toBe(0);
    r.engine.setAmbience(true);
    expect(roomSources(r)).toHaveLength(1);
  });

  it("fades out and stops when turned off", async () => {
    const r = await makeRig({ tweak: withRoom });
    r.engine.setAmbience(true);
    r.ctx.currentTime = 5;
    r.engine.setAmbience(false);
    const [src] = roomSources(r);
    expect(src!.stoppedAt).toBeCloseTo(6, 5);
    r.ctx.currentTime = 6;
    expect(([...src!.out][0] as FakeGain).gain.value).toBeCloseTo(0, 5);
  });

  it("waits for unlock and for the sound to exist", async () => {
    const r = await makeRig({ tweak: withRoom, unlock: false });
    r.engine.setAmbience(true);
    expect(roomSources(r)).toHaveLength(0);
    await r.engine.unlock();
    expect(roomSources(r)).toHaveLength(1);
    const bare = await makeRig();
    expect(() => bare.engine.setAmbience(true)).not.toThrow();
  });
});

describe("delayed starts", () => {
  it("starts a sound later on the audio clock, at its full level then", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 1;
    r.engine.play("glass_tick", { delay: 0.12 });
    const src = r.ctx.sources[0]!;
    expect(src.startedAt).toBeCloseTo(1.12, 9);
    expect(([...src.out][0] as FakeGain).gain.at(1.12)).toBeCloseTo(1, 9);
    // It holds its voice from now, so the pool counts it.
    expect(r.engine.activeVoices).toBe(1);
  });

  it("ducks the music from when the sound starts, not from when it was asked for", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 2;
    r.engine.play("walls_hinge", { delay: 0.7 });
    const down = r.duckEvents().find((e) => e.type === "linear" && e.value !== 1)!;
    expect(down.time).toBeCloseTo(2.7 + 0.05, 9);
  });
});

describe("loops (the hums)", () => {
  const humOf = (r: Awaited<ReturnType<typeof makeRig>>) => r.ctx.sources.find((s) => s.buffer === (r.buf("hum_a") as unknown))!;
  const gainOf = (src: FakeSource) => [...src.out][0] as FakeGain;

  it("loops the sound outside the voice pool, so one-shots never steal it", async () => {
    const r = await makeRig();
    const hum = r.engine.loop("lock_hum", { position: [0, 1, -1.9] })!;
    expect(hum).not.toBeNull();
    const src = humOf(r);
    expect(src.loop).toBe(true);
    for (let i = 0; i < 40; i++) {
      r.ctx.currentTime += 0.001;
      r.engine.play("lantern_pick");
    }
    expect(src.stoppedAt).toBeNull();
    expect(hum.playing).toBe(true);
    expect(r.engine.activeVoices).toBe(16);
  });

  it("is pitched from the sound's tuning, at its position through the sound's panner", async () => {
    const r = await makeRig();
    r.engine.loop("lock_hum", { pitch: 4, position: [0.1, 1, -1.9] });
    const src = humOf(r);
    expect(cents(src)).toBeCloseTo(-2 + 400, 6);
    const panner = [...gainOf(src).out][0] as FakePanner;
    expect(panner.panningModel).toBe("HRTF");
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([0.1, 1, -1.9]);
    expect([...panner.out][0]).toBe(r.engine.busGain("sfx"));
  });

  it("starts silent and ramps its gain over about 40 ms (no zipper noise)", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 1;
    const hum = r.engine.loop("lock_hum")!;
    const g = gainOf(humOf(r)).gain;
    expect(g.value).toBe(0);
    hum.setGain(0.5);
    expect(g.at(1.02)).toBeCloseTo(0.25, 6);
    expect(g.at(1.04)).toBeCloseTo(0.5, 9);
    // A change half way through a ramp starts from where the level is, not from the old target.
    r.ctx.currentTime = 1.02;
    hum.setGain(1, 50);
    expect(g.at(1.02)).toBeCloseTo(0.25, 6);
    expect(g.at(1.07)).toBeCloseTo(1, 9);
    expect(g.events.filter((e) => e.type === "linear").map((e) => e.time)).toEqual([1.04, 1.07].map((t) => expect.closeTo(t, 9)));
  });

  it("applies the sound's trim to every level, the starting one too", async () => {
    const r = await makeRig({ tweak: (m) => (m.sfx.lock_hum!.gainDb = -6) });
    r.ctx.currentTime = 1;
    const hum = r.engine.loop("lock_hum", { gain: 0.5 })!;
    const g = gainOf(humOf(r)).gain;
    expect(g.value).toBeCloseTo(0.5 * 10 ** (-6 / 20), 9);
    hum.setGain(1, 0);
    expect(g.value).toBeCloseTo(10 ** (-6 / 20), 9);
  });

  it("glides its pitch, moves with its position and fades out when stopped", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 3;
    const hum = r.engine.loop("lock_hum", { position: [0, 0, 0] })!;
    const src = humOf(r);
    hum.setPitch(2, 100);
    r.ctx.currentTime = 3.1;
    expect(cents(src)).toBeCloseTo(-2 + 200, 6);
    hum.setPosition([1, 2, 3]);
    const panner = [...gainOf(src).out][0] as FakePanner;
    expect(panner.positionZ.value).toBe(3);
    hum.setGain(1, 0);
    hum.stop(150);
    expect(hum.playing).toBe(false);
    expect(src.stoppedAt).toBeCloseTo(3.1 + 0.15 + 0.005, 9);
    r.ctx.currentTime = 3.25;
    expect(gainOf(src).gain.value).toBeCloseTo(0, 9);
    src.end();
    expect(src.out.size).toBe(0);
    // A stopped loop ignores later calls.
    expect(() => {
      hum.setGain(1);
      hum.stop();
    }).not.toThrow();
  });

  it("is not made before audio starts, for a sound the pack lacks, or while effects are off", async () => {
    const locked = await makeRig({ unlock: false });
    expect(locked.engine.canLoop()).toBe(false);
    expect(locked.engine.loop("lock_hum")).toBeNull();
    const r = await makeRig();
    expect(r.engine.canLoop()).toBe(true);
    expect(r.engine.loop(id("fingertip_hum"))).toBeNull();
    expect(r.engine.loop(id("fingertip_hum"))).toBeNull();
    // A sound the pack lacks says so once, as play() does.
    expect(r.warnings).toEqual(['audio: no sound "fingertip_hum" in the manifest']);
    r.engine.setVolumes({ music: 1, sfx: 0 });
    expect(r.engine.canLoop()).toBe(false);
    expect(r.engine.loop("lock_hum")).toBeNull();
    expect(r.ctx.sources).toHaveLength(0);
    expect(locked.warnings).toEqual([]);
  });
});

describe("music state for tests", () => {
  it("reports the state, whether the bed plays, and the low-pass it heads for", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 1;
    expect(r.engine.musicInfo()).toEqual({ state: "off", playing: false, cutoffHz: 20000, filterHz: 20000 });
    r.engine.setMusic("menu");
    expect(r.engine.musicInfo()).toEqual({ state: "menu", playing: true, cutoffHz: 1500, filterHz: 1500 });
    r.engine.setMusic("calm");
    expect(r.engine.musicInfo().cutoffHz).toBe(20000);
  });
});
