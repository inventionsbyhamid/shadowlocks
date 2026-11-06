// scripts/deploy-pages.sh's guards refuse when a reading is missing, instead of passing: the build server's load and
// free disk (a stand-in ssh answers), and git status (a stand-in git). Nothing here reaches a network or a real secret.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-guard-"));
  dirs.push(d);
  return d;
}

/** A folder for PATH whose `name` command runs `body` (bash). */
function stub(name: string, body: string): string {
  const bin = tmp();
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return bin;
}

function deploy(args: string[], bin: string, env: Record<string, string> = {}): { status: number | null; out: string } {
  const e: NodeJS.ProcessEnv = { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}` };
  delete e.NS_DEPLOY_NOW;
  const r = spawnSync("bash", ["scripts/deploy-pages.sh", ...args], { encoding: "utf8", env: e, input: "" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("deploy-pages.sh guards", () => {
  it("refuses a load or disk reading that is empty or not a number, and checks the token only past the gate", () => {
    // A made-up secrets file: a placeholder token and an all-zero account id.
    const secrets = path.join(tmp(), "cloudflare.env");
    fs.writeFileSync(secrets, ["CLOUDFLARE_API_TOK", "EN=not-a-real-token\nCLOUDFLARE_ACCOUNT_ID=", "0".repeat(32), "\n"].join(""));
    // Every call is counted; stdin (the token, for the check) is read and dropped; the reading is FAKE_SSH_OUT.
    const bin = stub("ssh", 'echo call >>"$SSH_LOG"; cat >/dev/null; printf \'%b\' "$FAKE_SSH_OUT"');
    const tryGate = (reading: string) => {
      const log = path.join(tmp(), "ssh.log");
      const r = deploy(["--check-token"], bin, { NS_CLOUDFLARE_ENV: secrets, SSH_LOG: log, FAKE_SSH_OUT: reading });
      return { ...r, calls: fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0 };
    };
    for (const [reading, why] of [
      ["", /could not read the load average/],
      ["\\n300\\n", /could not read the load average/],
      ["abc\\n300\\n", /could not read the load average/],
      ["12.5\\n", /could not read the free disk/],
      ["12.5\\nlots\\n", /could not read the free disk/],
      ["30\\n300\\n", /load 30 > 25/],
      ["1.5\\n50\\n", /free disk 50 GB < 100 GB/],
    ] as const) {
      const r = tryGate(reading);
      expect(r.status, `${reading}: ${r.out}`).toBe(3);
      expect(r.out, reading).toMatch(why);
      expect(r.calls, reading).toBe(1);
    }
    const ok = tryGate("1.5\\n300\\n");
    expect(ok.status, ok.out).toBe(0);
    expect(ok.calls).toBe(2);
    expect(ok.out).not.toContain("not-a-real-token");
  });

  it("refuses when git status fails, instead of reading the tree as clean", () => {
    const git = (status: string) =>
      stub(
        "git",
        [
          'case "$*" in',
          `  *status*) ${status} ;;`,
          "  *rev-parse*) echo 0123456789abcdef0123456789abcdef01234567 ;;",
          "  *log*) echo a subject ;;",
          "  *) exit 1 ;;",
          "esac",
        ].join("\n"),
      );
    const failed = deploy(["--placeholder", "--dry-run"], git('echo "fatal: stand-in failure" >&2; exit 128'));
    expect(failed.status, failed.out).toBe(2);
    expect(failed.out).toMatch(/git status failed/);
    const dirty = deploy(["--placeholder", "--dry-run"], git("echo ' M src/a.ts'"));
    expect(dirty.status, dirty.out).toBe(2);
    expect(dirty.out).toMatch(/uncommitted changes/);
    const clean = deploy(["--placeholder", "--dry-run"], git("true"));
    expect(clean.status, clean.out).toBe(0);
    expect(clean.out).toMatch(/dry run: would publish/);
  });

  it("refuses a bad stand-in limit for load or disk", () => {
    const bin = stub("ssh", "exit 99");
    for (const [env, why] of [
      [{ NS_MAX_LOAD: "x" }, /^bad NS_MAX_LOAD: x$/m],
      [{ NS_MAX_LOAD: " 25" }, /^bad NS_MAX_LOAD: {2}25$/m],
      [{ NS_MIN_FREE_GB: "-1" }, /^bad NS_MIN_FREE_GB: -1$/m],
      [{ NS_MIN_FREE_GB: "1e3" }, /^bad NS_MIN_FREE_GB: 1e3$/m],
    ] as const) {
      const r = deploy(["--both", "--dry-run"], bin, env);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toMatch(why);
    }
  });

  it("remote.sh refuses a bad NS_MAX_LOAD before it reaches the server", () => {
    const log = path.join(tmp(), "ssh.log");
    const bin = stub("ssh", 'echo call >>"$SSH_LOG"; exit 99');
    for (const bad of ["x", "", " 25", "25x"]) {
      const e: NodeJS.ProcessEnv = { ...process.env, NS_MAX_LOAD: bad, SSH_LOG: log, PATH: `${bin}:${process.env.PATH}` };
      const r = spawnSync("bash", ["scripts/remote.sh", "guard-test", "--", "true"], { encoding: "utf8", env: e, input: "" });
      if (bad === "") {
        // Empty means unset: the default limit applies, and the run goes on to the (stand-in) server.
        expect(r.status, r.stderr).not.toBe(2);
        continue;
      }
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toContain(`bad NS_MAX_LOAD: ${bad}`);
    }
    // Only the empty value went on to call ssh.
    expect(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length).toBe(1);
  });
});
