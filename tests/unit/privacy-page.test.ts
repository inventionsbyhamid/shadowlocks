// The privacy policy page (public/privacy.html): the store listing links to it, so it must say what
// the game does with data, stay readable offline under the site's CSP, and follow the copy rules.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { pwaOptions } from "../../src/platform/pwa-config";

const html = fs.readFileSync("public/privacy.html", "utf8");
/** What a reader sees: the body without tags, entities decoded the simple way. */
const text = html
  .replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&middot;/g, "·")
  .replace(/\s+/g, " ");

describe("privacy page", () => {
  it("says what the game collects, where progress lives, and how to delete it", () => {
    for (const phrase of [
      "collects nothing about you",
      "no account, no analytics, no advertising and no cookies",
      "browser storage on your headset",
      "hand, head and controller positions",
      "Cloudflare",
      "IP address",
      "We do not see or keep that data",
      "clear the game's data in your headset's settings: the app's data, and the browser's site data",
      "13 and over",
      "Meta will handle the payment",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("has exactly one support link, which the fill step writes", () => {
    const links = [...html.matchAll(/<a id="support-email" href="mailto:([^"]*)">([^<]*)<\/a>/g)];
    expect(links).toHaveLength(1);
    expect(links[0]![1]).toBe(links[0]![2]);
    expect(html.match(/mailto:/g)).toHaveLength(1);
  });

  it("promises no deletion by uninstalling alone (a Quest app's site data lives in the headset's browser)", () => {
    expect(text).not.toMatch(/[Uu]ninstall/);
  });

  it("has no em or en dashes in what readers see", () => {
    expect(text).not.toMatch(/[–—]/);
    expect(html).not.toMatch(/&[mn]dash;/);
  });

  it("loads nothing from other hosts and runs no script (the site's CSP allows only its own origin)", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\bsrc=/i);
    expect(html).not.toMatch(/url\(/i);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) expect(m[1], "link href").toMatch(/^\.\//);
  });

  it("is precached with the rest of the site, so it opens offline too", () => {
    const wb = pwaOptions().workbox!;
    expect(wb.globPatterns?.[0]).toMatch(/\bhtml\b/);
    expect(wb.globIgnores).not.toContain("privacy.html");
  });
});
