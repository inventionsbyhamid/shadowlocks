// Every store-art run starts from an empty test-results/store/, so its art is cut only from plates and screenshots
// rendered in that run (a run filtered with -g reports the rest as missing instead of reusing an older render).
import fs from "node:fs";
import path from "node:path";

export default function storeSetup(): void {
  const out = path.join("test-results", "store");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
}
