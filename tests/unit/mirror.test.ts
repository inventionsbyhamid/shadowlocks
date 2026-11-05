import { beforeAll, describe, expect, it } from "vitest";
import { ENVELOPE } from "../../src/core/envelope";
import { generateBox } from "../../src/core/generator";
import { mirrorBox } from "../../src/core/mirror";
import type { Box, BoxSpec, V2, V3 } from "../../src/core/types";
import { checkBox, fingerAngles, nearHorizontal } from "./helpers/box-checks";

const SPECS: BoxSpec[] = [
  ...Array.from({ length: 200 }, (_, i): BoxSpec => ({ kind: "box", n: i + 1 })),
  ...Array.from({ length: 30 }, (_, i): BoxSpec => ({ kind: "daily", day: `2026-11-${String(i + 1).padStart(2, "0")}` })),
];
const pairs: { box: Box; m: Box }[] = [];

beforeAll(() => {
  for (const spec of SPECS) {
    const box = generateBox(spec);
    pairs.push({ box, m: mirrorBox(box) });
  }
}, 600_000);

const flip2 = (p: V2): V2 => [-p[0], p[1]];
const flip3 = (p: V3): V3 => [-p[0], p[1], p[2]];

describe("mirrorBox", () => {
  it("mirrored boxes keep every guarantee", () => {
    const errs = pairs.flatMap(({ m }) => checkBox(m).map((e) => `${m.key} (mirrored): ${e}`));
    expect(errs).toEqual([]);
    const angles = pairs.flatMap(({ m }) => fingerAngles(m));
    expect(angles.filter(nearHorizontal).length / angles.length).toBeGreaterThanOrEqual(0.9);
  });

  it("starts the lantern on the left", () => {
    for (const { m } of pairs) expect(m.start).toEqual([-ENVELOPE.START[0], ENVELOPE.START[1], ENVELOPE.START[2]]);
    expect(pairs[0]!.m.start[0]).toBeCloseTo(-0.35, 12);
  });

  it("negates every x and nothing else", () => {
    for (const { box, m } of pairs) {
      expect(m.mirrored).toBe(true);
      expect([m.key, m.spec, m.params, m.owner, m.loot]).toEqual([box.key, box.spec, box.params, box.owner, box.loot]);
      expect(m.elements).toEqual(
        box.elements.map((e) =>
          e.kind === "ring" ? { ...e, c: flip3(e.c), nrm: flip3(e.nrm) } : { ...e, verts: e.verts.map(flip3) },
        ),
      );
      expect(m.locks).toEqual(
        box.locks.map((l) => ({
          ...l,
          center: flip2(l.center),
          rot: -l.rot,
          target: l.target.map((p) => p.map(flip2)),
          L: flip3(l.L),
          fingerAngle: -l.fingerAngle,
          mark: l.mark && flip2(l.mark),
        })),
      );
    }
  });

  it("leaves the original box alone, and mirroring twice gives it back", () => {
    const box = generateBox({ kind: "box", n: 12 });
    const copy = structuredClone(box);
    const m = mirrorBox(box);
    expect(box).toEqual(copy);
    expect(mirrorBox(m)).toEqual(box);
  });
});
