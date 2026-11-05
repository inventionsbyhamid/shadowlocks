/* eslint-disable @typescript-eslint/no-explicit-any */
// Sound in the real browser, with the real sound pack. Chromium's autoplay policy is lifted for this
// file (a test-only launch flag), so the audio context could run from the start: the engine must
// still wait for a gesture of its own (the copied latch), and a first try with no gesture behind it
// (entering XR by itself, as the installed app does) must not stop the first pinch from starting
// sound. The page below makes that first try hang for good, as it does on a headset.
import { CHROME_ARGS } from "./helpers/chromium";
import { Hands } from "./helpers/hands";
import { expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

test.use({ launchOptions: { args: [...CHROME_ARGS, "--autoplay-policy=no-user-gesture-required"] } });

/** Each audio context's first resume() never settles (a resume with no gesture behind it); later ones work. */
function firstResumeHangs(): void {
  const proto = AudioContext.prototype;
  const real = proto.resume;
  const tried = new WeakSet<AudioContext>();
  proto.resume = function (this: AudioContext) {
    (window as any).__resumes = ((window as any).__resumes ?? 0) + 1;
    if (!tried.has(this)) {
      tried.add(this);
      return new Promise<void>(() => {});
    }
    return real.call(this);
  };
}

/** Pinch in the air beside the box, away from the lantern and the panels. */
async function pinch(app: XrApp): Promise<void> {
  const head = (await app.state()).head!;
  const hand = new Hands(app, "right");
  await hand.pinchAt([head[0] + 0.3, head[1] - 0.35, head[2] - 0.25]);
  await hand.release();
}

async function startSound(app: XrApp): Promise<void> {
  await app.stepUntil((ns) => ns.audio.ready(), { maxMs: 10_000, label: "sound effects loaded" });
  await pinch(app);
  await app.stepUntil((ns) => ns.audio.running(), { maxMs: 2_000, label: "audio running after the pinch" });
}

test("audio starts on the first pinch, even when entering XR tried and hung", async ({ page, boot }) => {
  await page.addInitScript(firstResumeHangs);
  const app = await boot();
  await app.stepUntil((ns) => ns.audio.ready(), { maxMs: 10_000, label: "sound effects loaded" });
  // Entering XR asked for audio (no gesture): that try hangs, and a second of frames changes nothing.
  await app.step(72);
  expect(await page.evaluate(() => (window as any).__ns.audio.running())).toBe(false);
  const before = (await page.evaluate(() => (window as any).__resumes)) as number;
  expect(before).toBeGreaterThanOrEqual(1);
  await pinch(app);
  await app.stepUntil((ns) => ns.audio.running(), { maxMs: 2_000, label: "audio running after the pinch" });
  expect(await page.evaluate(() => (window as any).__resumes)).toBeGreaterThan(before);
  // A sound now really plays.
  await page.evaluate(() => (window as any).__ns.audio.clear());
  await page.evaluate(() => (window as any).__sl.sound.hint(0));
  expect(await page.evaluate(() => (window as any).__ns.audio.voices())).toBeGreaterThan(0);
});

test("a lock opening plays its three layers in order: tick, clunk at +120 ms, its note at +200 ms", async ({ page, boot }) => {
  const app = await boot();
  await startSound(app);
  await page.evaluate(() => (window as any).__ns.scene.show({ n: 1 }));
  await page.evaluate(() => {
    const w = window as any;
    w.__ns.audio.clear();
    w.__sl.sound.boxStart({ kind: "box", n: 1 });
    w.__sl.sound.lockOpened(0);
  });
  // The tick goes out at once; the later layers when their time comes.
  expect(await page.evaluate(() => (window as any).__ns.audio.log().map((s: { id: string }) => s.id))).toEqual(["glass_tick"]);
  await app.step(30);
  const log = (await page.evaluate(() => (window as any).__ns.audio.log())) as { id: string; at: number; delayMs?: number }[];
  expect(log.map((s) => s.id)).toEqual(["glass_tick", "brass_clunk", "mb_g5"]);
  const starts = log.map((s) => s.at + (s.delayMs ?? 0) - log[0]!.at);
  [0, 120, 200].forEach((ms, i) => expect(starts[i]).toBeCloseTo(ms, 3));
  // Each layer reached the engine shortly before its time, never late.
  for (const s of log) expect(s.delayMs ?? 0).toBeLessThanOrEqual(60);
  expect(await page.evaluate(() => (window as any).__ns.audio.voices())).toBeGreaterThan(0);
  // "Lock opens" is the one caption for the three layers.
  expect(await page.evaluate(() => (window as any).__sl.captions())).toEqual(["Lock opens"]);
});

test("menus play the bed through the 800 Hz low-pass; a box in play opens it up", async ({ page, boot }) => {
  const app = await boot();
  await startSound(app);
  // Home is a menu.
  await app.waitReal((ns) => ns.audio.music().playing, { label: "the music bed loaded and playing", timeoutMs: 120_000 });
  let music = await page.evaluate(() => (window as any).__ns.audio.music());
  expect(music).toMatchObject({ state: "menu", playing: true, cutoffHz: 800, filterHz: 800 });
  // Into play: the filter opens up on the next bar line.
  await page.evaluate(() => (window as any).__ns.ui.go("play"));
  await app.step(2);
  music = await page.evaluate(() => (window as any).__ns.audio.music());
  expect(music).toMatchObject({ state: "calm", cutoffHz: 20000 });
  await app.waitReal((ns) => ns.audio.music().filterHz > 10_000, { label: "the low-pass opened", timeoutMs: 30_000 });
  // An in-box menu brings the low-pass back.
  await page.evaluate(() => (window as any).__sl.sound.menuOpen(true));
  expect(await page.evaluate(() => (window as any).__ns.audio.music())).toMatchObject({ state: "menu", cutoffHz: 800 });
});
