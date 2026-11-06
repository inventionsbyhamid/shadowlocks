// e2e: exclusive (times real milliseconds: scripts/e2e.sh runs this spec alone on the server)
// What holding the lantern costs a frame once the engine has optimised it: our per-frame path (hand-pinch reads the
// hands, lantern runs the grab, the feel and the view) at 4x CPU throttle, and what it allocates.
//
// A minute into a session V8 has optimised every per-frame function; until then it boxes floats in every hot function
// and runs slower (lantern.spec.ts measures and reports that case). These flags have V8 optimise after a few calls, so
// a short test sees the steady-state code.
//
// Time: the two systems' summed update time per frame, in two windows of 200 frames one after the other, judged by the
// stall rule (helpers/lantern.ts, shared with hand-cost.spec.ts): frames over STALL_MS are host stalls, left out and
// counted; the better window must have at most MAX_STALLS of them and its mean stay within MEAN_BUDGET_MS on every
// run, whatever the server's load. Both windows' means and p95s are reported; p95 is not held to a limit.
//
// Allocation: the path makes no objects, arrays or closures per frame: everything it writes is preallocated.
// Optimised code still boxes a float it passes to, or gets back from, a call it did not inline (12 bytes each;
// `performance.now()` returns one), as any JavaScript frame loop does, and the heap sampler cannot tell those from
// objects (V8 folds several into one allocation). So the allocation check is two budgets. In all our per-frame files
// the boxes come to about 140 bytes a frame, so ALLOC_BUDGET catches anything like a per-frame array of the hand's
// joints or of shadow points. The lantern's own new modules box at most about 27 bytes a frame each, so
// FUNCTION_BUDGET catches even a few vectors made per frame there (four Vector3s in an array put LanternGrab.update
// at 73 bytes a frame).
import { CHROME_ARGS } from "./helpers/chromium";
import { expectWithinBudget, MEAN_BUDGET_MS, measureCost, TIMED_FRAMES, WINDOWS } from "./helpers/lantern";
import { expect, test } from "./helpers/test";

/** Bytes a frame allocated in all our per-frame files, at most (optimised; boxed floats only). */
const ALLOC_BUDGET = 250;
/** Bytes a frame any one function of these files may allocate (boxed floats only). */
const FUNCTION_BUDGET = 48;
const NEW_MODULES = ["src/input/lantern-grab.ts", "src/feel/lantern-ctx.ts", "src/render/ring-beam.ts", "src/input/hand-joints.ts"];

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

test("holding the lantern costs at most 0.5 ms a frame on average at 4x CPU throttle and allocates only boxed floats", async ({ page, boot }, testInfo) => {
  const c = await measureCost(boot, page, testInfo, "optimised");
  expect(c.frames).toBe(TIMED_FRAMES);
  expect(c.windows).toHaveLength(WINDOWS);
  expectWithinBudget(c.judged, MEAN_BUDGET_MS, "hand-pinch + lantern");
  expect(c.allocs.bytesPerFrame).toBeLessThan(ALLOC_BUDGET);
  const over = [...c.allocs.byFunction]
    .filter(([k, b]) => NEW_MODULES.some((m) => k.startsWith(m)) && b > FUNCTION_BUDGET)
    .map(([k, b]) => `${k} ${b.toFixed(0)} bytes a frame`);
  expect(over).toEqual([]);
});
