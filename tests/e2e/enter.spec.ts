import path from "node:path";
import { COPY } from "../../src/ui/copy";
import { expect, test } from "./helpers/test";
import { SHOTS_DIR } from "./helpers/xr-app";

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
  // The brand faces come from our own origin (the page's font policy allows nothing else) and set the name, the
  // button and the facts.
  const faces = await page.evaluate(async () => {
    const brand = ["Shadow Locks Display", "Shadow Locks Sans"];
    const all = [...document.fonts].filter((f) => brand.includes(f.family.replace(/"/g, "")));
    await Promise.allSettled(all.map((f) => f.load()));
    return all.map((f) => `${f.family.replace(/"/g, "")} ${f.weight} ${f.status}`).sort();
  });
  expect(faces).toEqual(["Shadow Locks Display 400 loaded", "Shadow Locks Sans 700 loaded"]);
  await page.screenshot({ path: path.join(SHOTS_DIR, "landing.png") });
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
  // No landing art as a splash: before XR (in-xr off) only the status shows.
  const shown = await page.evaluate(() => {
    const inXr = document.body.classList.contains("in-xr");
    document.body.classList.remove("in-xr");
    const seen = (sel: string) => getComputedStyle(document.querySelector(sel)!).display !== "none";
    const r = { installed: document.body.classList.contains("installed"), art: seen(".art"), name: seen("#landing h1"), status: seen("#status") };
    if (inXr) document.body.classList.add("in-xr");
    return r;
  });
  expect(shown).toEqual({ installed: true, art: false, name: false, status: true });
  // The app requested the session by itself: no click and no answer to an offer.
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR presenting without a tap" });
  expect((await app.state()).xr.sessionMode).toBe("immersive-ar");
  await app.stepUntil((ns) => ns.state().boxPose.source === "head", { maxMs: 2_000, label: "box placed" });
  await expect(page.locator("#status")).toHaveText("");
  await expect(page.locator("#landing")).toBeHidden();
  await expect(page.locator("#enter")).toBeHidden();
});
