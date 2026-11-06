/* eslint-disable @typescript-eslint/no-explicit-any */
// The installed or bookmarked game must play with no network after the first load: the first launch
// downloads and precaches it, and every launch after that runs from the service worker. These tests
// build the app for production (with the test hooks and the emulator) and serve it like the host,
// headers included, because the dev server has no service worker. The CSP is served enforced (it
// ships report-only), so these tests also prove that switching it on is safe. Violations are seen
// twice over: the document's securitypolicyviolation events (these work offline) and the reports
// browsers send to the test server's report-uri (these also cover workers).
import type { Page } from "@playwright/test";
import { RUNNING_LOCK, TAKEOVER_KEY } from "../../src/platform/offline";
import { Hands } from "./helpers/hands";
import { add, carry, dist, grab, lantern, shadows, toWorld } from "./helpers/lantern";
import {
  buildForTests,
  copySite,
  CSP_REPORT_PATH,
  CSP_SELFTEST_WORKER,
  deployUpdate,
  serve,
  type CspReport,
  type PwaSite,
} from "./helpers/pwa-site";
import { expect, test } from "./helpers/test";
import type { XrApp } from "./helpers/xr-app";

let built: string;
let site: PwaSite;

test.beforeAll(async () => {
  built = await buildForTests();
  site = await serve(built, { enforceCsp: true });
});

test.afterAll(async () => {
  await site?.close();
});

/** Every CSP violation the current document reports (starts empty on each load). */
function recordCspViolations(): void {
  const w = window as any;
  w.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) =>
    w.__csp.push(`${e.violatedDirective} ${e.blockedURI} from ${e.sourceFile}:${e.lineNumber}`),
  );
}

/**
 * What the CSP would break, beyond the one expected report: UIKit's zod checks once per page
 * document whether eval works (`try { new Function("") }`); the CSP blocks it, zod catches that and
 * skips its JIT. `docs` is how many page documents loaded.
 */
function unexpectedEvents(events: string[], docs = 1): string[] {
  const probe = (v: string) => v.startsWith("script-src eval ");
  return [...events.filter((v) => !probe(v)), ...events.filter(probe).slice(docs)];
}

/** The same for report-uri reports; a worker's reports name the worker script as their document. */
function unexpectedReports(reports: CspReport[], docs: number): string[] {
  const probe = (r: CspReport) => r["blocked-uri"] === "eval" && !/\.js$/.test(r["document-uri"]);
  return [...reports.filter((r) => !probe(r)), ...reports.filter(probe).slice(docs)].map(
    (r) => `${r["document-uri"]}: ${r["effective-directive"] ?? r["violated-directive"]} ${r["blocked-uri"]} from ${r["source-file"]}:${r["line-number"]}`,
  );
}

/** Reports are sent right after a violation; give the last ones a moment to arrive. */
const reportsSettle = (page: Page) => page.waitForTimeout(1500);

/** Waits (real time) for the service worker to be active, then lists what its caches hold. */
async function precached(page: Page): Promise<{ scope: string; cached: string[] } | null> {
  return page.evaluate(async () => {
    const ready = navigator.serviceWorker.ready.then(async (reg) => {
      const worker = reg.active!;
      if (worker.state !== "activated") {
        await new Promise<void>((r) => worker.addEventListener("statechange", () => worker.state === "activated" && r()));
      }
      const cached: string[] = [];
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) cached.push(new URL(req.url).pathname.slice(1));
      }
      return { scope: reg.scope, cached };
    });
    const late = new Promise<null>((r) => setTimeout(() => r(null), 120_000));
    return Promise.race([ready, late]);
  });
}

/** The build label in the current document (deployUpdate's meta), or null for the first build. */
async function buildLabel(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => document.querySelector('meta[name="shadowlocks-build"]')?.getAttribute("content") ?? null);
  } catch {
    return "(navigating)";
  }
}

/** From home, the menus away and box `n` in the lap (the lantern at its start). */
async function showBox(app: XrApp, page: Page, n = 1): Promise<string> {
  await page.evaluate(() => window.__ns!.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  const key = await page.evaluate((k) => window.__ns!.scene.show({ n: k }), n);
  await app.step(2);
  return key;
}

/**
 * Pinch the lantern, carry it 4 cm left and 2 cm down, and check that it followed the hand and that
 * the shadows on the panel moved with it: the game itself running, not only its page.
 */
async function playWithLantern(app: XrApp, page: Page): Promise<void> {
  const hand = new Hands(app, "right");
  const before = await shadows(page);
  expect(before.length, "shadows on the panel").toBeGreaterThan(0);
  const off = await grab(app, page, hand);
  expect((await lantern(page)).held).toBe(true);
  const want = add(await toWorld(page, (await lantern(page)).pos), [-0.04, -0.02, 0]);
  await carry(hand, off, want, 400);
  await app.step(30);
  const moved = await lantern(page);
  expect(moved.held).toBe(true);
  expect(dist(await toWorld(page, moved.pos), want), "the lantern follows the hand").toBeLessThan(0.005);
  const after = await shadows(page);
  expect(after).toHaveLength(before.length);
  expect(after, "the shadows moved with the lantern").not.toEqual(before);
}

test("a second launch plays with the network off", async ({ page, context, boot }) => {
  await page.addInitScript(recordCspViolations);

  // First launch, online. The host's headers come with it.
  const head = await page.request.get(site.url);
  expect(head.headers()["content-security-policy"]).toMatch(/default-src 'self'/);
  expect((await page.request.get(`${site.url}sw.js`)).headers()["cache-control"]).toBe("no-cache");
  const first = await boot({ url: site.url, enterXR: false });

  // The app registers the service worker once the first screen is up; it precaches the whole build.
  const sw = await precached(page);
  expect(sw, "the service worker was active and precached within 120 s").not.toBeNull();
  expect(sw!.scope).toBe(site.url);
  expect(site.precached).toContain("index.html");
  expect(site.precached).toContain("privacy.html");
  expect(site.precached).not.toContain("404.html"); // the host's page; the worker never serves it
  expect(site.precached.some((f) => f.startsWith(".well-known/"))).toBe(false); // the Quest apps check these online
  expect(site.precached).toContain("audio/music/music_bed.ogg");
  expect(site.precached).toContain("audio/sfx/lock_hum.flac");
  expect(site.precached).toContain("fonts/archivo-xb.png");
  expect(site.precached).toContain("input-profiles/meta-quest-touch-plus/left.glb");
  expect([...sw!.cached].sort()).toEqual([...site.precached].sort());
  await reportsSettle(page);
  const firstCsp: string[] = await page.evaluate(() => (window as any).__csp);
  console.log(`CSP, first load: events ${JSON.stringify(firstCsp)}, reports ${JSON.stringify(unexpectedReports(site.reports(), 0))}`);
  expect(unexpectedEvents(firstCsp), "CSP violations on the first load").toEqual([]);
  expect(unexpectedReports(site.reports(), 1), "CSP reports on the first load (page and workers)").toEqual([]);
  expect(first.foreignHosts()).toEqual([]);

  // The network goes off. The second launch must come entirely from the service worker. (A CSP report
  // is the test server's own endpoint, not the game's, and cannot arrive offline.)
  const failed: string[] = [];
  const network: string[] = [];
  const game = (url: string) => /^https?:/.test(url) && !url.includes(CSP_REPORT_PATH);
  context.on("requestfailed", (r) => {
    if (game(r.url())) failed.push(r.url());
  });
  context.on("response", (r) => {
    if (game(r.url()) && !r.fromServiceWorker()) network.push(r.url());
  });
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  const app = await boot({ url: site.url });
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect((await app.state()).screen).toBe("home");
  // The sound pack loads from the precache too.
  await app.stepUntil((ns) => ns.audio.ready(), { maxMs: 10_000, label: "sounds decoded offline" });

  // Play: a box in the lap, the lantern pinched and carried, its shadows moving on the panel.
  const key = await showBox(app, page, 1);
  expect(key).toBeTruthy();
  expect((await app.state()).box.visible).toBe(true);
  await playWithLantern(app, page);

  expect(failed, "requests that tried the network while offline").toEqual([]);
  expect(network, "responses that did not come from the service worker").toEqual([]);
  expect(app.foreignHosts()).toEqual([]);
  const offlineCsp: string[] = await page.evaluate(() => (window as any).__csp);
  console.log(`CSP, offline: events ${JSON.stringify(offlineCsp)}; precache ${site.precached.length} files`);
  expect(unexpectedEvents(offlineCsp), "CSP violations offline").toEqual([]);
});

test("the CSP check sees violations inside workers", async ({ page, boot }) => {
  await boot({ url: site.url, enterXR: false });
  const before = site.reports().length;
  // A same-origin worker under the same headers as ours, trying eval.
  await page.evaluate((src) => new Promise((r) => (new Worker(src).onmessage = r)), CSP_SELFTEST_WORKER);
  await expect
    .poll(() => unexpectedReports(site.reports().slice(before), 1), { timeout: 10_000 })
    .toEqual([expect.stringMatching(/__csp-selftest-worker\.js: script-src(-elem)? eval /)]);
});

test("a new version waits while a box is in play and takes over at the next launch", async ({ page, boot }) => {
  // Its own origin, so its service worker and storage start empty.
  const live = await serve(copySite(built, "dist-e2e-update"), { port: 8083, enforceCsp: true });
  try {
    // Version A: first load, precache, a box in play with the lantern held.
    let app = await boot({ url: live.url });
    expect(await precached(page)).not.toBeNull();
    await showBox(app, page, 2);
    const hand = new Hands(app, "right");
    await grab(app, page, hand);
    await page.evaluate(() => ((window as any).__sameDocument = true));

    // Version B goes live and the browser finds it (as on its own update check).
    deployUpdate(live.outDir, "B");
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null), {
        timeout: 60_000,
      })
      .toBe("installed");

    // No takeover mid-box: the same document plays on, A in control, B waiting, the lantern still held.
    await app.step(144);
    expect((await app.state()).screen).toBe("play");
    expect((await lantern(page)).held).toBe(true);
    expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
    expect(await buildLabel(page)).toBeNull();

    // Next launch: B takes over before anything starts (one reload).
    await page.reload({ waitUntil: "load" });
    await expect.poll(() => buildLabel(page), { timeout: 60_000 }).toBe("B");
    expect(await page.evaluate(async () => !(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
    // The tab remembers it reloaded for an update (so it never loops).
    expect(await page.evaluate((k) => sessionStorage.getItem(k), TAKEOVER_KEY)).not.toBeNull();
    app = await boot({ url: live.url });
    expect(await buildLabel(page)).toBe("B");
    expect(app.foreignHosts()).toEqual([]);
    // Four page documents loaded (A, A's boot that handed over, B twice).
    await reportsSettle(page);
    expect(unexpectedReports(live.reports(), 4), "CSP reports (page and workers)").toEqual([]);
  } finally {
    await live.close();
  }
});

test("a second window never switches a box in play to a new version", async ({ page, context, boot }) => {
  const live = await serve(copySite(built, "dist-e2e-windows"), { port: 8084, enforceCsp: true });
  try {
    // Window 1 plays version A; version B is published and waits.
    const app = await boot({ url: live.url });
    expect(await precached(page)).not.toBeNull();
    await showBox(app, page, 2);
    await page.evaluate(() => ((window as any).__sameDocument = true));
    deployUpdate(live.outDir, "B");
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null), {
        timeout: 60_000,
      })
      .toBe("installed");

    // Window 2 launches. Window 1 holds the running lock, so window 2 must not take over.
    const second = await context.newPage();
    try {
      await second.goto(live.url, { waitUntil: "load" });
      await second.waitForFunction(() => !!(window as any).__ns, null, { timeout: 120_000 });
      expect(await buildLabel(second)).toBeNull();
      expect(await second.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null)).toBe(
        "installed",
      );
      const held = await second.evaluate(
        async (name) => (await navigator.locks.query()).held?.filter((l) => l.name === name).length,
        RUNNING_LOCK,
      );
      expect(held).toBe(2);
    } finally {
      await second.close();
    }

    // Window 1 played on, untouched.
    await app.step(144);
    expect((await app.state()).screen).toBe("play");
    expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
    expect(await buildLabel(page)).toBeNull();
    expect(app.foreignHosts()).toEqual([]);
  } finally {
    await live.close();
  }
});
