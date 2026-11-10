// e2e: exclusive (times our JS at 4x on a reference box at the start and the end: scripts/e2e.sh runs this spec alone on the server)
// A long session: 60 boxes in a row without a reload, each played to its end and the next started by the plate's Next
// (helpers/soak.ts plays them, as session.spec does, on the virtual clock). After box 1 and every 10 boxes, with the
// reward taken and Next offered, it counts what the session has left behind: the renderer's geometries, textures and
// shader programs, the scene's objects, the ECS's entities, the listeners on the bus, the page's event targets and
// three's XR manager, the Web Audio nodes wired into the graph and the sources playing, the JS heap after a forced GC
// (V8's gc(), exposed for this spec only), and the profile as stored. Before every heap sample the three logs only a
// test build keeps and nothing caps (the hooks' sound log and feel log, the IWER command results) are cleared, so the
// heap measured is the game's.
//
// From box 10 (by then everything a first box, tip or crystallise shows has been made) to box 60:
// - every count the same, with no slack: everything counted is made once and reused, or made and let go;
// - the heap after GC grown by less than 1 MB, 20 KB a box (a Box kept per box, with its lock samples, is far more);
// - the stored profile grown by its collection alone: one item a box, at most 400 bytes each;
// - the reference box (perf-budget's box 15, timed as perf-budget times it, three windows at 4x, the stall rule) at
//   the end: our JS's p95 within 10% of the start's, the same draw calls and triangles.
// The 300-box run before a deploy is soak-long.spec.ts (opt in).
import { countAudioNodes, pageErrors, soakArgs, soakBoxes } from "./helpers/soak";
import { expect, test } from "./helpers/test";

test.use({ launchOptions: { args: soakArgs(true) } });

test("60 boxes in a row leave nothing behind and cost the same", { tag: "@full" }, async ({ page, boot }, testInfo) => {
  test.setTimeout(45 * 60_000);
  await page.addInitScript(countAudioNodes);
  const app = await boot();
  await soakBoxes(app, testInfo, { boxes: 60, every: 10, heapKB: 1024, profileBytesPerBox: 400, costRatio: 1.1 });
  expect(pageErrors(app)).toEqual([]);
});
