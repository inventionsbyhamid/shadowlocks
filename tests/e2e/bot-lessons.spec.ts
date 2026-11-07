// e2e: exclusive (long and timing-heavy: scripts/e2e.sh runs this spec alone on the server)
// The jitter bot (helpers/jitter.ts) plays both lessons with its shaking right hand (3 mm of noise, 1-1.5 cm of drift
// as a pinch opens, 200 ms out of tracking every 10 s). Lesson 1: the lantern picked up, its three locks opened by the
// careful approach around the ghost's two examples, the reward lifted out by hand. Lesson 2, which follows: an open
// hand in the beam for the shadow puppets, the ghost finger's example, the crown's gap filled by the shaking finger,
// the reward by hand, and the real drawer pulled by hand. Both must end saved done. Results:
// test-results/bot/lessons.json. Opt in, outside the routine suite:
// scripts/e2e.sh -c playwright.bot.config.ts tests/e2e/bot-lessons.spec.ts
import type { Page } from "@playwright/test";
import { Bot, botSolve, boxLine, type LessonResult, lockLine, pageErrors, report, saveResults } from "./helpers/jitter";
import { expect, test } from "./helpers/test";
import { addRunNote } from "./helpers/xr-app";

const lessons = (page: Page) => page.evaluate(() => window.__sl!.lessons.state());

function lessonLine(r: LessonResult): string {
  const extra = [
    `reward ${r.rewardTaken ? "taken by hand" : "NOT taken by hand"}`,
    r.grabsAtIntro !== undefined ? `picked up in ${r.grabsAtIntro} pinch${r.grabsAtIntro === 1 ? "" : "es"}` : "",
    r.beamMs !== undefined ? `hand in the beam ${(r.beamMs / 1000).toFixed(1)} s before the puppets moved on` : "",
    r.drawerPulled !== undefined ? `drawer ${r.drawerPulled ? "pulled, Home up" : "NOT pulled"}` : "",
    `steps at ${r.steps.map((s) => `${s.step}: ${(s.atMs / 1000).toFixed(1)} s`).join(", ")}`,
  ].filter(Boolean);
  return `${boxLine("hands", r)}; ${extra.join("; ")}`;
}

test("bot solves both lessons under jitter", async ({ page, boot }, testInfo) => {
  test.setTimeout(30 * 60_000);
  const app = await boot();
  const bot = await Bot.attach(app, { input: "hands", jitter: { seed: 5 } });
  // Lesson 1 through the plan's interface (a lesson spec); lesson 2 follows it by itself.
  const l1 = (await botSolve(app, { kind: "lesson", id: "l1" }, { bot })) as LessonResult;
  report(testInfo, lessonLine(l1));
  saveResults("lessons", [l1]);
  const l2 = await bot.solveLesson("l2", { start: false });
  report(testInfo, lessonLine(l2));
  saveResults("lessons", [l1, l2]);
  addRunNote(`bot lessons: l1 ${l1.solved ? "done" : "NOT done"} in ${(l1.ms / 1000).toFixed(1)} s, l2 ${l2.solved ? "done" : "NOT done"} in ${(l2.ms / 1000).toFixed(1)} s`);

  for (const r of [l1, l2]) {
    expect(r.solved, lessonLine(r)).toBe(true);
    expect(r.rewardTaken, lessonLine(r)).toBe(true);
    for (const l of r.locks) {
      expect(l.open, `${r.key}: ${lockLine(l)}`).toBe(true);
      if (!l.finger) expect(l.attempts, `${r.key}: ${lockLine(l)}`).toBe(1);
      for (const h of l.holds ?? []) expect(h.fresh, `${r.key}: ${lockLine(l)}`).toBe(true);
    }
  }
  expect(l1.locks.map((l) => [l.lock, l.finger])).toEqual([
    [0, false],
    [1, false],
    [2, false],
  ]);
  expect(l2.locks.map((l) => [l.lock, l.finger])).toEqual([[0, true]]);
  // The puppets moved on for the hand in the beam (5 s, a dropout or two longer), not the 12 s fallback.
  expect(l2.beamMs, lessonLine(l2)).toBeLessThan(7_000);
  expect(l2.drawerPulled, lessonLine(l2)).toBe(true);
  const s = await lessons(page);
  expect(s.progress).toEqual({ l1: true, l2: true, step: null });
  expect(s.running).toBe(false);
  expect((await app.state()).screen).toBe("home");
  expect(pageErrors(app)).toEqual([]);
});
