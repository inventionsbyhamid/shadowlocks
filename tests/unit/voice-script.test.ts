// The voice pack against the copy: every line the coach chip can show has an English clip, and each clip's text is the
// English copy at its key, so a later wording change fails here until the clip is made again.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTROLLER_KEYS } from "../../src/app/controller-lines";
import { copyAt, PHONE_KEYS } from "../../src/app/phone-lines";
import { VOICE_BUDGET_BYTES } from "../../src/audio/voice-pack";
import { chipKeys } from "../../src/app/voice-lines";
import { COPY } from "../../src/ui/copy";

const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(ROOT, "public/audio/voice");
const manifest = JSON.parse(readFileSync(path.join(DIR, "manifest.json"), "utf8")) as {
  kind: string;
  langs: { en: Record<string, { file: string; ms: number; bytes: number; text: string }> };
};
const en = manifest.langs.en;

describe("the voice pack", () => {
  it("lists every line the coach chip can show: the lessons, the tips, the suggestion, the phone's and the controllers'", () => {
    const lessons = Object.entries(COPY.lessons)
      .filter(([, v]) => typeof v === "string")
      .map(([k]) => `lessons.${k}`);
    const tips = Object.keys(COPY.lessons.tips).map((k) => `lessons.tips.${k}`);
    const want = [...lessons, ...tips, "game.controllerFinger", ...Object.values(PHONE_KEYS), ...Object.values(CONTROLLER_KEYS)];
    expect(new Set(chipKeys())).toEqual(new Set(want));
    for (const k of want) expect(en[k], k).toBeDefined();
    expect(Object.keys(en).sort()).toEqual([...new Set(want)].sort());
    expect(Object.keys(en).length).toBe(42);
  });

  it("says each line in the English copy's exact words", () => {
    for (const [k, clip] of Object.entries(en)) expect(clip.text, k).toBe(copyAt(k));
  });

  it("has every file, as long as the manifest says, within the voice budget", () => {
    let total = 0;
    for (const [k, clip] of Object.entries(en)) {
      expect(clip.file, k).toBe(`en/${k}.ogg`);
      expect(statSync(path.join(DIR, clip.file)).size, k).toBe(clip.bytes);
      expect(clip.ms, k).toBeGreaterThan(500);
      expect(clip.ms, k).toBeLessThan(6000);
      total += clip.bytes;
    }
    expect(manifest.kind).toBe("voice");
    expect(total).toBeLessThanOrEqual(VOICE_BUDGET_BYTES);
  });
});
