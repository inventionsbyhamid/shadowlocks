// Every store-art run starts from an empty test-results/store/, so its art is cut only from plates and screenshots
// rendered in that run (a run filtered with -g reports the rest as missing instead of reusing an older render). It also
// writes owned.txt: every file name this pipeline makes, so scripts/store-art.sh replaces those in the planning folder
// and nothing else (a headset capture placed there by hand stays).
import fs from "node:fs";
import path from "node:path";
import { ART, SCREENSHOT_COUNT, screenshotFile } from "./lib/store-art";

/** Every file the store art pipeline writes to the planning folder. */
export function ownedFiles(): string[] {
  const shots = Array.from({ length: SCREENSHOT_COUNT }, (_, i) => screenshotFile(i + 1));
  return [...ART.map((a) => a.file), ...shots, "overview.png", "store-art.json"];
}

export default function storeSetup(): void {
  const out = path.join("test-results", "store");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "owned.txt"), `${ownedFiles().join("\n")}\n`);
}
