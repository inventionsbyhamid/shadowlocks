import { COPY } from "../../src/ui/copy";
import { expect, test } from "./helpers/test";

const FAILED = COPY.page.enterFailed;

test("the landing page shows the box art, the name and one button, and Open the box starts an AR session", async ({ page, boot }) => {
  const app = await boot({ enterXR: false });
  const landing = page.locator("#landing");
  const enter = page.locator("#enter");
  const status = page.locator("#status");
  await expect(landing).toBeVisible();
  await expect(landing.locator(".art svg")).toBeVisible();
  await expect(landing.locator("h1")).toHaveText("Shadow Locks");
  await expect(landing.locator("button")).toHaveCount(1);
  await expect(enter).toBeVisible();
  await expect(enter).toHaveText(COPY.landing.open);
  await expect(page.locator("#tagline")).toHaveText(COPY.landing.tagline);
  await expect(status).toHaveText("");
  await enter.click();
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR after Open the box" });
  expect((await app.state()).xr.sessionMode).toBe("immersive-ar");
  await expect(enter).toBeEnabled();
  await expect(status).toHaveText("");
  // In XR the landing page is gone (the headset shows the box, and screenshots the scene).
  await expect(landing).toBeHidden();
});

test("if the headset refuses the session, Open the box stays for another try that works", async ({ page, boot }) => {
  const app = await boot({ enterXR: false });
  await page.evaluate(() => {
    const xr = navigator.xr as XRSystem & { __real?: XRSystem["requestSession"] };
    xr.__real = xr.requestSession.bind(xr);
    xr.requestSession = () => Promise.reject(new Error("refused"));
  });
  const enter = page.locator("#enter");
  const status = page.locator("#status");
  await enter.click();
  await expect(status).toHaveText(FAILED);
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
  await expect(page.locator("#status")).toHaveText(FAILED, { timeout: 10_000 });
  await expect(enter).toBeEnabled();
});

test("the installed Quest app (Digital Goods API present) skips the landing page and goes into XR with no tap", async ({ page, boot }) => {
  // The TWA exposes getDigitalGoodsService; its presence means "installed app": no tap needed.
  await page.addInitScript(() => {
    (window as unknown as { getDigitalGoodsService: () => Promise<never> }).getDigitalGoodsService = () => Promise.reject(new Error("no billing in tests"));
  });
  const app = await boot({ enterXR: false });
  // The app requested the session by itself: no click and no answer to an offer.
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR presenting without a tap" });
  expect((await app.state()).xr.sessionMode).toBe("immersive-ar");
  await app.stepUntil((ns) => ns.state().boxPose.source === "head", { maxMs: 2_000, label: "box placed" });
  await expect(page.locator("#status")).toHaveText("");
  await expect(page.locator("#landing")).toBeHidden();
  await expect(page.locator("#enter")).toBeHidden();
});
