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

  it("signs with scheme v2 after zipalign, and keeps its scratch folder private and gone on any exit", () => {
    expect(code).toMatch(/"\$BT\/zipalign" -p -f 4/);
    expect(code).toMatch(/--v2-signing-enabled true/);
    expect(code).toMatch(/chmod 700 "\$TMP"/);
    expect(code).toMatch(/trap 'rm -rf "\$TMP"' EXIT/);
    expect(code).toMatch(/trap 'exit 130' INT TERM HUP/);
  });
});
