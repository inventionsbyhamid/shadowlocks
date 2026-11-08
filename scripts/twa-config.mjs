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
//                                    [--store-host <host>] [--competition-host <host>]
//                                    [--store-version <n>] [--competition-version <n>] [--out <dir>]
//   node scripts/twa-config.mjs check [--app store|competition] [--allow-placeholders]
//   node scripts/twa-config.mjs patch <generated project folder>
//   node scripts/twa-config.mjs apk-check <apk> --app store|competition [--build-tools <dir>] [--test]
// fill reads the current values from the files, applies the options and writes every file, in place or
// under --out (same layout). A version (--store-version, or one a `bubblewrap update` bumped) is kept.
// check fails when a file differs from what the generator makes of its own values (a hand edit), when
// the values are wrong (two apps on one package or host, a malformed id) and, unless
// --allow-placeholders, while any placeholder is left. --app counts only that app's placeholders (and the
// shared key and support address), so the store APK need not wait for the Competition App ID. Run it before
// every APK build.
// patch writes what Meta's release rules want in the APK and Bubblewrap has no setting for into the Gradle
// project `bubblewrap update` generated, before `bubblewrap build` (RELEASE below). Running it again changes
// nothing. (`devices`, its old name, still works.)
// apk-check dumps a built APK with the Android build tools (aapt, apksigner) and checks every rule: run it on each
// APK before it is uploaded. --test is for a test build: any signing key, placeholders allowed.
// scripts/twa-build.sh runs fill's check, patch and apk-check around Bubblewrap.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDER_SHA256 = "REPLACE_WITH_SIGNING_KEY_SHA256";
export const PLACEHOLDER_EMAIL = "REPLACE_WITH_SUPPORT_EMAIL";
export const ASSETLINKS = "public/.well-known/assetlinks.json";
export const PRIVACY = "public/privacy.html";

/** Theme colour of the page, the web manifest and both apps (src/platform/pwa-config.ts THEME_COLOR). */
const THEME = "#1a1410";
/** Where the build container mounts the keystore (plan: never in the repo, deleted after each build). */
const KEYSTORE = { path: "/secrets/shadowlocks-android.keystore", alias: "shadowlocks" };

/**
 * The owner's package ids (decided 2026-11-06): permanent once the first APK of each app is uploaded. Each app's
 * name is its application label, which Meta's release rules say "must be unique on the platform"; the Competition
 * app's is its dashboard name.
 */
export const APPS = {
  store: {
    file: "twa/store/twa-manifest.json",
    packageId: "com.shadowlocks",
    host: "shadowlocks.pages.dev",
    appIdPlaceholder: "REPLACE_WITH_STORE_APP_ID",
    name: "Shadow Locks",
  },
  competition: {
    file: "twa/competition/twa-manifest.json",
    packageId: "com.shadowlocks.judge",
    host: "shadowlocks-judge.pages.dev",
    appIdPlaceholder: "REPLACE_WITH_COMPETITION_APP_ID",
    name: "Shadow Locks Competition",
  },
};
const KINDS = /** @type {const} */ (["store", "competition"]);

const PACKAGE_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const APP_ID_RE = /^[1-9][0-9]{4,24}$/;
const SHA256_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const VERSION_RE = /^[1-9][0-9]{0,8}$/;
/** The support link on the privacy page: the address appears in the href and as the link text. */
const SUPPORT_LINK_RE = /(<a id="support-email" href="mailto:)([^"]*)(">)([^<]*)(<\/a>)/;

/**
 * Meta's "Application Manifests for Release Builds" (updated 2026-10-15), which VRC.Quest.Packaging.1 checks on
 * every upload. Bubblewrap's setting covers minSdkVersion ("29-34"; 32 is the value it recommends for Quest 2, Pro
 * and 3); `patch` writes the rest. Meta's own Bubblewrap 1.24.1 template already writes the passthrough splash for an
 * immersive app; `patch` keeps it so.
 */
export const RELEASE = {
  minSdk: 32,
  minSdkRange: [29, 34],
  /** "apps created since March 1, 2026, must set their targetSdkVersion to 34" (Bubblewrap's Quest template: 32). */
  targetSdk: 34,
  /** VRC.Quest.Functional.14: an app that launches into passthrough shows the system loader over passthrough. */
  splash: { name: "com.oculus.ossplash.background", value: "passthrough-contextual" },
  /** Immersive apps: `<uses-feature android:name="android.hardware.vr.headtracking" android:required="true" android:version="1" />`. */
  headtracking: "android.hardware.vr.headtracking",
  /**
   * VRC.Quest.Packaging.4: "your application must provide a valid network security configuration in your application
   * manifest". No clear text, which is Android's own default at targetSdk 34: no change in behaviour.
   */
  networkConfig: {
    file: "app/src/main/res/xml/network_security_config.xml",
    ref: "@xml/network_security_config",
    text:
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      "<!-- VRC.Quest.Packaging.4: the manifest names a network security configuration. No clear text (Android's default at\n" +
      "     targetSdk 34); the game's traffic is https to its own host anyway. Written by scripts/twa-config.mjs patch. -->\n" +
      "<network-security-config>\n" +
      '    <base-config cleartextTrafficPermitted="false" />\n' +
      "</network-security-config>\n",
  },
};

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
    name: app.name,
    launcherName: app.name,
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
    // No scene permission: the game reads no room data (iwsdk.config.json: sceneUnderstanding and environmentRaycast
    // off; the box is placed from the head pose), and VRC Security.2 allows only permissions the app uses.
    enableXRScene: false,
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
    minSdkVersion: RELEASE.minSdk,
    fingerprints: [],
    additionalTrustedOrigins: [],
    retainedBundles: [],
    displayOverride: [],
  };
}

/**
 * The headsets both apps run on: the APK manifest's `com.oculus.supportedDevices` (identifiers from Meta's
 * compatibility-mode page). Bubblewrap writes no such entry, and without one Horizon OS runs the app on a newer headset
 * in compatibility mode as a Quest 2 (device APIs report Quest 2; refresh rates only those both offer). `patch`
 * writes it into the generated Gradle project, between `bubblewrap update` and `bubblewrap build`.
 */
export const SUPPORTED_DEVICES = ["quest2", "questpro", "quest3", "quest3s"];
const DEVICES_KEY = "com.oculus.supportedDevices";
export const ANDROID_MANIFEST = "app/src/main/AndroidManifest.xml";
export const APP_GRADLE = "app/build.gradle";
export const ROOT_GRADLE = "build.gradle";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `xml` with `<meta-data android:name="name" android:value="value" />` in its application element: an entry of that
 * name with another value is replaced, a missing one added, a right one left as it is.
 */
export function withMetaData(xml, name, value) {
  const entry = `<meta-data android:name="${name}" android:value="${value}" />`;
  const existing = new RegExp(`<meta-data\\s+android:name="${escapeRe(name)}"[^>]*\\/>`);
  const found = existing.exec(xml);
  if (found) return /android:value="([^"]*)"/.exec(found[0])?.[1] === value ? xml : xml.replace(existing, entry);
  const app = /<application\b[^>]*>/.exec(xml);
  if (!app) throw new Error("the manifest has no <application> element");
  const at = app.index + app[0].length;
  return `${xml.slice(0, at)}\n        ${entry}${xml.slice(at)}`;
}

/** `xml` (a generated AndroidManifest.xml) declaring `devices` in its application element, replacing any such entry. */
export function withSupportedDevices(xml, devices = SUPPORTED_DEVICES) {
  return withMetaData(xml, DEVICES_KEY, devices.join("|"));
}

/** `tag` (one start tag) with `attr="value"`, replacing that attribute's value if it has one. */
function withAttribute(tag, attr, value) {
  const re = new RegExp(`(\\s${escapeRe(attr)}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, `$1${value}$2`);
  return tag.replace(/^(<[\w-]+)/, `$1 ${attr}="${value}"`);
}

/** `<manifest android:installLocation="auto">`: "installLocation must be set to auto". */
export function withInstallLocation(xml) {
  const m = /<manifest\b[^>]*>/.exec(xml);
  if (!m) throw new Error("the manifest has no <manifest> element");
  return xml.slice(0, m.index) + withAttribute(m[0], "android:installLocation", "auto") + xml.slice(m.index + m[0].length);
}

/** The head tracking feature an immersive app requires, replacing Bubblewrap's `android:required="false"`. */
export function withHeadTracking(xml) {
  const entry = `<uses-feature android:name="${RELEASE.headtracking}" android:required="true" android:version="1" />`;
  const existing = new RegExp(`<uses-feature\\b[^>]*android:name="${escapeRe(RELEASE.headtracking)}"[^>]*\\/>`);
  if (existing.test(xml)) return xml.replace(existing, entry);
  const app = /<application\b/.exec(xml);
  if (!app) throw new Error("the manifest has no <application> element");
  return `${xml.slice(0, app.index)}${entry}\n\n    ${xml.slice(app.index)}`;
}

/** `android:excludeFromRecents="true"` on the activity that launches the app (the one with MAIN and LAUNCHER). */
export function withExcludeFromRecents(xml) {
  let n = 0;
  const out = xml.replace(/<activity(?=\s)[^>]*?(?:\/>|>[\s\S]*?<\/activity>)/g, (block) => {
    if (!/android\.intent\.action\.MAIN/.test(block) || !/android\.intent\.category\.LAUNCHER/.test(block)) return block;
    n++;
    const start = /^<activity[^>]*>/.exec(block)[0];
    return withAttribute(start, "android:excludeFromRecents", "true") + block.slice(start.length);
  });
  if (n !== 1) throw new Error(`the manifest has ${n} launcher activities (MAIN and LAUNCHER), not one`);
  return out;
}

/** `<application android:networkSecurityConfig="@xml/network_security_config">` (the file: RELEASE.networkConfig). */
export function withNetworkSecurityConfig(xml) {
  const m = /<application\b[^>]*>/.exec(xml);
  if (!m) throw new Error("the manifest has no <application> element");
  return xml.slice(0, m.index) + withAttribute(m[0], "android:networkSecurityConfig", RELEASE.networkConfig.ref) + xml.slice(m.index + m[0].length);
}

/** Every manifest rule `patch` writes, in one pass. */
export function releaseManifest(xml) {
  let out = withSupportedDevices(xml);
  out = withMetaData(out, RELEASE.splash.name, RELEASE.splash.value);
  out = withInstallLocation(out);
  out = withHeadTracking(out);
  out = withNetworkSecurityConfig(out);
  return withExcludeFromRecents(out);
}

/** The app module's build.gradle with targetSdk and compileSdk at RELEASE.targetSdk (compileSdk may not be lower). */
export function releaseAppGradle(gradle) {
  let out = gradle;
  for (const key of ["targetSdk", "compileSdk"]) {
    const re = new RegExp(`(\\b${key}(?:Version)?)(\\s*=\\s*|\\s+)\\d+`, "g");
    if (!re.test(out)) throw new Error(`the app's build.gradle sets no ${key}Version`);
    out = out.replace(re, `$1$2${RELEASE.targetSdk}`);
  }
  return out;
}

/** The top build.gradle without jcenter(), which is gone ("replace that entry with mavenCentral()", Meta's PWA page). */
export function releaseRootGradle(gradle) {
  return gradle.replace(/\bjcenter\(\)/g, "mavenCentral()");
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
      name: d.name,
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

const isPlaceholder = (v) => typeof v === "string" && v.startsWith("REPLACE_WITH_");

/**
 * Problems with the values themselves; placeholders count only when `placeholders` is false, and an App ID
 * placeholder only for the apps in `apps` (both by default).
 */
export function problems(values, { placeholders = false, apps = KINDS } = {}) {
  const bad = [];
  for (const k of KINDS) {
    const a = values.apps[k];
    if (!PACKAGE_RE.test(a.packageId)) bad.push(`${k}: package id "${a.packageId}" is not a valid Android package name`);
    if (!HOST_RE.test(a.host)) bad.push(`${k}: host "${a.host}" is not a host name (no https://, no path)`);
    if (isPlaceholder(a.appId)) {
      if (!placeholders && apps.includes(k)) bad.push(`${k}: App ID is still the placeholder ${a.appId}`);
    } else if (!APP_ID_RE.test(String(a.appId))) bad.push(`${k}: App ID "${a.appId}" is not a numeric Meta App ID`);
    if (!Number.isInteger(a.versionCode) || a.versionCode < 1) bad.push(`${k}: appVersionCode ${a.versionCode} is not a positive whole number`);
  }
  const [s, c] = [values.apps.store, values.apps.competition];
  if (s.packageId === c.packageId) bad.push(`both apps use the package id ${s.packageId}; each app needs its own`);
  if (s.host === c.host) bad.push(`both apps open ${s.host}; the store app opens the public host, the Competition app the judge host`);
  if (!isPlaceholder(s.appId) && s.appId === c.appId) bad.push(`both apps have the App ID ${s.appId}; each dashboard app has its own`);
  if (s.name === c.name) bad.push(`both apps are named "${s.name}"; Meta wants each app's label unique on the platform`);
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
    const version = opts[`${k}-version`];
    if (version !== undefined) {
      if (!VERSION_RE.test(version)) throw new Error(`--${k}-version: "${version}" is not a positive whole number`);
      if (Number(version) < v.apps[k].versionCode) throw new Error(`--${k}-version: ${version} is lower than the current ${v.apps[k].versionCode}`);
      v.apps[k].versionCode = Number(version);
      v.apps[k].versionName = version;
    }
  }
  if (opts.sha256 !== undefined) v.sha256 = normalizeSha256(opts.sha256);
  if (opts["support-email"] !== undefined) {
    if (v.supportEmail == null) throw new Error(`--support-email: ${PRIVACY} has no support link to fill`);
    if (!EMAIL_RE.test(opts["support-email"])) throw new Error(`--support-email: "${opts["support-email"]}" is not an email address`);
    v.supportEmail = opts["support-email"];
  }
  return v;
}

// ---- The built APK, as the Android build tools dump it ----

/**
 * `aapt dump xmltree <apk> AndroidManifest.xml` as a tree: { name, attrs: { name: value }, children }. A value is a
 * string, a number (ints, enums), a boolean (type 0x12) or { ref: "0x7f..." } (a resource reference).
 */
export function parseXmlTree(text) {
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [{ depth: -1, node: root }];
  for (const line of text.split("\n")) {
    const m = /^(\s*)([NEA]): (.*)$/.exec(line);
    if (!m) continue;
    const depth = m[1].length;
    if (m[2] === "N") continue;
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (m[2] === "E") {
      const node = { name: m[3].replace(/\s*\(line=\d+\)$/, ""), attrs: {}, children: [] };
      parent.children.push(node);
      stack.push({ depth, node });
    } else {
      const a = /^([^=(]+?)(?:\(0x[0-9a-f]+\))?=(.*)$/.exec(m[3]);
      if (a) parent.attrs[a[1].trim()] = parseValue(a[2]);
    }
  }
  return root;
}

function parseValue(v) {
  const s = /^"([\s\S]*)" \(Raw: "[\s\S]*"\)$/.exec(v);
  if (s) return s[1];
  const t = /^\(type 0x([0-9a-f]+)\)0x([0-9a-f]+)$/.exec(v);
  if (t) return t[1] === "12" ? parseInt(t[2], 16) !== 0 : parseInt(t[2], 16);
  const r = /^@(0x[0-9a-f]+)$/.exec(v);
  if (r) return { ref: r[1] };
  return v;
}

/** Every element named `name` under `node`, at any depth. */
function all(node, name) {
  const out = [];
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    out.push(...all(c, name));
  }
  return out;
}

/**
 * `aapt dump --values resources <apk>`: the string-valued resources by id, default config first: strings
 * ("0x7f0f0012" -> "immersive") and file resources (an xml resource -> its path in the APK).
 */
export function parseStringResources(text) {
  const out = new Map();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const r = /resource (0x[0-9a-f]+) [^\s:]+:\w+\/\S+: t=0x03/.exec(lines[i]);
    const v = r && /^\s*\(string(?:8|16)\) "([\s\S]*)"\s*$/.exec(lines[i + 1]);
    if (v && !out.has(r[1])) out.set(r[1], v[1]);
  }
  return out;
}

/** `aapt dump badging <apk>`: the lines that matter, by key. */
export function parseBadging(text) {
  const q = (line, key) => new RegExp(`${key}='([^']*)'`).exec(line)?.[1];
  const out = { permissions: [], nativeCode: [], debuggable: false };
  for (const line of text.split("\n")) {
    if (line.startsWith("package:")) {
      out.packageId = q(line, "name");
      out.versionCode = Number(q(line, "versionCode"));
      out.versionName = q(line, "versionName");
      const c = q(line, "compileSdkVersion");
      if (c) out.compileSdk = Number(c);
    } else if (line.startsWith("sdkVersion:")) out.minSdk = Number(/'(\d+)'/.exec(line)?.[1]);
    else if (line.startsWith("targetSdkVersion:")) out.targetSdk = Number(/'(\d+)'/.exec(line)?.[1]);
    else if (line.startsWith("uses-permission:")) out.permissions.push(q(line, "name"));
    else if (line.startsWith("application-label:")) out.label = /^application-label:'(.*)'$/.exec(line)?.[1];
    else if (line.startsWith("native-code:")) out.nativeCode = [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    else if (line.startsWith("application-debuggable")) out.debuggable = true;
  }
  return out;
}

/** `apksigner verify --verbose --print-certs <apk>`: the schemes it verified and each signer's SHA-256. */
export function parseSigner(text) {
  return {
    verified: /^Verifies\s*$/m.test(text),
    v2: /Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(text),
    sha256: [...new Set([...text.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/g)].map((m) => normalizeSha256(m[1])))],
  };
}

/** Permissions the apps may hold (VRC.Quest.Security.2): hand tracking, and AndroidX's own guard for its receivers. */
export function allowedPermissions(packageId) {
  return ["com.oculus.permission.HAND_TRACKING", `${packageId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];
}

/**
 * Every release rule for one built APK, each { rule, ok, detail }. `dumps` holds the build tools' output (xmltree,
 * badging, resources, signer) and the file's size; `want` the app's values: packageId, name, host, appId and sha256
 * (null: not checked), versionCode.
 */
export function apkRules(dumps, want) {
  const rules = [];
  const add = (rule, ok, detail) => rules.push({ rule, ok: Boolean(ok), detail: String(detail) });
  const tree = parseXmlTree(dumps.xmltree);
  const strings = parseStringResources(dumps.resources ?? "");
  const badge = parseBadging(dumps.badging);
  const signer = parseSigner(dumps.signer ?? "");
  const manifest = all(tree, "manifest")[0] ?? { attrs: {}, children: [] };
  const application = all(manifest, "application")[0] ?? { attrs: {}, children: [] };
  const value = (v) => (v && typeof v === "object" && "ref" in v ? (strings.get(v.ref) ?? `@${v.ref}`) : v);
  const meta = new Map(application.children.filter((c) => c.name === "meta-data").map((c) => [c.attrs["android:name"], value(c.attrs["android:value"])]));
  const activities = all(application, "activity");
  const launchers = activities.filter((a) =>
    all(a, "intent-filter").some((f) =>
      all(f, "action").some((x) => x.attrs["android:name"] === "android.intent.action.MAIN") &&
      all(f, "category").some((x) => x.attrs["android:name"] === "android.intent.category.LAUNCHER")),
  );
  const launcher = launchers[0];
  const launcherMeta = new Map((launcher?.children ?? []).filter((c) => c.name === "meta-data").map((c) => [c.attrs["android:name"], value(c.attrs["android:value"])]));
  const features = manifest.children.filter((c) => c.name === "uses-feature");
  const head = features.find((f) => f.attrs["android:name"] === RELEASE.headtracking);
  const [lo, hi] = RELEASE.minSdkRange;

  add("package id", badge.packageId === want.packageId, badge.packageId);
  add("version code (the config's)", badge.versionCode === want.versionCode, `${badge.versionCode} (want ${want.versionCode})`);
  add("application label, unique on the platform", badge.label === want.name, `"${badge.label}" (want "${want.name}")`);
  add(`minSdkVersion ${lo}-${hi}`, badge.minSdk >= lo && badge.minSdk <= hi, badge.minSdk);
  add(`targetSdkVersion ${RELEASE.targetSdk} (apps created since 2026-03-01)`, badge.targetSdk === RELEASE.targetSdk, badge.targetSdk);
  add("compileSdkVersion not below targetSdkVersion", badge.compileSdk === undefined || badge.compileSdk >= badge.targetSdk, badge.compileSdk ?? "not set");
  add("installLocation auto", manifest.attrs["android:installLocation"] === 0, manifest.attrs["android:installLocation"] ?? "not set");
  add(
    "uses-feature android.hardware.vr.headtracking, required, version 1",
    head && head.attrs["android:required"] === true && head.attrs["android:version"] === 1,
    head ? `required=${head.attrs["android:required"]} version=${head.attrs["android:version"]}` : "missing",
  );
  const required = features.filter((f) => f.attrs["android:required"] !== false).map((f) => f.attrs["android:name"]);
  add("no other required feature (VRC.Quest.Packaging.3)", required.every((n) => n === RELEASE.headtracking), required.join(", ") || "none");
  add("not debuggable", !badge.debuggable && application.attrs["android:debuggable"] !== true, badge.debuggable ? "debuggable" : "release");
  add("one launcher activity (MAIN, LAUNCHER)", launchers.length === 1, launchers.map((a) => a.attrs["android:name"]).join(", ") || "none");
  add("launcher activity excludeFromRecents", launcher?.attrs["android:excludeFromRecents"] === true, launcher?.attrs["android:excludeFromRecents"] ?? "not set");
  const vrCategory = launcher && all(launcher, "category").some((x) => x.attrs["android:name"] === "com.oculus.intent.category.VR");
  add("launcher category com.oculus.intent.category.VR (immersive)", vrCategory, vrCategory ? "present" : "missing");
  add("horizonos.pwa.APP_MODE immersive", launcherMeta.get("horizonos.pwa.APP_MODE") === "immersive", launcherMeta.get("horizonos.pwa.APP_MODE") ?? "missing");
  const url = launcherMeta.get("android.support.customtabs.trusted.DEFAULT_URL");
  add("opens its own host", url === `https://${want.host}/`, url ?? "missing");
  add(`${DEVICES_KEY} ${SUPPORTED_DEVICES.join("|")}`, meta.get(DEVICES_KEY) === SUPPORTED_DEVICES.join("|"), meta.get(DEVICES_KEY) ?? "missing");
  add(`${RELEASE.splash.name} ${RELEASE.splash.value} (VRC.Quest.Functional.14)`, meta.get(RELEASE.splash.name) === RELEASE.splash.value, meta.get(RELEASE.splash.name) ?? "missing");
  const nscRef = application.attrs["android:networkSecurityConfig"];
  const nscBase = all(parseXmlTree(dumps.nsc ?? ""), "base-config")[0];
  add(
    "network security config, no clear text (VRC.Quest.Packaging.4)",
    nscRef && typeof nscRef === "object" && nscBase?.attrs.cleartextTrafficPermitted === false,
    !nscRef ? "no android:networkSecurityConfig" : nscBase ? `cleartextTrafficPermitted=${nscBase.attrs.cleartextTrafficPermitted}` : "no base-config",
  );
  // Bubblewrap writes the id as "\ <id>" so that it stays a string, not a number.
  const appId = String(meta.get("com.meta.horizon.platform.ovr.OCULUS_APP_ID") ?? "missing").replace(/^\\/, "").trim();
  if (want.appId !== null) add("Meta App ID", appId === want.appId, appId);
  else add("Meta App ID (not checked: test build)", true, appId);
  const allowed = allowedPermissions(want.packageId);
  const extra = badge.permissions.filter((p) => !allowed.includes(p));
  add("only the permissions the game uses (VRC.Quest.Security.2)", extra.length === 0, badge.permissions.join(", ") || "none");
  add("64-bit or no native code (VRC.Quest.Packaging.6)", badge.nativeCode.length === 0 || badge.nativeCode.includes("arm64-v8a"), badge.nativeCode.join(", ") || "none");
  add("APK Signature Scheme v2, verified (VRC.Quest.Packaging.2)", signer.verified && signer.v2, signer.verified ? (signer.v2 ? "v2" : "no v2") : "not verified");
  if (want.sha256 !== null) add("signed with the key in the asset links", signer.sha256.length === 1 && signer.sha256[0] === want.sha256, signer.sha256.join(", ") || "none");
  else add("signing key (not checked: test build)", signer.sha256.length === 1, signer.sha256.join(", ") || "none");
  add("under 1 GB (VRC.Quest.Packaging.5)", dumps.size > 0 && dumps.size < 1024 ** 3, `${dumps.size} B`);
  return rules;
}

/** The build tools' output for `apk` (aapt and apksigner from `buildTools`). */
export function dumpApk(apk, buildTools) {
  const run = (tool, args) => {
    const r = spawnSync(path.join(buildTools, tool), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`${tool}: ${r.error.message}`);
    if (r.status !== 0 && tool !== "apksigner") throw new Error(`${tool} ${args[0]} failed: ${r.stderr.trim()}`);
    return `${r.stdout}${tool === "apksigner" ? r.stderr : ""}`;
  };
  const xmltree = run("aapt", ["dump", "xmltree", apk, "AndroidManifest.xml"]);
  const resources = run("aapt", ["dump", "--values", "resources", apk]);
  // The network security config the manifest names, by its path in the APK (the build may shorten resource paths).
  const application = all(all(parseXmlTree(xmltree), "manifest")[0] ?? { children: [] }, "application")[0];
  const ref = application?.attrs["android:networkSecurityConfig"];
  const nscPath = ref && typeof ref === "object" ? parseStringResources(resources).get(ref.ref) : undefined;
  return {
    xmltree,
    badging: run("aapt", ["dump", "badging", apk]),
    resources,
    nsc: nscPath ? run("aapt", ["dump", "xmltree", apk, nscPath]) : "",
    signer: run("apksigner", ["verify", "--verbose", "--print-certs", apk]),
    size: fs.statSync(apk).size,
  };
}

// ---- Command line ----

const OPTIONS = new Set([
  "store-app-id", "competition-app-id", "sha256", "support-email",
  "store-package", "competition-package", "store-host", "competition-host", "store-version", "competition-version", "out",
]);
const FLAGS = new Set(["allow-placeholders", "test"]);

function parseArgs(argv, options = OPTIONS) {
  const opts = {};
  const flags = new Set();
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (FLAGS.has(name)) {
      flags.add(name);
      continue;
    }
    if (!options.has(name)) throw new Error(`unknown option: ${a}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${a} needs a value`);
    opts[name] = value;
    i++;
  }
  return { opts, flags, positional };
}

function appKind(opts, required) {
  const k = opts.app;
  if (k === undefined && !required) return null;
  if (!KINDS.includes(k)) throw new Error(`--app takes ${KINDS.join(" or ")}`);
  return k;
}

function patchProject(root, dir) {
  const files = [
    [ANDROID_MANIFEST, releaseManifest],
    [APP_GRADLE, releaseAppGradle],
    [ROOT_GRADLE, releaseRootGradle],
  ];
  for (const [rel] of files) {
    if (!fs.existsSync(path.resolve(root, dir, rel))) throw new Error(`no ${rel} under ${dir} (run it after bubblewrap update)`);
  }
  for (const [rel, fix] of files) {
    const f = path.resolve(root, dir, rel);
    const before = fs.readFileSync(f, "utf8");
    const after = fix(before);
    if (after !== before) fs.writeFileSync(f, after);
    console.log(`twa-config: ${path.relative(root, f)} ${after === before ? "already meets" : "now meets"} Meta's release rules`);
  }
  // The network security config the manifest now names.
  const nsc = path.resolve(root, dir, RELEASE.networkConfig.file);
  const same = fs.existsSync(nsc) && fs.readFileSync(nsc, "utf8") === RELEASE.networkConfig.text;
  if (!same) {
    fs.mkdirSync(path.dirname(nsc), { recursive: true });
    fs.writeFileSync(nsc, RELEASE.networkConfig.text);
  }
  console.log(`twa-config: ${path.relative(root, nsc)} ${same ? "already meets" : "now meets"} Meta's release rules`);
  console.log(
    `twa-config: ${DEVICES_KEY} = ${SUPPORTED_DEVICES.join("|")}; ${RELEASE.splash.name} = ${RELEASE.splash.value}; installLocation auto; ` +
      `${RELEASE.headtracking} required; launcher excludeFromRecents; network security config ${RELEASE.networkConfig.ref} (no clear text); ` +
      `targetSdk and compileSdk ${RELEASE.targetSdk}; no jcenter()`,
  );
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const root = process.cwd();
  if (cmd === "patch" || cmd === "devices") {
    if (rest.length !== 1 || rest[0].startsWith("--")) throw new Error(`${cmd} takes the generated project's folder`);
    patchProject(root, rest[0]);
    return 0;
  }
  if (cmd === "apk-check") {
    const { opts, flags, positional } = parseArgs(rest, new Set(["app", "build-tools"]));
    if (positional.length !== 1) throw new Error("apk-check takes one APK");
    const kind = appKind(opts, true);
    const buildTools = opts["build-tools"] ?? path.join(process.env.ANDROID_HOME ?? "", "build-tools", "34.0.0");
    const values = readValues(root);
    const a = values.apps[kind];
    const test = flags.has("test");
    const want = {
      packageId: a.packageId,
      name: a.name,
      host: a.host,
      versionCode: a.versionCode,
      appId: test ? null : a.appId,
      sha256: test ? null : values.sha256,
    };
    const rules = apkRules(dumpApk(positional[0], buildTools), want);
    for (const r of rules) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.rule}: ${r.detail}`);
    const failed = rules.filter((r) => !r.ok).length;
    console.log(`twa-config: ${kind} APK ${positional[0]}: ${failed ? `${failed} of ${rules.length} rules FAIL` : `all ${rules.length} rules pass`}${test ? " (test build)" : ""}`);
    return failed ? 1 : 0;
  }
  const { opts, flags, positional } = parseArgs(rest, cmd === "check" ? new Set(["app"]) : OPTIONS);
  if (positional.length) throw new Error(`unexpected argument: ${positional[0]}`);
  if (flags.has("test")) throw new Error("--test is for apk-check");
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
    const kind = appKind(opts, false);
    const values = readValues(root);
    const bad = problems(values, { placeholders: flags.has("allow-placeholders"), apps: kind ? [kind] : KINDS });
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
    const line = (k) => `${k} ${a[k].packageId} "${a[k].name}" on ${a[k].host} (App ID ${a[k].appId}, version ${a[k].versionCode})`;
    console.log(`twa-config: ok${kind ? ` for ${kind}` : ""}: ${(kind ? [kind] : KINDS).map(line).join("; ")}; key ${values.sha256}`);
    return 0;
  }
  console.error(
    "usage: node scripts/twa-config.mjs fill [options] | check [--app store|competition] [--allow-placeholders] | " +
      "patch <generated project folder> | apk-check <apk> --app store|competition [--build-tools <dir>] [--test]",
  );
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
