// scripts/twa-build.sh keeps the keystore password off every command line and out of every environment (Task 28):
// Bubblewrap builds unsigned with Gradle's daemon off, apksigner gets the password on its stdin, and only a test build's
// throwaway keytool gets one through its environment. The build itself runs only in the Android build container (Task
// 28 ran it there); this reads its code, and runs the scripts' first steps with stand-in programs.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const script = fs.readFileSync("scripts/twa-build.sh", "utf8");
/** The script without its comment lines. */
const code = script
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "twa-pw-"));
  dirs.push(d);
  return d;
}

/**
 * Runs `script` (a path, from the repo root) with a made-up password as the first line of stdin and the password's
 * variable `name` already exported by the caller, with stand-ins for `programs`: each notes in the log whether the
 * password is in its environment ("leak" or "clean"), then does what `bodies` gives it (bash). Returns the run and the
 * log's lines.
 */
function runWithExported(name: string, script: string, args: string[], programs: string[], bodies: Record<string, string> = {}) {
  const d = tmp();
  const bin = path.join(d, "bin");
  fs.mkdirSync(bin);
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  // grep reads the password from a file: the stand-ins' own arguments and environments never hold it.
  const mark = path.join(d, "mark");
  fs.writeFileSync(mark, `${password}\n`, { mode: 0o600 });
  const log = path.join(d, "log");
  for (const p of programs) {
    const body = bodies[p] ?? "";
    fs.writeFileSync(
      path.join(bin, p),
      `#!/usr/bin/env bash\nif env | grep -qF -f "$LEAK_MARK"; then echo "leak ${p}" >>"$LEAK_LOG"; else echo "clean ${p}" >>"$LEAK_LOG"; fi\n${body}\n`,
      { mode: 0o755 },
    );
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LEAK_MARK: mark, LEAK_LOG: log, HOME: d, JAVA_HOME: d };
  for (const k of Object.keys(env)) if (/^(NS_|ANDROID_)/.test(k)) delete env[k];
  env[name] = "exported-by-the-caller";
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", env, input: `${password}\n`, timeout: 30_000 });
  const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { r, lines, password, mark, log };
}

/** A copy of the scripts in a scratch repo root, with `drop` taken out of `file`: the positive control. */
function withoutLine(file: string, drop: string, alsoCopy: string[] = []): string {
  const root = tmp();
  fs.mkdirSync(path.join(root, "scripts"));
  for (const f of [file, ...alsoCopy]) fs.copyFileSync(f, path.join(root, f));
  const text = fs.readFileSync(file, "utf8");
  expect(text).toContain(drop);
  fs.writeFileSync(path.join(root, file), text.replace(drop, ""));
  return path.join(root, file);
}

describe("scripts/twa-build.sh and the keystore password", () => {
  it("has Bubblewrap build unsigned: its own signing puts the password on apksigner's and jarsigner's command lines", () => {
    expect(code).toMatch(/"\$BW" build [^\n]*--skipSigning/);
    expect(code).not.toMatch(/BUBBLEWRAP_(KEYSTORE|KEY)_PASSWORD=/);
    expect(code).not.toMatch(/export[^\n]*BUBBLEWRAP_/);
    expect(code).toMatch(/unset BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD/);
  });

  it("gives apksigner the password on its stdin, and only a test build's keytool through its environment", () => {
    // apksigner's and keytool's literal forms (pass:<password>, -storepass <password>) never appear.
    expect(code).not.toMatch(/pass:(?!env\b)/);
    expect(code).not.toMatch(/-(store|key)pass\s/);
    // apksigner: from printf (a builtin) on its stdin, so no command line and no environment holds it; no --key-pass,
    // so it takes the keystore's password for the key.
    expect(code).toMatch(/\n {2}printf '%s\\n' "\$PW" \| "\$BT\/apksigner" sign [^\n]*--ks-pass stdin \\\n/);
    expect(code).not.toMatch(/--ks-pass env:|--key-pass/);
    // The test build's keytool (a throwaway password) is the one command that gets it in its environment.
    expect(code).toContain("-storepass:env TWA_KS_PASS -keypass:env TWA_KS_PASS");
    expect(code.match(/TWA_KS_PASS=\$PW /g)).toHaveLength(1);
    expect(code).toMatch(/TWA_KS_PASS=\$PW keytool -genkeypair/);
    // The shell variable is never exported, echoed or traced, and printed only into apksigner's stdin.
    expect(code).not.toMatch(/export[^\n]*\b(PW|TWA_KS_PASS)\b/);
    expect(code.split("\n").filter((l) => /(echo|printf)[^\n]*\$\{?PW\b/.test(l))).toEqual([
      `  printf '%s\\n' "$PW" | "$BT/apksigner" sign --ks "$KEY_PATH" --ks-key-alias "$KEY_ALIAS" --ks-pass stdin \\`,
    ]);
    expect(code).not.toMatch(/set -x|set -o xtrace/);
  });

  it("builds with Gradle's daemon off, so no daemon runs beside apksigner", () => {
    const off = code.indexOf(`printf 'org.gradle.daemon=false\\n' > "$GRADLE_USER_HOME/gradle.properties"`);
    expect(off).toBeGreaterThan(code.indexOf("export GRADLE_USER_HOME=$TMP/gradle"));
    expect(off).toBeLessThan(code.indexOf('"$BW" update'));
    expect(code).not.toMatch(/GRADLE_USER_HOME=(?!\$TMP\/gradle )/);
  });

  it("reads the password before any other program runs, then closes stdin for all of them", () => {
    const read = code.indexOf('if [ "$TEST" = 0 ]; then IFS= read -r PW || true; fi');
    expect(read).toBeGreaterThan(-1);
    // Nothing runs before it but the argument checks; stdin is closed right after.
    expect(code.slice(0, read)).not.toMatch(/\b(node|npm|java|keytool|curl|sdkmanager)\b(?! [^\n]*in this image)/);
    expect(code.slice(read)).toMatch(/^[^\n]*\nexec <\/dev\/null\n/);
  });

  it("unsets PW before reading into it: a PW the caller exported never reaches a program the script starts", () => {
    expect(code).toMatch(/\nunset PW\nPW=\nif \[ "\$TEST" = 0 \]; then IFS= read -r PW/);
    // Run up to the Android SDK check (none here): the stand-in node is the first program it starts.
    const tools = ["node", "npm", "java", "keytool", "curl"];
    const node = { node: "echo /dev/null" };
    const run = runWithExported("PW", "scripts/twa-build.sh", ["store"], tools, node);
    expect(run.r.status, run.r.stderr).toBe(2);
    expect(run.r.stderr).toContain("no Android SDK");
    expect(run.lines).toEqual(["clean node", "clean node"]);
    // The control: without the unset, the same run hands the password to node.
    const control = runWithExported("PW", withoutLine("scripts/twa-build.sh", "unset PW\n"), ["store"], tools, node);
    expect(control.r.status, control.r.stderr).toBe(2);
    expect(control.lines).toEqual(["leak node", "leak node"]);
  });

  it("signs with scheme v2 after zipalign, and keeps its scratch folder private and gone on any exit", () => {
    expect(code).toMatch(/"\$BT\/zipalign" -p -f 4/);
    expect(code).toMatch(/--v2-signing-enabled true/);
    expect(code).toMatch(/chmod 700 "\$TMP"/);
    expect(code).toMatch(/trap 'rm -rf "\$TMP"' EXIT/);
    expect(code).toMatch(/trap 'exit 130' INT TERM HUP/);
  });

  it("stops before building when the host's live asset links are not this build's", () => {
    expect(code).toContain('links=$(curl -s --max-time 20 "https://$icons/.well-known/assetlinks.json"');
    expect(code).toContain('"$(tr -d \'\\r\' < public/.well-known/assetlinks.json)"');
    expect(code).not.toMatch(/--skipPwaValidation/); // Bubblewrap 1.24.1's build does not read it
  });
});

describe("scripts/remote.sh --signing-key", () => {
  const strip = (f: string) =>
    fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
  const remote = strip("scripts/remote.sh");
  const run = strip("scripts/remote-run.sh");
  const stop = strip("scripts/remote-stop.sh");

  it("reads the password from its stdin before any ssh could, refuses a terminal, and closes stdin after", () => {
    const read = remote.indexOf("IFS= read -r SECRET || true");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(remote.indexOf('gate=$(ssh "$HOST"'));
    expect(remote).toMatch(/if \[ -t 0 \]; then\n[^\n]*reads the keystore password from stdin/);
    expect(remote.slice(read)).toMatch(/^[^\n]*\n[^\n]*\n {2}exec <\/dev\/null\n/);
  });

  it("sends it as the first line on the ssh connection, ahead of the heartbeat, with printf (a builtin)", () => {
    expect(remote).toContain(`< <(if [ -n "$SECRET" ]; then printf '%s\\n' "$SECRET"; fi; heartbeat $$) &`);
    expect(remote).not.toMatch(/(echo|--env|-e)[^\n]*\$SECRET/);
    expect(remote).toMatch(/DOCKER_OPTS\+=\(-i -v "\$SIGNING_STORE:\/secrets\/shadowlocks-android\.keystore:ro"\)/);
    // npm never reads the command's stdin.
    expect(remote).toMatch(/npm ci [^\n]*<\/dev\/null/);
  });

  it("on the server, reads that line before the watchdog, gives it to the container's stdin, and removes the keystore when the run ends", () => {
    expect(run.indexOf('if [ "$SIGN" = 1 ]; then IFS= read -r SECRET || SECRET=; fi')).toBeLessThan(run.indexOf("exec 3<&0"));
    expect(run).toContain(`printf '%s\\n' "$SECRET" | "$@"`);
    expect(run).toMatch(/finish\(\) \{\n[^\n]*\n {2}if \[ "\$SIGN" = 1 \]; then rm -rf "\$\(dirname "\$SIGNING_STORE"\)"; fi/);
    expect(run).not.toMatch(/(echo|export)[^\n]*\$SECRET/);
  });

  it("removes the keystore when the run is stopped: remote-stop.sh's SIGKILL keeps finish from running", () => {
    // remote-run.sh marks a signing run before the pid file a stop looks for, and finish takes the mark away.
    const mark = run.indexOf('if [ "$SIGN" = 1 ]; then : > "$LOCKS/$NAME.signing"; fi');
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(run.indexOf('echo $$ > "$LOCKS/$NAME.pgid"'));
    expect(run).toMatch(/finish\(\) \{[^}]*rm -f "\$LOCKS\/\$NAME\.pgid" "\$LOCKS\/\$NAME\.uploaded" "\$LOCKS\/\$NAME\.signing"/);
    // remote-stop.sh removes the keystore's folder when it finds the mark: after the kill (not in a dry run), and again
    // after the container is surely gone; the folder is SIGNING_STORE's in both other scripts.
    const store = /\nSIGNING_STORE=(\S+)\n/;
    expect(run.match(store)?.[1]).toBe(remote.match(store)?.[1]);
    expect(`${stop.match(/\nSTORE_DIR=(\S+)\n/)?.[1]}/shadowlocks-android.keystore`).toBe(remote.match(store)?.[1]);
    const kill = stop.indexOf('kill -KILL -- "-$p"');
    const dry = stop.indexOf('[ -n "${NS_STOP_DRY:-}" ] && exit 0');
    const first = stop.indexOf('if [ -e "$LOCKS/$NAME.signing" ]; then SIGNING=1; rm -rf "$STORE_DIR"; fi');
    const again = stop.indexOf('if [ "$SIGNING" = 1 ]; then rm -rf "$STORE_DIR"; rm -f "$LOCKS/$NAME.signing"; fi');
    expect(kill).toBeGreaterThan(-1);
    expect(dry).toBeGreaterThan(kill);
    expect(first).toBeGreaterThan(dry);
    expect(again).toBeGreaterThan(stop.lastIndexOf('docker rm -f "$NAME"'));
    expect(stop.slice(again)).toMatch(/^[^\n]*\nexit 0\n/);
  });

  it("unsets SECRET before reading into it, here and on the server", () => {
    expect(remote).toMatch(/\nunset SECRET\nSECRET=\nif \[ "\$SIGNING" = 1 \]; then\n/);
    expect(run).toMatch(/\nunset SECRET\nSECRET=\nif \[ "\$SIGN" = 1 \]; then IFS= read -r SECRET/);
  });

  it("a SECRET the caller exported never reaches ssh or rsync, and the password is the first line on the connection", () => {
    // Stand-ins: ssh answers the gate (load 0.5, 500 GB free) and, for the run, reads its first line; rsync does nothing.
    const programs = ["ssh", "rsync"];
    const bodies = {
      ssh: `case "$*" in
  *"docker volume create"*) printf '0.5\\n500\\n' ;;
  *remote-run*) IFS= read -r first; if [ "$first" = "$(cat "$LEAK_MARK")" ]; then echo "first line: the password" >>"$LEAK_LOG"; fi ;;
esac`,
    };
    const args = ["leak-test", "--signing-key", "--", "true"];
    const r = runWithExported("SECRET", "scripts/remote.sh", args, programs, bodies);
    expect(r.r.status, r.r.stderr).toBe(0);
    expect(r.lines).toContain("first line: the password");
    expect(r.lines.filter((l) => l === "clean ssh").length).toBe(2);
    expect(r.lines.filter((l) => l.startsWith("leak"))).toEqual([]);
    // The control: without the unset, the gate's ssh already has the password in its environment.
    const others = ["scripts/remote-run.sh", "scripts/remote-stop.sh", "scripts/remote-upload.sh"];
    const control = runWithExported("SECRET", withoutLine("scripts/remote.sh", "unset SECRET\n", others), args, programs, bodies);
    expect(control.lines).toContain("leak ssh");
  });
});
