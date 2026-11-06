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
      expect(m.name).toBe("Shadow Locks");
      // The launcher label truncates past about 12 characters.
      expect(String(m.launcherName).length).toBeLessThanOrEqual(12);
    }
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
    expect(c.out).toMatch(/twa-config: ok: store com\.shadowlocks on shadowlocks\.pages\.dev \(App ID 1234567890123456/);
    expect(c.status).toBe(0);
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
