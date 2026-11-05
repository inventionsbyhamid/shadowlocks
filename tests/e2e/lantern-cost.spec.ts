// What holding the lantern costs a frame once the engine has optimised it: our per-frame path (hand-pinch reads the
// hands, lantern runs the grab, the feel and the view) at 4x CPU throttle, and what it allocates.
//
// A minute into a session V8 has optimised every per-frame function. Until then, code it has not optimised boxes its
// floating point numbers (a few bytes a frame in every hot function, the feel layer's included) and runs slower;
// lantern.spec.ts measures that case and reports it. These flags have V8 optimise after a few calls, so a short
// test sees the steady-state code: any allocation left in our files is then the code's own, and fails the test.
import { CHROME_ARGS } from "./helpers/chromium";
import { BUDGET_MS, LOOSE_MS, MAX_LOAD, measureCost } from "./helpers/lantern";
import { expect, test } from "./helpers/test";
import { addRunNote } from "./helpers/xr-app";

test.use({
  launchOptions: { args: [...CHROME_ARGS, "--js-flags=--invocation-count-for-maglev=5 --invocation-count-for-turbofan=30"] },
});

test("holding the lantern costs well under 1 ms a frame at 4x CPU throttle and allocates nothing", async ({ page, boot }, testInfo) => {
  const c = await measureCost(boot, page, testInfo, "optimised");
  expect([...c.allocs]).toEqual([]);
  const both = c.pinch.p95Ms + c.lan.p95Ms;
  expect(both).toBeLessThanOrEqual(LOOSE_MS);
  if (c.load !== undefined && c.load > MAX_LOAD) {
    const note = `lantern cost: not strictly asserted, server load ${c.load.toFixed(1)} > ${MAX_LOAD}; p95 hand-pinch + lantern ${both.toFixed(2)} ms (budget ${BUDGET_MS} ms)`;
    testInfo.annotations.push({ type: "perf", description: note });
    addRunNote(note);
    console.log(note);
  } else {
    expect(both).toBeLessThan(BUDGET_MS);
  }
});
