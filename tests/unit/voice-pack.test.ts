// The voice pack at runtime: its manifest read (none: text only), every file fetched once, clips decoded only when
// wanted and at most four at a time, dropped when no longer wanted, and a file that fails is text only, warned once.
import { describe, expect, it, vi } from "vitest";
import { DECODE_GROUP, VoicePack, type VoicePackDeps } from "../../src/audio/voice-pack";

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

function pack(keys: string[], o: { fail?: string[]; noManifest?: boolean; badDecode?: string[] } = {}) {
  const clips = Object.fromEntries(keys.map((k, i) => [k, { file: `en/${k}.ogg`, ms: 1000 + i, bytes: 10, group: "l1", text: k }]));
  const fetched: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const deps: VoicePackDeps = {
    baseUrl: "audio/voice/",
    fetchData: vi.fn(async (url: string) => {
      fetched.push(url);
      if (url.endsWith("manifest.json")) {
        if (o.noManifest) throw new Error("HTTP 404");
        return enc(JSON.stringify({ version: 1, kind: "voice", langs: { en: clips } }));
      }
      if (o.fail?.some((k) => url.endsWith(`${k}.ogg`))) throw new Error("HTTP 404");
      return enc(url);
    }),
    decode: vi.fn(async (data: ArrayBuffer) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      const url = new TextDecoder().decode(data);
      if (o.badDecode?.some((k) => url.endsWith(`${k}.ogg`))) throw new Error("bad data");
      return { duration: 1, length: 48000, numberOfChannels: 1, url } as unknown as AudioBuffer;
    }),
    warn: vi.fn(),
  };
  return { deps, fetched, peak: () => peak };
}

describe("VoicePack", () => {
  it("reads the manifest for a language; none, or none for the language, is text only", async () => {
    const a = pack(["lessons.goal"]);
    const p = await VoicePack.open("en", a.deps);
    expect(p).not.toBeNull();
    expect(p!.ms("lessons.goal")).toBe(1000);
    expect(p!.ms("lessons.nope")).toBe(0);
    expect(await VoicePack.open("de", a.deps)).toBeNull();
    const b = pack([], { noManifest: true });
    expect(await VoicePack.open("en", b.deps)).toBeNull();
    expect(b.deps.warn).toHaveBeenCalledTimes(1);
  });

  it("fetches every file once, but decodes only what is wanted, at most four at a time, and drops the rest", async () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g"].map((k) => `lessons.${k}`);
    const t = pack(keys);
    const p = (await VoicePack.open("en", t.deps))!;
    await p.fetchAll();
    expect(t.fetched.filter((u) => u.endsWith(".ogg")).length).toBe(7);
    expect(p.decoded()).toEqual([]);
    await p.want(keys.slice(0, 6));
    expect(p.decoded()).toEqual(keys.slice(0, 6));
    expect(t.peak()).toBeLessThanOrEqual(DECODE_GROUP);
    expect(p.buffer("lessons.a")).not.toBeNull();
    // The part is over: its buffers go, the next part's come.
    await p.want(["lessons.f", "lessons.g"]);
    expect(p.decoded()).toEqual(["lessons.f", "lessons.g"]);
    expect(p.buffer("lessons.a")).toBeNull();
    expect(p.decodedBytes()).toBe(2 * 48000 * 4);
    // Fetched once: nothing more.
    expect(t.fetched.filter((u) => u.endsWith(".ogg")).length).toBe(7);
  });

  it("decodes a line asked for before the files are in once they are", async () => {
    const t = pack(["lessons.goal"]);
    const p = (await VoicePack.open("en", t.deps))!;
    const fetching = p.fetchAll();
    const wanted = p.want(["lessons.goal"]);
    await fetching;
    await wanted;
    expect(p.buffer("lessons.goal")).not.toBeNull();
  });

  it("treats a file that will not load or decode as text only, warned once, its length 0", async () => {
    const t = pack(["lessons.goal", "lessons.watch", "lessons.slide"], { fail: ["lessons.watch"], badDecode: ["lessons.slide"] });
    const p = (await VoicePack.open("en", t.deps))!;
    await p.fetchAll();
    expect(p.has("lessons.watch")).toBe(false);
    expect(p.ms("lessons.watch")).toBe(0);
    await p.want(["lessons.goal", "lessons.watch", "lessons.slide"]);
    await p.want(["lessons.goal", "lessons.watch", "lessons.slide"]);
    expect(p.buffer("lessons.goal")).not.toBeNull();
    expect([p.buffer("lessons.watch"), p.buffer("lessons.slide")]).toEqual([null, null]);
    expect(p.has("lessons.slide")).toBe(false);
    expect(t.deps.warn).toHaveBeenCalledTimes(2);
  });
});
