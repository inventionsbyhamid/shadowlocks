// What a shot's output depends on, as two fingerprints. Frames and the lossless mezzanine depend on
// the app (code, art, scene, build config, dependencies), the browser image, the shot script and the
// video library; the sound depends on the audio code, the sound pack and the mix library. A change to
// the sound only re-mixes from the stored events; anything else renders the frames again.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Files under `entries` (files or folders, relative to `root`), sorted, minus those `skip` names. */
export function listFiles(root: string, entries: string[], skip: (rel: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(root, rel);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch {
      return;
    }
    if (skip(rel)) return;
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) walk(path.join(rel, name));
    } else if (st.isFile()) {
      out.push(rel);
    }
  };
  for (const e of entries) walk(e);
  return [...new Set(out)].sort();
}

/** sha256 over each file's path and bytes, plus extra strings; the first 16 hex characters. */
export function fingerprint(root: string, files: string[], extra: string[] = []): string {
  const h = crypto.createHash("sha256");
  for (const rel of files) {
    h.update(`${rel}\0`);
    h.update(fs.readFileSync(path.join(root, rel)));
    h.update("\0");
  }
  for (const x of extra) h.update(`${x}\0`);
  return h.digest("hex").slice(0, 16);
}

const isAudio = (rel: string) => rel.startsWith(`src${path.sep}audio${path.sep}`) || rel.startsWith(`public${path.sep}audio${path.sep}`);

/** Everything that changes what a frame looks like. */
export const FRAME_INPUTS = [
  "src",
  "public",
  "index.html",
  "iwsdk.config.json",
  "vite.config.ts",
  "vite.test.config.ts",
  "package-lock.json",
  "playwright.video.config.ts",
  "tests/e2e/helpers",
  "tests/video/lib/camera.ts",
  "tests/video/lib/journal.ts",
  "tests/video/lib/page-video.ts",
  "tests/video/lib/recorder.ts",
  "tests/video/lib/shot.ts",
  // Shared setup of a box in play (the store's inline media shots).
  "tests/video/lib/stage.ts",
  // Shots of the 2D page.
  "tests/video/lib/page-shot.ts",
  // The start time, epoch, boot options and the align, setup and warm-up order live here.
  "tests/video/lib/shoot.ts",
  "tests/video/lib/options.ts",
];

/** Everything that changes a shot's sound (given the same events). */
export const MIX_INPUTS = [
  "src/audio",
  "public/audio",
  "tests/video/lib/audio.ts",
  "tests/video/lib/mixdown.ts",
  "tests/video/lib/loudness.ts",
  "tests/video/lib/deliver.ts",
  // The ffmpeg runs of the sound (loudness normalisation among them).
  "tests/video/lib/ffrun.ts",
];

export interface Versions {
  frames: string;
  mix: string;
}

export function shotVersions(
  root: string,
  shotFile: string,
  o: { imageId: string; width: number; height: number; fps: number; hfovDeg: number },
): Versions {
  const frameFiles = listFiles(root, [...FRAME_INPUTS, shotFile], isAudio);
  return {
    frames: fingerprint(root, frameFiles, [`image ${o.imageId}`, `${o.width}x${o.height}@${o.fps}`, `hfov ${o.hfovDeg}`]),
    mix: fingerprint(root, listFiles(root, MIX_INPUTS)),
  };
}
