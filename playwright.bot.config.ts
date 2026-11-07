import { defineConfig } from "@playwright/test";
import suite, { BOT_SPECS } from "./playwright.config";

// The jitter bot's specs (tests/e2e/bot*.spec.ts), opt in: the routine suite leaves them out. The same browser, dev
// server, fixtures and timeouts as the suite; only which specs run differs. Each spec is exclusive, and so is any run
// naming this file (its name says "bot"):
//   scripts/e2e.sh -c playwright.bot.config.ts                           all three, one after the other
//   scripts/e2e.sh -c playwright.bot.config.ts tests/e2e/bot.spec.ts     one
export default defineConfig({
  ...suite,
  testMatch: BOT_SPECS,
  testIgnore: [],
});
