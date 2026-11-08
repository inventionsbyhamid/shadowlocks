import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { FRAME_MS } from "../../src/core/frame-cost";
import {
  BUILDABLE_VERSIONS,
  boxFrame,
  buildBox,
  DECOY_TRIM_MAX,
  FRAME_CORNER_CAP,
  GENERATOR_VERSION,
  generateBox,
  genOf,
  seedKey,
  specForSave,
  specOfKey,
} from "../../src/core/generator";
import { mirrorBox } from "../../src/core/mirror";
import { boxKind, boxParams, boxParamsV3, dailyParams } from "../../src/core/params";
import { FIRST_SILHOUETTES, SHAPES, SILHOUETTES } from "../../src/core/shapes";
import { boxSilhouettes, REPEAT_GAP } from "../../src/core/silhouette-deck";
import { type Coverage, measure, meets, prepareLock, RULE, shadowPolys, SKIP_MISSING } from "../../src/core/solve";
import { LOOT, OWNERS } from "../../src/core/story";
import type { Box, BoxSpec, ShapeName, V2 } from "../../src/core/types";
import GEN3 from "./fixtures/gen3-boxes.json";
import GEN4 from "./fixtures/gen4-boxes.json";
import { FINGER_MODEL_MARGIN, fingerCoverage } from "./helpers/finger-model";
import {
  checkBox,
  checkCounts,
  checkFingerAndDepth,
  checkSilhouettes,
  checkInBox,
  checkMarkClear,
  checkRingsNest,
  checkSolvable,
  checkSpots,
  type LockStat,
  type RingStat,
  fingerAngles,
  missingShares,
  nearHorizontal,
  paramsFor,
} from "./helpers/box-checks";
import { notWarmest } from "./helpers/warmth";

/** A box's fingerprint: its JSON's sha256, the spec's `gen` left out (a version 3 box rebuilt for a save carries it). */
const sha = (box: Box) => {
  const { gen: _gen, ...spec } = box.spec as BoxSpec & { gen?: number };
  return createHash("sha256").update(JSON.stringify({ ...box, spec })).digest("hex").slice(0, 16);
};
/** Version 3's boxes, fingerprinted at main before version 4 (boxes 1-200 and the days of November 2026). */
const V3_HASHES = GEN3 as Record<string, string>;
/**
 * Version 4's boxes, fingerprinted at f75c09f, the version 4 preview 61eb1aca shipped (gen4-fixture.test.ts says how):
 * the same specs as SPECS. A saved box resumes by its key and GENERATOR_VERSION, so a change to any of them is a new
 * generator version, never a new fixture.
 */
const V4_HASHES = GEN4 as Record<string, string>;

const BOXES = 200;
const DAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
const SPECS: BoxSpec[] = [
  ...Array.from({ length: BOXES }, (_, i): BoxSpec => ({ kind: "box", n: i + 1 })),
  ...DAYS.map((day): BoxSpec => ({ kind: "daily", day })),
];

interface Built {
  spec: BoxSpec;
  box: Box;
  ms: number;
  attempts: number;
}
const built: Built[] = [];
const failures: Record<string, number> = {};

/** Runs a per-box check over every box and lists what failed. */
function failing(check: (b: Box) => string[]): string[] {
  return built.flatMap(({ box }) => check(box).map((e) => `${box.key}: ${e}`));
}

/** Locks with sight rings over every box, as the boxes' settings ask (checkCounts holds each box to them). */
const ringedLocks = () => built.reduce((s, { box }) => s + paramsFor(box).locks - paramsFor(box).ringless, 0);

beforeAll(() => {
  for (const spec of SPECS) {
    const t0 = performance.now();
    const r = buildBox(spec);
    built.push({ spec, box: r.box, ms: performance.now() - t0, attempts: r.attempts });
    for (const [k, v] of Object.entries(r.failures)) failures[k] = (failures[k] ?? 0) + v;
  }
}, 600_000);

describe("generateBox", () => {
  it("builds boxes 1..200 and 30 days quickly", () => {
    const ms = built.map((b) => b.ms);
    const avg = ms.reduce((s, v) => s + v, 0) / ms.length;
    const worst = Math.max(...ms);
    const attempts = built.reduce((s, b) => s + b.attempts, 0) / built.length;
    console.log(
      `${built.length} boxes: avg ${avg.toFixed(1)} ms, worst ${worst.toFixed(1)} ms (${built.find((b) => b.ms === worst)!.box.key}); ` +
        `avg ${attempts.toFixed(2)} attempts, most ${Math.max(...built.map((b) => b.attempts))}; failed attempts by reason ${JSON.stringify(failures)}`,
    );
    expect(avg).toBeLessThan(150);
    expect(worst).toBeLessThan(1000);
  });

  it("is solvable from every spot, finger locks short exactly their piece, no spill, nothing solved from the start", () => {
    const stats: LockStat[] = [];
    const errs = failing((b) => checkSolvable(b, stats));
    const plain = stats.filter((s) => !s.finger), finger = stats.filter((s) => s.finger);
    const min = (v: number[]) => Math.min(...v).toFixed(3), max = (v: number[]) => Math.max(...v).toFixed(3);
    const worst = (f: (s: LockStat) => number) => stats.reduce((a, b) => (f(b) > f(a) ? b : a));
    console.log(`worst spill ${worst((s) => s.spill).box} lock ${worst((s) => s.spill).lock}; ` +
      `worst other scraps ${worst((s) => s.foreign).box} lock ${worst((s) => s.foreign).lock}`);
    console.log(
      `${stats.length} locks (${finger.length} finger): plain coverage min ${min(plain.map((s) => s.cov))}; ` +
        `finger with piece min ${min(finger.map((s) => s.covAll))}, without max ${max(finger.map((s) => s.cov))} ` +
        `(missing share ${min(finger.map((s) => 1 - s.cov))}..${max(finger.map((s) => 1 - s.cov))}); ` +
        `spill max ${max(stats.map((s) => s.spill))}; other scraps max ${max(stats.map((s) => s.foreign))}; ` +
        `from the start max ${max(stats.map((s) => s.atStart))}; finger locks near horizontal ` +
        `${finger.filter((s) => nearHorizontal(s.fingerAngle)).length}/${finger.length}`,
    );
    expect(errs).toEqual([]);
  });

  it("nests each lock's two ring shadows into a bullseye at its spot", () => {
    const stats: RingStat[] = [];
    expect(failing((b) => checkRingsNest(b, stats))).toEqual([]);
    expect(stats.length).toBe(ringedLocks());
    console.log(
      `${stats.length} ring pairs: centres within ${Math.max(...stats.map((s) => s.offset)).toFixed(5)} ` +
        `(at most ${(100 * Math.max(...stats.map((s) => s.offsetShare))).toFixed(0)}% of the lock's bound), ` +
        `gap ${Math.min(...stats.map((s) => s.gap)).toFixed(6)}..${Math.max(...stats.map((s) => s.gap)).toFixed(6)}`,
    );
  });

  it("keeps every other shadow 0.07 clear of each ringed lock's mark, seen from its spot", () => {
    const clearance: number[] = [];
    const errs = failing((b) => checkMarkClear(b, clearance));
    expect(clearance.length).toBe(ringedLocks());
    console.log(`${clearance.length} marks: nearest other shadow ${Math.min(...clearance).toFixed(4)} from a mark`);
    expect(errs).toEqual([]);
  });

  it("keeps every spot inside the envelope, apart from the others and from the start", () => {
    expect(failing(checkSpots)).toEqual([]);
  });

  it("hangs every scrap and ring inside the box", () => {
    expect(failing(checkInBox)).toEqual([]);
  });

  it("has the locks, finger locks, decoys, ringless and hidden locks boxParams asks for", () => {
    expect(failing(checkCounts)).toEqual([]);
    for (const { box } of built) expect(box.params).toEqual(paramsFor(box));
  });

  it("puts two silhouettes in a silhouettes box and at most one in any other", () => {
    for (const { spec, box } of built) {
      const n = box.locks.filter((l) => SILHOUETTES.includes(l.shape)).length;
      if (spec.kind === "box" && boxKind(spec.n) === "silhouettes") expect(n, box.key).toBe(2);
      else expect(n, box.key).toBeLessThanOrEqual(1);
    }
  });

  it("gives every box with a hidden lock its silhouettes, each on a hidden lock, as the deck dealt them", () => {
    expect(failing(checkSilhouettes)).toEqual([]);
    for (const { spec, box } of built) {
      const shown = box.locks.filter((l) => SILHOUETTES.includes(l.shape)).map((l) => l.shape).sort();
      expect(shown, box.key).toEqual(boxSilhouettes(spec).sort());
    }
  });

  it("is solvable by the game's own solve rule: from each spot, with the finger in the gap, every lock opens", () => {
    const fails: string[] = [], cov: Coverage = { cover: 0, spill: 0, spillAll: 0, gap: 0 };
    let locks = 0;
    for (const { box } of built) {
      for (const l of box.locks) {
        const scraps: V2[][] = [], n = shadowPolys(box.elements, l.L, scraps, SKIP_MISSING);
        // The finger casts the missing piece's own shadow: the scrap the box leaves out, seen from the spot.
        const gap = box.elements.find((e) => e.kind === "piece" && e.lock === l.i && e.missing);
        const finger: V2[][] = [], nf = gap ? shadowPolys([gap], l.L, finger) : 0;
        measure(prepareLock(l), scraps, n, finger, nf, cov);
        locks++;
        if (!meets(cov, l.finger)) fails.push(`${box.key} lock ${l.i}: ${JSON.stringify(cov)}`);
      }
    }
    expect(locks).toBeGreaterThan(600);
    expect(fails).toEqual([]);
  });

  it("opens every finger lock with a real finger laid in its gap, with room to spare, for either hand", () => {
    // The finger model (helpers/finger-model.ts) casts IWER's index finger as the e2e specs lay it; against 20 locks
    // measured in the browser it is within 0.029 of the spill measured (rms 0.011), so it is held 0.03 under the rule.
    // A left-handed player's box is the mirror, sampled on a grid of its own (mirror.ts, prepareLock).
    const fails: string[] = [], worst = new Map<string, { spill: number; at: string }>();
    let left = 0;
    for (const { box: right } of built) {
      for (const box of [right, mirrorBox(right)]) {
        for (const l of box.locks) {
          if (!l.finger) continue;
          const c = fingerCoverage(box, l), key = `${l.shape} ${l.size}`;
          if (!meets(c, true) || c.spillAll > RULE.SPILL_ALL_MAX - FINGER_MODEL_MARGIN) {
            fails.push(`${box.key}${box.mirrored ? " (left)" : ""} lock ${l.i} ${l.shape}: spill with the finger ${c.spillAll.toFixed(3)}, gap ${c.gap.toFixed(3)}`);
          }
          if (box.mirrored) left = Math.max(left, c.spillAll);
          if (!worst.has(key) || worst.get(key)!.spill < c.spillAll) worst.set(key, { spill: c.spillAll, at: `${box.key} lock ${l.i}` });
        }
      }
    }
    console.log(`finger locks, worst spill with the finger in a left-handed box: ${left.toFixed(3)}`);
    console.log(`finger locks, worst spill with the finger by shape and size: ${[...worst].sort((a, b) => b[1].spill - a[1].spill).slice(0, 12).map(([k, v]) => `${k} ${v.spill.toFixed(3)}`).join(", ")}`);
    expect(fails).toEqual([]);
  });

  it("is strictly warmest at each spot along the line in from 0.2 toward the start, for either hand", () => {
    const fails = built
      .flatMap(({ box }) => [box, mirrorBox(box)])
      .flatMap((box) => notWarmest(box).map((f) => `${box.key}${box.mirrored ? " (left)" : ""} ${f}`));
    expect(fails).toEqual([]);
  });

  it("shows each classic shape in at least 10% of boxes 10 and up", () => {
    const late = built.filter((b) => b.spec.kind === "box" && b.spec.n >= 10);
    const classics = (Object.keys(SHAPES) as ShapeName[]).filter((s) => !SILHOUETTES.includes(s));
    const share = Object.fromEntries(
      classics.map((s) => [s, late.filter((b) => b.box.locks.some((l) => l.shape === s)).length / late.length]),
    );
    console.log(`classic shapes in boxes 10+: ${JSON.stringify(share, (_, v: unknown) => (typeof v === "number" ? +v.toFixed(3) : v))}`);
    for (const s of classics) expect(share[s], s).toBeGreaterThanOrEqual(0.1);
  });

  it("leaves out only pieces a finger can fill: at most 35% of the shape", () => {
    expect(failing((b) => checkFingerAndDepth(b).filter((e) => e.includes("misses")))).toEqual([]);
    const shares = built.flatMap(({ box }) => missingShares(box));
    console.log(`missing piece share ${Math.min(...shares).toFixed(3)}..${Math.max(...shares).toFixed(3)}`);
  });

  it("keeps a hidden lock's pieces within 0.45 of the panel", () => {
    expect(failing((b) => checkFingerAndDepth(b).filter((e) => e.includes("hangs")))).toEqual([]);
    expect(built.some(({ box }) => box.locks.some((l) => l.hidden))).toBe(true);
  });

  it("runs at least 90% of finger locks within 45 degrees of horizontal", () => {
    const angles = built.flatMap(({ box }) => fingerAngles(box));
    expect(angles.length).toBeGreaterThan(300);
    expect(angles.filter(nearHorizontal).length / angles.length).toBeGreaterThanOrEqual(0.9);
  });

  it("names each box by its seed key and tells its story from the word lists", () => {
    for (const { spec, box } of built) {
      expect(box.key).toBe(spec.kind === "box" ? `shadow-locks/${spec.n}` : spec.kind === "daily" ? `shadow-locks/daily/${spec.day}` : "");
      expect(box.spec).toEqual(spec);
      expect(box.mirrored).toBe(false);
      expect(OWNERS).toContain(box.owner);
      expect(LOOT).toContain(box.loot);
    }
    expect(new Set(built.map((b) => b.box.owner)).size).toBeGreaterThan(OWNERS.length / 2);
  });

  it("gives the same box twice for one spec", () => {
    for (const { spec, box } of built) expect(generateBox(spec)).toEqual(box);
  }, 600_000);

  it("gives each day its own box", () => {
    const days = built.filter((b) => b.spec.kind === "daily").map((b) => JSON.stringify(b.box.locks.map((l) => [l.shape, l.L])));
    expect(new Set(days).size).toBe(DAYS.length);
  });

  it("leaves lessons to the lesson data", () => {
    expect(() => generateBox({ kind: "lesson", id: "l1" })).toThrow();
  });

  it("reads a box's spec back from its seed key, and nothing else", () => {
    for (const spec of [{ kind: "box", n: 1 }, { kind: "box", n: 4321 }, { kind: "daily", day: "2026-11-06" }] as BoxSpec[]) {
      expect(specOfKey(seedKey(spec))).toEqual(spec);
    }
    for (const key of ["", "shadow-locks/0", "shadow-locks/-3", "shadow-locks/1.5", "shadow-locks/daily/2026-02-30", "box/3", "lesson/l1"]) {
      expect(specOfKey(key), key).toBeNull();
    }
  });
});

describe("the frame cost cap at work (a cap lower than FRAME_CORNER_CAP, so that it binds)", () => {
  const decoys = (b: Box) => b.elements.filter((e) => e.kind === "decoy").length;

  it("leaves decoys out to fit, at most DECOY_TRIM_MAX of them, and the box keeps every guarantee", () => {
    // Box 52, the heaviest from 10 to 60, under a cap 16 corners below its own: its scraps and rings fit, its 14
    // decoys do not all.
    const corners = boxFrame(generateBox({ kind: "box", n: 52 })).corners, cap = corners - 16;
    const { box } = buildBox({ kind: "box", n: 52 }, cap), P = boxParams(52);
    expect(boxFrame(box).corners).toBeLessThanOrEqual(cap);
    // And tight: no room left for one more decoy (a triangle's 3 corners), so a pre-count that overcounts the scraps or
    // rings, and so trims more than it needs to, fails here as an undercount fails above.
    expect(boxFrame(box).corners + 3).toBeGreaterThan(cap);
    expect(decoys(box)).toBeLessThan(P.decoys);
    expect(decoys(box)).toBeGreaterThanOrEqual(P.decoys - Math.floor(P.decoys * DECOY_TRIM_MAX));
    expect(checkBox(box)).toEqual([]);
  });

  it("draws a box again when even its fewest decoys would not fit, and the Daily Box keeps all of its decoys", () => {
    const tight = buildBox({ kind: "box", n: 52 }, 300);
    expect(tight.failures.cost, JSON.stringify(tight.failures)).toBeGreaterThan(0);
    expect(boxFrame(tight.box).corners).toBeLessThanOrEqual(300);
    expect(checkBox(tight.box)).toEqual([]);
    const day: BoxSpec = { kind: "daily", day: "2026-11-06" }, cap = boxFrame(generateBox(day)).corners - 1;
    const daily = buildBox(day, cap);
    expect(daily.failures.cost, JSON.stringify(daily.failures)).toBeGreaterThan(0);
    expect(boxFrame(daily.box).corners).toBeLessThanOrEqual(cap);
    expect(decoys(daily.box)).toBe(dailyParams().decoys);
    expect(checkBox(daily.box)).toEqual([]);
  });
});

describe("golden boxes", () => {
  // Saves keep a box by its spec and GENERATOR_VERSION, so one spec must keep giving one box. A change that alters any
  // box (RNG call order, a constant, a shape) must bump GENERATOR_VERSION and update these hashes.
  const GOLDEN: [BoxSpec, string][] = [
    [{ kind: "box", n: 1 }, "deeb47a2fbea952f"],
    [{ kind: "box", n: 7 }, "f0d30a933ef964aa"],
    [{ kind: "box", n: 15 }, "56ce7943ea10bee9"],
    [{ kind: "daily", day: "2026-11-06" }, "359de34c81698956"],
  ];

  it("pins boxes 1, 7, 15 and one day at generator version 4", () => {
    expect(GENERATOR_VERSION).toBe(4);
    expect(GOLDEN.map(([spec]) => [JSON.stringify(spec), sha(generateBox(spec))])).toEqual(
      GOLDEN.map(([spec, hash]) => [JSON.stringify(spec), hash]),
    );
  });

  it("pins every box it builds (boxes 1 to 200 and 30 days) to version 4 as it shipped", () => {
    expect(GENERATOR_VERSION).toBe(4);
    expect(Object.keys(V4_HASHES)).toHaveLength(SPECS.length);
    const changed = built.filter(({ box }) => sha(box) !== V4_HASHES[box.key]).map(({ box }) => box.key);
    expect(changed, "version 4 boxes that changed: a saved box would resume on another box (GENERATOR_VERSION 5)").toEqual([]);
  });
});

describe("generator version 3, for saves made before the box kinds", () => {
  it("keeps boxes 1 to 4 byte for byte as version 3 built them", () => {
    for (let n = 1; n <= 4; n++) expect(sha(generateBox({ kind: "box", n })), `box ${n}`).toBe(V3_HASHES[`shadow-locks/${n}`]);
  });

  it("still builds version 3's boxes exactly, for a box saved mid-play under it", () => {
    const specs: BoxSpec[] = [
      ...Array.from({ length: 40 }, (_, i): BoxSpec => ({ kind: "box", n: i + 1, gen: 3 })),
      ...[50, 77, 100, 150, 200].map((n): BoxSpec => ({ kind: "box", n, gen: 3 })),
      ...["2026-11-01", "2026-11-06", "2026-11-17", "2026-11-30"].map((day): BoxSpec => ({ kind: "daily", day, gen: 3 })),
    ];
    for (const spec of specs) {
      const box = generateBox(spec);
      expect(sha(box), box.key).toBe(V3_HASHES[box.key]);
      expect(box.spec).toEqual(spec);
      expect(genOf(box.spec)).toBe(3);
    }
    expect(BUILDABLE_VERSIONS).toEqual([3, 4]);
    expect(() => generateBox({ kind: "box", n: 12, gen: 2 })).toThrow();
  });

  it("rebuilds a save from its own version: a version 3 save as version 3's box, anything else as today's", () => {
    const box12: BoxSpec = { kind: "box", n: 12 };
    expect(specForSave(box12, { key: "shadow-locks/12", gen: 3 })).toEqual({ kind: "box", n: 12, gen: 3 });
    expect(specForSave(box12, { key: "shadow-locks/12", gen: 4 })).toEqual(box12);
    expect(specForSave(box12, { key: "shadow-locks/12", gen: 2 })).toEqual(box12);
    expect(specForSave(box12, { key: "shadow-locks/12" })).toEqual(box12);
    expect(specForSave(box12, { key: "shadow-locks/13", gen: 3 })).toEqual(box12);
    expect(specForSave(box12, null)).toEqual(box12);
    const day: BoxSpec = { kind: "daily", day: "2026-11-06" };
    expect(specForSave(day, { key: "shadow-locks/daily/2026-11-06", gen: 3 })).toEqual({ ...day, gen: 3 });
    expect(genOf(box12)).toBe(GENERATOR_VERSION);
  });
});

describe("box kinds and silhouettes", () => {
  it("changes boxes 5 to 9 only in their silhouette: the same settings, one silhouette on a hidden lock", () => {
    const changed: string[] = [];
    for (let n = 5; n <= 9; n++) {
      const now = generateBox({ kind: "box", n }), then = generateBox({ kind: "box", n, gen: 3 });
      expect(now.params).toEqual(then.params);
      expect(now.params).toEqual(boxParamsV3(n));
      const sil = (b: Box) => b.locks.filter((l) => SILHOUETTES.includes(l.shape));
      expect(sil(now)).toHaveLength(1);
      expect(sil(now)[0]!.hidden).toBe(true);
      if (sil(now)[0]!.shape !== sil(then)[0]!.shape) changed.push(`${n}: ${sil(then)[0]!.shape} -> ${sil(now)[0]!.shape}`);
      else expect(sha(now), `box ${n}, the same silhouette`).toBe(V3_HASHES[now.key]);
    }
    console.log(`boxes 5-9, silhouettes changed: ${changed.join("; ") || "none"}`);
  });

  it("builds each kind as it says: two hidden silhouettes, three finger locks, no rings, or one or two big locks", () => {
    for (const { spec, box } of built) {
      if (spec.kind !== "box" || spec.n < 10) continue;
      const kind = boxKind(spec.n), sil = box.locks.filter((l) => SILHOUETTES.includes(l.shape));
      if (kind === "silhouettes") {
        expect(box.locks.every((l) => l.hidden), box.key).toBe(true);
        expect(sil, box.key).toHaveLength(2);
      }
      if (kind === "fingers") expect(box.locks.every((l) => l.finger && l.rings), box.key).toBe(true);
      if (kind === "expert") expect(box.locks.some((l) => l.rings) || box.elements.some((e) => e.kind === "ring"), box.key).toBe(false);
      if (kind === "breather") {
        expect(box.locks.length, box.key).toBeLessThanOrEqual(2);
        expect(box.locks.every((l) => l.rings) && box.locks.some((l) => l.size >= 0.34), box.key).toBe(true);
        expect(sil, box.key).toHaveLength(1);
      }
    }
  });

  it("never shows a silhouette the boxes just before showed: any few dealt in a row differ", () => {
    // A box and the three before it deal at most six (two silhouettes boxes are never closer than two boxes), and any
    // REPEAT_GAP + 1 dealt in a row differ.
    expect(REPEAT_GAP + 1).toBeGreaterThanOrEqual(6);
    let prev: ShapeName[][] = [];
    for (let n = 1; n <= 3000; n++) {
      const now = boxSilhouettes({ kind: "box", n });
      expect(new Set(now).size).toBe(now.length);
      for (const p of prev.slice(-3)) for (const s of now) expect(p, `box ${n}`).not.toContain(s);
      prev = [...prev.slice(-9), now];
    }
  });

  it("deals every silhouette by box 60, the quickest to name first (the cat at box 5), each as often as the others", () => {
    const dealt = Array.from({ length: 56 }, (_, i) => boxSilhouettes({ kind: "box", n: 5 + i })).flat();
    expect(dealt.slice(0, 5)).toEqual(["Cat", "Fish", "House", "Rabbit", "Anchor"]);
    // The owl, whose tufted outline is the cat's, comes last in the first deck.
    expect(dealt.indexOf("Owl")).toBe(SILHOUETTES.length - 1);
    expect([...new Set(dealt)].sort()).toEqual([...SILHOUETTES].sort());
    const counts = new Map<ShapeName, number>();
    for (let n = 5; n <= 2000; n++) for (const s of boxSilhouettes({ kind: "box", n })) counts.set(s, (counts.get(s) ?? 0) + 1);
    const c = [...counts.values()];
    expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(3);
    expect(FIRST_SILHOUETTES.every((s) => counts.has(s))).toBe(true);
  });

  it("deals a Daily Box a silhouette for a day before 1970 too, and builds it", () => {
    // Days before 1970-01-01 count back from it: the deck's index wraps the right way round.
    for (const day of ["1969-12-31", "1900-01-01"]) {
      const [shape] = boxSilhouettes({ kind: "daily", day });
      expect(SILHOUETTES, day).toContain(shape);
    }
    const box = generateBox({ kind: "daily", day: "1900-01-01" });
    expect(box.locks.filter((l) => SILHOUETTES.includes(l.shape)).map((l) => l.shape)).toEqual(boxSilhouettes({ kind: "daily", day: "1900-01-01" }));
  });

  it("keeps the Daily Box's difficulty (box 7's settings) and deals it a new silhouette each day", () => {
    const days = built.filter((b) => b.spec.kind === "daily");
    for (const { box } of days) expect(box.params).toEqual(dailyParams());
    expect(dailyParams()).toEqual(boxParams(7));
    const sil = days.map(({ box }) => box.locks.find((l) => SILHOUETTES.includes(l.shape))!.shape);
    for (let i = 1; i < sil.length; i++) expect(sil[i], DAYS[i]).not.toBe(sil[i - 1]);
    expect(sil.some((s) => !FIRST_SILHOUETTES.includes(s))).toBe(true);
  });

  it("keeps every box from 10 and every Daily Box within the frame cost cap, at most 10% over box 15's frame", () => {
    // frame-cost.ts: a frame's mean JS at 4x grows FRAME_MS.corner a shadow corner. A box at the cap costs at most a
    // tenth more than box 15, the box the frame budgets are timed on.
    const box15 = boxFrame(built.find((b) => b.spec.kind === "box" && b.spec.n === 15)!.box);
    expect(FRAME_MS.base + FRAME_MS.corner * FRAME_CORNER_CAP).toBeLessThanOrEqual(1.1 * box15.ms);
    const late = built.filter((b) => b.spec.kind === "daily" || (b.spec.kind === "box" && b.spec.n >= 10)), over: string[] = [];
    let most = 0;
    for (const { box } of late) {
      const f = boxFrame(box);
      most = Math.max(most, f.corners);
      if (f.corners > FRAME_CORNER_CAP) over.push(`${box.key}: ${f.corners}`);
    }
    console.log(`frame cost: box 15 ${box15.corners} corners (${box15.ms.toFixed(3)} ms at 4x), the most from box 10 ${most} (cap ${FRAME_CORNER_CAP})`);
    expect(over).toEqual([]);
  });

  it("takes about as long to build boxes 10 to 40 as version 3 did", () => {
    const time = (gen: number | undefined) => {
      const ms: number[] = [];
      for (let n = 10; n <= 40; n++) {
        const t0 = performance.now();
        buildBox(gen === undefined ? { kind: "box", n } : { kind: "box", n, gen });
        ms.push(performance.now() - t0);
      }
      return { avg: ms.reduce((s, v) => s + v, 0) / ms.length, worst: Math.max(...ms) };
    };
    time(undefined);
    const v3 = time(3), v4 = time(undefined);
    console.log(`boxes 10-40: version 3 avg ${v3.avg.toFixed(1)} ms, worst ${v3.worst.toFixed(1)}; version 4 avg ${v4.avg.toFixed(1)} ms, worst ${v4.worst.toFixed(1)}`);
    expect(v4.avg).toBeLessThan(1.5 * v3.avg + 10);
    expect(v4.worst).toBeLessThan(1000);
  }, 60_000);
});
