// The frame rate a session runs at (src/app/headset.ts): 72 Hz on IWER's Quest 2 profile, and the `?hz=` field switch
// (src/app/field-flags.ts) that asks for another rate, so a tester can compare 72 and 90 Hz on a real Quest 2 or Pro.
// (The project's Quest 3 profile keeping 90 Hz is checked by hidden-overdraw.spec.ts.) IWER's Quest 2, Pro and 3
// profiles offer every rate the switch takes; its Quest 1 profile offers no 120, so it stands for a session that does
// not offer a listed rate (the headset's own rate then; tests/unit/headset.test.ts has the cases).
import { emulateHeadset } from "./helpers/headset";
import { expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

/** The session's own frame rate once it has taken the request. */
async function runsAt(app: XrApp, hz: number): Promise<void> {
  await app.stepUntil((_ns, w, f) => (w.__ns.world as { session?: XRSession }).session?.frameRate === f, {
    arg: hz,
    maxMs: 2_000,
    label: `the session at ${hz} Hz`,
  });
}

test("Quest 2 runs at 72 Hz, and ?hz=90 runs it at 90", async ({ page, boot }) => {
  await emulateHeadset(page, "metaQuest2");
  let app = await boot();
  expect(await page.evaluate(() => window.__ns!.headset())).toMatchObject({ class: "xr2-gen1", frameRate: 72 });
  await runsAt(app, 72);
  app = await boot({ url: "/?hz=90" });
  expect(await page.evaluate(() => window.__ns!.headset())).toMatchObject({ class: "xr2-gen1", frameRate: 90 });
  await runsAt(app, 90);
});

test("a listed ?hz= rate the session does not offer leaves the headset's own: 120 on a session of 72, 80 and 90 runs at 72", async ({
  page,
  boot,
}) => {
  await emulateHeadset(page, "oculusQuest1");
  const app = await boot({ url: "/?hz=120" });
  const offered = await page.evaluate(() => Array.from((window.__ns!.world as { session?: XRSession }).session?.supportedFrameRates ?? []));
  expect(offered).toEqual([72, 80, 90]);
  // Its "Quest 1" token is an older Quest's: its own rate is 72, asked for in place of the 120 it does not offer.
  expect(await page.evaluate(() => window.__ns!.headset())).toMatchObject({ class: "xr2-gen1", frameRate: 72 });
  await runsAt(app, 72);
});

test("?hz=72 runs the Quest 3 profile at 72, and a value outside the switch's list is ignored: its own 90 stands", async ({ page, boot }) => {
  let app = await boot({ url: "/?hz=72" });
  expect(await page.evaluate(() => window.__ns!.headset())).toMatchObject({ class: "standard", frameRate: 72 });
  await runsAt(app, 72);
  // 60 is no Quest Browser rate: the switch ignores it and the headset's own 90 stands.
  app = await boot({ url: "/?hz=60" });
  expect(await page.evaluate(() => window.__ns!.headset())).toMatchObject({ class: "standard", frameRate: 90 });
  await runsAt(app, 90);
});
