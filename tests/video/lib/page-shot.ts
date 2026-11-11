// A shot of the game's 2D page (index.html) in a browser window, not the headset's view: the result to share after a
// session, a friend's link landing. Each window is a fresh browser context with the headset's browser user agent
// (IWER's Quest 3 profile, which the e2e boot brings) and a window of `viewport` CSS px, drawn at the render size.
// The page is still between clicks, so each state is captured once and held for its time (no frame stepping). The
// result is a shot like any other (a lossless mezzanine and a sidecar with no events: its sound is the music bed
// only), so an edit cuts it in with the rest.
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "@playwright/test";
import type { MusicState } from "../../../src/audio/manifest";
import { boot as bootPage, type BootOptions } from "../../e2e/helpers/boot";
import type { XrApp } from "../../e2e/helpers/xr-app";
import { finishShot } from "./deliver";
import { ffmpeg, mediaFacts } from "./ffrun";
import { framesDir, mezzDir, type VideoOptions, workDir } from "./options";
import { readRecord, type ShotRecord, shotFile, writeRecord } from "./records";
import type { ShotContext, ShotRun } from "./shoot";
import { shotVersions } from "./version";

const ROOT = process.cwd();

export interface PageShotContext {
  /** A new browser window at the shot's size; `profile` is the player's history in it (as a shot's `profile`). */
  window(o?: { profile?: Record<string, unknown> }): Promise<Page>;
  /** The e2e boot in that window (IWER's headset: its user agent; enters XR unless `enterXR: false`). */
  boot(page: Page, o?: Omit<BootOptions, "viewport" | "testInfo" | "consoleLines">): Promise<XrApp>;
  /** Capture the window as it is now and hold it for `sec`. */
  hold(page: Page, sec: number): Promise<void>;
}

export interface PageShot {
  kind: "page";
  name: string;
  description: string;
  /** The browser window, CSS px (its aspect must be the render's). */
  viewport: { width: number; height: number };
  /** The film's music bed under it (the page itself is silent). Default "menu". */
  music?: MusicState;
  play(ctx: PageShotContext): Promise<void>;
}

export const definePageShot = (s: Omit<PageShot, "kind">): PageShot => ({ kind: "page", ...s });

/** Render a page shot, or reuse it while its versions hold. */
export async function renderPageShot(shot: PageShot, browser: Browser, baseURL: string, o: VideoOptions, ctx: ShotContext): Promise<ShotRun> {
  const log = ctx.log;
  const name = shot.name;
  for (const d of [o.outDir, mezzDir(o), workDir(o)]) fs.mkdirSync(d, { recursive: true });
  const v = shotVersions(ROOT, shotFile(name), o);
  const mezz = path.join(mezzDir(o), `${name}.mkv`);
  const old = o.fresh && ctx.retry === 0 ? null : readRecord(o, name);
  let base: ShotRecord | null = old && fs.existsSync(mezz) && old.frameVersion === v.frames && old.imageId === o.imageId ? old : null;
  if (base && base.mixVersion === v.mix && base.crf === o.crf && base.preset === o.preset && fs.existsSync(path.join(o.outDir, `${name}.mp4`))) {
    log(`${name}: up to date (${base.frames} frames)`);
    return { record: base, stopped: null, did: "cached" };
  }
  let did: ShotRun["did"] = "remixed";
  if (!base) {
    base = await capturePage(shot, browser, baseURL, o, v.frames, mezz, log);
    did = "rendered";
  }
  const record = await finishShot(base, o, v, mezz, log);
  return { record, stopped: null, did };
}

async function capturePage(shot: PageShot, browser: Browser, baseURL: string, o: VideoOptions, frameVersion: string, mezz: string, log: (s: string) => void): Promise<ShotRecord> {
  const t0 = Date.now();
  const { width: vw, height: vh } = shot.viewport;
  if (Math.abs(vw / vh - o.width / o.height) > 1e-3) throw new Error(`${shot.name}: a ${vw}x${vh} window is not the render's ${o.width}x${o.height} aspect`);
  const dir = framesDir(o, shot.name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const holds: Array<{ png: string; frames: number }> = [];
  const contexts: Array<{ close(): Promise<void> }> = [];
  const ctx: PageShotContext = {
    async window(w = {}) {
      const c = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: o.width / vw, ignoreHTTPSErrors: true, baseURL, timezoneId: "UTC" });
      contexts.push(c);
      const page = await c.newPage();
      if (w.profile) {
        await page.addInitScript((p) => {
          (window as unknown as { __nsVideoProfile?: unknown }).__nsVideoProfile = p;
        }, w.profile);
      }
      return page;
    },
    boot: (page, b = {}) => bootPage(page, { mode: "visual", ...b, viewport: shot.viewport }),
    async hold(page, sec) {
      // The emulator's own "Enter XR" button (IWER's, not the game's) goes, as the headset shots hide its DevUI.
      await page.evaluate(() => {
        for (const b of Array.from(document.querySelectorAll("button"))) {
          if (b.textContent?.trim() === "Enter XR" && !b.closest("#landing")) (b as HTMLElement).style.display = "none";
        }
      });
      const png = path.join(dir, `hold-${String(holds.length).padStart(3, "0")}.png`);
      await page.screenshot({ path: png, animations: "disabled", caret: "hide" });
      holds.push({ png, frames: Math.round(sec * o.fps) });
      log(`${shot.name}: hold ${holds.length} for ${sec} s`);
    },
  };
  try {
    await shot.play(ctx);
  } finally {
    for (const c of contexts) await c.close().catch(() => undefined);
  }
  if (holds.length === 0) throw new Error(`${shot.name}: nothing was held`);
  const frames = holds.reduce((n, h) => n + h.frames, 0);
  const tmp = `${mezz}.tmp.mkv`;
  ffmpeg([
    "-y", "-hide_banner", "-loglevel", "error",
    ...holds.flatMap((h) => ["-loop", "1", "-framerate", String(o.fps), "-t", String(h.frames / o.fps), "-i", h.png]),
    "-filter_complex", `${holds.map((_, i) => `[${i}:v]scale=${o.width}:${o.height}:flags=lanczos,setsar=1[h${i}]`).join(";")};${holds.map((_, i) => `[h${i}]`).join("")}concat=n=${holds.length}:v=1:a=0,format=rgb24[v]`,
    "-map", "[v]", "-frames:v", String(frames),
    "-c:v", "libx264rgb", "-qp", "0", "-preset", "veryfast", "-pix_fmt", "rgb24", "-r", String(o.fps),
    tmp,
  ]);
  const mf = mediaFacts(tmp, { audio: false });
  if (mf.frames !== frames || mf.width !== o.width || mf.height !== o.height) {
    throw new Error(`${shot.name}: mezzanine has ${mf.frames} frames of ${mf.width}x${mf.height}, expected ${frames} of ${o.width}x${o.height}`);
  }
  fs.renameSync(tmp, mezz);
  if (!o.keepFrames) fs.rmSync(dir, { recursive: true, force: true });
  const record: ShotRecord = {
    shot: shot.name,
    frameVersion,
    mixVersion: "",
    imageId: o.imageId,
    width: o.width,
    height: o.height,
    fps: o.fps,
    hfovDeg: o.hfovDeg,
    frames,
    duration: frames / o.fps,
    quality: o.quality,
    crf: o.crf,
    preset: o.preset,
    mp4: "",
    contact: "",
    stills: [],
    mezz: path.relative(ROOT, mezz),
    fx: "",
    events: [],
    music: { initial: shot.music ?? "menu", offsetSec: 0, changes: [] },
    ambience: false,
    ducks: [],
    cues: [],
    loudness: null,
    stats: { page: true, holds: holds.map((h) => h.frames), ms: { total: Date.now() - t0 } },
  };
  writeRecord(o, record);
  log(`${shot.name}: ${holds.length} page states, ${frames} frames (${record.duration.toFixed(2)} s) -> mezzanine`);
  return record;
}
