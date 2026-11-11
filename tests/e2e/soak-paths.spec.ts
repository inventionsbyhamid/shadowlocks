// The other paths a long session takes again and again, each soaked as soak.spec.ts soaks the boxes (helpers/soak.ts)
// and counted the same way: the renderer's geometries, textures and programs, the scene's objects, the ECS's entities,
// the listeners on the bus, the page's event targets and three's XR manager, the Web Audio nodes wired and sources
// playing, the JS heap after a forced GC (V8's gc(), exposed for this spec only) and the stored profile. Before every
// heap sample the three logs only a test build keeps and nothing caps (the hooks' sound log and feel log, the IWER
// command results) are cleared, so the heap measured is the game's. Each path runs a warm-up first, long enough for
// everything it shows to have shown once (what shows the first time is made then), then its cycles; at the end every
// count is as after the warm-up (no slack), and the heap has settled: its growth over the last block of cycles is under
// 128 KB, or under 3/4 of its growth over the first (helpers/soak.ts, expectHeapSettles). A leak keeps its pace from
// block to block; the engine's and the libraries' warm-up dies away. (Measured: a 30-replay run grew 1.06, 0.72, then
// 0.52 MB a block of 10, and the retained allocations of 10 more were the box in play's own state, UIKit's sorted
// buckets and the emulator's frame code, none of ours accumulating.) Nothing here is timed: these run in a shared slot.
// - 30 lesson replays from the Lessons menu's rows, round the four examples, box 5 put back after each (after 8: each
//   example twice);
// - 30 uses of the hint lantern, Hint and Show me in turn (15 hints, 15 examples replayed on box 5; after 10, every
//   hint level has shown);
// - 30 menu open and close cycles: the drawer pulled, Home, Continue back to the box (after 10);
// - 20 headset off and on cycles: the XR session and the page hidden, then seen again (after 10);
// - 10 summons: the box left out of view, the arrow pinched, the box placed in front again (after 4, sampled every 5).
import type { Page } from "@playwright/test";
import { countAudioNodes, EXAMPLE_ROWS, handsAway, headsetOn, hintUse, inPlay, menuCycle, pageErrors, replayRow, soakArgs, soakPath, summonOnce } from "./helpers/soak";
import { type BootFn, expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

test.use({ launchOptions: { args: soakArgs(false) } });

const BOX5 = "shadow-locks/5";

/** Booted with the audio counted, sound on (a pinch is the engine's gesture), and box 5 in play from Continue. */
async function box5(page: Page, boot: BootFn): Promise<XrApp> {
  await page.addInitScript(countAudioNodes);
  const app = await boot();
  await app.stepUntil((ns) => ns.audio.ready(), { maxMs: 10_000, label: "sound effects loaded" });
  await page.evaluate(() => window.__ns!.ui.profile({ nextBox: 5 }));
  await app.poke("home-continue");
  await inPlay(app, BOX5);
  await app.stepUntil((ns) => ns.audio.running(), { maxMs: 2_000, label: "audio running after the poke" });
  await handsAway(app);
  return app;
}

test("30 lesson replays leave nothing behind", { tag: "@full" }, async ({ page, boot }, testInfo) => {
  test.setTimeout(60 * 60_000);
  const app = await box5(page, boot);
  await soakPath(app, testInfo, "lesson replays", { warm: 2 * EXAMPLE_ROWS.length, cycles: 30, every: 10 }, async (i) => {
    const [row, ex] = EXAMPLE_ROWS[i % EXAMPLE_ROWS.length]!;
    await replayRow(app, row, ex, BOX5);
  });
  expect(pageErrors(app)).toEqual([]);
});

test("30 hint and Show me uses leave nothing behind", { tag: "@full" }, async ({ page, boot }, testInfo) => {
  test.setTimeout(40 * 60_000);
  const app = await box5(page, boot);
  await soakPath(app, testInfo, "hint and Show me", { warm: 10, cycles: 30, every: 10 }, (i) =>
    hintUse(app, i % 2 === 0 ? "hint" : "show-me", BOX5),
  );
  expect(pageErrors(app)).toEqual([]);
});

test("30 menu open and close cycles leave nothing behind", { tag: "@full" }, async ({ page, boot }, testInfo) => {
  test.setTimeout(20 * 60_000);
  const app = await box5(page, boot);
  await soakPath(app, testInfo, "menus", { warm: 10, cycles: 30, every: 10 }, () => menuCycle(app, BOX5));
  expect(pageErrors(app)).toEqual([]);
});

test("20 headset off and on cycles leave nothing behind", { tag: "@full" }, async ({ page, boot }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const app = await box5(page, boot);
  await soakPath(app, testInfo, "headset off and on", { warm: 10, cycles: 20, every: 10 }, async () => {
    await headsetOn(app, false);
    await headsetOn(app, true);
    await inPlay(app, BOX5);
  });
  expect(pageErrors(app)).toEqual([]);
});

test("10 summons of a lost box leave nothing behind", { tag: "@full" }, async ({ page, boot }, testInfo) => {
  test.setTimeout(15 * 60_000);
  const app = await box5(page, boot);
  // Four warm-up summons: two each way round (the box placed facing away, then back).
  await soakPath(app, testInfo, "summons", { warm: 4, cycles: 10, every: 5 }, (i) => summonOnce(app, i % 2 === 0));
  expect(pageErrors(app)).toEqual([]);
});
