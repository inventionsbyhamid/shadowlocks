import { defineConfig } from "@playwright/test";
import { CHROME_ARGS } from "./tests/e2e/helpers/chromium";

const PORT = 8081;
const URL = `https://localhost:${PORT}/`;

// The store art (tests/video/store.spec.ts), on the build server only: scripts/store-art.sh. Same
// browser and dev server as the video renders (VITE_VIDEO=1: the see-through system hand, progress in
// memory). Plates first, one test each, then the art cut from them; a failed plate leaves the others.
export default defineConfig({
  testDir: "tests/video",
  testMatch: "store.spec.ts",
  outputDir: "test-results/store-runs",
  timeout: 60 * 60_000,
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
    env: { VITE_TEST_HOOKS: "1", VITE_VIDEO: "1" },
  },
});
