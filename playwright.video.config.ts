import { defineConfig } from "@playwright/test";
import { CHROME_ARGS } from "./tests/e2e/helpers/chromium";

const PORT = 8081;
const URL = `https://localhost:${PORT}/`;

// Demo video renders (tests/video), on the build server only: scripts/video.sh. Same browser and
// dev server as the e2e tests, plus VITE_VIDEO=1 (the see-through system hand, progress in memory).
// A render takes as long as it takes (no timeout); a failed shot is retried once, resuming from the
// frames already on disk.
export default defineConfig({
  testDir: "tests/video",
  testMatch: "render.spec.ts",
  outputDir: "test-results/video-runs",
  timeout: 0,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 1,
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
