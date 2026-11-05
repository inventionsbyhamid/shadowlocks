import { fetchArrayBuffer, type AudioEngine, type LoadOptions, type SoundSet } from "./engine";
import type { AudioManifest } from "./manifest";
import { makePlaceholders } from "./placeholder";

/** Where the sound pack is served, relative to the page: `public/audio/` in the repo. */
export const SOUND_PACK_URL = "audio/";

export interface PackOptions {
  /** Folder holding manifest.json, sfx/ and music/. Default `audio/`, relative to the page. */
  baseUrl?: string;
  fetchData?: (url: string) => Promise<ArrayBuffer>;
  warn?: (message: string) => void;
}

export interface SoundPack {
  manifest: AudioManifest;
  /** For engine.loadSfx and engine.loadMusic: any file that fails to load falls back to its placeholder. */
  options: LoadOptions;
  /** manifest.json itself could not be read, so every sound is a placeholder. */
  placeholdersOnly: boolean;
}

/**
 * Reads the pack's manifest. Placeholders are synthesised only if something is missing, once.
 * Without a readable manifest the whole placeholder set is used, so the game always has sound.
 */
export async function openSoundPack(ctx: AudioContext, o: PackOptions = {}): Promise<SoundPack> {
  const baseUrl = o.baseUrl ?? SOUND_PACK_URL;
  const fetchData = o.fetchData ?? fetchArrayBuffer;
  let placeholders: SoundSet | undefined;
  const fallback = () => (placeholders ??= makePlaceholders(ctx));
  try {
    const manifest = JSON.parse(new TextDecoder().decode(await fetchData(`${baseUrl}manifest.json`))) as AudioManifest;
    if (!manifest || typeof manifest.sfx !== "object" || typeof manifest.music !== "object") throw new Error("not a sound manifest");
    return { manifest, options: { baseUrl, fetchData, fallback }, placeholdersOnly: false };
  } catch (e) {
    o.warn?.(`audio: no sound pack at ${baseUrl}manifest.json (${String(e)}); using placeholder sounds`);
    const p = fallback();
    return { manifest: p.manifest, options: { buffers: p.buffers }, placeholdersOnly: true };
  }
}

/**
 * Opens the pack and loads its sound effects: call before the first screen. Call the returned
 * `loadMusic` once the first screen is interactive (music is the bigger download).
 *
 *   const { loadMusic } = await loadSoundPack(engine, { baseUrl: `${import.meta.env.BASE_URL}audio/` });
 *   // first screen up
 *   void loadMusic();
 */
export async function loadSoundPack(engine: AudioEngine, o: PackOptions = {}): Promise<{ pack: SoundPack; loadMusic: () => Promise<void> }> {
  const pack = await openSoundPack(engine.context, o);
  await engine.loadSfx(pack.manifest, pack.options);
  return { pack, loadMusic: () => engine.loadMusic(pack.manifest, pack.options) };
}
