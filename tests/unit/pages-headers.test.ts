import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { headersFor, parseHeadersFile } from "../../tests/e2e/helpers/pages-headers";

describe("_headers parser (Cloudflare Pages rules)", () => {
  it("applies every matching rule, joins a header set twice and lets a rule detach one", () => {
    const rules = parseHeadersFile(`# comment
/*
  X-Frame-Options: DENY
  X-Robots-Tag: noindex

/static/*
  X-Robots-Tag: nosnippet
  ! X-Frame-Options

/movies/:title
  X-Movie: yes
`);
    expect(headersFor(rules, "/home")).toEqual({ "X-Frame-Options": "DENY", "X-Robots-Tag": "noindex" });
    expect(headersFor(rules, "/static/a/b.css")).toEqual({ "X-Robots-Tag": "noindex, nosnippet" });
    expect(headersFor(rules, "/movies/up")).toMatchObject({ "X-Movie": "yes" });
    expect(headersFor(rules, "/movies/up/extra")).not.toHaveProperty("X-Movie");
  });

  it("matches an exact path only exactly, and ignores absolute URL rules", () => {
    const rules = parseHeadersFile("/\n  A: 1\nhttps://x.pages.dev/*\n  B: 2\n");
    expect(headersFor(rules, "/")).toEqual({ A: "1" });
    expect(headersFor(rules, "/index.html")).toEqual({});
  });
});

describe("public/_headers", () => {
  const rules = parseHeadersFile(fs.readFileSync("public/_headers", "utf8"));
  const paths = [
    "/",
    "/404.html",
    "/sw.js",
    "/manifest.webmanifest",
    "/assets/index-N12jER5b.js",
    "/audio/music/mus_game_calm.ogg",
    "/input-profiles/generic-hand/left.glb",
    "/ui/home.uikitml",
    "/.well-known/assetlinks.json",
  ];

  it("gives each path at most one Cache-Control rule (two would be joined into nonsense)", () => {
    const setsCache = (r: (typeof rules)[number]) => r.set.some(([name]) => name.toLowerCase() === "cache-control");
    for (const p of paths) expect(rules.filter((r) => r.pattern.test(p) && setsCache(r)).length, p).toBeLessThanOrEqual(1);
  });

  it("caches hashed bundles for a day only, and always revalidates the page, worker and manifest", () => {
    // Not a year and not immutable: the rule also covers a missing /assets/ URL, and a year-long
    // 404 would break a rollback or keep a precache install failing. The precache serves them anyway.
    expect(headersFor(rules, "/assets/index-N12jER5b.js")["Cache-Control"]).toBe("public, max-age=86400");
    for (const p of ["/", "/sw.js", "/manifest.webmanifest"]) {
      expect(headersFor(rules, p)["Cache-Control"], p).toBe("no-cache");
    }
    // Unhashed public files keep the host default (revalidate), so a new deploy is picked up.
    expect(headersFor(rules, "/audio/music/mus_game_calm.ogg")["Cache-Control"]).toBeUndefined();
  });

  it("serves the manifest and asset links with their JSON types", () => {
    expect(headersFor(rules, "/manifest.webmanifest")["Content-Type"]).toBe("application/manifest+json");
    expect(headersFor(rules, "/.well-known/assetlinks.json")["Content-Type"]).toBe("application/json");
  });

  it("has no rule for /index.html (Pages redirects it to /)", () => {
    expect(rules.some((r) => r.pattern.test("/index.html") && !r.pattern.test("/sw.js"))).toBe(false);
  });

  it("enforces the CSP (the offline e2e runs the game under it), with no report-only copy left", () => {
    const h = headersFor(rules, "/");
    expect(h["Content-Security-Policy"]).toBeDefined();
    expect(h["Content-Security-Policy-Report-Only"]).toBeUndefined();
  });

  it("allows only our own origin in the CSP, and never blocks WebXR", () => {
    const h = headersFor(rules, "/");
    const csp = h["Content-Security-Policy"] ?? "";
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).not.toMatch(/https?:|\*|'unsafe-eval'/);
    expect(h["Permissions-Policy"]).toMatch(/xr-spatial-tracking=\(self\)/);
    expect(h["Permissions-Policy"]).not.toMatch(/payment=\(\)/); // the installed app checks getDigitalGoodsService
  });
});
