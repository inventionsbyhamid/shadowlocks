// scripts/prepublish-check.sh against throwaway git repositories: it passes a clean one and catches
// each kind of leak, in the files, in the history and in commit messages, without ever printing a
// secret. Every planted value is put together at run time, so this file never trips the check itself.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const AUTHOR = ["dev", "test.invalid"].join("@");
const OTHER = ["someone", "gmail.com"].join("@");
const AWS = "AKIA" + "Q7".repeat(8);
const LONG_SECRET = "s3cr3tV4lue" + "x".repeat(16);
const USERS = "/Use" + "rs/someone/project";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=Dev", "-c", `user.email=${AUTHOR}`, "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** A repository holding the check, a .gitignore and `files`, in one commit (message `msg`). */
function repo(files: Record<string, string>, msg = "first"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "prepublish-"));
  dirs.push(d);
  git(d, "init", "-q", "-b", "main");
  fs.mkdirSync(path.join(d, "scripts"));
  fs.copyFileSync("scripts/prepublish-check.sh", path.join(d, "scripts/prepublish-check.sh"));
  write(d, { ".gitignore": ".secrets\n*.keystore\n", "README.md": "A game.\n", ...files });
  commit(d, msg);
  return d;
}

function write(d: string, files: Record<string, string>): void {
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), text);
  }
}

function commit(d: string, msg: string): void {
  git(d, "add", "-A", "-f");
  git(d, "commit", "-q", "-m", msg);
}

function check(d: string): { status: number | null; out: string } {
  const r = spawnSync("bash", ["scripts/prepublish-check.sh"], { cwd: d, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("prepublish-check.sh", () => {
  it("says clean for a clean repository, example.com addresses included", () => {
    const d = repo({ "src/a.ts": `// see ${["help", "example.com"].join("@")}\nexport const a = 1;\n` });
    const r = check(d);
    expect(r.out).toMatch(/^clean$/m);
    expect(r.status).toBe(0);
  });

  it("allows the support address on the privacy page only, even when it is the commit author's own", () => {
    const link = `<a id="support-email" href="mailto:${AUTHOR}">${AUTHOR}</a>\n`;
    const ok = repo({ "public/privacy.html": link });
    expect(check(ok).out).toMatch(/^clean$/m);

    const d = repo({ "public/privacy.html": link, "src/a.ts": `// by ${AUTHOR}\n` }, `add the page\n\nask ${AUTHOR}`);
    const r = check(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain("FAIL email d***@test.invalid: src/a.ts:1");
    expect(r.out).toMatch(/FAIL email d\*\*\*@test\.invalid: commit [0-9a-f]+/);
    expect(r.out).toMatch(/FAIL email d\*\*\*@test\.invalid: message of [0-9a-f]+/);
    expect(r.out).not.toMatch(/public\/privacy\.html/);
    expect(r.out).not.toContain(AUTHOR);
    // Without the page's link, the author's address is allowed nowhere.
    expect(check(repo({ "src/b.ts": `// ${AUTHOR}\n` })).out).toContain("FAIL email d***@test.invalid: src/b.ts:1");
  });

  it("fails a tracked .secrets file and a key file", () => {
    const d = repo({ ".secrets/cloudflare.env": "X=1\n", "twa/app.keystore": "key" });
    const r = check(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain("FAIL .secrets tracked: .secrets/cloudflare.env");
    expect(r.out).toContain("FAIL key or package file tracked: twa/app.keystore");
  });

  it("fails secret-looking values and shows only the rule and the place", () => {
    const d = repo({
      "src/aws.ts": `export const k = "${AWS}";\n`,
      "src/client.ts": `const apiKey = "${LONG_SECRET}";\n`,
      "deploy.env.sample": `CLOUDFLARE_API_TOKEN=${LONG_SECRET}\n`,
    });
    const r = check(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain("FAIL AWS access key: src/aws.ts (1 lines)");
    expect(r.out).toContain("FAIL secret in a quoted literal: src/client.ts (1 lines)");
    expect(r.out).toContain("FAIL secret in an env assignment: deploy.env.sample (1 lines)");
    expect(r.out).not.toContain(AWS);
    expect(r.out).not.toContain(LONG_SECRET);
  });

  it("passes code that only names a secret's variable", () => {
    const d = repo({
      "scripts/deploy.sh": "TOKEN=$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' \"$F\")\nexport CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=$ACCOUNT\n",
      "src/key.ts": "const apiKey = process.env.KIE_API_KEY_FROM_THE_ENVIRONMENT;\n",
    });
    expect(check(d).out).toMatch(/^clean$/m);
  });

  it("fails absolute /Users/ paths", () => {
    const d = repo({ "notes.txt": `built in ${USERS}\n` });
    const r = check(d);
    expect(r.out).toContain("FAIL absolute /Users/ path: notes.txt (1 lines)");
  });

  it("fails another person's email, masked, and allows the privacy page's support address", () => {
    const support = ["help", "shadowlocks.test"].join("@");
    const d = repo({
      "src/b.ts": `// ask ${OTHER}\n`,
      "public/privacy.html": `<a id="support-email" href="mailto:${support}">${support}</a>\n`,
    });
    const r = check(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain("FAIL email s***@gmail.com: src/b.ts:1");
    expect(r.out).not.toContain(OTHER);
    expect(r.out).not.toMatch(/help\*\*\*@/);
  });

  it("allows a maintainer's address in the lock file's deprecated notices, but nowhere else in it", () => {
    const d = repo({
      "package-lock.json": `{\n  "a": {\n    "deprecated": "Ask ${OTHER} for support"\n  },\n  "b": {\n    "author": "${OTHER}"\n  }\n}\n`,
    });
    const r = check(d);
    expect(r.out.match(/FAIL email/g)).toHaveLength(2); // line 6, and the commit that added it
    expect(r.out).toContain("FAIL email s***@gmail.com: package-lock.json:6");
  });

  it("finds what a later commit removed, and leaks in commit messages", () => {
    const d = repo({ "src/c.ts": `export const k = "${AWS}";\n` });
    write(d, { "src/c.ts": "export const k = process.env.K;\n" });
    commit(d, `drop the key, thanks ${OTHER}\n\nbuilt in ${USERS}`);
    const r = check(d);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/FAIL AWS access key: added or removed in commit [0-9a-f]+/);
    expect(r.out).toMatch(/FAIL email s\*\*\*@gmail\.com: message of [0-9a-f]+/);
    expect(r.out).toMatch(/FAIL absolute \/Users\/ path: message of [0-9a-f]+/);
    expect(r.out).not.toMatch(/FAIL AWS access key: src\/c\.ts/);
  });

  it("fails when .gitignore stops keeping .secrets out", () => {
    const d = repo({ ".gitignore": "node_modules\n" });
    expect(check(d).out).toContain("FAIL .gitignore does not keep .secrets/ out");
  });
});
