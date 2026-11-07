// Build-time PWA settings for vite-plugin-pwa (used by vite.config.ts): the web app manifest and the
// generated service worker. Plain data plus one manifest transform, so unit tests can check the
// offline promise without a build.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { VitePWAOptions } from "vite-plugin-pwa";
import { SW_FILE } from "./offline";

export const APP_NAME = "Shadow Locks";
/** The launcher label (truncates past about 12 characters). */
export const SHORT_NAME = "Shadow Locks";
/** Theme and splash colour: the walnut dark of the workshop at night (index.html and the TWA use it too). */
export const THEME_COLOR = "#1a1410";
/** The service worker's cache name prefix, so its caches never mix with another app's on the same origin. */
export const CACHE_ID = "shadow-locks-v1";
const DESCRIPTION = "A puzzle box in your lap. Move the lantern until the brass scraps cast each lock's shape.";

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: "image/png";
  purpose: "any" | "maskable";
}

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "landscape";
  background_color: string;
  theme_color: string;
  categories: string[];
  icons: ManifestIcon[];
}

/** Paths are relative to the manifest, so the app works at an origin root and in a subfolder. */
export function webManifest(): WebManifest {
  return {
    id: "./",
    name: APP_NAME,
    short_name: SHORT_NAME,
    description: DESCRIPTION,
    lang: "en",
    start_url: "./",
    scope: "./",
    display: "standalone",
    orientation: "landscape",
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    categories: ["games", "entertainment"],
    icons: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/**
 * Every file type the build ships. A new kind of asset must be added here or it is not offline
 * (check-dist fails the build when a file is left out). The plugin adds manifest.webmanifest itself.
 * flac: the two hums (FLAC loops without the tick Opus makes at every wrap).
 */
export const PRECACHE_EXTENSIONS = [
  "html", "js", "mjs", "css", "json", "uikitml",
  "glb", "gltf", "bin", "ktx2", "png", "jpg", "webp", "svg",
  "ogg", "flac", "mp3", "wav", "wasm", "woff2", "ttf", "txt",
];

/**
 * Files for link scrapers and search engines only (the link card image, robots.txt, the sitemap): the app
 * never loads them, so they stay out of the precache (scripts/check-dist.mjs allows exactly these).
 */
export const SCRAPER_FILES = ["og-image.jpg", "robots.txt", "sitemap.xml"];

/** Above the biggest file we ship (the main bundle, a music loop); workbox's default is 2 MiB. */
export const MAX_PRECACHE_FILE_BYTES = 8 * 1024 * 1024;

/** One precache entry as workbox's manifestTransforms see it. */
export interface PrecacheEntry {
  url: string;
  revision: string | null;
  size: number;
}

/** Responses whose headers become a scope's policy: pages, and worker scripts (a worker's CSP is its own response's). */
const CARRIES_HEADERS = /(?:\.html|(?:^|\/)[^/]*worker[^/]*\.js)$/i;

/**
 * The service worker caches pages and worker scripts with the headers they came with (the CSP
 * above all), but `_headers` itself is not precached, so changing only it would leave sw.js the
 * same and returning players would never see the change. Folding its hash into those entries'
 * revisions fixes that (a hashed worker without a revision gets "0-<hash>").
 */
function withHostHeaders(headersFile: string) {
  const hash = createHash("sha256").update(readFileSync(headersFile)).digest("hex").slice(0, 12);
  return async (entries: PrecacheEntry[]) => ({
    manifest: entries.map((e) => (CARRIES_HEADERS.test(e.url) ? { ...e, revision: `${e.revision ?? "0"}-${hash}` } : e)),
    warnings: [] as string[],
  });
}

export function pwaOptions(o: { headersFile?: string } = {}): Partial<VitePWAOptions> {
  return {
    strategies: "generateSW",
    filename: SW_FILE,
    manifestFilename: "manifest.webmanifest",
    // main.ts registers it (src/platform/offline.ts), after the first screen is up.
    injectRegister: false,
    devOptions: { enabled: false },
    manifest: webManifest(),
    // The png glob already finds the icons; listing them again would precache them twice.
    includeManifestIcons: false,
    workbox: {
      cacheId: CACHE_ID,
      globPatterns: [`**/*.{${PRECACHE_EXTENSIONS.join(",")}}`],
      // Host files, asset links (the Quest app checks those on the network, never from cache), the
      // 404 page (the worker answers unknown pages with index.html, never with it) and what only link
      // scrapers and search engines fetch (SCRAPER_FILES), so an offline install never grows by them.
      globIgnores: ["**/node_modules/**", "**/_headers", "**/_redirects", "**/.well-known/**", "404.html", ...SCRAPER_FILES],
      maximumFileSizeToCacheInBytes: MAX_PRECACHE_FILE_BYTES,
      // No skipWaiting: a new version never takes over mid-game. The page tells it to at the next
      // boot, before anything starts (takeOverWaitingUpdate in offline.ts).
      skipWaiting: false,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      navigateFallback: "index.html",
      navigateFallbackDenylist: [/^\/\.well-known\//],
      // One self-contained file: no workbox runtime to fetch, nothing from other hosts.
      inlineWorkboxRuntime: true,
      runtimeCaching: [],
      sourcemap: false,
      manifestTransforms: [withHostHeaders(o.headersFile ?? "public/_headers")],
    },
  };
}
