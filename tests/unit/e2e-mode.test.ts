// Which e2e runs share the server's browser slot (functional, two at once) and which run alone
// (exclusive): `scripts/e2e.sh --print-mode`, the rule in that script's header. Uses this checkout's
// spec files (tests/e2e/lantern.spec.ts next to lantern-cost.spec.ts, tests/video/render.spec.ts).
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function mode(args: string[], env: Record<string, string> = {}): string {
  const r = spawnSync("bash", ["scripts/e2e.sh", "--print-mode", ...args], {
    encoding: "utf8",
    env: { ...process.env, NS_E2E_EXCLUSIVE: "", ...env },
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

describe("e2e run mode (scripts/e2e.sh --print-mode)", () => {
  it("lets plain functional specs share the slot", () => {
    expect(mode(["tests/e2e/boot.spec.ts"])).toBe("functional");
    expect(mode(["boot"])).toBe("functional");
    expect(mode(["tests/e2e/boot.spec.ts:12"])).toBe("functional");
    expect(mode(["tests/e2e/boot.spec.ts:12:3"])).toBe("functional");
    expect(mode(["tests/e2e/lantern.spec.ts"])).toBe("functional");
    expect(mode(["tests/e2e/boot.spec.ts", "tests/e2e/finger.spec.ts"])).toBe("functional");
    expect(mode(["TESTS/E2E/BOOT.SPEC.TS"])).toBe("functional");
  });

  it("does not take option values for spec filters", () => {
    expect(mode(["--reporter", "line", "tests/e2e/boot.spec.ts"])).toBe("functional");
    expect(mode(["tests/e2e/lantern.spec.ts", "-g", "lights the room"])).toBe("functional");
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
    expect(mode(["tests/e2e/perf-budget.spec.ts"])).toBe("exclusive");
    expect(mode(["tests/e2e/bot.spec.ts"])).toBe("exclusive");
    expect(mode(["store"])).toBe("exclusive");
    expect(mode(["tests/video/render.spec.ts"])).toBe("exclusive");
    expect(mode(["-c", "playwright.video.config.ts", "render"])).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts", "-g", "cost"])).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts", "--grep=perf-budget"])).toBe("exclusive");
  });

  it("runs a filter alone when it also matches such a spec, or matches nothing here", () => {
    // Playwright reads "lantern" as a pattern: it runs lantern-cost.spec.ts too.
    expect(mode(["lantern"])).toBe("exclusive");
    expect(mode(["render"])).toBe("exclusive");
    expect(mode(["no-such-spec"])).toBe("exclusive");
    expect(mode(["tests/e2e/(boot"])).toBe("exclusive");
  });

  it("runs alone whenever NS_E2E_EXCLUSIVE=1", () => {
    expect(mode(["tests/e2e/boot.spec.ts"], { NS_E2E_EXCLUSIVE: "1" })).toBe("exclusive");
    expect(mode(["tests/e2e/boot.spec.ts"], { NS_E2E_EXCLUSIVE: "0" })).toBe("functional");
  });
});
