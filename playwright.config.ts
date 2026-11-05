import { defineConfig } from "@playwright/test";
import { CHROME_ARGS } from "./tests/e2e/helpers/chromium";

const PORT = 8081;
const URL = `https://localhost:${PORT}/`;

// Runs on the build server in the shadowlocks-e2e image (scripts/e2e.sh), never on a laptop.
// Software rendering is slow, so tests run one at a time with long timeouts and always on the
// virtual clock (tests/e2e/helpers).
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
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
