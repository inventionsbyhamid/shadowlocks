// A long sweep of the generator, opt in (GEN_SWEEP=1, about a minute on the server):
//   scripts/remote.sh gen --env GEN_SWEEP=1 -- npx vitest run tests/unit/generator-sweep.test.ts
// Boxes 10 to 2000 and a year of Daily Boxes, past what generator.test.ts builds:
// - none may come near giving up (ATTEMPTS, 300, then a throw that would stop a player's Continue for good), nor take
//   longer than BUILD_MS_MAX to build;
// - every finger lock must open with a real finger laid in its gap (helpers/finger-model.ts) at every lock size the
//   kinds use, for either hand (the left hand's box is the mirror, sampled on its own grid);
// - every lock must be strictly warmest at its spot along the line in from 0.2 toward the start, for either hand, but
//   for exactly LEFT_HAND_TIES (they must all still be there: version 4's boxes as shipped);
// - no box may cast more shadow corners than FRAME_CORNER_CAP (frame-cost.ts: its frame then costs at most 10% more
//   than box 15's).
// Prints the worst attempts, the slowest build, each kind's heaviest box and its decoys given up, and each shape's
// worst spill with the finger, by size.
import { describe, expect, it } from "vitest";
import { boxFrame, buildBox, FRAME_CORNER_CAP } from "../../src/core/generator";
import { mirrorBox } from "../../src/core/mirror";
import { boxKind, boxParams } from "../../src/core/params";
import { meets, RULE } from "../../src/core/solve";
import type { BoxSpec } from "../../src/core/types";
import { FINGER_MODEL_MARGIN, fingerCoverage } from "./helpers/finger-model";
import { notWarmest } from "./helpers/warmth";

/** Attempts a box may take before the sweep calls it close to giving up. */
const ATTEMPTS_MAX = 100;
/** The slowest build allowed (ms, on the server): Ruling 146. */
const BUILD_MS_MAX = 300;

/**
 * Locks that are as warm a few millimetres short of their spot as at it in the mirrored (left-handed) box only, on that
 * box's own sample grid. The generator checks warmth for the right hand; checking both would redraw these boxes, and
 * version 4's boxes are fixed now that it has shipped (a change needs GENERATOR_VERSION 5). The glow just leads in less
 * cleanly there; the lock still opens by the rule.
 */
const LEFT_HAND_TIES = [
  "shadow-locks/1870 (left hand) lock 2 at 8",
  "shadow-locks/1919 (left hand) lock 1 at 7",
  "shadow-locks/1919 (left hand) lock 1 at 8",
  "shadow-locks/daily/2027-02-18 (left hand) lock 2 at 8",
  "shadow-locks/daily/2027-10-19 (left hand) lock 1 at 8",
];

describe.runIf(process.env.GEN_SWEEP)("generator sweep", () => {
  it("builds boxes 10 to 2000 and 365 days quickly, none near giving up, finger locks filled and warmth strict for either hand, every frame within the cap", () => {
    const day0 = Date.UTC(2026, 10, 1);
    const specs: BoxSpec[] = [
      ...Array.from({ length: 1991 }, (_, i): BoxSpec => ({ kind: "box", n: 10 + i })),
      ...Array.from({ length: 365 }, (_, i): BoxSpec => ({ kind: "daily", day: new Date(day0 + i * 86_400_000).toISOString().slice(0, 10) })),
    ];
    let worstAttempts = { n: 0, key: "" }, slowest = { ms: 0, key: "" }, total = 0;
    const cold: string[] = [], gaveUp: string[] = [], near: string[] = [], slow: string[] = [], fails: string[] = [], heavy: string[] = [], costFailures = { boxes: 0, attempts: 0 };
    const worst = new Map<string, { spill: number; at: string; count: number }>();
    const kinds = new Map<string, { max: number; at: string; trimmed: number; boxes: number }>();
    for (const spec of specs) {
      const t0 = performance.now();
      let built: ReturnType<typeof buildBox>;
      try {
        built = buildBox(spec);
      } catch (e) {
        gaveUp.push(String(e));
        continue;
      }
      const { box, attempts, failures } = built, ms = performance.now() - t0;
      total += ms;
      if (attempts > worstAttempts.n) worstAttempts = { n: attempts, key: box.key };
      if (ms > slowest.ms) slowest = { ms, key: box.key };
      if (attempts >= ATTEMPTS_MAX) near.push(`${box.key}: ${attempts} attempts`);
      if (ms > BUILD_MS_MAX) slow.push(`${box.key}: ${ms.toFixed(0)} ms`);
      if (failures.cost) {
        costFailures.boxes++;
        costFailures.attempts += failures.cost;
      }
      const frame = boxFrame(box), kind = spec.kind === "box" ? boxKind(spec.n) : "daily";
      if (frame.corners > FRAME_CORNER_CAP) heavy.push(`${box.key}: ${frame.corners} corners`);
      const decoys = box.elements.filter((e) => e.kind === "decoy").length;
      const k = kinds.get(kind) ?? { max: 0, at: "", trimmed: 0, boxes: 0 };
      k.boxes++;
      if (spec.kind === "box" && decoys < boxParams(spec.n).decoys) k.trimmed++;
      if (frame.corners > k.max) {
        k.max = frame.corners;
        k.at = box.key;
      }
      kinds.set(kind, k);
      for (const [hand, b] of [["right", box], ["left", mirrorBox(box)]] as const) {
        for (const f of notWarmest(b)) cold.push(`${box.key} (${hand} hand) ${f}`);
        for (const l of b.locks) {
          if (!l.finger) continue;
          const c = fingerCoverage(b, l), key = `${l.shape} @${l.size}`;
          if (!meets(c, true) || c.spillAll > RULE.SPILL_ALL_MAX - FINGER_MODEL_MARGIN) {
            fails.push(`${box.key} (${hand} hand) lock ${l.i} ${l.shape} @${l.size}: spill ${c.spillAll.toFixed(3)}, gap ${c.gap.toFixed(3)}`);
          }
          const w = worst.get(key) ?? { spill: 0, at: "", count: 0 };
          w.count++;
          if (c.spillAll > w.spill) {
            w.spill = c.spillAll;
            w.at = `${box.key} lock ${l.i} (${hand})`;
          }
          worst.set(key, w);
        }
      }
    }
    console.log(
      `${specs.length} boxes: avg ${(total / specs.length).toFixed(1)} ms, slowest ${slowest.ms.toFixed(0)} ms (${slowest.key}), ` +
        `most attempts ${worstAttempts.n} (${worstAttempts.key}); redrawn for the frame cost: ${costFailures.attempts} attempts in ${costFailures.boxes} boxes`,
    );
    console.log(
      `most shadow corners by kind (cap ${FRAME_CORNER_CAP}): ` +
        [...kinds].map(([k, v]) => `${k} ${v.max} (${v.at}), fewer decoys in ${v.trimmed} of ${v.boxes}`).join("; "),
    );
    console.log(
      `worst spill with a finger, either hand, by shape and lock size (finger locks seen): ` +
        [...worst].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v.spill.toFixed(3)} (${v.count}, ${v.at})`).join("; "),
    );
    console.log(`failing finger locks: ${fails.length}\n${fails.slice(0, 40).join("\n")}`);
    console.log(`locks not strictly warmest at their spot, either hand: ${cold.length} ${cold.slice(0, 20).join("; ")}`);
    console.log(`gave up: ${gaveUp.length}: ${gaveUp.slice(0, 20).join("; ")}`);
    expect(gaveUp).toEqual([]);
    expect(near).toEqual([]);
    expect(slow).toEqual([]);
    expect(heavy).toEqual([]);
    expect(fails).toEqual([]);
    // Exactly these ties, in the sweep's order: none more, and none gone (a generator that checks the left hand too
    // redraws those four boxes, which version 4 must not).
    expect(cold).toEqual(LEFT_HAND_TIES);
  }, 1_800_000);
});
