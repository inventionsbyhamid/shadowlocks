import { defineConfig } from "@playwright/test";
import { CHROME_ARGS } from "./tests/e2e/helpers/chromium";

const PORT = 8081;
const URL = `https://localhost:${PORT}/`;

/**
 * The jitter bot's specs (tests/e2e/bot*.spec.ts): opt in, so the routine suite leaves them out (each takes about 25
 * minutes of exclusive server time). playwright.bot.config.ts runs them; tests/e2e/README.md says how.
 */
export const BOT_SPECS = "**/bot*.spec.ts";

/**
 * The Quest 2 and Pro CPU gate (tests/e2e/perf-budget-quest2.spec.ts, strict: 5.72x, 3.75 ms): opt in too, because on
 * this server it sits on its budget line and the server's load decides which side (task-25-report.md, fix round 1).
 * playwright.quest2.config.ts runs it, at low load; tests/e2e/README.md says how and when.
 */
export const QUEST2_GATE_SPECS = "**/perf-budget-quest2.spec.ts";

// Runs on the build server in the shadowlocks-e2e image (scripts/e2e.sh), never on a laptop.
// Software rendering is slow, so tests run one at a time with long timeouts and always on the
// virtual clock (tests/e2e/helpers).
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  testIgnore: [BOT_SPECS, QUEST2_GATE_SPECS],
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "test-results/artifacts",
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: URL,
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    // Day keys are local dates; pin the zone so seeds do not depend on the server.
    timezoneId: "UTC",
    launchOptions: { args: CHROME_ARGS },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: `npx vite --config vite.test.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: URL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { VITE_TEST_HOOKS: "1" },
  },
});
