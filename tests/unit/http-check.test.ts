// The hosting checks behind `scripts/deploy-pages.sh --verify`, fed response heads like the ones
// Cloudflare Pages sends (curl -D -: CRLF line ends, lower-case HTTP/2 header names).
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'";

function head(status: string, headers: Record<string, string>): string {
  return [status, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), "", ""].join("\r\n");
}

/** Runs head_ok from scripts/http-check.sh; returns its exit code and output. */
function headOk(h: string, ...args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("bash", ["-c", 'source scripts/http-check.sh && head_ok "$@"', "head_ok", h, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}`.trim() };
}

const page = head("HTTP/2 200 ", {
  date: "Mon, 02 Nov 2026 16:00:00 GMT",
  "content-type": "text/html; charset=utf-8",
  "access-control-allow-origin": "*",
  "cache-control": "no-cache",
  "content-security-policy-report-only": CSP,
  "permissions-policy": "xr-spatial-tracking=(self), camera=()",
  server: "cloudflare",
});
const manifest = head("HTTP/2 200 ", { "content-type": "application/manifest+json", "cache-control": "no-cache" });
const sw = head("HTTP/2 200 ", { "content-type": "application/javascript", "cache-control": "no-cache" });
const swText = head("HTTP/1.1 200 OK", { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
const icon = head("HTTP/2 200 ", { "content-type": "image/png" });
const links = head("HTTP/2 200 ", { "content-type": "application/json", "cache-control": "public, max-age=300" });
const missing = head("HTTP/2 404 ", { "content-type": "text/html; charset=utf-8" });
const redirect = head("HTTP/2 308 ", { location: "/", "content-type": "text/plain" });

describe("head_ok (deploy-pages.sh --verify)", () => {
  it("passes the real heads of a good deploy", () => {
    expect(headOk(page, "/", "200", "text/html", "content-security-policy-report-only: default-src 'self'").ok).toBe(true);
    expect(headOk(manifest, "/manifest.webmanifest", "200", "application/manifest+json", "cache-control: no-cache").ok).toBe(true);
    expect(headOk(sw, "/sw.js", "200", "application/javascript|text/javascript", "cache-control: no-cache").ok).toBe(true);
    expect(headOk(swText, "/sw.js", "200", "application/javascript|text/javascript", "cache-control: no-cache").ok).toBe(true);
    expect(headOk(icon, "/icons/icon-512.png", "200", "image/png").ok).toBe(true);
    expect(headOk(links, "/.well-known/assetlinks.json", "200", "application/json").ok).toBe(true);
    expect(headOk(missing, "/no-such-path", "404", "text/html").ok).toBe(true);
  });

  it("reads the type and the wanted header literally, not as patterns", () => {
    const plusless = head("HTTP/2 200 ", { "content-type": "application/manifesttjson" });
    expect(headOk(plusless, "/manifest.webmanifest", "200", "application/manifest+json").ok).toBe(false);
    const dotted = head("HTTP/2 200 ", { "content-type": "textXhtml" });
    expect(headOk(dotted, "/", "200", "text.html").ok).toBe(false);
  });

  it("fails a wrong status, a wrong type or a missing header, and says why", () => {
    const r = headOk(redirect, "/index.html", "200", "text/html");
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/^FAIL \/index\.html: 308/);
    const plain = head("HTTP/2 200 ", { "content-type": "text/plain" });
    expect(headOk(plain, "/manifest.webmanifest", "200", "application/manifest+json").ok).toBe(false);
    const enforcing = head("HTTP/2 200 ", { "content-type": "text/html", "content-security-policy": CSP });
    expect(headOk(enforcing, "/", "200", "text/html", "content-security-policy-report-only: default-src 'self'").ok).toBe(false);
    expect(headOk("", "/", "200", "text/html").ok).toBe(false);
  });

  it("matches header names in any case", () => {
    const upper = head("HTTP/1.1 200 OK", { "Content-Type": "text/html", "Content-Security-Policy-Report-Only": CSP });
    expect(headOk(upper, "/", "200", "text/html", "content-security-policy-report-only: default-src 'self'").ok).toBe(true);
  });
});
