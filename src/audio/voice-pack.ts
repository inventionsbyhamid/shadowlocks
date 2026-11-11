// The voice guide's clips (public/audio/voice/: manifest.json and <lang>/<copy key>.ogg, Ogg Opus mono 32 kb/s). The
// manifest names each line by the copy key whose words the coach chip shows, with its length (`ms`), which the lessons'
// pacing reads; the files are fetched once (about 0.6 MB, after the first screen is up, from the offline precache
// after the first load) and kept compressed. Decoded, the whole English pack would be about 27 MiB, so a clip is
// decoded only while its part of a lesson needs it (`want`), at most DECODE_GROUP at a time, and dropped after. A
// missing manifest, language or file means text only: never a stand-in sound.
import { fetchArrayBuffer } from "./engine";

/** Where the voice pack is served, relative to the page. */
export const VOICE_PACK_URL = "audio/voice/";
/** The download budget for one language's voice. */
export const VOICE_BUDGET_BYTES = 800_000;
/** Clips decoded at once, at most. */
export const DECODE_GROUP = 4;

export interface VoiceClip {
  /** Relative to the pack's folder: `en/lessons.goal.ogg`. */
  file: string;
  /** Its length as made (the pacing waits for it). */
  ms: number;
  bytes?: number;
  group?: string;
  /** The words, as recorded (a unit test checks them against the copy). */
  text?: string;
}

export interface VoiceManifest {
  version: number;
  kind: "voice";
  /** By language, then by copy key. */
  langs: Partial<Record<string, Record<string, VoiceClip>>>;
}

export interface VoicePackDeps {
  /** The audio context's decodeAudioData (it may detach the data: the pack hands it a copy). */
  decode(data: ArrayBuffer): Promise<AudioBuffer>;
  fetchData?: (url: string) => Promise<ArrayBuffer>;
  /** The pack's folder, ending in a slash (default VOICE_PACK_URL). */
  baseUrl?: string;
  warn?: (message: string) => void;
}

export class VoicePack {
  private readonly bytes = new Map<string, ArrayBuffer>();
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Keys whose file would not load or decode: text only. */
  private readonly broken = new Set<string>();
  private wanted: ReadonlySet<string> = new Set();
  private fetching: Promise<void> | null = null;
  /** Decoding runs one want after another. */
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    readonly lang: string,
    private readonly clips: Readonly<Record<string, VoiceClip>>,
    private readonly deps: VoicePackDeps,
  ) {}

  /** The pack for `lang`, or null (no manifest, or no clips in that language): text only. */
  static async open(lang: string, deps: VoicePackDeps): Promise<VoicePack | null> {
    const base = deps.baseUrl ?? VOICE_PACK_URL;
    try {
      const m = JSON.parse(new TextDecoder().decode(await (deps.fetchData ?? fetchArrayBuffer)(`${base}manifest.json`))) as VoiceManifest;
      if (!m || m.kind !== "voice" || typeof m.langs !== "object") throw new Error("not a voice manifest");
      const clips = m.langs[lang];
      return clips && Object.keys(clips).length ? new VoicePack(lang, clips, deps) : null;
    } catch (e) {
      deps.warn?.(`voice: no voice pack at ${base}manifest.json (${String(e)}); text only`);
      return null;
    }
  }

  /** The manifest has a clip for line `key` (it may still fail to load). */
  known(key: string): boolean {
    return key in this.clips;
  }

  /** Line `key` has a clip that loaded (or is still loading). */
  has(key: string): boolean {
    return key in this.clips && !this.broken.has(key);
  }

  /** Line `key`'s length (ms), or 0 when it has no clip. */
  ms(key: string): number {
    return this.has(key) ? this.clips[key]!.ms : 0;
  }

  /** Line `key` decoded, or null (not wanted yet, still decoding, or no clip). */
  buffer(key: string): AudioBuffer | null {
    return this.buffers.get(key) ?? null;
  }

  /** The keys decoded now (tests, the memory check). */
  decoded(): string[] {
    return [...this.buffers.keys()];
  }

  /** What the decoded clips hold in memory (bytes of samples). */
  decodedBytes(): number {
    let n = 0;
    for (const b of this.buffers.values()) n += b.length * b.numberOfChannels * 4;
    return n;
  }

  /** Fetch every file once (compressed, kept); a file that fails is text only. */
  fetchAll(): Promise<void> {
    this.fetching ??= (async () => {
      const base = this.deps.baseUrl ?? VOICE_PACK_URL;
      const get = this.deps.fetchData ?? fetchArrayBuffer;
      await Promise.all(
        Object.entries(this.clips).map(async ([key, clip]) => {
          try {
            this.bytes.set(key, await get(base + clip.file));
          } catch (e) {
            this.fail(key, `voice: could not load ${clip.file}: ${String(e)}; text only`);
          }
        }),
      );
    })();
    return this.fetching;
  }

  /**
   * The clips a part of a lesson needs: those decoded (DECODE_GROUP at a time, in this order), every other decoded clip
   * dropped. A later call replaces the set.
   */
  want(keys: readonly string[]): Promise<void> {
    const set = new Set(keys);
    this.wanted = set;
    for (const k of [...this.buffers.keys()]) if (!set.has(k)) this.buffers.delete(k);
    this.chain = this.chain.then(() => this.decodeWanted(set));
    return this.chain;
  }

  private async decodeWanted(set: ReadonlySet<string>): Promise<void> {
    await (this.fetching ?? this.fetchAll());
    const todo = [...set].filter((k) => this.wanted === set && !this.buffers.has(k) && this.bytes.has(k) && !this.broken.has(k));
    for (let i = 0; i < todo.length && this.wanted === set; i += DECODE_GROUP) {
      await Promise.all(
        todo.slice(i, i + DECODE_GROUP).map(async (k) => {
          try {
            const b = await this.deps.decode(this.bytes.get(k)!.slice(0));
            if (this.wanted.has(k)) this.buffers.set(k, b);
          } catch (e) {
            this.fail(k, `voice: could not decode ${this.clips[k]!.file}: ${String(e)}; text only`);
          }
        }),
      );
    }
  }

  private fail(key: string, message: string): void {
    if (this.broken.has(key)) return;
    this.broken.add(key);
    this.bytes.delete(key);
    this.deps.warn?.(message);
  }
}
