import { describe, expect, it } from "vitest";
import { makePlaceholders } from "../../src/audio/placeholder";
import { BASE_SFX_IDS } from "../../src/audio/manifest";
import { FakeAudioContext, asCtx } from "./helpers/fake-audio";
import { AudioEngine } from "../../src/audio/engine";

describe("placeholder sounds", () => {
  const ctx = new FakeAudioContext();
  const { manifest, buffers } = makePlaceholders(asCtx(ctx));

  it("covers every base sound id and nothing else", () => {
    for (const id of BASE_SFX_IDS) expect(manifest.sfx[id], id).toBeDefined();
    expect(Object.keys(manifest.sfx).sort()).toEqual([...BASE_SFX_IDS].sort());
    expect(manifest.derived).toEqual({});
  });

  it("gives every file a non-silent buffer under 1.5 seconds", () => {
    for (const e of Object.values(manifest.sfx)) {
      for (const f of e.files) {
        const b = buffers.get(f) as unknown as { length: number; sampleRate: number; getChannelData(c: number): Float32Array };
        expect(b, f).toBeDefined();
        expect(b.length / b.sampleRate).toBeLessThan(1.5);
        expect(Math.max(...b.getChannelData(0).map(Math.abs))).toBeGreaterThan(0.05);
      }
    }
  });

  it("has distinct audio for different ids", () => {
    const sig = (f: string) => Array.from((buffers.get(f) as unknown as { getChannelData(c: number): Float32Array }).getChannelData(0).slice(100, 140)).join(",");
    expect(sig(manifest.sfx.ui_press!.files[0]!)).not.toBe(sig(manifest.sfx.brass_clunk!.files[0]!));
    expect(sig(manifest.sfx.lantern_pick!.files[0]!)).not.toBe(sig(manifest.sfx.lantern_set!.files[0]!));
  });

  it("builds the bed with a bar-exact length and the music states", () => {
    const e = manifest.music[manifest.musicStates.calm!]!;
    const b = buffers.get(e.file) as unknown as { length: number; sampleRate: number };
    expect(b.length / b.sampleRate).toBeCloseTo(e.loopEndSec!, 6);
    expect(e.loopEndSec).toBe((e.bars! * 4 * 60) / e.bpm!);
    // menu and results name the bed (calm), as the real pack does; menus low-pass it at 800 Hz.
    expect(manifest.musicStates.calm).toBe("music_bed");
    expect(manifest.musicStates.menu).toBe(manifest.musicStates.calm);
    expect(manifest.musicStates.results).toBe(manifest.musicStates.calm);
    expect(manifest.musicStateFx?.menu?.lowpassHz).toBe(800);
    expect(manifest.stings.solve).toBe("sting_solve");
    expect(manifest.music.sting_solve?.role).toBe("sting");
  });

  it("tonal sounds have no pitch jitter, and the tick follows its pitch exactly", () => {
    for (const id of ["ring_chime", "crystallise", "reward_lift", "daily_streak", "hint_reveal", "lock_hum", "dial_tick"]) {
      expect(manifest.sfx[id]!.pitchCents, id).toBe(0);
    }
  });

  it("captions only the sounds that carry meaning", () => {
    const captioned = Object.entries(manifest.sfx)
      .filter(([, e]) => e.caption !== null)
      .map(([id]) => id)
      .sort();
    expect(captioned).toEqual(["brass_clunk", "crystallise", "daily_streak", "gentle_error", "hint_reveal", "ring_chime", "walls_hinge"]);
  });

  it("the bed starts and ends near silence so the bars do not click", () => {
    const b = buffers.get(manifest.music[manifest.musicStates.calm!]!.file) as unknown as { length: number; getChannelData(c: number): Float32Array };
    const d = b.getChannelData(0);
    expect(Math.abs(d[0]!)).toBeLessThan(0.05);
    expect(Math.abs(d[d.length - 1]!)).toBeLessThan(0.05);
    const barLen = Math.round(d.length / 4);
    for (let bar = 1; bar < 4; bar++) expect(Math.abs(d[bar * barLen]! - d[bar * barLen - 1]!)).toBeLessThan(0.1);
  });

  it("loads into the engine and plays", async () => {
    const c = new FakeAudioContext();
    const p = makePlaceholders(asCtx(c));
    const engine = new AudioEngine({ createContext: () => asCtx(c), warn: () => {} });
    await engine.load(p.manifest, { buffers: p.buffers });
    await engine.unlock();
    engine.play("ui_press");
    expect(c.sources).toHaveLength(1);
  });
});
