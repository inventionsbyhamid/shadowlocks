/* eslint-disable @typescript-eslint/no-explicit-any */
// The box's own lettering in every language (the plate, the box's keys, the story card): every piece fits at a
// readable size with the fonts the game ships; changing the Language setting repaints it at once; a reload keeps
// the language; and shots of the box in each language for the owner. IWER's headset on the virtual clock.
import type { Page } from "@playwright/test";
import type { SlSessionState } from "../../src/app/test-api";
import type { BoxSpec, V3 } from "../../src/core/types";
import { expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

const LANGS = ["en", "es", "fr", "de", "pt-BR", "ja"] as const;

const session = (page: Page): Promise<SlSessionState | null> => page.evaluate(() => window.__sl!.session.state());
const texts = (page: Page) => page.evaluate(() => window.__sl!.i18n.texts());
const setLanguage = (page: Page, language: string) => page.evaluate((l) => (window as any).__ns.ui.setSettings({ language: l }), language);

async function play(app: XrApp, page: Page, spec: BoxSpec): Promise<SlSessionState> {
  await page.evaluate((s) => window.__sl!.session.play(s), spec);
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "the box in play" },
  );
  return (await session(page))!;
}

/** Wait until the canvas fonts language `l` draws with have arrived, then let the repaint reach the screen. */
async function fontsIn(app: XrApp, page: Page, l: string): Promise<void> {
  await page.waitForFunction(
    (ja) => document.fonts.check("bold 20px 'Shadow Locks Serif'") && (!ja || document.fonts.check("bold 20px 'Shadow Locks JP'")),
    l === "ja",
    { timeout: 10_000 },
  );
  await app.step(2);
}

test("every piece of the box's lettering fits at a readable size in every language", async ({ page, boot }, testInfo) => {
  await boot();
  const fits = await page.evaluate(() => window.__sl!.i18n.boxFits());
  // Every language, every piece: the plate's four names, three keys, the coach card, 24 owners and 22 loot lines.
  expect(fits).toHaveLength(LANGS.length * (4 + 3 + 1 + 24 + 22));
  const squeezed = fits.filter((f) => f.squeezed).map((f) => `${f.lang} ${f.where}: "${f.text}" at ${f.size} px`);
  // What had to be set smaller than full size, or a story sentence that wrapped (allowed; listed for the report).
  const full = (where: string) => Math.max(...fits.filter((x) => x.where === where).map((x) => x.size));
  const notes = fits
    .filter((f) => (f.where === "story" ? f.lines > 2 : f.size < full(f.where)))
    .map((f) => `${f.lang} ${f.where}: "${f.text}" ${f.size} px, ${f.lines} line(s)`);
  testInfo.annotations.push({ type: "fits", description: notes.join("\n") || "every piece at full size" });
  console.log(notes.join("\n"));
  expect(squeezed).toEqual([]);
});

test("changing the language repaints the box's lettering at once, and a reload keeps it", async ({ page, boot }) => {
  let app = await boot();
  await play(app, page, { kind: "box", n: 3 });
  const en = await texts(page);
  expect(en.plate).toBe("Box No. 3");
  expect(en.keys).toEqual({ "plate-next": "Next box", "hint-choice": "Hint", "hint-show-me": "Show me" });
  expect(en.story[0]).toMatch(/^Off the desk of /);

  await setLanguage(page, "de");
  await app.step(1);
  expect(await page.evaluate(() => window.__sl!.i18n.lang())).toEqual({ shown: "de", doc: "de" });
  const de = await texts(page);
  expect(de.plate).toBe("Box Nr. 3");
  expect(de.keys).toEqual({ "plate-next": "Nächste", "hint-choice": "Hinweis", "hint-show-me": "Zeigen" });
  expect(de.story[0]).toMatch(/^Vom Schreibtisch /);
  expect(de.story[1]).toMatch(/^Inhalt: /);

  await setLanguage(page, "ja");
  await app.step(1);
  const ja = await texts(page);
  expect(ja.plate).toBe("第3の箱");
  expect(ja.keys["hint-show-me"]).toBe("見せて");
  expect(ja.story[0]).toMatch(/の机から。$/);

  // Saved in the profile: the next launch starts in Japanese.
  await app.step(5);
  expect(await page.evaluate(() => (window as any).__ns.state().settings?.language ?? null)).not.toBe("en");
  app = await boot();
  expect(await page.evaluate(() => window.__sl!.i18n.lang())).toEqual({ shown: "ja", doc: "ja" });
  await play(app, page, { kind: "box", n: 5 });
  expect((await texts(page)).plate).toBe("第5の箱");

  // Back to the headset's language (IWER's browser says English).
  await setLanguage(page, "auto");
  await app.step(1);
  expect((await texts(page)).plate).toBe("Box No. 5");
});

test("shots: the box's plate and story card in each language", async ({ page, boot }) => {
  test.setTimeout(900_000);
  const app = await boot({ mode: "visual" });
  const playFor = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) await app.step(1, 100);
  };
  for (const l of LANGS) {
    await setLanguage(page, l);
    // Box 88 on the plate (two digits), then box 1's single lock opened for its story card.
    await play(app, page, { kind: "box", n: 88 });
    await fontsIn(app, page, l);
    const panel = (await app.state()).boxPose.position;
    await app.captureHeadset(`i18n-${l}-plate-headset`, { x: panel[0], y: panel[1] + 0.12, z: panel[2] });
    const s = await play(app, page, { kind: "box", n: 1 });
    await page.evaluate((L: V3) => window.__sl!.placeLantern(L), s.locks[0]!.spot);
    await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "reward", { maxMs: 8_000, dt: 100, label: "the reward up" });
    await playFor(400);
    const r = (await page.evaluate(() => window.__sl!.session.reward()))!;
    await app.captureHeadset(`i18n-${l}-story-headset`, { x: r.world[0], y: r.world[1] + 0.03, z: r.world[2] });
  }
});
