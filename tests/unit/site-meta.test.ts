// The website's heads for link cards and search (index.html, public/privacy.html, public/404.html), robots.txt,
// the sitemap and the card image. Scrapers run no script, so all of this is static English in the files themselves.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLIC_ORIGIN, siteOrigin } from "../../src/platform/site-origin";
import { expectCleanCopy } from "./helpers/ui";

const INDEX = fs.readFileSync("index.html", "utf8");
const PRIVACY = fs.readFileSync("public/privacy.html", "utf8");
const NOT_FOUND = fs.readFileSync("public/404.html", "utf8");
const head = (html: string) => /<head>([\s\S]*?)<\/head>/.exec(html)![1]!;
const INDEX_HEAD = head(INDEX);

/** The content of every `<meta property|name="key">` in a head. */
function metas(h: string, key: string): string[] {
  const out: string[] = [];
  for (const m of h.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/>/g)) if (m[1] === key) out.push(m[2]!);
  return out;
}
/** The one `<meta>` with this key (fails when it is missing or there twice). */
function meta(h: string, key: string): string {
  const all = metas(h, key);
  expect(all, key).toHaveLength(1);
  return all[0]!;
}
/** Every `<link rel="..." ...>` tag with this rel. */
const links = (h: string, rel: string) => [...h.matchAll(/<link\s[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes(`rel="${rel}"`));
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const titles = (h: string) => [...h.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]!);

/** The JSON-LD block, parsed. */
function jsonLd(): Record<string, unknown> {
  const blocks = [...INDEX_HEAD.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(blocks).toHaveLength(1);
  return JSON.parse(blocks[0]![1]!) as Record<string, unknown>;
}

/** Width and height from a JPEG's first start-of-frame marker. */
function jpegSize(file: string): [number, number] {
  const b = fs.readFileSync(file);
  expect(b.readUInt16BE(0), "JPEG start").toBe(0xffd8);
  let i = 2;
  while (i < b.length) {
    expect(b[i], "marker").toBe(0xff);
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error(`no frame header in ${file}`);
}
/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = fs.readFileSync(file);
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** The page as a build for the public host reads (Vite fills %VITE_SITE_ORIGIN%). */
const built = (s: string) => s.replaceAll("%VITE_SITE_ORIGIN%", siteOrigin(undefined));
const IMAGE = "%VITE_SITE_ORIGIN%/og-image.jpg";
const DESCRIPTION = meta(INDEX_HEAD, "description");
const SEARCH_WORDS = ["relaxing", "puzzle", "hands", "lantern", "shadows", "Meta Quest"];

describe("index.html head", () => {
  it("has the title, description and canonical on the public host, each once", () => {
    expect(titles(INDEX_HEAD)).toEqual(["Shadow Locks"]);
    expect(PUBLIC_ORIGIN).toBe("https://shadowlocks.pages.dev");
    const canonical = links(INDEX_HEAD, "canonical");
    expect(canonical).toHaveLength(1);
    expect(attr(canonical[0]!, "href")).toBe(`${PUBLIC_ORIGIN}/`);
  });

  it("uses one card-length description everywhere, with the store listing's search words", () => {
    expect(DESCRIPTION.length).toBeGreaterThanOrEqual(150);
    expect(DESCRIPTION.length).toBeLessThanOrEqual(200);
    for (const w of SEARCH_WORDS) expect(DESCRIPTION, w).toContain(w);
    expect(meta(INDEX_HEAD, "og:description")).toBe(DESCRIPTION);
    expect(meta(INDEX_HEAD, "twitter:description")).toBe(DESCRIPTION);
    expect(jsonLd().description).toBe(DESCRIPTION);
  });

  it("has the Open Graph card: website, names, the public URL, the image with its size, type and alt, the locales", () => {
    expect(meta(INDEX_HEAD, "og:type")).toBe("website");
    expect(meta(INDEX_HEAD, "og:site_name")).toBe("Shadow Locks");
    expect(meta(INDEX_HEAD, "og:title")).toBe("Shadow Locks");
    expect(meta(INDEX_HEAD, "og:url")).toBe(`${PUBLIC_ORIGIN}/`);
    expect(meta(INDEX_HEAD, "og:image")).toBe(IMAGE);
    expect(meta(INDEX_HEAD, "og:image:type")).toBe("image/jpeg");
    expect(meta(INDEX_HEAD, "og:image:alt").length).toBeGreaterThan(20);
    expect(meta(INDEX_HEAD, "og:locale")).toBe("en_US");
    expect(metas(INDEX_HEAD, "og:locale:alternate")).toEqual(["es_ES", "es_MX", "fr_FR", "de_DE", "pt_BR", "ja_JP"]);
  });

  it("has the large Twitter card with the same image and alt", () => {
    expect(meta(INDEX_HEAD, "twitter:card")).toBe("summary_large_image");
    expect(meta(INDEX_HEAD, "twitter:title")).toBe("Shadow Locks");
    expect(meta(INDEX_HEAD, "twitter:image")).toBe(IMAGE);
    expect(meta(INDEX_HEAD, "twitter:image:alt")).toBe(meta(INDEX_HEAD, "og:image:alt"));
  });

  it("names absolute https URLs once built: the image on the build's host, the page on the public host", () => {
    for (const url of [meta(INDEX_HEAD, "og:image"), meta(INDEX_HEAD, "twitter:image"), String(jsonLd().image)]) {
      expect(built(url)).toBe(`${PUBLIC_ORIGIN}/og-image.jpg`);
    }
    for (const url of [meta(INDEX_HEAD, "og:url"), attr(links(INDEX_HEAD, "canonical")[0]!, "href")!, String(jsonLd().url)]) {
      expect(new URL(url).protocol).toBe("https:");
    }
    // The only %...% tokens are the image origin (check-dist fails a build that leaves one).
    expect([...INDEX.matchAll(/%([A-Z0-9_]+)%/g)].map((m) => m[1])).toEqual(["VITE_SITE_ORIGIN", "VITE_SITE_ORIGIN", "VITE_SITE_ORIGIN"]);
  });

  it("takes the image origin from VITE_SITE_ORIGIN, the public host when unset, and refuses anything but https://<host>", () => {
    expect(siteOrigin(undefined)).toBe(PUBLIC_ORIGIN);
    expect(siteOrigin("")).toBe(PUBLIC_ORIGIN);
    expect(siteOrigin("https://preview.shadowlocks.pages.dev")).toBe("https://preview.shadowlocks.pages.dev");
    for (const bad of ["http://shadowlocks.pages.dev", "https://shadowlocks.pages.dev/", "https://x.dev/a", "shadowlocks.pages.dev", "https://a b"]) {
      expect(() => siteOrigin(bad), bad).toThrow(/VITE_SITE_ORIGIN/);
    }
  });

  it("states the card image's real size, under 300 KB", () => {
    const [w, h] = jpegSize("public/og-image.jpg");
    expect(`${w}x${h}`).toBe(`${meta(INDEX_HEAD, "og:image:width")}x${meta(INDEX_HEAD, "og:image:height")}`);
    expect(`${w}x${h}`).toBe("1200x630");
    expect(fs.statSync("public/og-image.jpg").size).toBeLessThanOrEqual(300 * 1024);
  });

  it("has the touch icon and desktop favicons, each file the size it claims", () => {
    const want: Array<[string, string]> = [
      ["apple-touch-icon", "180x180"],
      ["icon", "32x32"],
      ["icon", "16x16"],
    ];
    for (const [rel, sizes] of want) {
      const tag = links(INDEX_HEAD, rel).filter((t) => attr(t, "sizes") === sizes);
      expect(tag, `${rel} ${sizes}`).toHaveLength(1);
      const [w, h] = pngSize(`public/${attr(tag[0]!, "href")!.replace(/^\.\//, "")}`);
      expect(`${w}x${h}`).toBe(sizes);
    }
  });

  it("describes the game in JSON-LD: a free VideoGame for Meta Quest in our six languages, by the privacy page's author", () => {
    const d = jsonLd();
    expect(d["@context"]).toBe("https://schema.org");
    expect(d["@type"]).toBe("VideoGame");
    expect(d.name).toBe("Shadow Locks");
    expect(d.url).toBe(`${PUBLIC_ORIGIN}/`);
    expect(d.image).toBe(IMAGE);
    expect(d.genre).toBe("Puzzle");
    expect(d.gamePlatform).toBe("Meta Quest");
    expect(d.applicationCategory).toBe("Game");
    expect(d.inLanguage).toEqual(["en", "es", "fr", "de", "pt-BR", "ja"]);
    const offers = d.offers as Record<string, unknown>;
    expect(offers["@type"]).toBe("Offer");
    expect(Number(offers.price)).toBe(0);
    expect(offers.priceCurrency).toBe("USD");
    for (const k of ["author", "publisher"]) expect(d[k], k).toEqual({ "@type": "Person", "name": "Hamid Siddiqui" });
    expect(PRIVACY).toContain("made by Hamid Siddiqui");
  });

  it("runs no script in the head: the JSON-LD is a data block, outside the CSP's script-src", () => {
    const scripts = [...INDEX.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]!.trim());
    expect(scripts).toEqual(['type="application/ld+json"', 'type="module" src="/src/app/main.ts"']);
  });
});

describe("privacy and 404 heads", () => {
  it("privacy.html has its own title, description and canonical, each once", () => {
    const h = head(PRIVACY);
    expect(titles(h)).toEqual(["Shadow Locks Privacy Policy"]);
    expect(meta(h, "description").length).toBeGreaterThan(50);
    const canonical = links(h, "canonical");
    expect(canonical).toHaveLength(1);
    expect(attr(canonical[0]!, "href")).toBe(`${PUBLIC_ORIGIN}/privacy`);
    expect(links(h, "apple-touch-icon")).toHaveLength(1);
  });

  it("the 404 page is never indexed", () => {
    expect(meta(head(NOT_FOUND), "robots")).toBe("noindex");
  });
});

describe("robots.txt and the sitemap", () => {
  it("lets crawlers in and points at the sitemap on the public host", () => {
    const robots = fs.readFileSync("public/robots.txt", "utf8");
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
    expect(robots).toMatch(new RegExp(`^Sitemap: ${PUBLIC_ORIGIN}/sitemap\\.xml$`, "m"));
  });

  it("lists the home page and the privacy policy", () => {
    const xml = fs.readFileSync("public/sitemap.xml", "utf8");
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([`${PUBLIC_ORIGIN}/`, `${PUBLIC_ORIGIN}/privacy`]);
  });
});

describe("copy rules in the heads", () => {
  it("has no em or en dashes in any title, tag or JSON-LD string", () => {
    for (const html of [INDEX, PRIVACY, NOT_FOUND]) {
      const h = head(html);
      expect(h).not.toMatch(/&[mn]dash;/);
      expectCleanCopy(titles(h));
      expectCleanCopy([...h.matchAll(/\scontent="([^"]*)"/g)].map((m) => m[1]!));
    }
    expectCleanCopy(jsonLd());
  });
});
