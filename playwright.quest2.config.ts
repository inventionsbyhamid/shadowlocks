import { defineConfig } from "@playwright/test";
import suite, { QUEST2_GATE_SPECS } from "./playwright.config";

// The Quest 2 and Pro CPU gate (tests/e2e/perf-budget-quest2.spec.ts), opt in: the routine suite leaves it out. The
// same browser, dev server, fixtures and timeouts as the suite; only which spec runs differs. The run is exclusive (no
// spec filter means the whole config, and the spec's name and first line say so too). Run it at low load:
//   NS_MAX_LOAD=8 NS_LOCK_WAIT=7200 scripts/e2e.sh -c playwright.quest2.config.ts
export default defineConfig({
  ...suite,
  testMatch: QUEST2_GATE_SPECS,
  testIgnore: [],
});
