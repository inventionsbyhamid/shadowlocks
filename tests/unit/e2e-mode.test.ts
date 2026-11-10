// Which e2e runs share the server's browser slot (functional, two at once) and which run alone
// (exclusive): `scripts/e2e.sh --print-mode`, the rule in that script's header. Uses this checkout's
// spec files (tests/e2e/hand.. next to hand-cost.spec.ts, tests/video/render.spec.ts), and a copy of
// the script beside made-up specs for the "// e2e: exclusive" marker.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

function modeOf(script: string, args: string[], env: Record<string, string> = {}): string {
  const r = spawnSync("bash", [script, "--print-mode", ...args], {
    encoding: "utf8",
    env: { ...process.env, NS_E2E_EXCLUSIVE: "", ...env },
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}
const mode = (args: string[], env: Record<string, string> = {}) => modeOf("scripts/e2e.sh", args, env);

// A checkout of its own: the script, one plain spec and one marked spec whose names say nothing.
const fake = mkdtempSync(join(tmpdir(), "e2e-mode-"));
mkdirSync(join(fake, "scripts"));
mkdirSync(join(fake, "tests", "e2e"), { recursive: true });
copyFileSync("scripts/e2e.sh", join(fake, "scripts", "e2e.sh"));
writeFileSync(join(fake, "tests", "e2e", "plain.spec.ts"), 'test("x", () => {});\n');
writeFileSync(join(fake, "tests", "e2e", "timed.spec.ts"), '// e2e: exclusive (times real ms)\ntest("y", () => {});\n');
afterAll(() => rmSync(fake, { recursive: true, force: true }));
const fakeMode = (args: string[]) => modeOf(join(fake, "scripts", "e2e.sh"), args);

describe("e2e run mode (scripts/e2e.sh --print-mode)", () => {
  it("lets plain functional specs share the slot", () => {
    expect(mode(["tests/e2e/boot.spec.ts"])).toBe("functional");
    expect(mode(["boot"])).toBe("functional");
    expect(mode(["tests/e2e/boot.spec.ts:12"])).toBe("functional");
    expect(mode(["tests/e2e/boot.spec.ts:12:3"])).toBe("functional");
    expect(mode(["tests/e2e/boot.spec.ts", "tests/e2e/finger.spec.ts"])).toBe("functional");
    expect(mode(["TESTS/E2E/BOOT.SPEC.TS"])).toBe("functional");
    expect(mode(["enter", "comfort"])).toBe("functional");
  });

  it("does not take option values for spec filters", () => {
    expect(mode(["--reporter", "line", "tests/e2e/boot.spec.ts"])).toBe("functional");
    expect(mode(["tests/e2e/finger.spec.ts", "-g", "finger shots"])).toBe("functional");
    expect(mode(["--retries=1", "-x", "tests/e2e/shell.spec.ts"])).toBe("functional");
  });

  it("runs the full suite alone, also behind options or a --grep only", () => {
    expect(mode([])).toBe("exclusive");
    expect(mode(["--headed"])).toBe("exclusive");
    expect(mode(["--reporter", "line"])).toBe("exclusive");
    expect(mode(["-g", "enters"])).toBe("exclusive");
    expect(mode(["tests/e2e"])).toBe("exclusive");
  });

  it("runs timing-sensitive and long specs alone, named by path, filter or grep", () => {
    expect(mode(["tests/e2e/lantern-cost.spec.ts"])).toBe("exclusive");
    expect(mode(["hand-cost"])).toBe("exclusive");
    expect(mode(["Hand-COST"])).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts", "tests/e2e/hand-cost.spec.ts"])).toBe("exclusive");
    expect(mode(["tests/e2e/shadows.spec.ts"])).toBe("exclusive");
    expect(mode(["tests/e2e/lantern.spec.ts"])).toBe("exclusive");
    expect(mode(["lantern"])).toBe("exclusive");
    expect(mode(["tests/e2e/perf-budget.spec.ts"])).toBe("exclusive");
    expect(mode(["tests/e2e/bot.spec.ts"])).toBe("exclusive");
    expect(mode(["store"])).toBe("exclusive");
    expect(mode(["tests/video/render.spec.ts"])).toBe("exclusive");
    expect(mode(["-c", "playwright.video.config.ts", "render"])).toBe("exclusive");
    expect(mode(["-c", "playwright.bot.config.ts"])).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts", "-g", "cost"])).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts", "--grep=perf-budget"])).toBe("exclusive");
  });

  it("runs a filter alone when it also matches such a spec, or matches nothing here", () => {
    // Playwright reads "hand" as a pattern: it runs hand-cost.spec.ts too.
    expect(mode(["hand"])).toBe("exclusive");
    expect(mode(["render"])).toBe("exclusive");
    expect(mode(["no-such-spec"])).toBe("exclusive");
  });

  it("runs alone any filter that is not a plain path or name", () => {
    expect(mode(["/boot|lantern/"])).toBe("exclusive");
    expect(mode(["boot|lantern\\b"])).toBe("exclusive");
    expect(mode(["/boot/"])).toBe("exclusive");
    expect(mode(["^tests/e2e/boot"])).toBe("exclusive");
    expect(mode(["boot.spec.ts$"])).toBe("exclusive");
    expect(mode(["boo[t]"])).toBe("exclusive");
    expect(mode(["boot*"])).toBe("exclusive");
    expect(mode(["tests/e2e/(boot"])).toBe("exclusive");
    expect(mode(["boot spec"])).toBe("exclusive");
    expect(mode([""])).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts:x"])).toBe("exclusive");
  });

  it("runs alone a spec that carries the // e2e: exclusive line, whatever its name", () => {
    expect(fakeMode(["plain"])).toBe("functional");
    expect(fakeMode(["tests/e2e/plain.spec.ts:3"])).toBe("functional");
    expect(fakeMode(["timed"])).toBe("exclusive");
    expect(fakeMode(["tests/e2e/timed.spec.ts"])).toBe("exclusive");
    expect(fakeMode(["plain", "timed"])).toBe("exclusive");
    // "e2e" matches both specs here.
    expect(fakeMode(["e2e"])).toBe("exclusive");
  });

  it("finds the line in this checkout's specs that time real milliseconds", () => {
    for (const spec of ["hand-cost", "lantern-cost", "lantern", "shadows"]) {
      expect(readFileSync(`tests/e2e/${spec}.spec.ts`, "utf8"), spec).toMatch(/^\/\/ e2e: exclusive\b/m);
    }
  });

  it("runs alone whenever NS_E2E_EXCLUSIVE is set to anything but empty or 0", () => {
    expect(mode(["tests/e2e/boot.spec.ts"], { NS_E2E_EXCLUSIVE: "1" })).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts"], { NS_E2E_EXCLUSIVE: "yes" })).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts"], { NS_E2E_EXCLUSIVE: "0" })).toBe("functional");
    expect(mode(["tests/e2e/boot.spec.ts"], { NS_E2E_EXCLUSIVE: "" })).toBe("functional");
  });
});

/** `scripts/e2e.sh --print-limits`: "<mode> <load limit> <browser runs that may be going>". */
function limits(args: string[], env: Record<string, string> = {}): string {
  const r = spawnSync("bash", ["scripts/e2e.sh", "--print-limits", ...args], {
    encoding: "utf8",
    env: { ...process.env, NS_E2E_EXCLUSIVE: "", NS_MAX_LOAD: "", ...env },
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

describe("e2e start gates (Ruling 111)", () => {
  it("starts a functional run at load 34 or less beside at most one other", () => {
    expect(limits(["tests/e2e/boot.spec.ts"])).toBe("functional 34 1");
  });

  it("starts an exclusive run at load 25 or less with no other browser run", () => {
    expect(limits([])).toBe("exclusive 25 0");
    expect(limits(["tests/e2e/hand-cost.spec.ts"])).toBe("exclusive 25 0");
    expect(limits(["tests/e2e/boot.spec.ts"], { NS_E2E_EXCLUSIVE: "1" })).toBe("exclusive 25 0");
  });

  it("lets NS_MAX_LOAD set the load limit of either kind", () => {
    expect(limits(["tests/e2e/boot.spec.ts"], { NS_MAX_LOAD: "20" })).toBe("functional 20 1");
    expect(limits([], { NS_MAX_LOAD: "20" })).toBe("exclusive 20 0");
  });

  it("keeps e2e.sh's functional slots equal to remote.sh's shared slots", () => {
    const slots = (file: string, name: string) => readFileSync(file, "utf8").match(new RegExp(`^${name}=(\\d+)$`, "m"))?.[1];
    expect(slots("scripts/e2e.sh", "FUNCTIONAL_SLOTS")).toBe("2");
    expect(slots("scripts/remote.sh", "SHARED_SLOTS")).toBe("2");
  });
});
