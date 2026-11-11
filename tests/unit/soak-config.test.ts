// The 300-box soak is opt in: the routine e2e suite (playwright.config.ts) leaves soak-long.spec.ts out and keeps the
// 60-box soak and the paths' soak, and playwright.soak.config.ts runs only the long one, with everything else as the
// suite has it. The two box soaks time our JS and stay exclusive; the paths' soak times nothing and shares the slot.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import suite, { SOAK_LONG_SPECS } from "../../playwright.config";
import soak from "../../playwright.soak.config";

const E2E = join(__dirname, "..", "e2e");
const specs = readdirSync(E2E).filter((f) => f.endsWith(".spec.ts"));
const firstLine = (f: string) => readFileSync(join(E2E, f), "utf8").split("\n")[0];

describe("the long soak is opt in", () => {
  it("names one pattern, which picks that spec alone", () => {
    expect(SOAK_LONG_SPECS).toBe("**/soak-long.spec.ts");
    expect(specs.filter((f) => f.startsWith("soak")).sort()).toEqual(["soak-long.spec.ts", "soak-paths.spec.ts", "soak.spec.ts"]);
  });

  it("leaves it out of the routine suite, which keeps the 60-box soak and the paths' soak", () => {
    expect(suite.testIgnore).toContain(SOAK_LONG_SPECS);
    expect(suite.testMatch).toBe("**/*.spec.ts");
  });

  it("runs only it with its own config, the browser, server and fixtures as the suite has them", () => {
    expect(soak.testMatch).toBe(SOAK_LONG_SPECS);
    expect(soak.testIgnore).toEqual([]);
    for (const k of ["testDir", "globalSetup", "outputDir", "workers", "use", "webServer", "expect", "timeout"] as const) {
      expect(soak[k], k).toEqual(suite[k]);
    }
  });

  it("keeps the timed soaks exclusive and the paths' soak functional", () => {
    expect(firstLine("soak.spec.ts")).toMatch(/^\/\/ e2e: exclusive/);
    expect(firstLine("soak-long.spec.ts")).toMatch(/^\/\/ e2e: exclusive/);
    expect(readFileSync(join(E2E, "soak-paths.spec.ts"), "utf8")).not.toContain("// e2e: exclusive");
  });
});
