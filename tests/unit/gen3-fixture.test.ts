// How tests/unit/fixtures/gen3-boxes.json was made, opt in (GEN3_FIXTURE=1):
//   scripts/remote.sh gen --env GEN3_FIXTURE=1 --pull test-results -- npx vitest run tests/unit/gen3-fixture.test.ts
// The fixture is each version 3 box's fingerprint: the first 16 hex digits of the sha256 of JSON.stringify(box), for
// boxes 1 to 200 and the days of November 2026. It was first written on main before version 4 (generateBox then built
// version 3). Version 3 is still buildable, so this rebuilds every entry from it ({ gen: 3 } in the spec, left out of
// the fingerprint), checks each against the committed file and writes the rebuilt file to test-results/.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import type { Box, BoxSpec } from "../../src/core/types";
import GEN3 from "./fixtures/gen3-boxes.json";

const sha = (box: Box) => {
  const { gen: _gen, ...spec } = box.spec as BoxSpec & { gen?: number };
  return createHash("sha256").update(JSON.stringify({ ...box, spec })).digest("hex").slice(0, 16);
};

describe.runIf(process.env.GEN3_FIXTURE)("version 3 fixture", () => {
  it("rebuilds every fingerprint from version 3 and matches the committed file", () => {
    const specs: BoxSpec[] = [
      ...Array.from({ length: 200 }, (_, i): BoxSpec => ({ kind: "box", n: i + 1, gen: 3 })),
      ...Array.from({ length: 30 }, (_, i): BoxSpec => ({ kind: "daily", day: `2026-11-${String(i + 1).padStart(2, "0")}`, gen: 3 })),
    ];
    const out: Record<string, string> = {};
    for (const spec of specs) {
      const box = generateBox(spec);
      out[box.key] = sha(box);
    }
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(path.join("test-results", "gen3-boxes.json"), JSON.stringify(out, null, 1) + "\n");
    expect(out).toEqual(GEN3);
  }, 600_000);
});
