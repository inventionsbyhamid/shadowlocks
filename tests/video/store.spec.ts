// The Meta Horizon Store art, rendered from the game on the build server (scripts/store-art.sh runs this
// with playwright.store.config.ts): plates first (the box lit by its lantern, from a set camera, in the
// video build's look on the virtual clock), then the art cut from them with the title in Limelight, and
// the five screenshots as real frames. Layout, sizes and rules: lib/store-art.ts.
// Output: test-results/store/ (the art at its final sizes and pixel formats, store-art.json describing
// each file, overview.png for review), plates in test-results/store/plates/.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { V3, Vec3 } from "../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../e2e/helpers/boot";
import { setHeadset, stopRoomRender } from "../e2e/helpers/page-scripts";
import { type BootFn, expect, test } from "../e2e/helpers/test";
import type { XrApp } from "../e2e/helpers/xr-app";
import { ffmpeg } from "./lib/ffrun";
import { frameFingerprint, videoInit, videoPrepare } from "./lib/page-video";
import { ShotHand } from "./lib/shot";
import {
  ART,
  artHtml,
  eyeBehind,
  fovyRad,
  overviewHtml,
  type Plate,
  type PlateScene,
  PLATES,
  project,
  SCREENSHOT_COUNT,
  SCREENSHOT_SIZE,
  screenshotFile,
  textSafe,
  TITLE_FONT_FILE,
} from "./lib/store-art";

const OUT = path.join("test-results", "store");
const PLATES_DIR = path.join(OUT, "plates");
const RAW = path.join(OUT, "raw");
const DT = 1000 / 72;
/** Hands at rest behind and below the seated eyes: out of every view here. */
const PARK_RIGHT: Vec3 = [0.35, 0.65, -0.95];
const PARK_LEFT: Vec3 = [-0.35, 0.65, -0.95];
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];

test.beforeAll(() => {
  fs.mkdirSync(PLATES_DIR, { recursive: true });
  fs.mkdirSync(RAW, { recursive: true });
});

/** Boot the video build at `width` x `height`, seated, the box placed, both hands parked out of view. */
async function bootAt(page: Page, boot: BootFn, width: number, height: number): Promise<{ app: XrApp; left: ShotHand; right: ShotHand }> {
  await page.addInitScript(videoInit);
  const app = await boot({ mode: "visual", viewport: { width, height } });
  const prep = await page.evaluate(videoPrepare, { fovy: fovyRad(56), epochMs: new Date(DEFAULT_DATE).getTime(), fingerprint: frameFingerprint.toString() });
  expect(prep.canvas, "the XR canvas is the plate's size").toEqual([width, height]);
  // Setup frames step without drawing (every system still runs, as in the video recorder's fast-forward);
  // grab() draws the frames it captures. A full-size drawn frame costs seconds in software GL.
  await page.evaluate(() => ((window as any).__nsVideoSkip = true));
  const right = new ShotHand(app, "right");
  const left = new ShotHand(app, "left");
  await right.park(PARK_RIGHT);
  await left.park(PARK_LEFT);
  return { app, left, right };
}

/** Menus away and box `scene.box` in the lap, its lantern on the lock's spot (or its start), chosen locks open. */
async function stage(app: XrApp, page: Page, scene: PlateScene): Promise<V3> {
  await page.evaluate(() => (window as any).__ns.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate((n) => (window as any).__ns.scene.show({ n }), scene.box);
  await app.step(2);
  if (scene.lock !== undefined) {
    const spot = (await page.evaluate((k) => (window as any).__ns.scene.box().spots[k], scene.lock)) as V3;
    await page.evaluate((p) => (window as any).__sl.placeLantern(p), spot);
  }
  for (const k of scene.open ?? []) await page.evaluate((i) => (window as any).__sl.setOpen(i, true), k);
  // Etching, warmth and the gold fill ease in over a few frames.
  await app.step(90);
  return (await page.evaluate(() => (window as any).__sl.lantern().pos)) as V3;
}

type P3 = readonly [number, number, number];

const toWorld = async (page: Page, pts: readonly P3[]): Promise<Vec3[]> =>
  (await page.evaluate((p) => (window as any).__ns.scene.toWorld(p), pts.map((q) => [q[0], q[1], q[2]] as V3))) as Vec3[];

/** Put the headset at `eye` looking at `at` (world) with a vertical field of view of `vfovDeg`. */
async function aim(page: Page, eye: Vec3, at: Vec3, vfovDeg: number): Promise<void> {
  await page.evaluate(setHeadset, { position: { x: eye[0], y: eye[1], z: eye[2] }, lookAt: { x: at[0], y: at[1], z: at[2] } });
  await page.evaluate((f) => ((window as any).IWER_DEVICE.fovy = f), fovyRad(vfovDeg));
}

/**
 * Wait for async work, draw `frames` frames (the last one captured in the same task, so no preserved
 * drawing buffer is needed) and return it as a PNG data URL: the room and the app, or (room off) the
 * app alone with its transparent background.
 */
async function grab(page: Page, room: boolean, frames = 3): Promise<string> {
  return page.evaluate(
    async (o) => {
      const w = window as any;
      w.__nsVideoSkip = false;
      for (let i = 0; i < o.frames; i++) {
        await w.__nsVideoIdle?.();
        w.__nsVideo?.styleHands(true);
        w.__vt.step(o.dt);
      }
      let url: string;
      if (o.room) url = w.__nsCapture("image/png") as string;
      else {
        const app = w.__ns.world.renderer.domElement as HTMLCanvasElement;
        const c = document.createElement("canvas");
        c.width = app.width;
        c.height = app.height;
        c.getContext("2d")!.drawImage(app, 0, 0);
        url = c.toDataURL("image/png");
      }
      w.__nsVideoSkip = true;
      return url;
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
  lantern: V3;
  /** The eye, box units. */
  eye: P3;
  /** Alpha at the frame's corner: 0 means the app layer is transparent where nothing is drawn. */
  cornerAlpha: number;
}

/** Render one "box" plate: the room not drawn, the camera on the box in box units. */
async function renderPlate(page: Page, boot: BootFn, p: Plate): Promise<PlateInfo> {
  const { app } = await bootAt(page, boot, p.width, p.height);
  await page.evaluate(stopRoomRender);
  const lantern = await stage(app, page, p.scene);
  const v = p.view!;
  const eye = eyeBehind(v.eye, lantern[2]);
  const [eyeW, atW, centreW] = await toWorld(page, [eye, v.at, [0, 0, 0.5]]);
  await aim(page, eyeW!, atW!, v.vfovDeg);
  const url = await grab(page, false);
  const file = path.join(PLATES_DIR, `${p.name}.png`);
  writeDataUrl(file, url);
  const glow = project(centreW!, eyeW!, atW!, v.vfovDeg, p.width, p.height) ?? [0.5, 0.5];
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
  const info: PlateInfo = { name: p.name, width: p.width, height: p.height, glow, lantern, eye, cornerAlpha };
  fs.writeFileSync(path.join(PLATES_DIR, `${p.name}.json`), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

for (const p of PLATES) {
  test(`plate ${p.name} (${p.width}x${p.height})`, async ({ page, boot }) => {
    const info = await renderPlate(page, boot, p);
    expect(fs.statSync(path.join(PLATES_DIR, `${p.name}.png`)).size).toBeGreaterThan(10_000);
    console.log(`plate ${p.name}: box centre at ${info.glow.map((x) => x.toFixed(2)).join(", ")}, corner alpha ${info.cornerAlpha}`);
  });
}

/** One screenshot: set the game up (hands included), then the camera, from the seated player's side. */
interface Screenshot {
  name: string;
  setup(c: { app: XrApp; page: Page; left: ShotHand; right: ShotHand }): Promise<{ eye: Vec3; at: Vec3; vfovDeg: number }>;
}

/** World point of box units `p`. */
const at1 = async (page: Page, p: P3): Promise<Vec3> => (await toWorld(page, [p]))[0]!;
const plus = (a: Vec3, d: Vec3): Vec3 => [a[0] + d[0], a[1] + d[1], a[2] + d[2]];

/**
 * The five screenshots, real frames of the game as it is today (the final run, about Nov 8, swaps in
 * the finished game's moments: a lesson, the fingertip casting the missing piece, a lock opening, the
 * box opening; see plan/store/trailer-shots.md).
 */
const SCREENSHOTS: Screenshot[] = [
  {
    name: "home",
    // Seated, looking down at the box in the lap and the home panel in front of it.
    async setup({ app, page }) {
      await app.step(30);
      const box = (await app.state()).boxPose.position as Vec3;
      return { eye: EYE, at: plus(box, [0, -0.05, 0.06]), vfovDeg: 52 };
    },
  },
  {
    name: "lantern-in-hand",
    // Box 3, the right hand holding the lantern up and to the side, its light moving the shadows.
    async setup({ app, page, right }) {
      await stage(app, page, { box: 3 });
      const l = (await page.evaluate(() => (window as any).__sl.lantern().pos)) as V3;
      const lw = await at1(page, l);
      await right.pinchAt(lw);
      let held = true;
      try {
        await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 1_000, batch: 1, label: "lantern held" });
      } catch {
        held = false;
      }
      // A screenshot still: if the grab did not take, the hand stays at the lantern instead of failing the set.
      if (held) await right.moveTo(plus(lw, [0.045, 0.035, -0.01]), 600);
      else console.warn("screenshot lantern-in-hand: the pinch did not hold the lantern; the hand stays at it");
      await app.step(30);
      return { eye: plus(EYE, [-0.04, -0.04, -0.06]), at: await at1(page, [0.1, -0.05, 0.6]), vfovDeg: 46 };
    },
  },
  {
    name: "lock-shape",
    // Box 3 with the lantern settled on its first lock's spot: the shadows make the lock's shape.
    async setup({ app, page }) {
      const l = await stage(app, page, { box: 3, lock: 0 });
      return { eye: await at1(page, eyeBehind([0.1, 0.25, 2.5], l[2], 0.6)), at: await at1(page, [0, 0, 0.2]), vfovDeg: 42 };
    },
  },
  {
    name: "lock-open",
    // Another box, a lock opened in gold while the lantern still sits on its spot.
    async setup({ app, page }) {
      const l = await stage(app, page, { box: 5, lock: 1, open: [1] });
      return { eye: await at1(page, eyeBehind([-0.2, 0.3, 2.6], l[2], 0.6)), at: await at1(page, [0, 0, 0.3]), vfovDeg: 44 };
    },
  },
  {
    name: "settings",
    // The settings panel in front of the box, the right index finger about to press a key.
    async setup({ app, page, right }) {
      await page.evaluate(() => (window as any).__ns.ui.go("settings"));
      await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "settings at rest" });
      const s = await app.state();
      const key = s.buttons.find((b) => b.id === "box-up") ?? s.buttons[0]!;
      await right.point();
      await right.glideTip(plus(key.world as Vec3, [key.normal[0] * 0.035, key.normal[1] * 0.035, key.normal[2] * 0.035]), 600);
      await app.step(20);
      const box = s.boxPose.position as Vec3;
      return { eye: EYE, at: plus(box, [0, -0.06, 0.1]), vfovDeg: 50 };
    },
  },
];

test("screenshots (5 real frames, 2560x1440)", async ({ page, boot }) => {
  expect(SCREENSHOTS).toHaveLength(SCREENSHOT_COUNT);
  const { width, height } = SCREENSHOT_SIZE;
  for (const [i, shot] of SCREENSHOTS.entries()) {
    // Each from a fresh boot: no state carried from one into the next.
    if (i > 0) await page.goto("about:blank");
    const ctx = await bootAt(page, boot, width, height);
    const cam = await shot.setup({ app: ctx.app, page, left: ctx.left, right: ctx.right });
    await aim(page, cam.eye, cam.at, cam.vfovDeg);
    const url = await grab(page, true, 4);
    writeDataUrl(path.join(RAW, screenshotFile(i + 1)), url);
    console.log(`screenshot ${i + 1} (${shot.name}) done`);
  }
});

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
  for (const a of ART) {
    let plate: string | undefined;
    let glow: [number, number] | undefined;
    if (a.plate) {
      const png = path.join(PLATES_DIR, `${a.plate}.png`);
      if (!fs.existsSync(png)) {
        missing.push(`${a.file} (plate ${a.plate})`);
        continue;
      }
      plate = dataUrl(png);
      glow = (JSON.parse(fs.readFileSync(path.join(PLATES_DIR, `${a.plate}.json`), "utf8")) as PlateInfo).glow;
    }
    await page.setViewportSize({ width: a.width, height: a.height });
    await page.setContent(artHtml(a, { plate, glow, fontDataUrl: font }));
    const ok = await page.evaluate(async () => {
      // A face loads only once something asks for it: ask, then wait for every load.
      await document.fonts.load("40px Limelight");
      await document.fonts.ready;
      for (const img of [...document.images]) await img.decode();
      return document.fonts.check("40px Limelight");
    });
    expect(ok, "the Limelight font loaded").toBe(true);
    let title: { left: number; top: number; right: number; bottom: number } | null = null;
    if (a.title) {
      // Shrink the title to its width limit, then read where it ended up.
      title = await page.evaluate((maxW) => {
        const el = document.getElementById("title")!;
        const r0 = el.getBoundingClientRect();
        if (r0.width > maxW) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * (maxW / r0.width)}px`;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }, a.title.maxWidth * a.width);
      if (!a.alpha) expect(textSafe(title, a.width, a.height), `${a.file}: title placement`).toBeNull();
    }
    const raw = path.join(RAW, a.file);
    await page.screenshot({ path: raw, omitBackground: a.alpha, fullPage: false });
    const facts = finalPng(raw, path.join(OUT, a.file), a.width, a.height, a.alpha);
    report.push({ file: a.file, ...facts, plate: a.plate ?? null, title: title && { ...title, text: "Shadow Locks" } });
  }
  for (let i = 1; i <= SCREENSHOT_COUNT; i++) {
    const raw = path.join(RAW, screenshotFile(i));
    if (!fs.existsSync(raw)) {
      missing.push(screenshotFile(i));
      continue;
    }
    const facts = finalPng(raw, path.join(OUT, screenshotFile(i)), SCREENSHOT_SIZE.width, SCREENSHOT_SIZE.height, false);
    report.push({ file: screenshotFile(i), ...facts, title: null });
  }
  const plates = PLATES.filter((p) => fs.existsSync(path.join(PLATES_DIR, `${p.name}.json`))).map(
    (p) => JSON.parse(fs.readFileSync(path.join(PLATES_DIR, `${p.name}.json`), "utf8")) as PlateInfo,
  );
  fs.writeFileSync(path.join(OUT, "store-art.json"), `${JSON.stringify({ made: new Date().toISOString(), art: report, plates, missing }, null, 2)}\n`);

  // One sheet to review everything at a glance.
  const items = report.map((r) => {
    const file = String(r.file);
    return { file, width: Number(r.width), height: Number(r.height), dataUrl: dataUrl(path.join(OUT, file)) };
  });
  await page.setViewportSize({ width: 1840, height: 1000 });
  await page.setContent(overviewHtml(items, `Rendered from the game ${new Date().toISOString().slice(0, 16)} UTC. Missing: ${missing.join(", ") || "none"}.`));
  await page.evaluate(async () => {
    for (const img of [...document.images]) await img.decode();
  });
  await page.screenshot({ path: path.join(OUT, "overview.png"), fullPage: true });
  expect(missing, "art without its plate or screenshot").toEqual([]);
});
