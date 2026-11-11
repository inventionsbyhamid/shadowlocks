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
      "browser storage on your headset or phone",
      "hand, head and controller positions",
      // The store declares Touch controllers, and the site also plays on a phone (AR in the browser).
      "your hands or with Touch controllers",
      "on an Android phone",
      // The phone's AR shows the camera view: the page says so, and that nothing of it is kept or sent.
      "the camera view that the browser shows behind the game through WebXR",
      "The game does not record, save or send any of those images",
      "Cloudflare",
      "IP address",
      "We do not see or keep that data",
      "clear the game's data in your headset's settings: the app's data, and the browser's site data",
      // One policy for both builds: the store app opens the public site, the Competition build the judge site.
      "shadowlocks.pages.dev, or shadowlocks-judge.pages.dev for the Competition build",
      "13 and over",
      "Meta will handle the payment",
      // Sharing: nothing is sent by the game; a link holds only its box or day, the result and the version; Web Launch only
      // when chosen.
      "The game sends nothing itself",
      "Share links hold only a box number or a day, a time, a hint count and the game's version number",
      "only if you choose it, it takes you to Meta's own",
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

  it("does not say the game is played with hands only (the store app declares Touch controllers)", () => {
    expect(text).not.toMatch(/hands only/i);
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
    // The canonical link names the public URL for search engines; it loads nothing.
    for (const m of html.matchAll(/<link(?![^>]*rel="canonical")[^>]+href="([^"]+)"/g)) expect(m[1], "link href").toMatch(/^\.\//);
    expect(html).toContain('<link rel="canonical" href="https://shadowlocks.pages.dev/privacy" />');
  });

  it("is precached with the rest of the site, so it opens offline too", () => {
    const wb = pwaOptions().workbox!;
    expect(wb.globPatterns?.[0]).toMatch(/\bhtml\b/);
    expect(wb.globIgnores).not.toContain("privacy.html");
  });
});
