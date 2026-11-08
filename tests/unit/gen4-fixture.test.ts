// How tests/unit/fixtures/gen4-boxes.json was made, opt in (GEN4_FIXTURE=1):
//   scripts/remote.sh gen --env GEN4_FIXTURE=1 --pull test-results -- npx vitest run tests/unit/gen4-fixture.test.ts
// The fixture is each version 4 box's fingerprint, made as gen3-boxes.json is: the first 16 hex digits of the sha256
// of JSON.stringify(box), for boxes 1 to 200 and the days of November 2026, the specs generator.test.ts builds. It was
// taken at f75c09f, the version 4 that preview 61eb1aca shipped: a saved box resumes by its key and GENERATOR_VERSION,
// so a change to any version 4 box needs GENERATOR_VERSION 5, not a new fixture. generator.test.ts checks every
// fingerprint in the default run; this rebuilds them, checks them against the committed file and writes the rebuilt
// file to test-results/.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateBox } from "../../src/core/generator";
import type { Box, BoxSpec } from "../../src/core/types";
import GEN4 from "./fixtures/gen4-boxes.json";

const sha = (box: Box) => {
  const { gen: _gen, ...spec } = box.spec as BoxSpec & { gen?: number };
  return createHash("sha256").update(JSON.stringify({ ...box, spec })).digest("hex").slice(0, 16);
};

describe.runIf(process.env.GEN4_FIXTURE)("version 4 fixture", () => {
  it("rebuilds every fingerprint from version 4 and matches the committed file", () => {
    const specs: BoxSpec[] = [
      ...Array.from({ length: 200 }, (_, i): BoxSpec => ({ kind: "box", n: i + 1 })),
      ...Array.from({ length: 30 }, (_, i): BoxSpec => ({ kind: "daily", day: `2026-11-${String(i + 1).padStart(2, "0")}` })),
    ];
    const out: Record<string, string> = {};
    for (const spec of specs) {
      const box = generateBox(spec);
      out[box.key] = sha(box);
    }
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(path.join("test-results", "gen4-boxes.json"), JSON.stringify(out, null, 1) + "\n");
    expect(out).toEqual(GEN4);
  }, 600_000);
});
