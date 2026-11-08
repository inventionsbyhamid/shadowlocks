// The Quest 2 and Pro CPU gate is opt in (Ruling 142): the routine e2e suite (playwright.config.ts) leaves
// perf-budget-quest2.spec.ts out, and playwright.quest2.config.ts runs only it, with everything else as the suite has it.
// It stays strict (5.72x, 3.75 ms) and exclusive.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import suite, { BOT_SPECS, FRAME_COST_SPECS, QUEST2_GATE_SPECS } from "../../playwright.config";
import quest2 from "../../playwright.quest2.config";

const E2E = join(__dirname, "..", "e2e");
const specs = readdirSync(E2E).filter((f) => f.endsWith(".spec.ts"));

describe("the Quest 2 and Pro gate is opt in", () => {
  it("names one pattern, which picks that spec alone", () => {
    expect(QUEST2_GATE_SPECS).toBe("**/perf-budget-quest2.spec.ts");
    expect(specs.filter((f) => f === "perf-budget-quest2.spec.ts")).toEqual(["perf-budget-quest2.spec.ts"]);
  });

  it("leaves it out of the routine suite, beside the bot specs and the frame cost calibration, and keeps perf-budget in", () => {
    expect(suite.testIgnore).toEqual([BOT_SPECS, QUEST2_GATE_SPECS, FRAME_COST_SPECS]);
    expect(specs).toContain("perf-budget.spec.ts");
  });

  it("runs only it with its own config, the browser, server and fixtures as the suite has them", () => {
    expect(quest2.testMatch).toBe(QUEST2_GATE_SPECS);
    expect(quest2.testIgnore).toEqual([]);
    for (const k of ["testDir", "globalSetup", "outputDir", "workers", "use", "webServer", "expect", "timeout"] as const) {
      expect(quest2[k], k).toEqual(suite[k]);
    }
  });

  it("keeps it exclusive and strict: 5.72x and 3.75 ms", () => {
    const src = readFileSync(join(E2E, "perf-budget-quest2.spec.ts"), "utf8");
    expect(src.split("\n")[0]).toMatch(/^\/\/ e2e: exclusive/);
    expect(src).toContain("const PRO_RATE = 4 * (4 / 3) * (1.48 / 1.38);");
    expect(src).toContain("const P95_MS = 3.75;");
  });
});
