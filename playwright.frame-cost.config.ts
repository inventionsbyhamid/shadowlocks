import { defineConfig } from "@playwright/test";
import suite, { FRAME_COST_SPECS } from "./playwright.config";

// The frame cost calibration (tests/e2e/frame-cost.spec.ts), opt in: the routine suite leaves it out. The same
// browser, dev server, fixtures and timeouts as the suite; only which spec runs differs. The run is exclusive (no spec
// filter means the whole config, and the spec's name and first line say so too):
//   scripts/e2e.sh -c playwright.frame-cost.config.ts
export default defineConfig({
  ...suite,
  testMatch: FRAME_COST_SPECS,
  testIgnore: [],
});
