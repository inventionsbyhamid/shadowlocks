import { defineConfig } from "@playwright/test";
import suite, { SOAK_LONG_SPECS } from "./playwright.config";

// The 300-box soak (tests/e2e/soak-long.spec.ts), opt in: the routine suite leaves it out. The same browser, dev
// server, fixtures and timeouts as the suite; only which spec runs differs. The run is exclusive (no spec filter means
// the whole config, and the spec carries the marker too), and lasts about an hour and a half (past the two-hour
// container limit on a loaded server, hence NS_MAX_RUN):
//   NS_LOCK_WAIT=7200 NS_MAX_RUN=10800 scripts/e2e.sh -c playwright.soak.config.ts
export default defineConfig({
  ...suite,
  testMatch: SOAK_LONG_SPECS,
  testIgnore: [],
});
