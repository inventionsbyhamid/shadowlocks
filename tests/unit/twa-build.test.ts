// scripts/twa-build.sh keeps the keystore password off every command line (Task 28's security fix): Bubblewrap builds
// unsigned, and only keytool and apksigner get the password, through their own environment. The script itself runs
// only in the Android build container (Task 28 ran it there); this reads its code.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const script = fs.readFileSync("scripts/twa-build.sh", "utf8");
/** The script without its comment lines. */
const code = script
  .split("\n")
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");

describe("scripts/twa-build.sh and the keystore password", () => {
  it("has Bubblewrap build unsigned: its own signing puts the password on apksigner's and jarsigner's command lines", () => {
    expect(code).toMatch(/"\$BW" build [^\n]*--skipSigning/);
    expect(code).not.toMatch(/BUBBLEWRAP_(KEYSTORE|KEY)_PASSWORD=/);
    expect(code).not.toMatch(/export[^\n]*BUBBLEWRAP_/);
    expect(code).toMatch(/unset BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD/);
  });

  it("gives the password to keytool and apksigner only through their environment", () => {
    // apksigner's and keytool's literal forms (pass:<password>, -storepass <password>) never appear.
    expect(code).not.toMatch(/pass:(?!env\b)/);
    expect(code).not.toMatch(/-(store|key)pass\s/);
    expect(code).toContain("--ks-pass env:TWA_KS_PASS");
    expect(code).toContain("--key-pass env:TWA_KS_PASS");
    expect(code).toContain("-storepass:env TWA_KS_PASS -keypass:env TWA_KS_PASS");
    // Each of those commands gets it in its own environment; the shell variable is never exported, echoed or traced.
    expect(code.match(/TWA_KS_PASS=\$PW /g)).toHaveLength(2);
    expect(code).not.toMatch(/export[^\n]*\b(PW|TWA_KS_PASS)\b/);
    expect(code).not.toMatch(/(echo|printf)[^\n]*\$\{?PW\b/);
    expect(code).not.toMatch(/set -x|set -o xtrace/);
  });

  it("reads the password before any other program runs, then closes stdin for all of them", () => {
    const read = code.indexOf('if [ "$TEST" = 0 ]; then IFS= read -r PW || true; fi');
    expect(read).toBeGreaterThan(-1);
    // Nothing runs before it but the argument checks; stdin is closed right after.
    expect(code.slice(0, read)).not.toMatch(/\b(node|npm|java|keytool|curl|sdkmanager)\b(?! [^\n]*in this image)/);
    expect(code.slice(read)).toMatch(/^[^\n]*\nexec <\/dev\/null\n/);
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

  it("on the server, reads that line before the watchdog, gives it to the container's stdin, and removes the keystore however the run ends", () => {
    expect(run.indexOf('if [ "$SIGN" = 1 ]; then IFS= read -r SECRET || SECRET=; fi')).toBeLessThan(run.indexOf("exec 3<&0"));
    expect(run).toContain(`printf '%s\\n' "$SECRET" | "$@"`);
    expect(run).toMatch(/finish\(\) \{\n[^\n]*\n {2}if \[ "\$SIGN" = 1 \]; then rm -rf "\$\(dirname "\$SIGNING_STORE"\)"; fi/);
    expect(run).not.toMatch(/(echo|export)[^\n]*\$SECRET/);
  });
});
