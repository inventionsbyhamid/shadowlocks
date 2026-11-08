// The Quest apps' configs and asset links (scripts/twa-config.mjs), through its command line: the
// committed files, filling in what the owner sends, and the check that runs before an APK build.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { THEME_COLOR } from "../../src/platform/pwa-config";

const SCRIPT = path.resolve("scripts/twa-config.mjs");
const STORE = "twa/store/twa-manifest.json";
const COMPETITION = "twa/competition/twa-manifest.json";
const LINKS = "public/.well-known/assetlinks.json";
const PRIVACY = "public/privacy.html";
const SHA = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

interface Manifest {
  [k: string]: unknown;
  packageId: string;
  applicationId: string;
  host: string;
  signingKey: { path: string; alias: string };
  features: Record<string, unknown>;
}
interface Statement {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}

function run(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const read = <T>(root: string, rel: string): T => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")) as T;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
/** An empty folder, optionally with a privacy page whose support link is still the placeholder (the fill writes it). */
function tmpRoot(withPrivacy = false): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "twa-config-"));
  dirs.push(d);
  if (withPrivacy) {
    fs.mkdirSync(path.join(d, "public"), { recursive: true });
    const p = "REPLACE_WITH_SUPPORT_EMAIL";
    fs.writeFileSync(path.join(d, PRIVACY), `<p>Email <a id="support-email" href="mailto:${p}">${p}</a>.</p>\n`);
  }
  return d;
}

describe("the committed Quest app configs", () => {
  const store = read<Manifest>(".", STORE);
  const competition = read<Manifest>(".", COMPETITION);

  it("are exactly what the generator makes of their own values", () => {
    const r = run(process.cwd(), "check", "--allow-placeholders");
    expect(r.out).toMatch(/twa-config: ok/);
    expect(r.status).toBe(0);
  });

  it("use the owner's package ids, which are permanent once uploaded", () => {
    expect(store.packageId).toBe("com.shadowlocks");
    expect(competition.packageId).toBe("com.shadowlocks.judge");
  });

  it("open the public host from the store app and the judge host from the Competition app", () => {
    expect(store.host).toBe("shadowlocks.pages.dev");
    expect(competition.host).toBe("shadowlocks-judge.pages.dev");
    expect(store.packageId).not.toBe(competition.packageId);
    for (const m of [store, competition]) {
      for (const k of ["iconUrl", "maskableIconUrl", "webManifestUrl", "fullScopeUrl"]) expect(String(m[k]), k).toMatch(new RegExp(`^https://${m.host}/`));
    }
  });

  it("are immersive Quest apps, version 1 or later, signed with the one shared key", () => {
    for (const m of [store, competition]) {
      expect(m.isMetaQuest).toBe(true);
      expect(m.horizonOSAppMode).toBe("immersive");
      expect(m.signingKey).toEqual({ path: "/secrets/shadowlocks-android.keystore", alias: "shadowlocks" });
      expect(Number(m.appVersionCode)).toBeGreaterThanOrEqual(1);
    }
  });

  it("carry each app's own name as its label: Meta wants the application label unique on the platform", () => {
    // The store app is the listing's name; the Competition app its dashboard name (ship steps, step 2).
    expect([store.name, store.launcherName]).toEqual(["Shadow Locks", "Shadow Locks"]);
    expect([competition.name, competition.launcherName]).toEqual(["Shadow Locks Competition", "Shadow Locks Competition"]);
  });

  it("set minSdkVersion 32: Meta's release rules allow 29 to 34 and recommend 32 for Quest 2, Pro and 3", () => {
    for (const m of [store, competition]) expect(m.minSdkVersion).toBe(32);
  });

  it("leave Horizon Billing off (v1 is free; billing comes with the paywall update)", () => {
    for (const m of [store, competition]) {
      expect(m.features).toEqual({});
      expect(JSON.stringify(m)).not.toMatch(/billing/i);
    }
  });

  it("ask for no permission the game does not use: no scene, microphone or notifications", () => {
    for (const m of [store, competition]) {
      expect(m.enableXRScene).toBe(false);
      expect(m.enableMicrophone).toBe(false);
      expect(m.enableNotifications).toBe(false);
    }
  });

  it("take the walnut theme colour of the page and the web manifest", () => {
    for (const m of [store, competition]) {
      for (const k of ["themeColor", "themeColorDark", "navigationColor", "navigationColorDark", "backgroundColor"]) {
        expect(String(m[k]).toLowerCase(), k).toBe(THEME_COLOR);
      }
    }
  });

  it("are matched by one asset links file that lists both packages with the same key", () => {
    const links = read<Statement[]>(".", LINKS);
    expect(links.map((s) => s.target.package_name)).toEqual([store.packageId, competition.packageId]);
    for (const s of links) {
      expect(s.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
      expect(s.target.namespace).toBe("android_app");
      expect(s.target.sha256_cert_fingerprints).toEqual(links[0]!.target.sha256_cert_fingerprints);
    }
  });

  it("leave the old single-app config behind", () => {
    expect(fs.existsSync("twa/twa-manifest.json")).toBe(false);
  });
});

describe("filling in what the owner sends", () => {
  it("starts from the defaults with every placeholder marked, and the strict check names each one", () => {
    const root = tmpRoot(true);
    expect(run(root, "fill").status).toBe(0);
    expect(read<Manifest>(root, STORE).applicationId).toBe("REPLACE_WITH_STORE_APP_ID");
    expect(read<Manifest>(root, COMPETITION).applicationId).toBe("REPLACE_WITH_COMPETITION_APP_ID");
    const r = run(root, "check");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/store: App ID is still the placeholder/);
    expect(r.out).toMatch(/competition: App ID is still the placeholder/);
    expect(r.out).toMatch(/SHA-256 is still the placeholder/);
    expect(r.out).toMatch(/support address is still the placeholder/);
    expect(run(root, "check", "--allow-placeholders").status).toBe(0);
  });

  it("writes the App IDs, the key (as keytool prints it) and the support address, then passes the strict check", () => {
    const root = tmpRoot(true);
    const keytool = `SHA256: ${SHA.toLowerCase()}`;
    const r = run(root, "fill", "--store-app-id", "1234567890123456", "--competition-app-id", "2345678901234567", "--sha256", keytool,
      "--support-email", "help@example.com");
    expect(r.status, r.out).toBe(0);
    expect(read<Manifest>(root, STORE).applicationId).toBe("1234567890123456");
    expect(read<Manifest>(root, COMPETITION).applicationId).toBe("2345678901234567");
    const links = read<Statement[]>(root, LINKS);
    expect(links.map((s) => s.target.sha256_cert_fingerprints)).toEqual([[SHA], [SHA]]);
    const page = fs.readFileSync(path.join(root, PRIVACY), "utf8");
    expect(page).toContain('<a id="support-email" href="mailto:help@example.com">help@example.com</a>');
    expect(page).not.toContain("REPLACE_WITH");
    const c = run(root, "check");
    expect(c.out).toMatch(/twa-config: ok: store com\.shadowlocks "Shadow Locks" on shadowlocks\.pages\.dev \(App ID 1234567890123456/);
    expect(c.out).toMatch(/competition com\.shadowlocks\.judge "Shadow Locks Competition" on shadowlocks-judge\.pages\.dev/);
    expect(c.status).toBe(0);
  });

  it("checks one app at a time: the store app need not wait for the Competition App ID", () => {
    const root = tmpRoot(true);
    expect(run(root, "fill", "--store-app-id", "1234567890123456", "--sha256", SHA, "--support-email", "help@example.com").status).toBe(0);
    const s = run(root, "check", "--app", "store");
    expect(s.out).toMatch(/twa-config: ok for store: store com\.shadowlocks/);
    expect(s.out).not.toMatch(/competition/);
    expect(s.status).toBe(0);
    const c = run(root, "check", "--app", "competition");
    expect(c.out).toMatch(/competition: App ID is still the placeholder/);
    expect(c.status).toBe(1);
    expect(run(root, "check").status).toBe(1);
    // The shared key still counts for either app.
    const bare = tmpRoot(true);
    expect(run(bare, "fill", "--store-app-id", "1234567890123456").status).toBe(0);
    expect(run(bare, "check", "--app", "store").out).toMatch(/SHA-256 is still the placeholder/);
    expect(run(bare, "check", "--app", "judge").status).toBe(2);
  });

  it("raises an app's version (a later APK), never lowers it", () => {
    const root = tmpRoot();
    expect(run(root, "fill", "--store-version", "2").status).toBe(0);
    const m = read<Manifest>(root, STORE);
    expect([m.appVersionCode, m.appVersionName, m.appVersion]).toEqual([2, "2", "2"]);
    expect(read<Manifest>(root, COMPETITION).appVersionCode).toBe(1);
    expect(run(root, "fill", "--store-version", "1").out).toMatch(/lower than the current 2/);
    expect(run(root, "fill", "--competition-version", "1.5").status).toBe(2);
    expect(read<Manifest>(root, STORE).appVersionCode).toBe(2);
  });

  it("fills in steps: a later fill keeps what an earlier one wrote", () => {
    const root = tmpRoot();
    expect(run(root, "fill", "--sha256", SHA.replace(/:/g, "")).status).toBe(0);
    expect(run(root, "fill", "--store-app-id", "1234567890123456").status).toBe(0);
    expect(read<Statement[]>(root, LINKS)[1]!.target.sha256_cert_fingerprints).toEqual([SHA]);
    expect(read<Manifest>(root, STORE).applicationId).toBe("1234567890123456");
  });

  it("takes other package ids and hosts, and moves both asset links statements with them", () => {
    const root = tmpRoot();
    const r = run(root, "fill", "--store-package", "com.example.locks", "--competition-package", "com.example.locks.judge",
      "--competition-host", "https://judge-x.pages.dev/");
    expect(r.status, r.out).toBe(0);
    const m = read<Manifest>(root, COMPETITION);
    expect(m.host).toBe("judge-x.pages.dev");
    expect(m.webManifestUrl).toBe("https://judge-x.pages.dev/manifest.webmanifest");
    expect(read<Statement[]>(root, LINKS).map((s) => s.target.package_name)).toEqual(["com.example.locks", "com.example.locks.judge"]);
  });

  it("keeps a version that a later bubblewrap update bumped", () => {
    const root = tmpRoot();
    expect(run(root, "fill").status).toBe(0);
    const m = read<Manifest>(root, STORE);
    fs.writeFileSync(path.join(root, STORE), JSON.stringify({ ...m, appVersion: "3", appVersionName: "3", appVersionCode: 3 }, null, 2));
    expect(run(root, "fill", "--store-app-id", "1234567890123456").status).toBe(0);
    expect(read<Manifest>(root, STORE).appVersionCode).toBe(3);
    expect(read<Manifest>(root, COMPETITION).appVersionCode).toBe(1);
  });

  it("refuses malformed values and writes nothing", () => {
    const root = tmpRoot(true);
    const bad = [
      ["--store-app-id", "12ab"],
      ["--sha256", "AB:CD"],
      ["--support-email", "not an address"],
    ];
    for (const args of bad) {
      const r = run(root, "fill", ...args);
      expect(r.status, args.join(" ")).toBe(2);
    }
    expect(fs.existsSync(path.join(root, STORE))).toBe(false);
    const same = run(root, "fill", "--competition-package", "com.shadowlocks");
    expect(same.status).toBe(1);
    expect(same.out).toMatch(/both apps use the package id/);
    expect(run(root, "fill", "--store-host", "shadowlocks-judge.pages.dev").out).toMatch(/both apps open/);
    expect(run(root, "fill", "--store-app-id", "1234567890123456", "--competition-app-id", "1234567890123456").out).toMatch(/both apps have the App ID/);
  });

  it("writes under --out in the repo's layout and leaves the files in place alone", () => {
    const root = tmpRoot(true);
    const before = fs.readFileSync(path.join(root, PRIVACY), "utf8");
    expect(run(root, "fill", "--out", "out", "--support-email", "help@example.com").status).toBe(0);
    for (const rel of [STORE, COMPETITION, LINKS, PRIVACY]) expect(fs.existsSync(path.join(root, "out", rel)), rel).toBe(true);
    expect(fs.existsSync(path.join(root, STORE))).toBe(false);
    expect(fs.readFileSync(path.join(root, PRIVACY), "utf8")).toBe(before);
  });

  it("catches a hand edit the generator would not make", () => {
    const root = tmpRoot();
    expect(run(root, "fill").status).toBe(0);
    const m = read<Manifest>(root, COMPETITION);
    fs.writeFileSync(path.join(root, COMPETITION), `${JSON.stringify({ ...m, horizonOSAppMode: "2D" }, null, 2)}\n`);
    const r = run(root, "check", "--allow-placeholders");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/twa\/competition\/twa-manifest\.json is not what the generator makes/);
  });
});

describe("patch: Meta's release rules in the Gradle project bubblewrap update generated", () => {
  const MANIFEST = "app/src/main/AndroidManifest.xml";
  const APP_GRADLE = "app/build.gradle";
  const ROOT_GRADLE = "build.gradle";
  const NSC = "app/src/main/res/xml/network_security_config.xml";
  const DEVICES = '<meta-data android:name="com.oculus.supportedDevices" android:value="quest2|questpro|quest3|quest3s" />';
  const HEAD = '<uses-feature android:name="android.hardware.vr.headtracking" android:required="true" android:version="1" />';
  /** The manifest as Meta's Bubblewrap 1.24.1 Quest template writes it for an immersive app (trimmed). */
  const generated = (extra = "") =>
    [
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
      '    package="com.shadowlocks">',
      '        <uses-permission android:name="com.oculus.permission.HAND_TRACKING" />',
      "    <uses-feature",
      '        android:name="android.hardware.vr.headtracking"',
      '        android:required="false"',
      '        android:version="1" />',
      "    <uses-feature",
      '        android:name="oculus.software.handtracking"',
      '        android:required="false" />',
      "    <application",
      '        android:name="Application"',
      '        android:label="@string/appName"',
      '        android:theme="@android:style/Theme.Translucent.NoTitleBar">',
      `${extra}        <meta-data`,
      '            android:name="asset_statements"',
      '            android:resource="@string/assetStatements" />',
      "             <meta-data",
      '                android:name="com.oculus.ossplash.background"',
      '                android:value="passthrough-contextual"/>',
      '        <activity android:name="LauncherActivity"',
      '            android:alwaysRetainTaskState="true"',
      '            android:label="@string/launcherName"',
      '                android:screenOrientation="landscape"',
      '            android:exported="true">',
      "            <intent-filter>",
      '                <action android:name="android.intent.action.MAIN" />',
      '                <category android:name="android.intent.category.LAUNCHER" />',
      '                    <category android:name="com.oculus.intent.category.VR" />',
      "            </intent-filter>",
      "        </activity>",
      '        <activity android:name="com.meta.androidbrowserhelper.trusted.FocusActivity" />',
      '        <activity android:name="com.meta.androidbrowserhelper.trusted.WebViewFallbackActivity"',
      '            android:configChanges="orientation|screenSize" />',
      "    </application>",
      "</manifest>",
      "",
    ].join("\n");
  const appGradle = [
    "android {",
    "        compileSdkVersion 32",
    '    namespace "com.shadowlocks"',
    "    defaultConfig {",
    '        applicationId "com.shadowlocks"',
    "        minSdkVersion 32",
    "            targetSdkVersion 32",
    "        versionCode 1",
    "    }",
    "}",
    "",
  ].join("\n");
  const rootGradle = "buildscript {\n    repositories {\n        google()\n        jcenter()\n    }\n}\nallprojects {\n    repositories {\n        mavenLocal()\n        google()\n        jcenter()\n    }\n}\n";
  const project = (xml: string, files: Record<string, string> = { [APP_GRADLE]: appGradle, [ROOT_GRADLE]: rootGradle }): string => {
    const root = tmpRoot();
    for (const [rel, text] of Object.entries({ [MANIFEST]: xml, ...files })) {
      fs.mkdirSync(path.join(root, "twa-build", path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(root, "twa-build", rel), text);
    }
    return root;
  };
  const file = (root: string, rel: string) => fs.readFileSync(path.join(root, "twa-build", rel), "utf8");

  it("writes every rule Bubblewrap has no setting for, once, and a second run changes nothing", () => {
    const root = project(generated());
    const r = run(root, "patch", "twa-build");
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/AndroidManifest\.xml now meets/);
    const xml = file(root, MANIFEST);
    // The supported headsets, once, inside the application.
    expect(xml.split(DEVICES)).toHaveLength(2);
    expect(xml.indexOf(DEVICES)).toBeGreaterThan(xml.indexOf("<application"));
    expect(xml.indexOf(DEVICES)).toBeLessThan(xml.indexOf("</application>"));
    // "installLocation must be set to auto", on the manifest element.
    expect(xml).toMatch(/^<manifest android:installLocation="auto" xmlns:android=/);
    // Immersive apps require 6DoF head tracking: Bubblewrap's required="false" becomes true.
    expect(xml.split(HEAD)).toHaveLength(2);
    expect(xml).not.toMatch(/headtracking"\s+android:required="false"/);
    // The hand tracking feature stays optional.
    expect(xml).toMatch(/oculus\.software\.handtracking"\s+android:required="false"/);
    // excludeFromRecents on the launcher activity only.
    expect(xml).toContain('<activity android:excludeFromRecents="true" android:name="LauncherActivity"');
    expect(xml.match(/excludeFromRecents/g)).toHaveLength(1);
    // The passthrough splash Bubblewrap already writes for an immersive app is left as it is.
    expect(xml.match(/com\.oculus\.ossplash\.background/g)).toHaveLength(1);
    expect(xml).toContain('android:name="com.oculus.ossplash.background"\n                android:value="passthrough-contextual"/>');
    // targetSdk and compileSdk 34, minSdk untouched; jcenter() gone.
    expect(file(root, APP_GRADLE)).toBe(appGradle.replace("compileSdkVersion 32", "compileSdkVersion 34").replace("targetSdkVersion 32", "targetSdkVersion 34"));
    expect(file(root, ROOT_GRADLE)).toBe(rootGradle.replace(/jcenter\(\)/g, "mavenCentral()"));
    // VRC.Quest.Packaging.4: the application names a network security config, which allows no clear text.
    expect(xml).toContain('<application android:networkSecurityConfig="@xml/network_security_config"\n        android:name="Application"');
    expect(xml.match(/networkSecurityConfig/g)).toHaveLength(1);
    expect(file(root, NSC)).toMatch(/<network-security-config>\s*<base-config cleartextTrafficPermitted="false" \/>\s*<\/network-security-config>/);
    // A second build: nothing changes.
    const before = [MANIFEST, APP_GRADLE, ROOT_GRADLE, NSC].map((f) => file(root, f));
    const again = run(root, "patch", "twa-build");
    expect(again.status).toBe(0);
    expect(again.out).not.toMatch(/now meets/);
    expect([MANIFEST, APP_GRADLE, ROOT_GRADLE, NSC].map((f) => file(root, f))).toEqual(before);
  });

  it("puts right a network security config that allows clear text", () => {
    const root = project(generated().replace('android:name="Application"', 'android:networkSecurityConfig="@xml/other" android:name="Application"'), {
      [APP_GRADLE]: appGradle,
      [ROOT_GRADLE]: rootGradle,
      [NSC]: '<network-security-config><base-config cleartextTrafficPermitted="true" /></network-security-config>\n',
    });
    expect(run(root, "patch", "twa-build").status).toBe(0);
    expect(file(root, MANIFEST)).toContain('android:networkSecurityConfig="@xml/network_security_config" android:name="Application"');
    expect(file(root, NSC)).toContain('cleartextTrafficPermitted="false"');
    expect(file(root, NSC)).not.toContain('"true"');
  });

  it("puts right what a template might write otherwise: a narrower device list, another splash, another install location", () => {
    const xml = generated('        <meta-data\n            android:name="com.oculus.supportedDevices"\n            android:value="quest3|quest3s" />\n')
      .replace('"passthrough-contextual"', '"black"')
      .replace('package="com.shadowlocks">', 'package="com.shadowlocks" android:installLocation="internalOnly">');
    const root = project(xml);
    expect(run(root, "devices", "twa-build").status).toBe(0); // the old name still works
    const out = file(root, MANIFEST);
    expect(out).toContain(DEVICES);
    expect(out).not.toContain('"quest3|quest3s"');
    expect(out).toContain('<meta-data android:name="com.oculus.ossplash.background" android:value="passthrough-contextual" />');
    expect(out).not.toContain('"black"');
    expect(out).toContain('android:installLocation="auto">');
    expect(out).not.toContain("internalOnly");
  });

  it("adds the splash and the head tracking feature when the template has neither", () => {
    const xml = generated()
      .replace(/ {13}<meta-data\n\s+android:name="com\.oculus\.ossplash\.background"\n\s+android:value="passthrough-contextual"\/>\n/, "")
      .replace(/ {4}<uses-feature\n\s+android:name="android\.hardware\.vr\.headtracking"[^>]*\/>\n/, "");
    expect(xml).not.toMatch(/ossplash|vr\.headtracking/);
    const root = project(xml);
    expect(run(root, "patch", "twa-build").status).toBe(0);
    const out = file(root, MANIFEST);
    expect(out).toContain('<meta-data android:name="com.oculus.ossplash.background" android:value="passthrough-contextual" />');
    expect(out.indexOf(HEAD)).toBeGreaterThan(-1);
    expect(out.indexOf(HEAD)).toBeLessThan(out.indexOf("<application"));
  });

  it("refuses a project it cannot read: no generated files, no application, no launcher or two, no targetSdk", () => {
    const missing = run(tmpRoot(), "patch", "twa-build");
    expect(missing.status).toBe(2);
    expect(missing.out).toMatch(/after bubblewrap update/);
    expect(run(project('<manifest package="com.shadowlocks"></manifest>\n'), "patch", "twa-build").out).toMatch(/no <application> element/);
    const noLauncher = generated().replace('<category android:name="android.intent.category.LAUNCHER" />', "");
    expect(run(project(noLauncher), "patch", "twa-build").out).toMatch(/0 launcher activities/);
    const twoLaunchers = generated().replace(
      '<activity android:name="com.meta.androidbrowserhelper.trusted.FocusActivity" />',
      '<activity android:name="Other"><intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter></activity>',
    );
    expect(run(project(twoLaunchers), "patch", "twa-build").out).toMatch(/2 launcher activities/);
    const noTarget = project(generated(), { [APP_GRADLE]: appGradle.replace(/ +targetSdkVersion 32\n/, ""), [ROOT_GRADLE]: rootGradle });
    expect(run(noTarget, "patch", "twa-build").out).toMatch(/sets no targetSdkVersion/);
    expect(run(tmpRoot(), "patch").status).toBe(2);
  });
});

describe("apk-check: a built APK against Meta's release rules", () => {
  // Dumps of the store test build (Task 28, scripts/twa-build.sh --test, signed with a throwaway key): aapt's xmltree
  // of the manifest and of the network security config, its badging (most locale lines left out) and apksigner, and
  // the four resources the manifest points at (aapt's resources dump, trimmed to them). Fake build tools print them.
  const FIXTURES = path.resolve("tests/unit/fixtures/twa-apk");

  /** A repo with the store App ID and `sha` filled, fake build tools printing the fixture dumps after `edit`, and an APK. */
  function setup(edit: (dumps: Record<string, string>) => void = () => {}, sha = SHA) {
    const root = tmpRoot(true);
    expect(run(root, "fill", "--store-app-id", "1534131276441915", "--sha256", sha, "--support-email", "help@example.com").status).toBe(0);
    const tools = path.join(root, "build-tools");
    fs.mkdirSync(tools);
    const dumps: Record<string, string> = {};
    for (const f of ["xmltree.txt", "nsc.txt", "badging.txt", "apksigner.txt", "resources.txt"]) dumps[f] = fs.readFileSync(path.join(FIXTURES, f), "utf8");
    edit(dumps);
    for (const [f, text] of Object.entries(dumps)) fs.writeFileSync(path.join(tools, f), text);
    const sh = (body: string) => `#!/bin/sh\nd=$(dirname "$0")\n${body}\n`;
    // aapt dump xmltree <apk> <file>: the manifest, or the network security config at the path the resources give.
    const aapt = [
      'case "$2" in',
      '  xmltree) case "$4" in AndroidManifest.xml) cat "$d/xmltree.txt" ;; res/8G.xml) cat "$d/nsc.txt" ;; *) exit 1 ;; esac ;;',
      '  badging) cat "$d/badging.txt" ;;',
      '  --values) cat "$d/resources.txt" ;;',
      "  *) exit 1 ;;",
      "esac",
    ].join("\n");
    fs.writeFileSync(path.join(tools, "aapt"), sh(aapt), { mode: 0o755 });
    fs.writeFileSync(path.join(tools, "apksigner"), sh('cat "$d/apksigner.txt"'), { mode: 0o755 });
    fs.writeFileSync(path.join(root, "app.apk"), "not really an APK");
    return { root, check: (...extra: string[]) => run(root, "apk-check", "app.apk", "--app", "store", "--build-tools", tools, ...extra) };
  }
  const realKey = (d: Record<string, string>) => {
    d["apksigner.txt"] = d["apksigner.txt"]!.replace(/certificate SHA-256 digest: [0-9a-f]+/, `certificate SHA-256 digest: ${SHA.replace(/:/g, "").toLowerCase()}`);
  };

  it("passes the store test build on every rule, as a test build and, signed with the real key, as a release", () => {
    const test = setup().check("--test");
    expect(test.out).toMatch(/all 24 rules pass \(test build\)/);
    expect(test.status).toBe(0);
    for (const rule of [
      /ok {3}targetSdkVersion 34 \(apps created since 2026-03-01\): 34/,
      /ok {3}minSdkVersion 29-34: 32/,
      /ok {3}installLocation auto: 0/,
      /ok {3}uses-feature android\.hardware\.vr\.headtracking, required, version 1: required=true version=1/,
      /ok {3}launcher activity excludeFromRecents: true/,
      /ok {3}com\.oculus\.ossplash\.background passthrough-contextual \(VRC\.Quest\.Functional\.14\): passthrough-contextual/,
      /ok {3}com\.oculus\.supportedDevices quest2\|questpro\|quest3\|quest3s/,
      /ok {3}application label, unique on the platform: "Shadow Locks"/,
      /ok {3}horizonos\.pwa\.APP_MODE immersive: immersive/,
      /ok {3}opens its own host: https:\/\/shadowlocks\.pages\.dev\//,
      /ok {3}APK Signature Scheme v2, verified \(VRC\.Quest\.Packaging\.2\): v2/,
      /ok {3}network security config, no clear text \(VRC\.Quest\.Packaging\.4\): cleartextTrafficPermitted=false/,
    ]) expect(test.out).toMatch(rule);
    const release = setup(realKey).check();
    expect(release.out).toMatch(/ok {3}Meta App ID: 1534131276441915/);
    expect(release.out).toMatch(/ok {3}signed with the key in the asset links/);
    expect(release.out).toMatch(/all 24 rules pass$/m);
    expect(release.status).toBe(0);
  });

  it("fails a release build signed with another key than the asset links name", () => {
    const r = setup().check();
    expect(r.out).toMatch(/FAIL signed with the key in the asset links/);
    expect(r.status).toBe(1);
  });

  it("fails each broken rule on its own line", () => {
    const cases: [string, (d: Record<string, string>) => void, RegExp][] = [
      ["target 32", (d) => { d["badging.txt"] = d["badging.txt"]!.replace("targetSdkVersion:'34'", "targetSdkVersion:'32'"); }, /FAIL targetSdkVersion 34/],
      ["min 23", (d) => { d["badging.txt"] = d["badging.txt"]!.replace("sdkVersion:'32'", "sdkVersion:'23'"); }, /FAIL minSdkVersion 29-34: 23/],
      ["no excludeFromRecents", (d) => { d["xmltree.txt"] = d["xmltree.txt"]!.replace(/^.*excludeFromRecents.*\n/m, ""); }, /FAIL launcher activity excludeFromRecents: not set/],
      ["headtracking optional", (d) => { d["xmltree.txt"] = d["xmltree.txt"]!.replace(/vr\.headtracking[^\n]*\n[^\n]*android:required\(0x0101028e\)=\(type 0x12\)0xffffffff/, (m) => m.replace(/0xffffffff$/, "0x0")); }, /FAIL uses-feature android\.hardware\.vr\.headtracking, required, version 1: required=false/],
      ["no install location", (d) => { d["xmltree.txt"] = d["xmltree.txt"]!.replace(/^.*android:installLocation.*\n/m, ""); }, /FAIL installLocation auto: not set/],
      ["black splash", (d) => { d["xmltree.txt"] = d["xmltree.txt"]!.replace('"passthrough-contextual" (Raw: "passthrough-contextual")', '"black" (Raw: "black")'); }, /FAIL com\.oculus\.ossplash\.background passthrough-contextual .*: black/],
      ["camera permission", (d) => { d["badging.txt"] += "uses-permission: name='android.permission.CAMERA'\n"; }, /FAIL only the permissions the game uses .*android\.permission\.CAMERA/],
      ["32-bit code", (d) => { d["badging.txt"] += "native-code: 'armeabi-v7a'\n"; }, /FAIL 64-bit or no native code .*: armeabi-v7a/],
      ["v3 only", (d) => { d["apksigner.txt"] = d["apksigner.txt"]!.replace("(APK Signature Scheme v2): true", "(APK Signature Scheme v2): false"); }, /FAIL APK Signature Scheme v2, verified .*: no v2/],
      ["debuggable", (d) => { d["badging.txt"] += "application-debuggable\n"; }, /FAIL not debuggable: debuggable/],
      ["other label", (d) => { d["badging.txt"] = d["badging.txt"]!.replace("application-label:'Shadow Locks'", "application-label:'Shadow'"); }, /FAIL application label, unique on the platform: "Shadow"/],
      ["no network config", (d) => { d["xmltree.txt"] = d["xmltree.txt"]!.replace(/^.*android:networkSecurityConfig.*\n/m, ""); }, /FAIL network security config, no clear text .*: no android:networkSecurityConfig/],
      ["clear text", (d) => { d["nsc.txt"] = d["nsc.txt"]!.replace("cleartextTrafficPermitted=(type 0x12)0x0", "cleartextTrafficPermitted=(type 0x12)0xffffffff"); }, /FAIL network security config, no clear text .*: cleartextTrafficPermitted=true/],
    ];
    for (const [name, edit, want] of cases) {
      const r = setup((d) => { realKey(d); edit(d); }).check();
      expect(r.out, name).toMatch(want);
      expect(r.out, name).toMatch(/1 of 24 rules FAIL/);
      expect(r.status, name).toBe(1);
    }
  });

  it("checks the App ID unless it is a test build", () => {
    const r = setup((d) => { realKey(d); d["xmltree.txt"] = d["xmltree.txt"]!.replace('" 1534131276441915" (Raw: " 1534131276441915")', '" 999999999999" (Raw: " 999999999999")'); }).check();
    expect(r.out).toMatch(/FAIL Meta App ID: 999999999999/);
    expect(r.status).toBe(1);
  });

  it("takes one APK and an app it knows", () => {
    const { root } = setup();
    expect(run(root, "apk-check", "--app", "store").status).toBe(2);
    expect(run(root, "apk-check", "app.apk").status).toBe(2);
    expect(run(root, "apk-check", "app.apk", "--app", "judge").out).toMatch(/--app takes store or competition/);
    expect(run(root, "check", "--test").status).toBe(2);
  });
});
