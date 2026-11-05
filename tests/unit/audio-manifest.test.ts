import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AudioEngine } from "../../src/audio/engine";
import { BASE_SFX_IDS, isSfxId, type AudioManifest, type DerivedEntry, type MusicEntry, type MusicStateFx, type SfxEntry, type SfxId } from "../../src/audio/manifest";
import { makePlaceholders } from "../../src/audio/placeholder";
import { FakeAudioContext, FakeBuffer, asCtx, type FakeFilter, type FakeGain, type FakeSource } from "./helpers/fake-audio";

const PACK = "public/audio/manifest.json";

// Every key the types declare. Typed as Record<keyof X, true>, so this list and the type must match
// exactly; the drift checks then find anything a manifest carries outside it.
const TOP: Record<keyof AudioManifest, true> = {
  version: true, generatedUtc: true, sampleRate: true, container: true, codec: true, buses: true, sfx: true,
  derived: true, music: true, musicStates: true, musicStateFx: true, stings: true, bytes: true,
};
const SFX: Record<keyof SfxEntry, true> = {
  files: true, durations: true, bus: true, spatial: true, gainDb: true, detuneCents: true, pitchCents: true, gainRandDb: true,
  cooldownMs: true, maxVoices: true, duckMusicDb: true, caption: true, loop: true, lowpassHz: true, sources: true, renderGainDb: true,
};
const MUSIC: Record<keyof MusicEntry, true> = {
  file: true, role: true, loop: true, bus: true, bpm: true, bars: true, key: true, lengthSamples: true, loopStartSec: true,
  loopEndSec: true, durationSec: true, gainDb: true, duckMusicDb: true, renderGainDb: true, crossfadeSec: true, provider: true,
  source: true, sourceStartSec: true, sourceBpm: true, startNote: true, basis: true,
};
const DERIVED: Record<keyof DerivedEntry, true> = { from: true, reverse: true, variant: true, semitones: true, with: true };
const STATES: Record<keyof AudioManifest["musicStates"], true> = { calm: true, intense: true, menu: true, results: true };
const FX_STATES: Record<keyof NonNullable<AudioManifest["musicStateFx"]>, true> = { menu: true, results: true };
const FX: Record<keyof MusicStateFx, true> = { lowpassHz: true, gainDb: true };
const STINGS: Record<keyof AudioManifest["stings"], true> = { solve: true };

const unknownKeys = (o: object, known: object, where: string) => Object.keys(o).filter((k) => !(k in known)).map((k) => `${where}.${k}`);

function drift(m: AudioManifest): string[] {
  return [
    ...unknownKeys(m, TOP, "manifest"),
    ...Object.entries(m.sfx).flatMap(([id, e]) => unknownKeys(e, SFX, `sfx.${id}`)),
    ...Object.entries(m.music).flatMap(([id, e]) => unknownKeys(e, MUSIC, `music.${id}`)),
    ...Object.entries(m.derived).flatMap(([id, e]) => unknownKeys(e, DERIVED, `derived.${id}`)),
    ...unknownKeys(m.musicStates, STATES, "musicStates"),
    ...unknownKeys(m.musicStateFx ?? {}, FX_STATES, "musicStateFx"),
    ...Object.entries(m.musicStateFx ?? {}).flatMap(([s, e]) => unknownKeys(e, FX, `musicStateFx.${s}`)),
    ...unknownKeys(m.stings, STINGS, "stings"),
  ];
}

function shapes(m: AudioManifest): void {
  for (const [id, e] of Object.entries(m.sfx)) {
    expect(["hrtf", "equalpower", "none"], id).toContain(e.spatial);
    expect(["sfx", "ui", "ambience"], id).toContain(e.bus);
    expect(e.caption === null || typeof e.caption === "string", id).toBe(true);
  }
  expect(m.musicStates.menu).toBe(m.musicStates.calm);
  expect(m.musicStates.results).toBe(m.musicStates.calm);
  for (const key of Object.values(m.stings)) expect(m.music[key!]?.role).toBe("sting");
}

/** An engine loaded with `m`, every file a short stand-in (loop points come from the manifest). */
async function load(m: AudioManifest) {
  const ctx = new FakeAudioContext();
  const buffers = new Map<string, AudioBuffer>();
  const files = [...Object.values(m.sfx).flatMap((e) => e.files), ...Object.values(m.music).map((e) => e.file)];
  for (const f of files) buffers.set(f, new FakeBuffer(f.startsWith("music/") ? 2 : 1, 9600, 48000) as unknown as AudioBuffer);
  const warnings: string[] = [];
  const captions: [string, string][] = [];
  const engine = new AudioEngine({
    createContext: () => asCtx(ctx),
    random: () => 0.5,
    warn: (w) => warnings.push(w),
    onCaption: (id, text) => captions.push([id, text]),
  });
  await engine.load(m, { buffers });
  await engine.unlock();
  const playing = (file: string) => ctx.sources.filter((s) => s.buffer === (buffers.get(file) as unknown));
  return { ctx, engine, warnings, captions, playing };
}

const chain = (s: FakeSource) => {
  const kinds: string[] = [];
  let n = [...s.out][0];
  while (n) {
    kinds.push(n.kind === "panner" ? `panner:${(n as unknown as { panningModel: string }).panningModel}` : n.kind);
    n = [...n.out][0];
  }
  return kinds;
};

describe("the placeholder manifest", () => {
  const m = makePlaceholders(asCtx(new FakeAudioContext())).manifest;

  it("has no field the types do not declare, and the shapes the engine expects", () => {
    expect(drift(m)).toEqual([]);
    shapes(m);
  });

  it("loads with no warnings and every sound id in it plays", async () => {
    const r = await load(m);
    const ids = [...Object.keys(m.sfx), ...Object.keys(m.derived)].filter(isSfxId) as SfxId[];
    expect(ids).toHaveLength(BASE_SFX_IDS.length);
    for (const id of ids) {
      r.ctx.currentTime += 1;
      const before = r.ctx.sources.length;
      r.engine.play(id);
      expect(r.ctx.sources.length, id).toBeGreaterThan(before);
    }
    expect(r.warnings).toEqual([]);
  });

  it("routes equalpower, hrtf and none as the design says", async () => {
    const r = await load(m);
    r.engine.play("ui_press", { position: [0.1, 0, -0.4] });
    r.engine.play("brass_clunk", { position: [0, 0, -0.4] });
    r.engine.play("walls_hinge", { position: [0, 0, -0.4] });
    // voice gain -> [panner] -> ui bus -> effects bus -> master -> limiter -> destination
    expect(chain(r.playing(m.sfx.ui_press!.files[0]!)[0]!)).toEqual(["gain", "panner:equalpower", "gain", "gain", "gain", "compressor", "destination"]);
    expect(chain(r.playing(m.sfx.brass_clunk!.files[0]!)[0]!)).toEqual(["gain", "panner:HRTF", "gain", "gain", "compressor", "destination"]);
    expect(chain(r.playing(m.sfx.walls_hinge!.files[0]!)[0]!)).toEqual(["gain", "gain", "gain", "compressor", "destination"]);
  });

  it("treats caption null as no caption", async () => {
    const r = await load(m);
    r.engine.play("ui_press");
    r.engine.play("brass_clunk");
    expect(r.captions).toEqual([["brass_clunk", "Lock open"]]);
  });

  it("plays the bed through an 800 Hz low-pass at -3 dB in menus", async () => {
    const r = await load(m);
    r.engine.setMusic("menu");
    const bed = r.playing(m.music.music_bed!.file)[0]!;
    const filter = [...bed.out][0] as FakeFilter;
    expect(filter.frequency.value).toBe(800);
    r.ctx.currentTime = 3;
    expect(([...filter.out][0] as FakeGain).gain.value).toBeCloseTo(10 ** (-3 / 20), 4);
  });

  it("plays the solve sting from the music section and the streak sting as its effect", async () => {
    const r = await load(m);
    r.engine.sting("solve");
    expect(r.playing(m.music.sting_solve!.file)).toHaveLength(1);
    r.engine.sting("streak");
    expect(r.playing(m.sfx.daily_streak!.files[0]!)).toHaveLength(1);
  });
});

// The real pack lands in public/audio with the sound design work; until then these wait.
describe.skipIf(!existsSync(PACK))("the real manifest (public/audio/manifest.json)", () => {
  const real = (existsSync(PACK) ? JSON.parse(readFileSync(PACK, "utf8")) : {}) as AudioManifest;

  it("has no field the types do not declare (writer drift), and the shapes the engine expects", () => {
    expect(drift(real)).toEqual([]);
    shapes(real);
  });

  it("has every base sound, loads with no warnings and every sound id in it plays", async () => {
    for (const id of BASE_SFX_IDS) expect(real.sfx[id], id).toBeDefined();
    const r = await load(real);
    const ids = [...Object.keys(real.sfx), ...Object.keys(real.derived)].filter(isSfxId) as SfxId[];
    for (const id of ids) {
      r.ctx.currentTime += 1;
      const before = r.ctx.sources.length;
      r.engine.play(id);
      expect(r.ctx.sources.length, id).toBeGreaterThan(before);
    }
    expect(r.warnings).toEqual([]);
  });
});
