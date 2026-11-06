import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_NAME, CACHE_ID, PRECACHE_EXTENSIONS, pwaOptions, SHORT_NAME, THEME_COLOR, webManifest, type PrecacheEntry } from "../../src/platform/pwa-config";
import { SW_FILE } from "../../src/platform/offline";

const PUBLIC = path.resolve("public");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = fs.readFileSync(file);
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function publicFiles(dir = PUBLIC): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(PUBLIC, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
}

describe("web app manifest", () => {
  const m = webManifest();

  it("names the game and opens standalone at the app's own folder", () => {
    expect(m.name).toBe("Shadow Locks");
    expect(m.name).toBe(APP_NAME);
    expect(m.short_name).toBe(SHORT_NAME);
    // The launcher label truncates past about 12 characters.
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    expect(m.display).toBe("standalone");
    // Relative, so the manifest works at an origin root and in a subfolder alike.
    expect(m.start_url).toBe("./");
    expect(m.scope).toBe("./");
    expect(m.id).toBe("./");
  });

  it("takes its colours from the walnut theme colour, the same as the page and both Quest apps", () => {
    expect(THEME_COLOR).toBe("#1a1410");
    expect(m.theme_color).toBe(THEME_COLOR);
    expect(m.background_color).toBe(THEME_COLOR);
    const html = fs.readFileSync("index.html", "utf8");
    expect(html).toContain(`<meta name="theme-color" content="${THEME_COLOR}" />`);
    for (const app of ["store", "competition"]) {
      const twa = JSON.parse(fs.readFileSync(`twa/${app}/twa-manifest.json`, "utf8")) as Record<string, unknown>;
      for (const k of ["themeColor", "themeColorDark", "navigationColor", "navigationColorDark", "backgroundColor"]) {
        expect(String(twa[k]).toLowerCase(), `${app} ${k}`).toBe(THEME_COLOR);
      }
    }
  });

  it("has no em or en dashes in what players read", () => {
    for (const text of [m.name, m.short_name, m.description]) expect(text).not.toMatch(/[–—]/);
  });

  it("lists 192 and 512 icons plus a 512 maskable one, and each file has the size it claims", () => {
    expect(m.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of m.icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src).not.toMatch(/^\//);
      const [w, h] = pngSize(path.join(PUBLIC, icon.src));
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });
});

describe("service worker options", () => {
  const o = pwaOptions();
  const wb = o.workbox!;

  it("generates sw.js, registered by the app itself, never in the dev server", () => {
    expect(o.strategies).toBe("generateSW");
    expect(o.filename).toBe(SW_FILE);
    expect(o.injectRegister).toBe(false);
    expect(o.devOptions?.enabled).toBe(false);
    expect(o.manifestFilename).toBe("manifest.webmanifest");
    expect(o.manifest).toEqual(webManifest());
  });

  it("waits for the next launch to switch versions (no skipWaiting, so no reload mid-game)", () => {
    expect(wb.skipWaiting).toBe(false);
    // Only takes control of the first page ever loaded (there is no older version to replace then).
    expect(wb.clientsClaim).toBe(true);
    expect(wb.cleanupOutdatedCaches).toBe(true);
  });

  it("only precaches: no runtime caching, nothing from other hosts", () => {
    expect(wb.runtimeCaching ?? []).toEqual([]);
    expect(wb.navigationPreload ?? false).toBe(false);
    expect(wb.offlineGoogleAnalytics ?? false).toBe(false);
    expect(wb.importScripts ?? []).toEqual([]);
    expect(wb.inlineWorkboxRuntime).toBe(true);
    expect(wb.navigateFallback).toBe("index.html");
    expect(wb.navigateFallbackDenylist?.some((re) => re.test("/.well-known/assetlinks.json"))).toBe(true);
  });

  it("names its caches for this game", () => {
    expect(CACHE_ID).toBe("shadow-locks-v1");
    expect(wb.cacheId).toBe(CACHE_ID);
  });

  it("precaches every kind of file the public folder ships", () => {
    expect(wb.globPatterns).toEqual([`**/*.{${PRECACHE_EXTENSIONS.join(",")}}`]);
    const skipped = /^(?:_headers|_redirects|404\.html|\.well-known\/.*|.*\.md)$/;
    const files = publicFiles().filter((f) => !skipped.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(PRECACHE_EXTENSIONS, f).toContain(path.extname(f).slice(1));
    expect(files).toContain("ui/home.uikitml");
    expect(files).toContain("fonts/archivo-xb.png");
    // The sound pack: the music bed, and the hums, which are FLAC (they loop without a tick).
    expect(files).toContain("audio/music/music_bed.ogg");
    expect(files).toContain("audio/sfx/lock_hum.flac");
    expect(files).toContain("audio/sfx/fingertip_hum.flac");
    expect(PRECACHE_EXTENSIONS).toContain("flac");
  });

  it("lists each file once: the plugin adds the manifest, the glob finds the icons", () => {
    expect(o.includeManifestIcons).toBe(false);
    expect(PRECACHE_EXTENSIONS).not.toContain("webmanifest");
  });

  it("keeps the host's files, asset links and the 404 page out of the precache", () => {
    // The worker never serves 404.html (unknown pages get index.html), so precaching it is waste.
    expect(wb.globIgnores).toEqual(expect.arrayContaining(["**/_headers", "**/_redirects", "**/.well-known/**", "404.html"]));
  });

  it("lets the big bundle and music tracks in (the default 2 MiB limit would drop them)", () => {
    expect(wb.maximumFileSizeToCacheInBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024);
  });
});

describe("host headers in the precache", () => {
  const entries: PrecacheEntry[] = [
    { url: "index.html", revision: "abc", size: 1 },
    { url: "assets/index-N12jER5b.js", revision: null, size: 2 },
    { url: "audio/manifest.json", revision: "def", size: 3 },
    { url: "assets/box.worker-Bg6JKhYO.js", revision: null, size: 4 },
    { url: "assets/msdf-worker-BUaSHgMS.js", revision: null, size: 5 },
    { url: "assets/worker-D8yl70Ie.js", revision: null, size: 6 },
  ];
  /** Entries whose responses carry the host's headers into a document or worker scope. */
  const scoped = (url: string) => url === "index.html" || /worker/.test(url);

  async function transform(headersFile: string) {
    const [t] = pwaOptions({ headersFile }).workbox!.manifestTransforms ?? [];
    expect(t, "a manifest transform").toBeDefined();
    return (await t!(entries.map((e) => ({ ...e })))).manifest as PrecacheEntry[];
  }

  function tempHeaders(text: string): string {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sl-headers-")), "_headers");
    fs.writeFileSync(f, text);
    return f;
  }

  it("folds _headers into index.html's revision, so a header change reaches returning players", async () => {
    const a = await transform(tempHeaders("/*\n  X-A: 1\n"));
    const b = await transform(tempHeaders("/*\n  X-A: 2\n"));
    const index = (m: PrecacheEntry[]) => m.find((e) => e.url === "index.html")!.revision;
    expect(index(a)).not.toBe(index(b));
    expect(index(a)).toMatch(/^abc-[0-9a-f]{12}$/);
    // Workers get their CSP from their own response, so they follow the headers too.
    for (const e of a.filter((x) => /worker/.test(x.url))) expect(e.revision).toMatch(/^0-[0-9a-f]{12}$/);
    expect(a.find((e) => e.url.includes("box.worker"))!.revision).not.toBe(b.find((e) => e.url.includes("box.worker"))!.revision);
    // Everything else keeps its own revision.
    expect(a.filter((e) => !scoped(e.url))).toEqual(entries.filter((e) => !scoped(e.url)));
    expect(b.filter((e) => !scoped(e.url))).toEqual(entries.filter((e) => !scoped(e.url)));
  });

  it("reads public/_headers by default", async () => {
    const m = await transform("public/_headers");
    const [t] = pwaOptions().workbox!.manifestTransforms!;
    const d = (await t!(entries.map((e) => ({ ...e })))).manifest as PrecacheEntry[];
    const hash = createHash("sha256").update(fs.readFileSync("public/_headers")).digest("hex").slice(0, 12);
    expect(d.find((e) => e.url === "index.html")!.revision).toBe(`abc-${hash}`);
    expect(d).toEqual(m);
  });
});

