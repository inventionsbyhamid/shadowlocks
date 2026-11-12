// Renders demo video shots (SHOTS=a,b) and edits (EDIT=name) on the build server: run it with
// scripts/video.sh, which uses playwright.video.config.ts. One test per shot, then the edit.
import fs from "node:fs";
import path from "node:path";
import { test } from "../e2e/helpers/test";
import { EDITS } from "./edits";
import { renderEdit } from "./lib/deliver";
import { renderCaption, renderCornerLabel, renderEndCard } from "./lib/endcard";
import { videoOptions, workDir } from "./lib/options";
import { shotFile } from "./lib/records";
import { renderShot, stoppedNote } from "./lib/shoot";
import { renderPageShot } from "./lib/page-shot";
import { PAGE_SHOTS, SHOTS } from "./shots";

const o = videoOptions();

const log = (line: string) => console.log(`[video ${new Date().toISOString().slice(11, 19)}] ${line}`);

// Every attempt says how it ended: a detached render's watchdog labels the run from each test's last
// attempt (a stop for the disk, or a real failure).
test.afterEach(({}, testInfo) => {
  log(`[video-result] ${JSON.stringify({ test: testInfo.title, retry: testInfo.retry, status: testInfo.status })}`);
});

for (const name of o.shots.filter((n) => PAGE_SHOTS[n])) {
  test(`page shot ${name}`, async ({ browser }, testInfo) => {
    log(`[video-attempt] ${JSON.stringify({ test: `page shot ${name}`, retry: testInfo.retry })}`);
    const shot = PAGE_SHOTS[name]!;
    if (!fs.existsSync(shotFile(name))) throw new Error(`shot ${name} must live in ${shotFile(name)}`);
    const run = await renderPageShot(shot, browser, String(testInfo.project.use.baseURL), o, { retry: testInfo.retry, log });
    if (run.record) testInfo.annotations.push({ type: "video", description: `${run.record.mp4}: ${run.record.frames} frames (${run.did})` });
  });
}

for (const name of o.shots.filter((n) => !PAGE_SHOTS[n])) {
  test(`shot ${name}`, async ({ boot, page }, testInfo) => {
    // Marks where this attempt's output starts (a detached render's watchdog reads only the last one).
    log(`[video-attempt] ${JSON.stringify({ test: `shot ${name}`, retry: testInfo.retry })}`);
    // Test hook for the detached watchdog: a retry that fails for a real reason must end "failed".
    if (process.env.VIDEO_FAIL_ON_RETRY === "1" && testInfo.retry > 0) throw new Error("failing the retry on purpose (VIDEO_FAIL_ON_RETRY)");
    // Test hook for the detached watchdog's stall stop: hang with no output and no files written.
    if (process.env.VIDEO_HANG === "1") await new Promise<void>(() => undefined);
    const shot = SHOTS[name];
    if (!shot) throw new Error(`no shot "${name}" (have: ${Object.keys(SHOTS).join(", ")})`);
    if (!fs.existsSync(shotFile(name))) throw new Error(`shot ${name} must live in ${shotFile(name)}`);
    const run = await renderShot(shot, page, boot, o, { retry: testInfo.retry, log });
    if (run.stopped) testInfo.annotations.push({ type: "stopped", description: run.stopped });
    if (run.record) testInfo.annotations.push({ type: "video", description: `${run.record.mp4}: ${run.record.frames} frames (${run.did})` });
  });
}

if (o.edit) {
  const name = o.edit;
  test(`edit ${name}`, async ({ page }, testInfo) => {
    log(`[video-attempt] ${JSON.stringify({ test: `edit ${name}`, retry: testInfo.retry })}`);
    const edit = EDITS[name];
    if (!edit) throw new Error(`no edit "${name}" (have: ${Object.keys(EDITS).join(", ")})`);
    if (SHOTS[name]) throw new Error(`edit "${name}" has a shot's name; rename it`);
    const stopped = edit.shots.filter((s) => fs.existsSync(stoppedNote(o, s)));
    test.skip(stopped.length > 0, `shots that stopped before they finished: ${stopped.join(", ")}`);
    // The end card's text layer, drawn by the browser at the edit's size.
    let card: string | undefined;
    if (edit.endCard) {
      card = path.join(workDir(o), `edit-${name}-card.png`);
      await renderEndCard(page, edit.endCard, { width: o.width, height: o.height }, process.cwd(), card);
    }
    let label: string | undefined;
    if (edit.label) {
      label = path.join(workDir(o), `edit-${name}-label.png`);
      await renderCornerLabel(page, edit.label.text, { width: o.width, height: o.height }, process.cwd(), label);
    }
    const captions: string[] = [];
    for (const [i, c] of (edit.captions ?? []).entries()) {
      const file = path.join(workDir(o), `edit-${name}-caption-${i}.png`);
      await renderCaption(page, c.text, { width: o.width, height: o.height }, process.cwd(), file);
      captions.push(file);
    }
    renderEdit(name, edit, o, log, card, label, captions);
  });
}

if (o.shots.length === 0 && !o.edit) {
  test("nothing to render", () => {
    throw new Error("set SHOTS=<names> and/or EDIT=<name> (scripts/video.sh --shots ... --edit ...)");
  });
}
