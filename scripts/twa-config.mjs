#!/usr/bin/env node
// The two Quest apps (Trusted Web Activities that Bubblewrap builds) and the asset links that let
// them open our hosts. One generator writes every file, so they never disagree:
//   twa/store/twa-manifest.json         the store app, on the public host
//   twa/competition/twa-manifest.json   the Competition app (judges), on the judge host
//   public/.well-known/assetlinks.json  both packages and the one signing key, served by both hosts
//   public/privacy.html                 only its support address (the rest of the page is hand-written)
// Until the owner sends them, the App IDs, the key's SHA-256 and the support address are placeholders
// (REPLACE_WITH_...). Horizon Billing stays off: no billing feature in either app.
//
// Usage (on the build server; scripts/twa-fill.sh runs it there and copies the result back):
//   node scripts/twa-config.mjs fill [--store-app-id <n>] [--competition-app-id <n>] [--sha256 <fingerprint>]
//                                    [--support-email <address>] [--store-package <id>] [--competition-package <id>]
//                                    [--store-host <host>] [--competition-host <host>] [--out <dir>]
//   node scripts/twa-config.mjs check [--allow-placeholders]
// fill reads the current values from the files, applies the options and writes every file, in place or
// under --out (same layout). A version a later `bubblewrap update` bumped is kept.
// check fails when a file differs from what the generator makes of its own values (a hand edit), when
// the values are wrong (two apps on one package or host, a malformed id) and, unless
// --allow-placeholders, while any placeholder is left: run it before every APK build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER_SHA256 = "REPLACE_WITH_SIGNING_KEY_SHA256";
export const PLACEHOLDER_EMAIL = "REPLACE_WITH_SUPPORT_EMAIL";
export const ASSETLINKS = "public/.well-known/assetlinks.json";
export const PRIVACY = "public/privacy.html";

/** Theme colour of the page, the web manifest and both apps (src/platform/pwa-config.ts THEME_COLOR). */
const THEME = "#1a1410";
const NAME = "Shadow Locks";
/** Where the build container mounts the keystore (plan: never in the repo, deleted after each build). */
const KEYSTORE = { path: "/secrets/shadowlocks-android.keystore", alias: "shadowlocks" };

/** The owner's package ids (decided 2026-11-06): permanent once the first APK of each app is uploaded. */
export const APPS = {
  store: {
    file: "twa/store/twa-manifest.json",
    packageId: "com.shadowlocks",
    host: "shadowlocks.pages.dev",
    appIdPlaceholder: "REPLACE_WITH_STORE_APP_ID",
  },
  competition: {
    file: "twa/competition/twa-manifest.json",
    packageId: "com.shadowlocks.judge",
    host: "shadowlocks-judge.pages.dev",
    appIdPlaceholder: "REPLACE_WITH_COMPETITION_APP_ID",
  },
};
const KINDS = /** @type {const} */ (["store", "competition"]);

const PACKAGE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const APP_ID_RE = /^[1-9][0-9]{4,24}$/;
const SHA256_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
/** The support link on the privacy page: the address appears in the href and as the link text. */
const SUPPORT_LINK_RE = /(<a id="support-email" href="mailto:)([^"]*)(">)([^<]*)(<\/a>)/;

/**
 * A certificate fingerprint as keytool or apksigner prints it ("SHA256: ab:cd:...", lower case, with
 * or without colons) in the colon-separated upper-case form asset links want. Throws on anything else.
 */
export function normalizeSha256(input) {
  const hex = String(input)
    .trim()
    .replace(/^SHA-?256(?:\s+digest)?\s*:\s*/i, "")
    .replace(/[:\s]/g, "")
    .toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) throw new Error(`not a SHA-256 certificate fingerprint (64 hex digits): ${input}`);
  return hex.match(/../g).join(":");
}

/** The Bubblewrap config of one app. */
export function twaManifest(app) {
  const url = (p) => `https://${app.host}${p}`;
  return {
    packageId: app.packageId,
    applicationId: app.appId,
    host: app.host,
    name: NAME,
    launcherName: NAME,
    display: "standalone",
    orientation: "landscape",
    themeColor: THEME,
    themeColorDark: THEME,
    navigationColor: THEME,
    navigationColorDark: THEME,
    navigationDividerColor: "#00000000",
    navigationDividerColorDark: "#00000000",
    backgroundColor: THEME,
    enableNotifications: false,
    enableMicrophone: false,
    enableXRScene: true,
    startUrl: "/",
    iconUrl: url("/icons/icon-512.png"),
    maskableIconUrl: url("/icons/icon-512-maskable.png"),
    webManifestUrl: url("/manifest.webmanifest"),
    fullScopeUrl: url("/"),
    splashScreenFadeOutDuration: 300,
    signingKey: { ...KEYSTORE },
    appVersion: app.versionName,
    appVersionName: app.versionName,
    appVersionCode: app.versionCode,
    shortcuts: [],
    generatorApp: "bubblewrap-cli",
    fallbackType: "customtabs",
    // Empty: no Horizon Billing (it comes with the paywall update) and no other feature.
    features: {},
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: false,
    isChromeOSOnly: false,
    isMetaQuest: true,
    horizonOSAppMode: "immersive",
    minSdkVersion: 23,
    fingerprints: [],
    additionalTrustedOrigins: [],
    retainedBundles: [],
    displayOverride: [],
  };
}

/** One statement per package, all with the same signing key: the file both hosts serve. */
export function assetLinks(packageIds, sha256) {
  return packageIds.map((p) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: p, sha256_cert_fingerprints: [sha256] },
  }));
}

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

function readJson(root, rel) {
  const f = path.join(root, rel);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

/** The values in the files under `root` (defaults and placeholders where a file is missing). */
export function readValues(root) {
  const apps = {};
  for (const k of KINDS) {
    const d = APPS[k];
    const m = readJson(root, d.file) ?? {};
    apps[k] = {
      packageId: m.packageId ?? d.packageId,
      host: m.host ?? d.host,
      appId: m.applicationId ?? d.appIdPlaceholder,
      versionName: String(m.appVersionName ?? m.appVersion ?? "1"),
      versionCode: Number(m.appVersionCode ?? 1),
    };
  }
  const links = readJson(root, ASSETLINKS);
  const sha256 = links?.[0]?.target?.sha256_cert_fingerprints?.[0] ?? PLACEHOLDER_SHA256;
  const privacyFile = path.join(root, PRIVACY);
  const page = fs.existsSync(privacyFile) ? fs.readFileSync(privacyFile, "utf8") : null;
  const supportEmail = page ? (SUPPORT_LINK_RE.exec(page)?.[2] ?? null) : null;
  return { apps, sha256, supportEmail };
}

/** What each file should hold for `values`: relative path -> text. The privacy page needs its current text. */
export function render(values, privacyText) {
  const out = {};
  for (const k of KINDS) out[APPS[k].file] = json(twaManifest(values.apps[k]));
  out[ASSETLINKS] = json(assetLinks(KINDS.map((k) => values.apps[k].packageId), values.sha256));
  if (privacyText != null && values.supportEmail != null) {
    const e = values.supportEmail;
    out[PRIVACY] = privacyText.replace(SUPPORT_LINK_RE, (_m, a, _old, b, _text, c) => `${a}${e}${b}${e}${c}`);
  }
  return out;
}

/** Problems with the values themselves; placeholders count only when `placeholders` is false. */
export function problems(values, { placeholders = false } = {}) {
  const bad = [];
  const isPlaceholder = (v) => typeof v === "string" && v.startsWith("REPLACE_WITH_");
  for (const k of KINDS) {
    const a = values.apps[k];
    if (!PACKAGE_RE.test(a.packageId)) bad.push(`${k}: package id "${a.packageId}" is not a valid Android package name`);
    if (!HOST_RE.test(a.host)) bad.push(`${k}: host "${a.host}" is not a host name (no https://, no path)`);
    if (isPlaceholder(a.appId)) {
      if (!placeholders) bad.push(`${k}: App ID is still the placeholder ${a.appId}`);
    } else if (!APP_ID_RE.test(String(a.appId))) bad.push(`${k}: App ID "${a.appId}" is not a numeric Meta App ID`);
    if (!Number.isInteger(a.versionCode) || a.versionCode < 1) bad.push(`${k}: appVersionCode ${a.versionCode} is not a positive whole number`);
  }
  const [s, c] = [values.apps.store, values.apps.competition];
  if (s.packageId === c.packageId) bad.push(`both apps use the package id ${s.packageId}; each app needs its own`);
  if (s.host === c.host) bad.push(`both apps open ${s.host}; the store app opens the public host, the Competition app the judge host`);
  if (!isPlaceholder(s.appId) && s.appId === c.appId) bad.push(`both apps have the App ID ${s.appId}; each dashboard app has its own`);
  if (isPlaceholder(values.sha256)) {
    if (!placeholders) bad.push(`the signing key's SHA-256 is still the placeholder ${values.sha256}`);
  } else if (!SHA256_RE.test(values.sha256)) bad.push(`"${values.sha256}" is not a colon-separated upper-case SHA-256 fingerprint`);
  if (values.supportEmail != null) {
    if (isPlaceholder(values.supportEmail)) {
      if (!placeholders) bad.push(`the privacy page's support address is still the placeholder ${values.supportEmail}`);
    } else if (!EMAIL_RE.test(values.supportEmail)) bad.push(`"${values.supportEmail}" is not an email address`);
  }
  return bad;
}

/** Values with the command line's changes applied (throws on a malformed option value). */
export function applyOptions(values, opts) {
  const v = structuredClone(values);
  for (const k of KINDS) {
    const id = opts[`${k}-app-id`];
    if (id !== undefined) {
      if (!APP_ID_RE.test(id)) throw new Error(`--${k}-app-id: "${id}" is not a numeric Meta App ID`);
      v.apps[k].appId = id;
    }
    const pkg = opts[`${k}-package`];
    if (pkg !== undefined) v.apps[k].packageId = pkg;
    const host = opts[`${k}-host`];
    if (host !== undefined) v.apps[k].host = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
  if (opts.sha256 !== undefined) v.sha256 = normalizeSha256(opts.sha256);
  if (opts["support-email"] !== undefined) {
    if (v.supportEmail == null) throw new Error(`--support-email: ${PRIVACY} has no support link to fill`);
    if (!EMAIL_RE.test(opts["support-email"])) throw new Error(`--support-email: "${opts["support-email"]}" is not an email address`);
    v.supportEmail = opts["support-email"];
  }
  return v;
}

const OPTIONS = new Set([
  "store-app-id", "competition-app-id", "sha256", "support-email",
  "store-package", "competition-package", "store-host", "competition-host", "out",
]);

function parseArgs(argv) {
  const opts = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const name = a.slice(2);
    if (name === "allow-placeholders") {
      flags.add(name);
      continue;
    }
    if (!OPTIONS.has(name)) throw new Error(`unknown option: ${a}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${a} needs a value`);
    opts[name] = value;
    i++;
  }
  return { opts, flags };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const root = process.cwd();
  const { opts, flags } = parseArgs(rest);
  const privacyFile = path.join(root, PRIVACY);
  const privacyText = fs.existsSync(privacyFile) ? fs.readFileSync(privacyFile, "utf8") : null;
  if (cmd === "fill") {
    const values = applyOptions(readValues(root), opts);
    const bad = problems(values, { placeholders: true });
    if (bad.length) {
      for (const b of bad) console.error(`twa-config: ${b}`);
      return 1;
    }
    const out = opts.out ? path.resolve(root, opts.out) : root;
    for (const [rel, text] of Object.entries(render(values, privacyText))) {
      const f = path.join(out, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text);
      console.log(`twa-config: wrote ${path.relative(root, f)}`);
    }
    const left = problems(values).filter((p) => p.includes("placeholder"));
    for (const p of left) console.log(`twa-config: still to fill: ${p}`);
    return 0;
  }
  if (cmd === "check") {
    if (Object.keys(opts).length) throw new Error("check takes no options but --allow-placeholders");
    const values = readValues(root);
    const bad = problems(values, { placeholders: flags.has("allow-placeholders") });
    for (const [rel, text] of Object.entries(render(values, privacyText))) {
      const f = path.join(root, rel);
      if (!fs.existsSync(f)) bad.push(`${rel} is missing`);
      else if (fs.readFileSync(f, "utf8") !== text) bad.push(`${rel} is not what the generator makes of its values (edit with: node scripts/twa-config.mjs fill)`);
    }
    if (bad.length) {
      for (const b of bad) console.error(`twa-config: ${b}`);
      return 1;
    }
    const a = values.apps;
    console.log(
      `twa-config: ok: store ${a.store.packageId} on ${a.store.host} (App ID ${a.store.appId}, version ${a.store.versionCode}); ` +
        `competition ${a.competition.packageId} on ${a.competition.host} (App ID ${a.competition.appId}, version ${a.competition.versionCode}); ` +
        `key ${values.sha256}`,
    );
    return 0;
  }
  console.error("usage: node scripts/twa-config.mjs fill [options] | check [--allow-placeholders]");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`twa-config: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  }
}
