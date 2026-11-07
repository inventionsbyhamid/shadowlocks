// A long sweep of the generator, opt in (GEN_SWEEP=1, about two minutes on the server):
//   scripts/remote.sh gen --env GEN_SWEEP=1 -- npx vitest run tests/unit/generator-sweep.test.ts
// Boxes 201 to 2000 and a year of Daily Boxes, past what generator.test.ts builds: none may come near giving up
// (ATTEMPTS, 300, then a throw that would stop a player's Continue for good), and every finger lock must open with a
// real finger laid in its gap (helpers/finger-model.ts) at every lock size the kinds use. Prints the worst attempts,
// the slowest build and each shape's worst spill with the finger, by size.
import { describe, expect, it } from "vitest";
import { buildBox } from "../../src/core/generator";
import { meets, RULE } from "../../src/core/solve";
import type { BoxSpec } from "../../src/core/types";
import { FINGER_MODEL_MARGIN, fingerCoverage } from "./helpers/finger-model";

/** Attempts a box may take before the sweep calls it close to giving up. */
const ATTEMPTS_MAX = 100;

describe.runIf(process.env.GEN_SWEEP)("generator sweep", () => {
  it("builds boxes 201 to 2000 and 365 days, none near giving up, every finger lock filled by a finger", () => {
    const day0 = Date.UTC(2026, 10, 1);
    const specs: BoxSpec[] = [
      ...Array.from({ length: 1800 }, (_, i): BoxSpec => ({ kind: "box", n: 201 + i })),
      ...Array.from({ length: 365 }, (_, i): BoxSpec => ({ kind: "daily", day: new Date(day0 + i * 86_400_000).toISOString().slice(0, 10) })),
    ];
    let worstAttempts = { n: 0, key: "" }, slowest = { ms: 0, key: "" }, total = 0;
    const near: string[] = [], fails: string[] = [];
    const worst = new Map<string, { spill: number; at: string; count: number }>(), shapes = new Map<string, number>();
    for (const spec of specs) {
      const t0 = performance.now(), { box, attempts } = buildBox(spec), ms = performance.now() - t0;
      total += ms;
      for (const s of new Set(box.locks.map((l) => l.shape))) shapes.set(s, (shapes.get(s) ?? 0) + 1);
      if (attempts > worstAttempts.n) worstAttempts = { n: attempts, key: box.key };
      if (ms > slowest.ms) slowest = { ms, key: box.key };
      if (attempts >= ATTEMPTS_MAX) near.push(`${box.key}: ${attempts} attempts`);
      for (const l of box.locks) {
        if (!l.finger) continue;
        const c = fingerCoverage(box, l), key = `${l.shape} @${l.size}`;
        if (!meets(c, true) || c.spillAll > RULE.SPILL_ALL_MAX - FINGER_MODEL_MARGIN) {
          fails.push(`${box.key} lock ${l.i} ${l.shape} @${l.size}: spill ${c.spillAll.toFixed(3)}, gap ${c.gap.toFixed(3)}`);
        }
        const w = worst.get(key) ?? { spill: 0, at: "", count: 0 };
        w.count++;
        if (c.spillAll > w.spill) {
          w.spill = c.spillAll;
          w.at = `${box.key} lock ${l.i}`;
        }
        worst.set(key, w);
      }
    }
    console.log(
      `${specs.length} boxes: avg ${(total / specs.length).toFixed(1)} ms, slowest ${slowest.ms.toFixed(0)} ms (${slowest.key}), ` +
        `most attempts ${worstAttempts.n} (${worstAttempts.key})`,
    );
    console.log(
      `worst spill with a finger, by shape and lock size (finger locks seen): ` +
        [...worst].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v.spill.toFixed(3)} (${v.count}, ${v.at})`).join("; "),
    );
    console.log(`failing finger locks: ${fails.length}\n${fails.slice(0, 40).join("\n")}`);
    console.log(`share of boxes showing each shape: ${[...shapes].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${(n / specs.length).toFixed(3)}`).join(", ")}`);
    expect(near).toEqual([]);
    expect(fails).toEqual([]);
  }, 1_800_000);
});
