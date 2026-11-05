import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AudioEngine } from "../../src/audio/engine";
import type { AudioManifest } from "../../src/audio/manifest";
import { loadSoundPack, openSoundPack } from "../../src/audio/pack";
import { makePlaceholders } from "../../src/audio/placeholder";
import { FakeAudioContext, asCtx, type FakeSource } from "./helpers/fake-audio";

const KB = 1000;
const PACK = "public/audio/manifest.json";

/**
 * A manifest laid out the way the sound pack's writer lays it out (sfx/<id>_<a, b, c>.ogg,
 * music/<id>.ogg), with every sound the game asks for: the placeholder set renamed to real files.
 */
function packLike(): AudioManifest {
  const m = makePlaceholders(asCtx(new FakeAudioContext())).manifest;
  const letters = "abcdefgh";
  for (const [id, e] of Object.entries(m.sfx)) e.files = e.files.map((_, i) => `sfx/${id}${e.files.length > 1 ? `_${letters[i]}` : ""}.ogg`);
  for (const [id, e] of Object.entries(m.music)) e.file = `music/${id}.ogg`;
  // A second loop, so a missing music file can fall back while another loads.
  m.music.music_intense = { ...m.music.music_bed!, file: "music/music_intense.ogg" };
  m.musicStates.intense = "music_intense";
  return m;
}

/** A server for the pack: manifest.json as given, every other file is 4800 bytes of "audio". */
function server(missing: string[] = [], manifest: unknown = packLike()) {
  const requested: string[] = [];
  const fetchData = async (url: string): Promise<ArrayBuffer> => {
    requested.push(url);
    if (missing.some((m) => url.endsWith(m))) throw new Error(`HTTP 404 for ${url}`);
    if (url.endsWith("manifest.json")) return new TextEncoder().encode(JSON.stringify(manifest)).buffer as ArrayBuffer;
    return new ArrayBuffer(4800);
  };
  return { fetchData, requested };
}

async function start(missing: string[] = [], manifest?: unknown) {
  const ctx = new FakeAudioContext();
  const warnings: string[] = [];
  const engine = new AudioEngine({ createContext: () => asCtx(ctx), random: () => 0.5, warn: (m) => warnings.push(m) });
  const s = server(missing, manifest);
  const { pack, loadMusic } = await loadSoundPack(engine, { baseUrl: "./audio/", fetchData: s.fetchData, warn: (m) => warnings.push(m) });
  await loadMusic();
  await engine.unlock();
  // The fake decoder makes 48 kHz buffers; placeholders are synthesised at 24 kHz.
  const rate = (s: FakeSource) => (s.buffer as unknown as { sampleRate: number }).sampleRate;
  return { ctx, engine, warnings, pack, requested: s.requested, rate };
}

describe("loading the sound pack", () => {
  it("reads manifest.json and every file from the pack folder, with no placeholders", async () => {
    const r = await start();
    expect(r.pack.placeholdersOnly).toBe(false);
    expect(r.requested[0]).toBe("./audio/manifest.json");
    expect(r.requested).toContain("./audio/sfx/ui_press_a.ogg");
    expect(r.requested).toContain("./audio/music/music_bed.ogg");
    r.engine.play("brass_clunk");
    r.engine.setMusic("calm");
    expect(r.ctx.sources.map(r.rate)).toEqual([48000, 48000, 48000]);
    expect(r.warnings).toEqual([]);
  });

  it("falls back to the placeholder for a sound whose files are missing, and only for it", async () => {
    const r = await start(["sfx/brass_clunk_a.ogg", "sfx/brass_clunk_b.ogg"]);
    r.engine.play("brass_clunk");
    r.ctx.currentTime += 1;
    r.engine.play("ui_press");
    expect(r.ctx.sources.map(r.rate)).toEqual([24000, 48000]);
    expect(r.warnings.some((w) => w.includes("brass_clunk_a.ogg"))).toBe(true);
  });

  it("keeps the files that did load when only one variant is missing", async () => {
    const r = await start(["sfx/ui_press_b.ogg"]);
    for (let i = 0; i < 3; i++) {
      r.ctx.currentTime += 1;
      r.engine.play("ui_press");
    }
    expect(r.ctx.sources.map(r.rate)).toEqual([48000, 48000, 48000]);
  });

  it("falls back to the placeholder bed for a missing music file", async () => {
    const r = await start(["music/music_bed.ogg"]);
    r.engine.setMusic("calm");
    const rates = r.ctx.sources.map(r.rate).sort();
    expect(rates).toEqual([24000, 48000]); // the bed is the placeholder, intense is real
  });

  it("uses placeholders for everything when manifest.json cannot be read", async () => {
    const r = await start(["manifest.json"]);
    expect(r.pack.placeholdersOnly).toBe(true);
    expect(r.warnings.some((w) => w.includes("using placeholder sounds"))).toBe(true);
    r.engine.play("ui_press");
    r.engine.setMusic("menu");
    expect(r.ctx.sources.map(r.rate)).toEqual([24000, 24000]);
  });

  it("treats a manifest of the wrong shape like a missing one", async () => {
    const ctx = new FakeAudioContext();
    const pack = await openSoundPack(asCtx(ctx), { fetchData: server([], { hello: 1 }).fetchData });
    expect(pack.placeholdersOnly).toBe(true);
  });
});

// The real pack lands in public/audio with the sound design work; until then these wait.
describe.skipIf(!existsSync(PACK))("the pack in public/audio", () => {
  const real = (existsSync(PACK) ? JSON.parse(readFileSync(PACK, "utf8")) : { sfx: {}, music: {} }) as AudioManifest;
  const files = [...Object.values(real.sfx).flatMap((e) => e.files), ...Object.values(real.music).map((e) => e.file)];

  it("has every file the manifest names, and nothing else (no audition page or raw takes)", () => {
    for (const file of files) expect(existsSync(`public/audio/${file}`), file).toBe(true);
    expect(readdirSync("public/audio").sort()).toEqual(["manifest.json", "music", "sfx"]);
    const onDisk = ["sfx", "music"].flatMap((d) => readdirSync(`public/audio/${d}`).map((n) => `${d}/${n}`)).sort();
    expect(onDisk).toEqual([...new Set(files)].sort());
  });

  it("fits the budgets: effects <= 1 MB, music <= 6 MB, and matches the manifest's byte counts", () => {
    const size = (dir: string) => readdirSync(`public/audio/${dir}`).reduce((n, name) => n + statSync(`public/audio/${dir}/${name}`).size, 0);
    const sfx = size("sfx");
    const music = size("music");
    expect(sfx).toBeLessThanOrEqual(1000 * KB);
    expect(music).toBeLessThanOrEqual(6000 * KB);
    expect({ sfx, music }).toEqual(real.bytes);
  });
});
