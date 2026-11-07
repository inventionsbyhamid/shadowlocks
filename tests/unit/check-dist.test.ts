import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** A tiny build: a page, a script, a music file, the service worker precaching all three. */
function fakeDist(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-dist-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Shadow Locks</title>");
  // Hex of random bytes: about half of it survives compression.
  fs.writeFileSync(path.join(dir, "app.js"), `console.log("${randomBytes(6000).toString("hex")}");`);
  // Incompressible audio, bigger than any budget used here: it must not count.
  fs.writeFileSync(path.join(dir, "music.ogg"), randomBytes(200_000));
  fs.writeFileSync(path.join(dir, "manifest.webmanifest"), JSON.stringify({ icons: [] }));
  fs.writeFileSync(path.join(dir, "_headers"), "/*\n  X-Test: 1\n");
  // The link card image: shipped, never precached, and never counted in the budget.
  fs.writeFileSync(path.join(dir, "og-image.jpg"), randomBytes(50_000));
  const urls = ["index.html", "app.js", "music.ogg", "manifest.webmanifest"];
  fs.writeFileSync(path.join(dir, "sw.js"), `self.m=[${urls.map((u) => `{url:"${u}",revision:"1"}`).join(",")}];`);
  return dir;
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function run(budget: number, change?: (dir: string) => void) {
  const dir = fakeDist();
  dirs.push(dir);
  change?.(dir);
  const r = spawnSync(process.execPath, ["scripts/check-dist.mjs", dir], {
    env: { ...process.env, CHECK_DIST_CODE_ART_MAX: String(budget) },
    encoding: "utf8",
  });
  const out = r.stdout + r.stderr;
  const m = /code and art (\d+) bytes Brotli \((\d+) files; budget (\d+)\)/.exec(out);
  return { status: r.status, out, bytes: m ? Number(m[1]) : null, files: m ? Number(m[2]) : null };
}

describe("check-dist size gate", () => {
  it("prints the Brotli size of code and art, leaving audio out, and passes under budget", () => {
    const r = run(100_000);
    expect(r.status, r.out).toBe(0);
    expect(r.files).toBe(3);
    expect(r.bytes).toBeGreaterThan(3000);
    // The 200 kB of audio would be over budget on its own.
    expect(r.bytes).toBeLessThan(100_000);
  });

  it("fails the build over budget", () => {
    const r = run(3000);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/over the 3000 byte budget/);
  });

  it("wants the link card image shipped but never precached, and every %VITE_...% in the page filled", () => {
    expect(run(100_000, (d) => fs.rmSync(path.join(d, "og-image.jpg"))).out).toMatch(/missing og-image\.jpg/);
    const precached = run(100_000, (d) => {
      const urls = ["index.html", "app.js", "music.ogg", "manifest.webmanifest", "og-image.jpg"];
      fs.writeFileSync(path.join(d, "sw.js"), `self.m=[${urls.map((u) => `{url:"${u}",revision:"1"}`).join(",")}];`);
    });
    expect(precached.status).toBe(1);
    expect(precached.out).toMatch(/sw\.js precaches og-image\.jpg/);
    // robots.txt and the sitemap may stay out of the precache too; anything else may not.
    const extra = run(100_000, (d) => {
      for (const f of ["robots.txt", "sitemap.xml", "stray.png"]) fs.writeFileSync(path.join(d, f), "x");
    });
    expect(extra.out).toMatch(/stray\.png is not precached/);
    expect(extra.out).not.toMatch(/(?:robots\.txt|sitemap\.xml) is not precached/);
    const unfilled = run(100_000, (d) => fs.writeFileSync(path.join(d, "index.html"), '<meta property="og:image" content="%VITE_SITE_ORIGIN%/og-image.jpg" />'));
    expect(unfilled.status).toBe(1);
    expect(unfilled.out).toMatch(/index\.html still has %VITE_SITE_ORIGIN%/);
  });

  it("defaults to the 5 MB code and art budget", () => {
    const text = fs.readFileSync("scripts/check-dist.mjs", "utf8");
    expect(text).toMatch(/CHECK_DIST_CODE_ART_MAX \?\? 5_000_000/);
  });
});
