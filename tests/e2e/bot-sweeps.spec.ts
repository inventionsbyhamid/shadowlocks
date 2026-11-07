// e2e: exclusive (long and timing-heavy: scripts/e2e.sh runs this spec alone on the server)
// Fast sweeps open nothing: the jitter bot's hand (3 mm of noise, 200 ms out of tracking every 10 s) holds the lantern
// and waves it back and forth through the spots at 15 to 30 cm/s, 30 s on each of boxes 1 to 10 (five minutes), each
// sweep passing within 1 cm of a spot in a random direction (helpers/jitter.ts sweepPlan). No lock may open, and the
// lantern is never pulled in (no settle, no ring line lock). Results: test-results/bot/sweeps.json. Opt in, outside the
// routine suite: scripts/e2e.sh -c playwright.bot.config.ts tests/e2e/bot-sweeps.spec.ts
import { Bot, pageErrors, report, saveResults, sweepPlan } from "./helpers/jitter";
import { expect, test } from "./helpers/test";
import { addRunNote } from "./helpers/xr-app";

const BOXES = 10;
const MS_PER_BOX = 30_000;
/** A sweep passes within 1 cm of its spot; the lantern then comes this close to every spot of a box. */
const SWEPT_WITHIN_CM = 2;

const s1 = (ms: number) => (ms / 1000).toFixed(1);

test("fast sweeps open nothing", async ({ page, boot }, testInfo) => {
  test.setTimeout(60 * 60_000);
  const app = await boot();
  const bot = await Bot.attach(app, { input: "hands", jitter: { seed: 3 } });
  const rows: { key: string; ms: number; sweeps: number; opened: number; settles: number; lines: number; closestCm: number[]; frames: number; realMs: number }[] = [];
  for (let n = 1; n <= BOXES; n++) {
    const s = await bot.start({ kind: "box", n });
    await bot.grab();
    const spots = s.locks.map((l) => l.spot);
    const plan = sweepPlan((await bot.lantern()).pos, spots, { seed: 100 + n, cmPerUnit: bot.cmPerUnit, totalMs: MS_PER_BOX });
    await page.evaluate(() => window.__sl!.clearFeelEvents());
    await bot.watch(spots);
    const t0 = await app.now(), f0 = await bot.frames(), real0 = Date.now();
    // Waving the lantern back and forth through the spots at 15 to 30 cm/s, never letting go.
    await bot.carryAlong(plan.legs, `sweeping box ${n}`);
    const feel = await page.evaluate(() => window.__sl!.feelEvents());
    const row = {
      key: s.key!,
      ms: (await app.now()) - t0,
      sweeps: plan.sweeps.length,
      opened: (await app.events("lock-open")).length,
      settles: feel.filter((e) => e.type === "settle").length,
      lines: feel.filter((e) => e.type === "line" && e.on).length,
      closestCm: await bot.watched(),
      frames: (await bot.frames()) - f0,
      realMs: Date.now() - real0,
    };
    rows.push(row);
    expect((await bot.lantern()).held, `${row.key}: still held`).toBe(true);
    report(
      testInfo,
      `sweeps ${row.key}: ${row.sweeps} sweeps in ${s1(row.ms)} s (${s1(row.realMs)} s real); ${row.opened} locks opened, ` +
        `${row.settles} settles, ${row.lines} line locks; closest to each spot ${row.closestCm.map((c) => `${c.toFixed(2)} cm`).join(", ")}`,
    );
    saveResults("sweeps", rows);
  }
  const total = rows.reduce((a, r) => a + r.ms, 0);
  const sum = (k: "opened" | "settles" | "lines") => rows.reduce((a, r) => a + r[k], 0);
  const frames = rows.reduce((a, r) => a + r.frames, 0), real = rows.reduce((a, r) => a + r.realMs, 0);
  const note =
    `sweeps: ${s1(total)} s, ${rows.reduce((a, r) => a + r.sweeps, 0)} sweeps over ${rows.length} boxes: ${sum("opened")} locks opened, ` +
    `${sum("settles")} settles, ${sum("lines")} line locks; ${await bot.dropouts()} dropouts; ${frames} frames in ${s1(real)} s real`;
  report(testInfo, note);
  addRunNote(note);
  expect(total).toBeGreaterThanOrEqual(5 * 60_000);
  // The sweeps really went through the spots: the lantern passed inside the settle radius of every one.
  for (const r of rows) for (const c of r.closestCm) expect(c, `${r.key}: closest approach to a spot`).toBeLessThan(SWEPT_WITHIN_CM);
  expect(sum("opened"), "locks opened by sweeping").toBe(0);
  expect(sum("settles"), "settles while sweeping").toBe(0);
  expect(sum("lines"), "ring line locks while sweeping").toBe(0);
  expect(pageErrors(app)).toEqual([]);
});
