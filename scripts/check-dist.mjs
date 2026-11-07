#!/usr/bin/env node
// Fails when a production build carries test or emulator code, or error reporting/telemetry SDKs,
// when the service worker would leave a shipped file out of the precache (offline after the first
// load), when a signing key or secret file landed in it, or when code and art (everything precached
// but audio) weigh more than 5 MB as served: each file Brotli-compressed at quality 11, summed. Audio
// keeps its own budgets (SFX 1 MB, music 6 MB, checked where the pack is built).
// Warns about CDN hosts the build mentions (the game must work offline after the first load).
// Usage (on the build server, after vite build): node scripts/check-dist.mjs [dist]
// CHECK_DIST_CODE_ART_MAX overrides the 5 MB budget (tests only).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const dir = process.argv[2] ?? "dist";
/** Code and art budget: Brotli bytes of every precached file except audio. */
const CODE_ART_MAX = Number(process.env.CHECK_DIST_CODE_ART_MAX ?? 5_000_000);
const AUDIO = /\.(?:ogg|oga|opus|mp3|wav|flac|m4a|aac)$/i;
const brotli = (buf) =>
  zlib.brotliCompressSync(buf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
  }).length;
const FORBIDDEN = [
  ["test hooks", /\b__ns\b/],
  ["test hooks", /\b__sl\b/],
  ["video helpers", /__nsVideo/],
  ["IWER emulator", /IWER_DEVICE/],
  ["Sentry", /sentry/i],
  ["OpenTelemetry", /opentelemetry/i],
  ["Meta VR CLI telemetry", /@meta-quest\/metavr|xxiwsdk/],
];
const CDN = /https?:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net|[a-z0-9.-]*googleapis\.com|[a-z0-9.-]*gstatic\.com)[^"'`\s)]*/gi;
const TEXT = /\.(?:js|mjs|html|css|json|webmanifest|svg|txt|uikitml)$/i;

if (!fs.existsSync(dir)) {
  console.error(`check-dist: no ${dir}/ (run vite build first)`);
  process.exit(2);
}
const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => TEXT.test(f));
let failed = false;
const cdn = new Map();
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  for (const [what, re] of FORBIDDEN) {
    const m = re.exec(text);
    if (m) {
      failed = true;
      console.error(`check-dist: ${what} in ${f}: ...${text.slice(Math.max(0, m.index - 40), m.index + 40)}...`);
    }
  }
  for (const m of text.matchAll(CDN)) cdn.set(m[0], f);
}
for (const [url, f] of cdn) console.warn(`check-dist: warning: ${f} mentions ${url}`);

// Offline: every file the app may load is in the service worker's precache.
const fail = (msg) => {
  failed = true;
  console.error(`check-dist: ${msg}`);
};
const all = fs
  .readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"));
const size = (f) => fs.statSync(path.join(dir, f)).size;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
for (const f of all) {
  if (/(?:\.(?:keystore|jks|p12|pfx|pem|key)|(?:^|\/)\.env(?:\..*)?)$/i.test(f)) fail(`${f} looks like a key or secret and must never be published`);
}
for (const f of ["index.html", "sw.js", "manifest.webmanifest", "_headers"]) {
  if (!all.includes(f)) fail(`missing ${f}`);
}
if (all.includes("sw.js")) {
  const sw = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
  const listed = [...sw.matchAll(/url:\s*["']([^"']+)["']\s*,\s*revision:/g)].map((m) => m[1].replace(/^\.\//, ""));
  const precached = new Set(listed);
  for (const u of precached) if (listed.indexOf(u) !== listed.lastIndexOf(u)) fail(`sw.js lists ${u} more than once`);
  if (/importScripts\(/.test(sw)) fail("sw.js imports scripts (expected the workbox runtime inlined)");
  // Never loaded by the app: the worker itself, host config, the host's 404 page, asset links
  // (checked on the network), docs, and what only link scrapers and search engines fetch
  // (SCRAPER_FILES in src/platform/pwa-config.ts: the card image, robots.txt, the sitemap).
  const uncachedOk = /^(?:sw\.js|_headers|_redirects|404\.html|og-image\.jpg|robots\.txt|sitemap\.xml|\.well-known\/.*|.*\.md)$/;
  for (const f of all) if (!uncachedOk.test(f) && !precached.has(f)) fail(`${f} is not precached (add its type to PRECACHE_EXTENSIONS or raise the size limit)`);
  if (all.includes("index.html")) {
    // The link card image: shipped, never precached (offline installs stay the same size).
    if (!all.includes("og-image.jpg")) fail("missing og-image.jpg (the link card image)");
    if (precached.has("og-image.jpg")) fail("sw.js precaches og-image.jpg (only link scrapers fetch it)");
  }
  for (const u of precached) if (!all.includes(u)) fail(`sw.js precaches ${u}, which the build does not have`);
  const bytes = [...precached].filter((u) => all.includes(u)).reduce((n, u) => n + size(u), 0);
  console.log(`check-dist: precache ${precached.size} files, ${mb(bytes)}`);
  // The download budget for code and art, as served (Brotli), audio left out.
  const codeArt = [...precached].filter((u) => all.includes(u) && !AUDIO.test(u));
  const served = codeArt.reduce((n, u) => n + brotli(fs.readFileSync(path.join(dir, u))), 0);
  console.log(`check-dist: code and art ${served} bytes Brotli (${codeArt.length} files; budget ${CODE_ART_MAX})`);
  if (served > CODE_ART_MAX) fail(`code and art are ${served} bytes Brotli, over the ${CODE_ART_MAX} byte budget`);
  // A stamp for this build: scripts/deploy-pages.sh compares it with the copy it pulled.
  console.log(`check-dist: sw.js sha256 ${createHash("sha256").update(sw).digest("hex")}`);
}
if (all.includes("index.html")) {
  // Vite fills %VITE_...% in the page from the env; one left means a value the build never got.
  const page = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const left = /%VITE_[A-Z0-9_]*%/.exec(page);
  if (left) fail(`index.html still has ${left[0]} (vite.config.ts gives VITE_SITE_ORIGIN a default)`);
}
if (all.includes("manifest.webmanifest")) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.webmanifest"), "utf8"));
  for (const icon of m.icons ?? []) if (!all.includes(icon.src.replace(/^\.?\//, ""))) fail(`manifest icon ${icon.src} is missing`);
}
console.log(`check-dist: ${all.length} files, ${mb(all.reduce((n, f) => n + size(f), 0))} in ${dir}/`);
if (failed) process.exit(1);
console.log(`check-dist: ${files.length} text files clean`);
