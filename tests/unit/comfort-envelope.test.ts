// The comfort envelope for every box the generator can make, not just the ones the e2e samples: every
// point of the spot region ENVELOPE allows (a grid with its corners) and the start, both hands, placed
// in world space by placeBox at every box size, must keep the seated comfort rules.
import { describe, expect, it } from "vitest";
import { Vector3 } from "@iwsdk/core";
import { ENVELOPE } from "../../src/core/envelope";
import type { V3, Vec3 } from "../../src/core/types";
import { boxToWorld, placeBox, TILT_DEG } from "../../src/render/placement";
import { broken, comfortOf, Worst } from "./helpers/comfort";

const E = ENVELOPE;
/** Steps per axis (13 values each, both ends included, x = 0 among them). */
const STEPS = 12;
const SIZES_CM = [18, 20, 22, 24, 26, 28, 30];
/** Two seated heads: straight ahead, and somewhere else facing another way (the rules must not depend on it). */
const HEADS = [
  { pos: new Vector3(0, 1.2, 0), yaw: 0 },
  { pos: new Vector3(0.4, 1.05, -2), yaw: 2.3 },
];

/** Every spot the envelope allows on the grid, plus the start for a right and a left hand. */
function envelopePoints(): { p: V3; name: string }[] {
  const out: { p: V3; name: string }[] = [];
  const lerp = (a: number, b: number, k: number) => a + ((b - a) * k) / STEPS;
  for (let i = 0; i <= STEPS; i++) {
    for (let j = 0; j <= STEPS; j++) {
      for (let k = 0; k <= STEPS; k++) {
        const p: V3 = [lerp(-E.LX_MAX, E.LX_MAX, i), lerp(E.LY[0], E.LY[1], j), lerp(E.LZ[0], E.LZ[1], k)];
        out.push({ p, name: `spot (${p.map((v) => v.toFixed(3)).join(", ")})` });
      }
    }
  }
  out.push({ p: [E.START[0], E.START[1], E.START[2]], name: "start (right hand)" });
  out.push({ p: [-E.START[0], E.START[1], E.START[2]], name: "start (left hand)" });
  return out;
}

function sweep(cm: number, head: (typeof HEADS)[number], tiltDeg: number) {
  const m = placeBox(head, cm, tiltDeg);
  const at = new Vector3();
  const v = (x: Vector3): Vec3 => [x.x, x.y, x.z];
  const eye = v(head.pos), panel = v(boxToWorld(m, [0, 0, 0], at));
  const worst = new Worst(), errors: string[] = [];
  for (const { p, name } of envelopePoints()) {
    const c = comfortOf(eye, head.yaw, panel, v(boxToWorld(m, p, at)));
    worst.add(c);
    errors.push(...broken(c, `${cm} cm ${name}`));
  }
  return { worst, errors };
}

describe("comfort envelope", () => {
  it("covers the spot region's corners and middle", () => {
    const pts = envelopePoints().map((x) => x.p);
    expect(pts).toHaveLength((STEPS + 1) ** 3 + 2);
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-12;
    for (const x of [-E.LX_MAX, 0, E.LX_MAX]) {
      for (const y of E.LY) for (const z of E.LZ) expect(pts.some((p) => near(p[0], x) && near(p[1], y) && near(p[2], z))).toBe(true);
    }
  });

  it("keeps every spot and the start comfortable at every box size, from any seated head", () => {
    const lines: string[] = [];
    const errors: string[] = [];
    for (const cm of SIZES_CM) {
      for (const [h, head] of HEADS.entries()) {
        const r = sweep(cm, head, TILT_DEG);
        errors.push(...r.errors);
        if (h === 0) lines.push(`${cm} cm: ${r.worst.line()}`);
      }
    }
    console.log(`comfort envelope, tilt ${TILT_DEG} deg, LY ${E.LY.join("..")}:\n${lines.join("\n")}`);
    expect(errors.slice(0, 10), `${errors.length} comfort failures`).toEqual([]);
  });

  it("binds where the spike said: the highest far spot at 30 cm, the highest near spot at 18 cm", () => {
    const head = HEADS[0]!;
    const eyeOf = (cm: number, p: V3) => {
      const m = placeBox(head, cm), at = new Vector3();
      const w = boxToWorld(m, p, at), panel = boxToWorld(m, [0, 0, 0], new Vector3());
      return comfortOf([0, 1.2, 0], 0, [panel.x, panel.y, panel.z], [w.x, w.y, w.z]);
    };
    const far = eyeOf(30, [0, E.LY[1], E.LZ[1]]), near = eyeOf(18, [0, E.LY[1], E.LZ[0]]);
    console.log(`30 cm (0, ${E.LY[1]}, ${E.LZ[1]}): ${(far.belowEyes * 100).toFixed(2)} cm below the eyes; ` +
      `18 cm (0, ${E.LY[1]}, ${E.LZ[0]}): ${near.offSight.toFixed(2)} deg off the sight line`);
    expect(far.belowEyes).toBeGreaterThanOrEqual(0.25);
    expect(far.belowEyes).toBeLessThan(0.26);
    expect(near.offSight).toBeGreaterThanOrEqual(12);
    expect(near.offSight).toBeLessThan(13);
  });

  it("fails the plan's 20 degree tilt (the sweep can tell)", () => {
    const r = sweep(24, HEADS[0]!, 20);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.worst.belowEyes).toBeLessThan(0.25);
  });
});
