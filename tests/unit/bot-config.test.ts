// The jitter bot's specs are opt in: the routine e2e suite (playwright.config.ts) leaves them out, and
// playwright.bot.config.ts runs only them, with everything else as the suite has it. Each keeps "// e2e: exclusive".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import bot from "../../playwright.bot.config";
import suite, { BOT_SPECS } from "../../playwright.config";

const E2E = join(__dirname, "..", "e2e");
const specs = readdirSync(E2E).filter((f) => f.endsWith(".spec.ts"));
/** The spec files BOT_SPECS ("**\/bot*.spec.ts") picks in tests/e2e. */
const botSpecs = specs.filter((f) => /^bot.*\.spec\.ts$/.test(f));

describe("the bot specs are opt in", () => {
  it("names one pattern: the three bot specs and nothing else of the suite", () => {
    expect(BOT_SPECS).toBe("**/bot*.spec.ts");
    expect(botSpecs.sort()).toEqual(["bot-controllers.spec.ts", "bot-sweeps.spec.ts", "bot.spec.ts"]);
  });

  it("leaves them out of the routine suite", () => {
    expect(suite.testDir).toBe("tests/e2e");
    expect(suite.testMatch).toBe("**/*.spec.ts");
    expect(suite.testIgnore).toBe(BOT_SPECS);
  });

  it("runs only them with the bot config, the browser, server and fixtures as the suite has them", () => {
    expect(bot.testMatch).toBe(BOT_SPECS);
    expect(bot.testIgnore).toEqual([]);
    for (const k of ["testDir", "globalSetup", "outputDir", "workers", "use", "webServer", "expect"] as const) {
      expect(bot[k], k).toEqual(suite[k]);
    }
  });

  it("keeps every bot spec exclusive", () => {
    for (const f of botSpecs) expect(readFileSync(join(E2E, f), "utf8").split("\n")[0], f).toMatch(/^\/\/ e2e: exclusive/);
  });
});
