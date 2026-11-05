import { expect, test } from "./helpers/test";

test("the 2D page shows Enter, and Enter starts an AR session", async ({ page, boot }) => {
  const app = await boot({ enterXR: false });
  const enter = page.locator("#enter");
  const status = page.locator("#status");
  await expect(enter).toBeVisible();
  await expect(enter).toHaveText("Enter");
  await expect(status).toHaveText("");
  await enter.click();
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR after Enter" });
  expect((await app.state()).xr.sessionMode).toBe("immersive-ar");
  await expect(enter).toBeEnabled();
  await expect(status).toHaveText("");
});

test("if the headset refuses the session, Enter stays for another try that works", async ({ page, boot }) => {
  const app = await boot({ enterXR: false });
  await page.evaluate(() => {
    const xr = navigator.xr as XRSystem & { __real?: XRSystem["requestSession"] };
    xr.__real = xr.requestSession.bind(xr);
    xr.requestSession = () => Promise.reject(new Error("refused"));
  });
  const enter = page.locator("#enter");
  const status = page.locator("#status");
  await enter.click();
  await expect(status).toHaveText("Could not start. Tap Enter to try again.");
  await expect(enter).toBeVisible();
  await expect(enter).toBeEnabled();
  expect((await app.state()).xr.presenting).toBe(false);
  // The second try goes through and clears the message.
  await page.evaluate(() => {
    const xr = navigator.xr as XRSystem & { __real?: XRSystem["requestSession"] };
    xr.requestSession = xr.__real!;
  });
  await enter.click();
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR on the second try" });
  await expect(status).toHaveText("");
});

test("an unanswered session request offers a retry after the wait runs out", async ({ page, boot }) => {
  await boot({ enterXR: false, url: "/?enterTimeoutMs=500" });
  await page.evaluate(() => {
    (navigator.xr as XRSystem).requestSession = () => new Promise<XRSession>(() => {});
  });
  const enter = page.locator("#enter");
  await enter.click();
  await expect(enter).toBeDisabled();
  await expect(page.locator("#status")).toHaveText("Could not start. Tap Enter to try again.", { timeout: 10_000 });
  await expect(enter).toBeEnabled();
});

test("the installed Quest app (Digital Goods API present) goes into XR with no tap", async ({ page, boot }) => {
  // The TWA exposes getDigitalGoodsService; its presence means "installed app": no Enter tap needed.
  await page.addInitScript(() => {
    (window as unknown as { getDigitalGoodsService: () => Promise<never> }).getDigitalGoodsService = () => Promise.reject(new Error("no billing in tests"));
  });
  const app = await boot({ enterXR: false });
  // The app requested the session by itself: no click on Enter and no answer to an offer.
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR presenting without a tap" });
  expect((await app.state()).xr.sessionMode).toBe("immersive-ar");
  await app.stepUntil((ns) => ns.state().boxPose.source === "head", { maxMs: 2_000, label: "box placed" });
  await expect(page.locator("#status")).toHaveText("");
});
