// scripts/prepublish-check.sh against throwaway git repositories: it passes a clean one and catches each kind of leak, in
// HEAD's files, in the history (merges too) and in commit messages, without ever printing a secret. Every planted value
// is put together at run time, so this file never trips the check itself.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const AUTHOR = ["dev", "test.invalid"].join("@");
const OTHER = ["someone", "gmail.com"].join("@");
const AWS = "AKIA" + "Q7".repeat(8);
const USERS = "/Use" + "rs/someone/project";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const link = (addr: string) => `<a id="support-email" href="mailto:${addr}">${addr}</a>\n`;
const j = (...parts: string[]) => parts.join("");

/** One planted sample per rule: the rule's name as the check prints it, and a file line that must trip it. */
const SAMPLES: Array<[string, string]> = [
  ["private key", j("-----BEGIN ", "RSA PRIVATE KEY-----")],
  ["AWS access key", `k = "${AWS}"`],
  ["GitHub token", j("t = gh", "p_", "a".repeat(36))],
  ["Slack token", j("t = xo", "xb-", "1234567890abc")],
  ["Google API key", j("k = AI", "za", "x".repeat(35))],
  ["API secret key", j("k = sk", "_live_", "a".repeat(20))],
  ["JSON web token", j("t = ey", "J", "a".repeat(12), ".ey", "J", "b".repeat(12))],
  ["bearer token", j("h = Bear", "er ", "a".repeat(32))],
  ["Meta access token", j("t = O", "C|", "1".repeat(16), "|", "0a".repeat(16))],
  ["Meta app secret", j("APP_SEC", "RET=", "0b".repeat(16))],
  ["secret in an assignment", j("KEYSTORE_PASS", "WORD=p")],
  ["secret in an assignment", j("storePass", "word=hunter2")],
  ["secret in an assignment", j("export NPM_PA", "SS=x")],
  // A token then a command, then a comment, then punctuation: none of them may hide it.
  ["secret in an assignment", j("CLOUDFLARE_API_TOK", "EN=", "a1".repeat(20), " npx wrangler pages deploy dist")],
  ["secret in an assignment", j("CLOUDFLARE_API_TOK", "EN=", "b2".repeat(20), "  # pages edit")],
  ["secret in an assignment", j("KEYSTORE_PASS", "WORD=", "c3".repeat(7), "!x")],
  // A short value with punctuation in it, or before a command, a comment or a ;.
  ["secret in an assignment", j("KEYSTORE_PASS", "WORD=short!x")],
  ["secret in an assignment", j("storePass", "word=hunter2!x")],
  ["secret in an assignment", j("keyPass", "word=p@ss")],
  ["secret in an assignment", j("PASS", "WORD=Tr0ub4dor&3")],
  ["secret in an assignment", j("PASS", "WORD=abc,def")],
  ["secret in an assignment", j("NPM_TOK", "EN=ab12 npm publish")],
  ["secret in an assignment", j("NPM_TOK", "EN=ab12 # the old one")],
  ["secret in an assignment", j("NPM_TOK", "EN=ab12; npm publish")],
  // A tight value that starts with punctuation.
  ["secret in an assignment", j("KEYSTORE_PASS", "WORD=!hunter2")],
  ["secret in an assignment", j("PASS", "WORD=@dm1n")],
  ["secret in an assignment", j("export NPM_TOK", "EN=%ab12")],
  // A web address with a user and password in it still counts, plain or quoted.
  ["secret in an assignment", j("TOKEN_U", "RL=https://user:pa", "ss@example.com/token")],
  ["secret in a quoted literal", j("  tokenU", "rl: \"https://user:pa", "ss@example.com/token\",")],
  // A plain address passes, but not a secret next to it on the same line.
  ["secret in a quoted literal", j("const c = { tokenU", "rl: \"https://a.example.com/t\", apiK", "ey: \"abc!d\" };")],
  ["secret in a quoted literal", j("const apiK", "ey = \"x1\";")],
  ["secret in a quoted literal", j("  keyPass", "word: 'q';")],
  // Punctuation inside the quotes.
  ["secret in a quoted literal", j("const pass", "word = \"hunter2!\";")],
  ["secret in a quoted literal", j("  storePass", "word: \"abc!def\",")],
  ["absolute /Users/ path", `built in ${USERS}`],
];

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
  return r.stdout.trim();
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

function write(d: string, files: Record<string, string | null>): void {
  for (const [f, text] of Object.entries(files)) {
    const p = path.join(d, f);
    if (text === null) {
      fs.rmSync(p);
      continue;
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
}

function commit(d: string, msg: string): string {
  git(d, "add", "-A", "-f");
  git(d, "commit", "-q", "-m", msg);
  return git(d, "rev-parse", "--short=7", "HEAD");
}

function check(d: string, env: Record<string, string> = {}): { status: number | null; out: string } {
  const r = spawnSync("bash", ["scripts/prepublish-check.sh"], { cwd: d, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("prepublish-check.sh", () => {
  it("says clean for a clean repository, example.com addresses included", () => {
    const d = repo({ "src/a.ts": `// see ${["help", "example.com"].join("@")}\nexport const a = 1;\n` });
    const r = check(d);
    expect(r.out).toMatch(/^clean$/m);
    expect(r.status).toBe(0);
  });

  it("catches one sample of every rule in HEAD's files and in the commit that added it, printing none", { timeout: 60_000 }, () => {
    for (const [name, line] of SAMPLES) {
      const d = repo({ "src/x.ts": `${line}\n` });
      const r = check(d);
      expect(r.status, `${name}: ${r.out}`).toBe(1);
      expect(r.out, name).toContain(`FAIL ${name}: src/x.ts (1 lines)`);
      expect(r.out, name).toMatch(new RegExp(`FAIL ${name.replace(/[/]/g, "\\/")}: added in commit [0-9a-f]+`));
      expect(r.out, name).not.toContain(line);
    }
  });

  it("passes code that only names a secret's variable, expansions and version ranges", () => {
    const d = repo({
      "scripts/deploy.sh": j(
        "TOK", "EN=$(sed -n 's/^CLOUDFLARE_API_TOK", "EN=//p' \"$F\")\n",
        "VERIFY='v=$(printf \"Authorization: Bearer %s\" \"$CLOUDFLARE_API_TOK", "EN\")'\n",
        "SECR", "ETS=${NS_ENV:-.secrets/x.env}\n",
        "CLOUDFLARE_API_TOK", "EN=$CLOUDFLARE_API_TOK", "EN npx wrangler pages deploy dist\n",
        // Only $ continues a tight value's word, so an expansion is never a value.
        "TOK", "EN=$X\n",
        "TOK", "EN=${X}\n",
        "TOK", "EN=$(cat f)\n",
        "TOK", "EN=\"$X\"\n",
        "TOK", "EN=abc$X\n",
        // Plain web addresses (no user or password before the host) are no secrets, a @ in the path included.
        "TOKEN_U", "RL=https://auth.example.com/oauth/token\n",
        "export API_TOKEN_U", "RL=\"https://cdn.example.com/npm/@scope/pkg\"\n",
        "PASSWORD_RESET_U", "RL=http://localhost:8080/reset?next=/home npm start\n",
      ),
      "src/key.ts": j(
        "const apiK", "ey = process.env.KIE_API_KEY;\nconst t = { tok", "en: \"${name}\" };\n",
        "let apiK", "ey = \"\";\n",
        "  const tok", "en = localStorage.getItem(\"t\");\n",
        "  secretS", "ub: \"In play\",\n",
        "  tokenU", "rl: \"https://auth.example.com/token\",\n",
        "const t2 = { tokenU", "rl: 'https://a.example.com/t?x=1', retries: 3 };\n",
      ),
      "package-lock.json": j("{\n  \"js-tok", "ens\": \"^4.0.0\",\n  \"b-tok", "ens\": \"4.0.0\"\n}\n"),
    });
    const r = check(d);
    expect(r.out).toMatch(/^clean$/m);
  });

  it("fails a tracked .secrets file, a key file and a properties file", () => {
    const d = repo({ ".secrets/cloudflare.env": "X=1\n", "twa/app.keystore": "key", "twa/store/key.properties": "x\n" });
    const r = check(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain("FAIL .secrets tracked: .secrets/cloudflare.env");
    expect(r.out).toContain("FAIL key or package file tracked: twa/app.keystore");
    expect(r.out).toContain("FAIL properties file tracked: twa/store/key.properties");
    expect(r.out).toContain("FAIL properties file in the history: twa/store/key.properties");
  });

  it("allows the pinned support address on the privacy page only, even when it is the commit author's own", () => {
    const env = { PREPUBLISH_SUPPORT_SHA256: sha(AUTHOR) };
    const pinned = check(repo({ "public/privacy.html": link(AUTHOR) }), env);
    expect(pinned.out).toMatch(/^clean$/m);
    // Overriding the pinned hash always says so.
    expect(pinned.out).toMatch(/note: PREPUBLISH_SUPPORT_SHA256 replaces the pinned support address hash/);

    const d = repo({ "public/privacy.html": link(AUTHOR), "src/a.ts": `// by ${AUTHOR}\n` }, `add the page\n\nask ${AUTHOR}`);
    const r = check(d, env);
    expect(r.status).toBe(1);
    expect(r.out).toContain("FAIL email d***@test.invalid: src/a.ts:1");
    expect(r.out).toMatch(/FAIL email d\*\*\*@test\.invalid: commit [0-9a-f]+/);
    expect(r.out).toMatch(/FAIL email d\*\*\*@test\.invalid: message of [0-9a-f]+/);
    expect(r.out).not.toMatch(/public\/privacy\.html/);
    expect(r.out).not.toContain(AUTHOR);
  });

  it("refuses a support link whose address is not the pinned one, and stops when the page has no link", () => {
    const pinned = { PREPUBLISH_SUPPORT_SHA256: sha(AUTHOR) };
    const swapped = check(repo({ "public/privacy.html": link(OTHER) }), pinned);
    expect(swapped.status).toBe(1);
    expect(swapped.out).toMatch(/support address on public\/privacy\.html is not the pinned one/);
    expect(swapped.out).toContain("FAIL email s***@gmail.com: public/privacy.html:1");
    const none = check(repo({ "public/privacy.html": "<p>No link.</p>\n" }), pinned);
    expect(none.status).toBe(2);
    expect(none.out).toMatch(/has no support link/);
  });

  it("gives the same answer every run, with the address twice on one line", () => {
    const env = { PREPUBLISH_SUPPORT_SHA256: sha(AUTHOR) };
    const d = repo({ "public/privacy.html": `<p>Email ${link(AUTHOR).trim()}.</p>\n`, "src/b.ts": `// ${OTHER} and ${OTHER}\n` });
    const outs = new Set<string>();
    for (let i = 0; i < 5; i++) outs.add(check(d, env).out);
    expect(outs.size).toBe(1);
    const out = [...outs][0]!;
    expect(out.match(/FAIL email/g)).toHaveLength(4); // both on src/b.ts:1, both again in the commit that added them
    expect(out).not.toMatch(/<|>/);
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
    expect(r.out).toMatch(/FAIL AWS access key: added in commit [0-9a-f]+/);
    expect(r.out).toMatch(/FAIL email s\*\*\*@gmail\.com: message of [0-9a-f]+/);
    expect(r.out).toMatch(/FAIL absolute \/Users\/ path: message of [0-9a-f]+/);
    expect(r.out).not.toMatch(/FAIL AWS access key: src\/c\.ts/);
  });

  it("reads each message on its own, so a line cannot pose as another commit and borrow its exception", () => {
    const d = repo({ "a.txt": "a\n" });
    write(d, { "a.txt": "b\n" });
    // dd1f70c... has a reviewed message exception for this rule; the line after it is this commit's own.
    const own = commit(d, j("tidy\n\n@@commit dd1f70cfb756ba6fdad9ea2f5236713649ca5b07\n", "KEYSTORE_PASS", "WORD=abc,def\n"));
    const r = check(d);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`FAIL secret in an assignment: message of ${own}`);
    expect(r.out).not.toMatch(/message of dd1f70c/);
  });

  it("looks inside merge commits", () => {
    const d = repo({ "a.txt": "a\n", "b.txt": "b\n" });
    git(d, "checkout", "-q", "-b", "side");
    write(d, { "b.txt": "b2\n" });
    commit(d, "side");
    git(d, "checkout", "-q", "main");
    write(d, { "a.txt": "a2\n" });
    commit(d, "main");
    git(d, "merge", "-q", "--no-ff", "--no-commit", "side");
    // A line only the merge commit adds.
    write(d, { "c.txt": `${AWS}\n` });
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "merge side");
    const merge = git(d, "rev-parse", "--short=7", "HEAD");
    write(d, { "c.txt": null });
    commit(d, "drop c");
    const r = check(d);
    expect(r.out).toContain(`FAIL AWS access key: added in commit ${merge}`);
  });

  it("charges a deleted file's lines to that file, not to the one before it", () => {
    const env = { PREPUBLISH_SUPPORT_SHA256: sha(AUTHOR) };
    const d = repo({ "public/privacy.html": link(AUTHOR), "public/x.txt": `${AUTHOR}\n` });
    write(d, { "public/privacy.html": `<p>Email ${link(AUTHOR).trim()}</p>\n`, "public/x.txt": null });
    const del = commit(d, "change the page, drop x");
    const r = check(d, env);
    expect(r.out).toContain(`FAIL email d***@test.invalid: commit ${del}`);
  });

  it("stops (exit 2) when a pattern does not compile, instead of passing", () => {
    const d = repo({ "a.txt": "a\n" });
    const r = check(d, { PREPUBLISH_TEST_RULE: "broken\t(unclosed[" });
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/the pattern for "broken" does not compile/);
  });

  it("fails when .gitignore stops keeping .secrets out", () => {
    const d = repo({ ".gitignore": "node_modules\n" });
    expect(check(d).out).toContain("FAIL .gitignore does not keep .secrets/ out");
  });
});
