// e2e: exclusive (times our JS at 4x on a reference box at the start and the end, and runs about an hour and a half: scripts/e2e.sh runs this spec alone on the server)
// The long soak, for the pass before a deploy: soak.spec.ts's session for 300 boxes in a row (helpers/soak.ts), sampled
// every 10. From box 10 to box 300 every count is the same but for the focus mark first drawn at box 13
// (FOCUS_MARK_SHOWN_LATER), and from box 20 on with no exception; the heap after GC grows by less than 2 MB (7 KB a box: a
// leak too small to show in 50 boxes shows here), the stored profile only by its collection, and the reference box
// costs the same at the end. Opt in, outside the routine suite: playwright.soak.config.ts runs it (tests/e2e/README.md).
import { countAudioNodes, FOCUS_MARK_SHOWN_LATER, pageErrors, soakArgs, soakBoxes } from "./helpers/soak";
import { expect, test } from "./helpers/test";

test.use({ launchOptions: { args: soakArgs(true) } });

test("300 boxes in a row leave nothing behind and cost the same", { tag: "@full" }, async ({ page, boot }, testInfo) => {
  test.setTimeout(150 * 60_000);
  await page.addInitScript(countAudioNodes);
  const app = await boot();
  await soakBoxes(app, testInfo, { boxes: 300, every: 10, heapKB: 2048, profileBytesPerBox: 400, costRatio: 1.1, shownLater: FOCUS_MARK_SHOWN_LATER });
  expect(pageErrors(app)).toEqual([]);
});
