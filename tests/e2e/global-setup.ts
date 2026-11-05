import fs from "node:fs";
import { NOTES_FILE, SHOTS_DIR } from "./helpers/xr-app";

/** Start every run with no screenshots from earlier runs. */
export default function globalSetup(): void {
  fs.rmSync(SHOTS_DIR, { recursive: true, force: true });
  fs.rmSync(NOTES_FILE, { force: true });
}
