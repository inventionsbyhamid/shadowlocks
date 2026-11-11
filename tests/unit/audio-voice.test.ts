// The voice player on the audio engine (fake Web Audio): a line plays unplaced on its own gain stage inside the
// effects bus, the music ducks 8 dB and the hums 6 dB while it plays (50 ms down, 300 ms back), one line at a time,
// and a line hushed fades out and lets the music and the hums come back.
import { describe, expect, it, vi } from "vitest";
import { Hums } from "../../src/audio/hums";
import { VOICE_GAIN_DB, VOICE_HUM_DUCK_DB, VOICE_MUSIC_DUCK_DB, VoicePlayer } from "../../src/audio/voice";
import { makeRig } from "./helpers/audio-fixture";
import { FakeBuffer, type FakeGain, type FakeParam, type FakeSource } from "./helpers/fake-audio";

const db = (x: number) => 10 ** (x / 20);

describe("VoicePlayer", () => {
  it("plays a line on its own gain stage into the effects bus, ducking the music 8 dB while it plays", async () => {
    const r = await makeRig();
    const v = new VoicePlayer(r.engine);
    expect(v.running).toBe(true);
    const line = new FakeBuffer(1, 48000 * 3, 48000);
    const ended = vi.fn();
    v.say(line as unknown as AudioBuffer, ended);
    const src = r.ctx.sources.at(-1)! as FakeSource;
    expect(src.buffer).toBe(line);
    expect(src.startedAt).toBe(0);
    // Source, its own fade gain, the voice stage (VOICE_GAIN_DB), the effects bus: no panner, both ears alike.
    const fade = [...src.out][0] as FakeGain;
    const stage = [...fade.out][0] as FakeGain;
    expect(stage.gain.value).toBeCloseTo(db(VOICE_GAIN_DB), 9);
    expect([...stage.out][0]).toBe(r.engine.busGain("sfx"));
    const duck = r.engine.duckGain().gain as unknown as FakeParam;
    expect(duck.at(0.05)).toBeCloseTo(db(-VOICE_MUSIC_DUCK_DB), 6);
    expect(duck.at(3)).toBeCloseTo(db(-VOICE_MUSIC_DUCK_DB), 6);
    expect(duck.at(3.4)).toBeCloseTo(1, 6);
    src.end();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("hushes a line with a fade, lets the music back up, and calls its end once", async () => {
    const r = await makeRig();
    const v = new VoicePlayer(r.engine);
    const ended = vi.fn();
    v.say(new FakeBuffer(1, 48000 * 4, 48000) as unknown as AudioBuffer, ended);
    const src = r.ctx.sources.at(-1)! as FakeSource;
    r.ctx.currentTime = 1;
    v.hush(120);
    expect(src.stoppedAt).toBeCloseTo(1.125, 6);
    const duck = r.engine.duckGain().gain as unknown as FakeParam;
    expect(duck.at(1.5)).toBeCloseTo(1, 6);
    src.end();
    expect(ended).toHaveBeenCalledTimes(1);
    // A new line stops the one before at once.
    v.say(new FakeBuffer(1, 48000, 48000) as unknown as AudioBuffer, () => {});
    const a = r.ctx.sources.at(-1)! as FakeSource;
    v.say(new FakeBuffer(1, 48000, 48000) as unknown as AudioBuffer, () => {});
    expect(a.stoppedAt).not.toBeNull();
  });

  it("is not running before audio starts", async () => {
    const r = await makeRig({ unlock: false });
    expect(new VoicePlayer(r.engine).running).toBe(false);
  });

  it("ducks the hums 6 dB while a line plays: down in 50 ms, back in 300 ms", async () => {
    const r = await makeRig();
    const hums = new Hums(r.engine);
    hums.setEnabled(true);
    hums.warmth(0, 1);
    const loopGain = () => r.ctx.gains.at(-1)!.gain as unknown as FakeParam;
    const g = loopGain();
    const full = g.at(0.1);
    expect(full).toBeGreaterThan(0);
    r.ctx.currentTime = 1;
    hums.duck(true);
    expect(g.at(1.05)).toBeCloseTo(full * db(-VOICE_HUM_DUCK_DB), 6);
    // Warmth moving while ducked stays ducked.
    hums.warmth(0, 0.5);
    r.ctx.currentTime = 2;
    expect(g.at(2.1)).toBeCloseTo((full / 1) * 0.5 * db(-VOICE_HUM_DUCK_DB), 6);
    hums.duck(false);
    expect(g.at(2.3)).toBeCloseTo(full * 0.5, 6);
    expect(hums.level(0)).toBe(0.5);
  });
});
