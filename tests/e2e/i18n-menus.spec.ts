/* eslint-disable @typescript-eslint/no-explicit-any */
// The drawer's menus in every language: every text on every panel fits its box and stays inside its key, plate and
// panel, as UIKit lays it out with the game's fonts (Japanese lines never start with a closing mark); the Language
// key in Settings changes the language at once and a reload keeps it; and shots of the menus in each language.
// Every panel is filled the longest way it can be: box 128, every tip, a 12-day streak, a collection holding every
// owner and every loot line (all eight pages), and the store edition's trial row and screen, in the app and on
// the web. IWER's headset on the virtual clock.
import type { Page } from "@playwright/test";
import { COPY } from "../../src/ui/copy";
import { DEFAULT_DATE } from "./helpers/boot";
import { expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

const LANGS = ["en", "es", "fr", "de", "pt-BR", "ja"] as const;
const SCREENS = ["home", "lessons", "settings", "reset", "trial", "collection"] as const;
const PAGES = Math.ceil(COPY.story.owners.length / 3);

const setLanguage = (page: Page, language: string) => page.evaluate((l) => (window as any).__ns.ui.setSettings({ language: l }), language);

/** Fill every panel the longest way (the store edition's trial, first launched on the paywall build). */
async function fillEverything(app: XrApp, page: Page): Promise<void> {
  const owners = COPY.story.owners, loot = COPY.story.loot;
  await page.evaluate(
    ({ owners, loot, atMs }) =>
      window.__ns!.ui.profile({
        nextBox: 128,
        current: null,
        tipsSeen: ["decoys", "ringless", "hidden", "drawer"],
        daily: { streak: 12, best: 12, lastDay: "2026-11-01", current: null },
        collection: owners.map((owner, i) => ({
          key: i % 5 === 4 ? "shadow-locks/daily/2026-09-30" : `shadow-locks/${100 + i}`,
          owner,
          loot: loot[i % loot.length]!,
          shapes: ["Moon"],
          atMs: i,
          timeMs: 60_000,
          hints: 0,
        })),
        firstLaunch: { atMs, build: "2.0.0" },
      } as any),
    { owners: [...owners], loot: [...loot], atMs: new Date(DEFAULT_DATE).getTime() },
  );
  await app.stepUntil((n) => n.ui.access().ent.kind === "trial", { maxMs: 2_000, label: "the trial" });
}

async function open(app: XrApp, screen: string): Promise<void> {
  await app.page.evaluate((s) => window.__ns!.ui.go(s as any), screen);
  await app.stepUntil((n, _w, s) => n.state().screen === s && !n.ui.busy(), { arg: screen, maxMs: 3_000, label: `${screen} at rest` });
  await app.step(2);
}

async function problems(app: XrApp, l: string, screen: string, where = screen): Promise<string[]> {
  const found = await app.page.evaluate((s) => window.__sl!.i18n.panelFits(s as any), screen);
  if (!found) return [`no ${screen} panel`];
  return found.map((p) => `${l} ${where} ${p.id}: "${p.text}" ${p.problem}`);
}

test("every text on every menu panel fits in every language", async ({ page, boot }) => {
  test.setTimeout(900_000);
  let app = await boot({ url: "/?edition=store&paywall=1&billing=app" });
  await fillEverything(app, page);
  const found: string[] = [];
  for (const l of LANGS) {
    await setLanguage(page, l);
    await app.step(2);
    for (const s of SCREENS) {
      // The collection opens on its first page when it comes from Home.
      if (s === "collection") await open(app, "home");
      await open(app, s);
      found.push(...(await problems(app, l, s)));
    }
    // Every page of the collection (Older pages on).
    for (let p = 1; p < PAGES; p++) {
      await app.poke("coll-older");
      await app.step(3);
      found.push(...(await problems(app, l, "collection", `collection page ${p + 1}`)));
    }
  }
  // The Language key on Automatic (with the language it picked under it).
  await setLanguage(page, "auto");
  await open(app, "settings");
  found.push(...(await problems(app, "auto", "settings")));

  // On the web the trial screen offers the store page instead of Buy.
  app = await boot({ url: "/?edition=store&paywall=1&billing=web" });
  await fillEverything(app, page);
  for (const l of LANGS) {
    await setLanguage(page, l);
    await open(app, "trial");
    found.push(...(await problems(app, l, "trial", "trial (web)")));
  }
  expect(found).toEqual([]);
  expect(app.consoleLines.filter((x) => /Missing glyph/i.test(x))).toEqual([]);
});

test("the Language key changes the menus at once, and a reload keeps the language", async ({ page, boot }) => {
  let app = await boot();
  await open(app, "settings");
  expect(await page.evaluate(() => window.__ns!.ui.text("settings-language-value"))).toBe("Automatic");
  // Automatic, then English, then Spanish.
  await app.poke("settings-language");
  await app.stepUntil((n) => n.ui.text("settings-language-value") === "English", { maxMs: 2_000, label: "English" });
  await app.poke("settings-language");
  await app.stepUntil((n) => n.ui.text("settings-title") === "Ajustes", { maxMs: 2_000, label: "the menu in Spanish" });
  expect(await page.evaluate(() => window.__ns!.ui.text("settings-language-value"))).toBe("Español");
  expect(await page.evaluate(() => window.__ns!.ui.text("toggle-motion-label"))).toBe("Menos movimiento");
  await open(app, "home");
  expect(await page.evaluate(() => window.__ns!.ui.text("home-settings-label"))).toBe("Ajustes");
  expect(await page.evaluate(() => window.__sl!.i18n.lang())).toEqual({ shown: "es", doc: "es" });
  await app.step(5);
  app = await boot();
  await open(app, "home");
  expect(await page.evaluate(() => window.__ns!.ui.text("home-continue-label"))).toBe("Continuar");
  expect(await page.title()).toBe("Shadow Locks");
});

test("the layout check finds what it is for on a real panel (negative controls)", async ({ page, boot }) => {
  const app = await boot();
  const found = (screen: string) => page.evaluate((s) => window.__sl!.i18n.panelFits(s as any)!, screen);
  await open(app, "settings");
  expect(await found("settings")).toEqual([]);
  // One overlong label on a real key: it runs out of its key (or into its frame, or breaks inside a word).
  await page.evaluate(() => window.__sl!.i18n.forceText("settings", "toggle-hand-label", "Handedness for players who reach mostly with their left"));
  await app.step(2);
  const long = await found("settings");
  expect(long.filter((p) => p.id === "toggle-hand-label").length, JSON.stringify(long)).toBeGreaterThan(0);
  // Painted again, the real words are back and nothing is found.
  await open(app, "home");
  await open(app, "settings");
  expect(await found("settings")).toEqual([]);

  // In Japanese, a plain space left on a panel outside PanelView (as Home's title was) draws as nothing: found.
  await setLanguage(page, "ja");
  await open(app, "home");
  expect(await found("home")).toEqual([]);
  await page.evaluate(() => window.__sl!.i18n.forceText("home", "home-title", "Shadow Locks", true));
  await app.step(2);
  const stray = await found("home");
  expect(stray.some((p) => p.id === "home-title" && /plain space/.test(p.problem)), JSON.stringify(stray)).toBe(true);
});

test("shots: the menus in each language", async ({ page, boot }) => {
  test.setTimeout(1_200_000);
  const app = await boot({ mode: "visual" });
  await page.evaluate(() =>
    window.__ns!.ui.profile({
      nextBox: 6,
      tipsSeen: ["decoys", "ringless"],
      daily: { streak: 3, best: 3, lastDay: "2026-11-01", current: null },
      collection: [1, 2, 3, 4, 5].map((n) => ({ key: `shadow-locks/${n}`, owner: "the Lamplighter", loot: "a night train ticket to Lisbon", shapes: ["Moon"], atMs: n, timeMs: 60_000, hints: 0 })),
    } as any),
  );
  // Home and Settings in every language; Lessons and Collection where the words run longest and where they
  // wrap without spaces (a headset shot takes about half a minute to render here).
  for (const l of LANGS) {
    await setLanguage(page, l);
    for (const s of l === "de" || l === "ja" ? ["home", "settings", "lessons", "collection"] : ["home", "settings"]) {
      if (s === "collection") await open(app, "home");
      await open(app, s);
      const p = await page.evaluate((x) => window.__ns!.ui.panelBox(x as any), s);
      // Settings is about 60 degrees tall from the seated eye: a wider view (10.5 px per degree) shows it whole.
      await app.captureHeadset(`i18n-${l}-menu-${s}`, { x: p!.center[0], y: p!.center[1], z: p!.center[2] }, s === "settings" ? 10.5 : 12);
    }
  }
});
