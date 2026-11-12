import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { framesDir, mezzDir, videoOptions } from "../video/lib/options";
import { diskProblem } from "../video/lib/recorder";
import { FRAME_INPUTS, fingerprint, listFiles, MIX_INPUTS, shotVersions } from "../video/lib/version";

let root = "";
const put = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const O = { imageId: "sha256:aa", width: 1920, height: 1080, fps: 60, hfovDeg: 90 };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "slversion-"));
  put("src/app/main.ts", "app");
  put("src/audio/cues.ts", "cues");
  put("public/ui/home.uikitml", "ui");
  put("public/audio/manifest.json", "{}");
  put("package-lock.json", "lock");
  put("tests/video/shots/s.ts", "shot");
  put("tests/video/lib/shoot.ts", "start at 30 s");
  put("tests/video/lib/audio.ts", "mix");
  put("tests/video/lib/deliver.ts", "edit");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("shot versions", () => {
  it("lists files in a stable order and fingerprints their bytes", () => {
    expect(listFiles(root, ["src", "missing"])).toEqual(["src/app/main.ts", "src/audio/cues.ts"]);
    const a = fingerprint(root, ["src/app/main.ts"]);
    put("src/app/main.ts", "app2");
    expect(fingerprint(root, ["src/app/main.ts"])).not.toBe(a);
  });

  it("frames follow the app, art, lockfile, image and shot; sound follows only the audio", () => {
    const v0 = shotVersions(root, "tests/video/shots/s.ts", O);
    put("public/audio/manifest.json", '{"x":1}');
    const v1 = shotVersions(root, "tests/video/shots/s.ts", O);
    expect(v1.frames).toBe(v0.frames);
    expect(v1.mix).not.toBe(v0.mix);
    put("src/audio/cues.ts", "cues2");
    expect(shotVersions(root, "tests/video/shots/s.ts", O).frames).toBe(v0.frames);
    for (const [rel, body] of [
      ["src/app/main.ts", "x"],
      ["public/ui/home.uikitml", "x"],
      ["package-lock.json", "x"],
      ["tests/video/shots/s.ts", "x"],
      ["tests/video/lib/shoot.ts", "start at 60 s"],
    ]) {
      const before = shotVersions(root, "tests/video/shots/s.ts", O).frames;
      put(rel as string, `${body}${Math.random()}`);
      expect(shotVersions(root, "tests/video/shots/s.ts", O).frames, rel).not.toBe(before);
    }
    // The mix library and the delivery and edit code change the sound only.
    let v2 = shotVersions(root, "tests/video/shots/s.ts", O);
    for (const rel of ["tests/video/lib/audio.ts", "tests/video/lib/deliver.ts"]) {
      put(rel, `${rel} ${Math.random()}`);
      const next = shotVersions(root, "tests/video/shots/s.ts", O);
      expect(next.frames, rel).toBe(v2.frames);
      expect(next.mix, rel).not.toBe(v2.mix);
      v2 = next;
    }
    expect(shotVersions(root, "tests/video/shots/s.ts", { ...O, imageId: "sha256:bb" }).frames).not.toBe(v2.frames);
    expect(shotVersions(root, "tests/video/shots/s.ts", { ...O, width: 1280, height: 720 }).frames).not.toBe(v2.frames);
  });

  it("names only video library files this repo has (a missing one would be skipped without a word)", () => {
    const lib = [...FRAME_INPUTS, ...MIX_INPUTS].filter((f) => f.startsWith("tests/video/"));
    expect(lib.length).toBeGreaterThan(5);
    for (const f of lib) expect(fs.existsSync(f), f).toBe(true);
  });
});

describe("render options and disk", () => {
  it("keeps deliveries per size and caches outside test-results", () => {
    const o = videoOptions({ QUALITY: "final", SHOTS: "a, b", EXPECT_GB: "3" }, "/w");
    expect(o.shots).toEqual(["a", "b"]);
    expect(o.outDir).toBe("/w/test-results/video/1920x1080-60");
    expect(videoOptions({ QUALITY: "final", FPS: "30" }, "/w").outDir).toBe("/w/test-results/video/1920x1080-30");
    expect(framesDir(o, "a")).toBe("/w/.video-cache/frames/a-1920x1080-60");
    expect(mezzDir(o)).toBe("/w/.video-cache/mezz/1920x1080-60");
    expect(o.minFreeGb).toBe(100);
    expect(o.expectGb).toBe(3);
    expect(videoOptions({}, "/w").outDir).toBe("/w/test-results/video/1280x720-60");
    expect(() => videoOptions({ SIZE: "1281x720" })).toThrow(/even/);
  });

  it("draws at the render size and delivers at OUT_SIZE, never larger", () => {
    const o = videoOptions({ QUALITY: "final", SIZE: "2560x1440", OUT_SIZE: "1920x1080" }, "/w");
    expect([o.width, o.height, o.outWidth, o.outHeight]).toEqual([2560, 1440, 1920, 1080]);
    expect(o.outDir).toBe("/w/test-results/video/2560x1440-60");
    const plain = videoOptions({ QUALITY: "final" }, "/w");
    expect([plain.outWidth, plain.outHeight]).toEqual([1920, 1080]);
    expect(() => videoOptions({ SIZE: "1280x720", OUT_SIZE: "1920x1080" })).toThrow(/larger/);
  });

  it("stops for low disk or frames past their budget", () => {
    const o = { minFreeGb: 100, expectGb: 4 };
    expect(diskProblem(200e9, 1e9, o)).toBeNull();
    expect(diskProblem(99e9, 1e9, o)).toMatch(/free disk 99.0 GB < 100 GB/);
    expect(diskProblem(200e9, 4.5e9, o)).toMatch(/frames take 4.5 GB/);
  });
});

describe("disk stop line", () => {
  it("keeps to the characters the detached watchdog accepts", async () => {
    const { diskStopLine } = await import("../video/lib/shoot");
    const line = diskStopLine("sample", "free disk 99.0 GB < 100 GB: stopped with 24 frames kept; run again (resume)");
    expect(line).toBe('[video-stop] {"reason":"sample: free disk 99.0 GB under 100 GB: stopped with 24 frames kept run again resume"}');
    const json = line.replace("[video-stop] ", "");
    expect(json).toMatch(/^\{[A-Za-z0-9_":,. -]*\}$/);
  });
});
