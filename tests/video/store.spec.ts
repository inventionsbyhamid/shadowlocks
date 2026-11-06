// The Meta Horizon Store art, rendered from the game on the build server (scripts/store-art.sh runs this with
// playwright.store.config.ts): plates first (the box lit by its lantern, from a set camera, in the video build's look on
// the virtual clock), then the art cut from them with the title in Limelight, and the five screenshots as real frames of
// the game's moments. Layout, sizes and rules: lib/store-art.ts; the staged moments: lib/stage.ts (shared with the
// listing's inline media and the trailer). Output: test-results/store/ (the art at its final sizes and pixel formats,
// store-art.json describing each file, overview.png for review), plates in test-results/store/plates/.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { V3, Vec3 } from "../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../e2e/helpers/boot";
import { grab } from "../e2e/helpers/lantern";
import { setHeadset, stopRoomRender } from "../e2e/helpers/page-scripts";
import { type BootFn, expect, test } from "../e2e/helpers/test";
import type { XrApp } from "../e2e/helpers/xr-app";
import { ffmpeg } from "./lib/ffrun";
import { frameFingerprint, videoInit, videoPrepare } from "./lib/page-video";
import { ShotHand } from "./lib/shot";
import { fingerLock, lanternPos, offset, openIfShut, plainLock, showBox, toWorld } from "./lib/stage";
import {
  ART,
  artHtml,
  boundsOf,
  boxPoints,
  clearOf,
  eyeBehind,
  fovyRad,
  keySilhouette,
  overviewHtml,
  type Plate,
  type PlateScene,
  PLATES,
  project,
  type Rect,
  SCREENSHOT_COUNT,
  SCREENSHOT_SIZE,
  screenshotFile,
  textSafe,
  TITLE_CLEARANCE,
  TITLE_FONT_FILE,
  toPixels,
} from "./lib/store-art";

const OUT = path.join("test-results", "store");
const PLATES_DIR = path.join(OUT, "plates");
const RAW = path.join(OUT, "raw");
const REVIEW = path.join(OUT, "review");
const DT = 1000 / 72;
/** Hands at rest behind and below the seated eyes: out of every view here. */
const PARK_RIGHT: Vec3 = [0.35, 0.65, -0.95];
const PARK_LEFT: Vec3 = [-0.35, 0.65, -0.95];
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];

test.beforeAll(() => {
  for (const d of [PLATES_DIR, RAW, REVIEW]) fs.mkdirSync(d, { recursive: true });
});

/** Boot the video build at `width` x `height`, seated, the box placed, both hands parked out of view. */
async function bootAt(
  page: Page,
  boot: BootFn,
  width: number,
  height: number,
  url?: string,
): Promise<{ app: XrApp; left: ShotHand; right: ShotHand }> {
  await page.addInitScript(videoInit);
  const app = await boot({ mode: "visual", viewport: { width, height }, url });
  const prep = await page.evaluate(videoPrepare, { fovy: fovyRad(56), epochMs: new Date(DEFAULT_DATE).getTime(), fingerprint: frameFingerprint.toString() });
  expect(prep.canvas, "the XR canvas is the plate's size").toEqual([width, height]);
  // Setup frames step without drawing (every system still runs, as in the video recorder's fast-forward); grab() draws
  // the frames it captures. A full-size drawn frame costs seconds in software GL.
  await page.evaluate(() => ((window as any).__nsVideoSkip = true));
  const right = new ShotHand(app, "right");
  const left = new ShotHand(app, "left");
  await right.park(PARK_RIGHT);
  await left.park(PARK_LEFT);
  return { app, left, right };
}

/** Menus away, box `scene.box` in the lap, its lantern on the lock's spot (or its start), chosen locks open. */
async function stage(app: XrApp, page: Page, scene: PlateScene): Promise<V3> {
  await showBox(app, page, scene.box);
  if (scene.lock !== undefined) {
    const spot = (await page.evaluate((k) => (window as any).__ns.scene.box().spots[k], scene.lock)) as V3;
    await page.evaluate((p) => (window as any).__sl.placeLantern(p), spot);
  }
  for (const k of scene.open ?? []) await openIfShut(page, k);
  // Etching, warmth, the gold fill and the theatre's dimming ease in over a few frames.
  await app.step(90);
  return lanternPos(page);
}

/** Put the headset at `eye` looking at `at` (world) with a vertical field of view of `vfovDeg`. */
async function aim(page: Page, eye: Vec3, at: Vec3, vfovDeg: number): Promise<void> {
  await page.evaluate(setHeadset, { position: { x: eye[0], y: eye[1], z: eye[2] }, lookAt: { x: at[0], y: at[1], z: at[2] } });
  await page.evaluate((f) => ((window as any).IWER_DEVICE.fovy = f), fovyRad(vfovDeg));
}

/**
 * The theatre lights dim the room by drawing a dark layer in the app over it (about 65% opaque in play, per the look
 * pick): a real screenshot needs at least this much of the app layer's opacity over the room (the top band of the
 * frame, above the box). Without the theatre the app layer is clear there.
 */
const THEATRE_MIN_ALPHA = 0.4;

/**
 * Wait for async work, draw `frames` frames (the last one captured in the same task, so no preserved drawing buffer is
 * needed) and return it as a PNG data URL: the room and the app, or (room off) the app alone with its transparent
 * background. `dimAlpha`: the app layer's mean opacity over the top 15% of the frame (the room above the box).
 */
async function grabFrame(page: Page, room: boolean, frames = 3): Promise<{ url: string; dimAlpha: number }> {
  return page.evaluate(
    async (o) => {
      const w = window as any;
      w.__nsVideoSkip = false;
      for (let i = 0; i < o.frames; i++) {
        await w.__nsVideoIdle?.();
        w.__nsVideo?.styleHands(true);
        w.__vt.step(o.dt);
      }
      const app = w.__ns.world.renderer.domElement as HTMLCanvasElement;
      const small = document.createElement("canvas");
      small.width = 160;
      small.height = 90;
      const s = small.getContext("2d")!;
      s.drawImage(app, 0, 0, 160, 90);
      const band = s.getImageData(0, 0, 160, 14).data;
      let alpha = 0;
      for (let i = 3; i < band.length; i += 4) alpha += band[i]!;
      const dimAlpha = alpha / (band.length / 4) / 255;
      let url: string;
      if (o.room) url = w.__nsCapture("image/png") as string;
      else {
        const c = document.createElement("canvas");
        c.width = app.width;
        c.height = app.height;
        c.getContext("2d")!.drawImage(app, 0, 0);
        url = c.toDataURL("image/png");
      }
      w.__nsVideoSkip = true;
      return { url, dimAlpha };
    },
    { room, frames, dt: DT },
  );
}

const writeDataUrl = (file: string, url: string) => fs.writeFileSync(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
const dataUrl = (file: string) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

interface PlateInfo {
  name: string;
  width: number;
  height: number;
  /** Where the box's centre lands (fractions of the frame): the backdrop's glow goes there. */
  glow: [number, number];
  /** The box (frame, glass, plinth) and its lantern on screen, fractions of the frame; null for the lantern alone. */
  boxRect: Rect | null;
  lantern: V3;
  /** The eye, box units relative to the box (covers) or to the lantern (the icon). */
  eye: readonly [number, number, number];
  /** Alpha at the frame's corner: 0 means the app layer is transparent where nothing is drawn. */
  cornerAlpha: number;
}

/** Render one plate: the room not drawn, the camera on the box (covers) or on the lantern alone (the icon). */
async function renderPlate(page: Page, boot: BootFn, p: Plate): Promise<PlateInfo> {
  const { app } = await bootAt(page, boot, p.width, p.height);
  await page.evaluate(stopRoomRender);
  // The covers keep their own dark backdrop: no theatre layer over the box (the setting players have too). A build
  // without the setting gets a warning, not a guess: its plates may carry the veil.
  const dimming = await page.evaluate(() => {
    const ui = (window as any).__ns.ui;
    if (typeof ui.settings()?.dimming !== "boolean") return "missing";
    ui.setSettings({ dimming: false });
    return ui.settings().dimming === false ? "off" : "stuck";
  });
  if (dimming !== "off") console.warn(`store art: the dimming setting is ${dimming}; the ${p.name} plate may show the theatre veil`);
  const lantern = await stage(app, page, p.scene);
  let eyeW: Vec3, atW: Vec3, vfov: number, eyeBox: readonly [number, number, number];
  let boxRect: Rect | null = null;
  let glow: [number, number];
  if (p.lanternView) {
    const o = p.lanternView.offset;
    eyeBox = [lantern[0] + o[0], lantern[1] + o[1], lantern[2] + o[2]];
    [eyeW, atW] = (await Promise.all([toWorld(page, eyeBox), toWorld(page, lantern)])) as [Vec3, Vec3];
    vfov = p.lanternView.vfovDeg;
    glow = [0.5, 0.5];
  } else {
    const v = p.view!;
    eyeBox = eyeBehind(v.eye, lantern[2]);
    const [e, a, c] = await Promise.all([toWorld(page, eyeBox), toWorld(page, v.at), toWorld(page, [0, 0, 0.5])]);
    [eyeW, atW] = [e, a];
    vfov = v.vfovDeg;
    glow = project(c, eyeW, atW, vfov, p.width, p.height) ?? [0.5, 0.5];
    const world = await Promise.all(boxPoints(lantern).map((q) => toWorld(page, q)));
    boxRect = boundsOf(world.map((q) => project(q, eyeW, atW, vfov, p.width, p.height)));
  }
  await aim(page, eyeW, atW, vfov);
  const { url } = await grabFrame(page, false);
  writeDataUrl(path.join(PLATES_DIR, `${p.name}.png`), url);
  const cornerAlpha = await page.evaluate(async (u) => {
    const img = new Image();
    img.src = u;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 4;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, 1, 1).data[3]!;
  }, url);
  const info: PlateInfo = { name: p.name, width: p.width, height: p.height, glow, boxRect, lantern, eye: eyeBox, cornerAlpha };
  fs.writeFileSync(path.join(PLATES_DIR, `${p.name}.json`), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

for (const p of PLATES) {
  test(`plate ${p.name} (${p.width}x${p.height})`, async ({ page, boot }) => {
    const info = await renderPlate(page, boot, p);
    expect(fs.statSync(path.join(PLATES_DIR, `${p.name}.png`)).size).toBeGreaterThan(10_000);
    const r = info.boxRect;
    console.log(`plate ${p.name}: box ${r ? `${r.left.toFixed(2)}..${r.right.toFixed(2)} x ${r.top.toFixed(2)}..${r.bottom.toFixed(2)}` : "(lantern alone)"}, corner alpha ${info.cornerAlpha}`);
    if (r) {
      // The whole box and its lantern on the cover (the first render cut the plinth).
      expect(r.left, `${p.name}: box ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(0.01);
      expect(r.right, `${p.name}: box ${JSON.stringify(r)}`).toBeLessThanOrEqual(0.99);
      expect(r.top, `${p.name}: box ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(0.01);
      expect(r.bottom, `${p.name}: box ${JSON.stringify(r)}`).toBeLessThanOrEqual(0.99);
    }
  });
}

/** One screenshot: set the game up (hands included) and say where the camera goes, from the seated player's side. */
interface Screenshot {
  name: string;
  /** A query for the page (a lesson, say), when the moment needs one at boot. */
  url?: string;
  setup(c: { app: XrApp; page: Page; left: ShotHand; right: ShotHand }): Promise<{ eye: Vec3; at: Vec3; vfovDeg: number }>;
}

/** Fails clearly when a moment needs a hook the build under test does not have yet. */
async function need(page: Page, hook: string, what: string): Promise<void> {
  const has = await page.evaluate((h) => h.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), window) != null, hook);
  if (!has) throw new Error(`this screenshot needs ${what} (window.${hook}); render it from a main that has it`);
}

/**
 * The five moments (art direction, 2026-11-06), real frames from near the seated eyes. No menus. The game dims the room
 * while a box is in play (the theatre lights), so the emulator's office recedes and the box glows. Real headset captures
 * from the tester's session, if they come, replace 1 and 3.
 */
const SCREENSHOTS: Screenshot[] = [
  {
    // 1. The held lantern lining the shadows up: a hand carries it to just off a lock's spot.
    name: "lining-up",
    async setup({ app, page, right }) {
      await showBox(app, page, 1);
      const { spot } = plainLock(1);
      const off = await grab(app, page, right);
      const s = await toWorld(page, spot);
      await right.moveTo(offset([s[0] - off[0], s[1] - off[1], s[2] - off[2]], 0.012, 0.008, 0.01), 700);
      await app.step(40);
      return { eye: offset(EYE, -0.04, -0.03, -0.05), at: await toWorld(page, [0.05, -0.05, 0.4]), vfovDeg: 48 };
    },
  },
  {
    // 2. A lock opening in gold, the sunburst behind it: the lantern carried onto the spot and held there.
    name: "lock-opens",
    async setup({ app, page, right }) {
      await showBox(app, page, 1);
      const { lock, spot } = plainLock(1);
      const off = await grab(app, page, right);
      const s = await toWorld(page, spot);
      await right.moveTo([s[0] - off[0], s[1] - off[1], s[2] - off[2]], 700);
      await app.step(60);
      await openIfShut(page, lock);
      // Into the opening: the sunburst at its fullest.
      await app.step(30);
      return { eye: offset(EYE, -0.05, -0.02, -0.07), at: await toWorld(page, [0, 0, 0.15]), vfovDeg: 44 };
    },
  },
  {
    // 3. The fingertip casting the missing piece of box 3's finger lock.
    name: "fingertip",
    async setup({ app, page, right }) {
      await showBox(app, page, 3);
      const f = fingerLock(3);
      await page.evaluate((p) => (window as any).__sl.placeLantern(p), f.spot);
      await app.step(10);
      const tip = await toWorld(page, f.tip);
      await right.point();
      await right.glideTip(offset(tip, 0.06, -0.08, 0.05), 300);
      await right.glideTip(tip, 900);
      // Held long enough for the piece to start filling.
      await app.step(110);
      return { eye: offset(EYE, -0.07, -0.05, -0.09), at: await toWorld(page, [0, 0, 0.15]), vfovDeg: 44 };
    },
  },
  {
    // 4. The box open, the reward plaque rising: box 1 played through the box session to its open.
    name: "box-open",
    async setup({ app, page }) {
      await need(page, "__sl.session", "the box session");
      await page.evaluate(() => (window as any).__ns.ui.go("play"));
      await page.evaluate(() => (window as any).__sl.session.play({ kind: "box", n: 1 }));
      await app.step(10);
      await page.evaluate((p) => (window as any).__sl.placeLantern(p), plainLock(1).spot);
      await app.stepUntil((_ns, w) => !!w.__sl.session.reward()?.up, { maxMs: 20_000, label: "the box open, the reward up" });
      await app.step(20);
      return { eye: offset(EYE, 0, 0.02, -0.04), at: (await app.state()).boxPose.position as Vec3, vfovDeg: 52 };
    },
  },
  {
    // 5. A lesson's ghost hand demonstrating the move.
    name: "lesson-ghost",
    url: "/?lesson=l1",
    async setup({ app, page }) {
      await need(page, "__sl.lesson", "the lessons");
      // Into the demonstration: the ghost hand mid-move.
      await app.step(200);
      return { eye: offset(EYE, -0.03, -0.02, -0.05), at: offset((await app.state()).boxPose.position as Vec3, 0.03, 0, 0.06), vfovDeg: 50 };
    },
  },
];

for (const [i, shot] of SCREENSHOTS.entries()) {
  test(`screenshot ${i + 1}: ${shot.name} (2560x1440)`, async ({ page, boot }) => {
    expect(SCREENSHOTS).toHaveLength(SCREENSHOT_COUNT);
    const { width, height } = SCREENSHOT_SIZE;
    const ctx = await bootAt(page, boot, width, height, shot.url);
    const cam = await shot.setup({ app: ctx.app, page, left: ctx.left, right: ctx.right });
    await aim(page, cam.eye, cam.at, cam.vfovDeg);
    const { url, dimAlpha } = await grabFrame(page, true, 4);
    // Store screenshots show the game as played: the room dimmed by the theatre lights, the box glowing.
    if (dimAlpha < THEATRE_MIN_ALPHA) {
      throw new Error(
        `screenshot ${i + 1}: the room is not dimmed (the app layer is ${(dimAlpha * 100).toFixed(0)}% opaque over it, want at least ${THEATRE_MIN_ALPHA * 100}%): render screenshots from a build with the theatre lights`,
      );
    }
    writeDataUrl(path.join(RAW, screenshotFile(i + 1)), url);
  });
}

/** Width, height and pixel format of an image, from ffprobe. */
function imageFacts(file: string): { width: number; height: number; pixFmt: string } {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "csv=p=0", file], {
    encoding: "utf8",
  }).trim();
  const [w, h, f] = out.split(",");
  return { width: Number(w), height: Number(h), pixFmt: String(f) };
}

/** Write `src` as `dst` at exactly width x height: 24-bit RGB, or 32-bit RGBA with `alpha`. */
function finalPng(src: string, dst: string, width: number, height: number, alpha: boolean): ReturnType<typeof imageFacts> {
  ffmpeg(["-y", "-v", "error", "-i", src, "-vf", `scale=${width}:${height}:flags=lanczos`, "-frames:v", "1", "-pix_fmt", alpha ? "rgba" : "rgb24", dst]);
  const f = imageFacts(dst);
  expect(f, dst).toEqual({ width, height, pixFmt: alpha ? "rgba" : "rgb24" });
  return f;
}

test("art: covers, icon and logo cut from the plates, with the title; screenshots in their final format", async ({ page }) => {
  const font = `data:font/ttf;base64,${fs.readFileSync(TITLE_FONT_FILE).toString("base64")}`;
  const report: Array<Record<string, unknown>> = [];
  const missing: string[] = [];
  const problems: string[] = [];
  for (const a of ART) {
    let plate: string | undefined;
    let info: PlateInfo | undefined;
    if (a.plate) {
      const png = path.join(PLATES_DIR, `${a.plate}.png`);
      if (!fs.existsSync(png)) {
        missing.push(`${a.file} (plate ${a.plate})`);
        continue;
      }
      plate = dataUrl(png);
      info = JSON.parse(fs.readFileSync(path.join(PLATES_DIR, `${a.plate}.json`), "utf8")) as PlateInfo;
    }
    await page.setViewportSize({ width: a.width, height: a.height });
    await page.setContent(artHtml(a, { plate, glow: a.icon ? undefined : info?.glow, fontDataUrl: font, silhouette: a.icon ? keySilhouette() : undefined }));
    const ok = await page.evaluate(async () => {
      // A face loads only once something asks for it: ask, then wait for every load.
      await document.fonts.load("40px Limelight");
      await document.fonts.ready;
      for (const img of [...document.images]) await img.decode();
      return document.fonts.check("40px Limelight");
    });
    expect(ok, "the Limelight font loaded").toBe(true);
    let title: Rect | null = null;
    if (a.title) {
      // Shrink the title to its width limit, then read where it ended up.
      title = await page.evaluate((maxW) => {
        const el = document.getElementById("title")!;
        const r0 = el.getBoundingClientRect();
        if (r0.width > maxW) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * (maxW / r0.width)}px`;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }, a.title.maxWidth * a.width);
      if (!a.alpha) {
        const safe = textSafe(title, a.width, a.height);
        if (safe) problems.push(`${a.file}: ${safe}`);
        if (info?.boxRect) {
          const clear = clearOf(title, toPixels(info.boxRect, a.width, a.height), TITLE_CLEARANCE * Math.min(a.width, a.height));
          if (clear) problems.push(`${a.file}: ${clear}`);
        }
      }
    }
    const raw = path.join(RAW, a.file);
    await page.screenshot({ path: raw, omitBackground: a.alpha, fullPage: false });
    const facts = finalPng(raw, path.join(OUT, a.file), a.width, a.height, a.alpha);
    report.push({ file: a.file, ...facts, plate: a.plate ?? null, title: title && { ...title, text: "Shadow Locks" }, box: info?.boxRect ?? null });
    if (a.icon) {
      // How it reads small: the icon at 64 and 128 px, for the review sheet only.
      for (const s of [64, 128]) finalPng(path.join(OUT, a.file), path.join(REVIEW, `icon-${s}.png`), s, s, false);
    }
  }
  for (let i = 1; i <= SCREENSHOT_COUNT; i++) {
    const raw = path.join(RAW, screenshotFile(i));
    if (!fs.existsSync(raw)) {
      missing.push(screenshotFile(i));
      continue;
    }
    const facts = finalPng(raw, path.join(OUT, screenshotFile(i)), SCREENSHOT_SIZE.width, SCREENSHOT_SIZE.height, false);
    report.push({ file: screenshotFile(i), ...facts, moment: SCREENSHOTS[i - 1]!.name, title: null });
  }
  const plates = PLATES.filter((p) => fs.existsSync(path.join(PLATES_DIR, `${p.name}.json`))).map(
    (p) => JSON.parse(fs.readFileSync(path.join(PLATES_DIR, `${p.name}.json`), "utf8")) as PlateInfo,
  );
  fs.writeFileSync(path.join(OUT, "store-art.json"), `${JSON.stringify({ made: new Date().toISOString(), art: report, plates, missing, problems }, null, 2)}\n`);

  // One sheet to review everything at a glance, the icon also at 64 and 128 px as they are.
  const items: Array<{ file: string; width: number; height: number; dataUrl: string; actual?: boolean }> = report.map((r) => {
    const file = String(r.file);
    return { file, width: Number(r.width), height: Number(r.height), dataUrl: dataUrl(path.join(OUT, file)) };
  });
  for (const s of [64, 128]) {
    const f = path.join(REVIEW, `icon-${s}.png`);
    if (fs.existsSync(f)) items.push({ file: `icon at ${s} px`, width: s, height: s, dataUrl: dataUrl(f), actual: true });
  }
  await page.setViewportSize({ width: 1840, height: 1000 });
  const note = `Rendered from the game ${new Date().toISOString().slice(0, 16)} UTC. Missing: ${missing.join(", ") || "none"}. Problems: ${problems.join("; ") || "none"}.`;
  await page.setContent(overviewHtml(items, note));
  await page.evaluate(async () => {
    for (const img of [...document.images]) await img.decode();
  });
  await page.screenshot({ path: path.join(OUT, "overview.png"), fullPage: true });
  expect(problems, "title placement").toEqual([]);
  expect(missing, "art without its plate or screenshot").toEqual([]);
});
