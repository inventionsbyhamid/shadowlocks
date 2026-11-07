/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { installVirtualClock } from "../../../src/app/virtual-clock";
import { installCapture, loadRoom, relaxIwer, setHeadset, stopRoomRender, type XYZ } from "./page-scripts";
import { type BootMode, XrApp } from "./xr-app";

export type Room =
  | "sunlit_living_room"
  | "home_office"
  | "conference_room"
  | "open_office"
  | "kitchen"
  | "bedroom"
  | "music_studio"
  | "open_studio";

/** The room iwsdk.config.json loads by default. */
export const DEFAULT_ROOM: Room = "home_office";

export const VIEWPORTS: Record<BootMode, { width: number; height: number }> = {
  /** Fast: tiny view, room not drawn. For gesture-to-state tests. */
  logic: { width: 320, height: 180 },
  /** Screenshots: 720p with the room drawn. */
  visual: { width: 1280, height: 720 },
};

/**
 * Seated in the home office desk chair (the desk's front edge is at z -1.68): eyes 1.2 m high,
 * looking down at the lap where the box goes (55 cm ahead, 28 cm below the eyes).
 */
export const SEATED: { position: XYZ; lookAt: XYZ } = {
  position: { x: 0, y: 1.2, z: -1.38 },
  lookAt: { x: 0, y: 0.92, z: -1.93 },
};

/** Default wall-clock date inside the page (the virtual clock drives Date), so seeds reproduce. */
export const DEFAULT_DATE = "2026-11-02T09:00:00Z";

export interface BootOptions {
  /** "logic" (default) or "visual". */
  mode?: BootMode;
  /** Page size instead of the mode's (video renders: 1920x1080 or 1280x720). */
  viewport?: { width: number; height: number };
  /** Synthetic room; the default comes from iwsdk.config.json. */
  room?: Room;
  /** Headset pose before XR starts (the box is placed from it). Default: seated. */
  head?: { position: XYZ; lookAt: XYZ } | null;
  /** Page path (default "/"). */
  url?: string;
  /** Stop after the page is ready, before entering XR. */
  enterXR?: boolean;
  /** Virtual ms allowed from entering XR to the first screen. Default 10 000. */
  homeWithinMs?: number;
  /** Screen to wait for after entering XR. Default "home". */
  expectScreen?: string;
  /** Date and time inside the page at load (DEFAULT_DATE when not given); it then follows the frame clock. */
  date?: string | number | Date;
  /**
   * Let a first launch go into the lessons, as a player's does (the app starts lesson 1 until it is done). Off by
   * default: the page opens on Home, as every other spec expects.
   */
  lessons?: boolean;
  testInfo?: TestInfo;
  /** Collect console lines here (the `test` fixture passes its own so they survive reloads). */
  consoleLines?: string[];
}

/** What a test's browser context did: console lines, outside hosts it reached, local paths it fetched. */
export interface Watched {
  hosts: Set<string>;
  lines: string[];
  paths: Set<string>;
}

const watched = new WeakMap<BrowserContext, Watched>();
const hookedPages = new WeakSet<Page>();

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function note(w: Watched, raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) return;
  if (LOCAL_HOSTS.has(u.hostname)) w.paths.add(u.pathname);
  else w.hosts.add(u.host);
}

/**
 * Start watching `page`'s browser context (once): every request, including service workers and
 * popups, every WebSocket, and the page's console. The `test` fixture calls this before boot(), so
 * the record exists even when boot() throws.
 */
export function watch(page: Page, lines?: string[]): Watched {
  const ctx = page.context();
  let w = watched.get(ctx);
  if (!w) {
    const entry: Watched = { hosts: new Set(), lines: lines ?? [], paths: new Set() };
    w = entry;
    watched.set(ctx, entry);
    ctx.on("request", (r) => note(entry, r.url()));
    const hookSockets = (p: Page) => p.on("websocket", (ws) => note(entry, ws.url()));
    for (const p of ctx.pages()) hookSockets(p);
    ctx.on("page", hookSockets);
  }
  if (!hookedPages.has(page)) {
    hookedPages.add(page);
    const entry = w;
    page.on("console", (m) => entry.lines.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => entry.lines.push(`PAGEERROR: ${e.message}`));
  }
  return w;
}

/**
 * Load the app with IWER in headless Chromium on the virtual clock, enter XR the way a player
 * would accept the browser's offer, and wait for the first screen.
 */
export async function boot(page: Page, o: BootOptions = {}): Promise<XrApp> {
  const t0 = Date.now();
  const mode = o.mode ?? "logic";
  const seen = watch(page, o.consoleLines);
  await page.setViewportSize(o.viewport ?? VIEWPORTS[mode]);
  await page.addInitScript(installVirtualClock, { enabled: true, epochMs: new Date(o.date ?? DEFAULT_DATE).getTime() });
  if (!o.lessons) {
    await page.addInitScript(() => {
      (window as { __slSkipLessons?: boolean }).__slSkipLessons = true;
    });
  }
  await page.goto(o.url ?? "/", { waitUntil: "load" });

  const app = new XrApp(page, mode, seen.lines, o.testInfo, seen.hosts, seen.paths);
  await app.waitReal((ns, w) => !!(w.IWER_DEVICE && ns), { label: "IWER and window.__ns" });
  await page.evaluate(relaxIwer);
  if (o.room && o.room !== DEFAULT_ROOM) await page.evaluate(loadRoom, o.room);
  if (mode === "logic") await page.evaluate(stopRoomRender);
  const head = o.head === undefined ? SEATED : o.head;
  if (head) await page.evaluate(setHeadset, head);
  if (o.enterXR === false) {
    app.bootRealMs = Date.now() - t0;
    return app;
  }

  await app.waitReal((_ns, w) => w.IWER_DEVICE.sessionOffered === true, { label: "XR session offer" });
  await app.command("accept_session");
  const entered = await app.now();
  await app.stepUntil((ns) => ns.state().xr.presenting, { maxMs: 5_000, label: "XR presenting" });
  await page.evaluate(relaxIwer);
  await page.evaluate(installCapture);
  // Ready when the first screen is up and the box (with its panels) is placed in front of the head.
  const want = o.expectScreen ?? "home";
  await app.stepUntil(
    (ns, _w, s) => {
      const st = ns.state();
      return st.screen === s && st.boxPose.source !== "default";
    },
    { arg: want, maxMs: o.homeWithinMs ?? 10_000, label: `screen "${want}" with the box placed` },
  );
  app.bootVirtualMs = (await app.now()) - entered;
  app.bootRealMs = Date.now() - t0;
  return app;
}
