// The lessons' ghost hand at work in the staged examples, placed each frame as the lesson view places it (the box in
// the lap of the e2e's and the slice video's seated head, tests/e2e/helpers/boot.ts SEATED):
//   - it never hides what an example teaches: from that head, no sight line to the twin's lock outline or to its
//     scraps' shadows on the panel passes through a capsule of the ghost hand while the hand shows;
//   - it holds the ghost lantern by its grip, between thumb and index;
//   - it never passes through the glass;
//   - lesson 2's ghost finger still teaches the finger moment: its own (slim) shadow fills the twin's missing prong.
import { type InstancedBufferAttribute, type Matrix4, Vector3 } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { gripOf } from "../../src/app/lesson-scripts";
import { type LessonFrame, type LessonInputs, LessonsDirector } from "../../src/app/lessons-director";
import { inPoly } from "../../src/core/geom";
import { type LessonId, lessonPlan } from "../../src/core/lessons-data";
import { lockSamples, RULE, RUNTIME_STEP } from "../../src/core/solve";
import type { Element, V2, V3 } from "../../src/core/types";
import { HAND_JOINTS, type HandJoints, type HandSide, JOINT_COUNT } from "../../src/input/hand-joints";
import { FOREARM, GHOST_BONES, GHOST_SHADOW_BONES, ghostRadius, GhostHand } from "../../src/render/ghost-hand";
import { HandShadow } from "../../src/render/hand-shadow";
import { boxToWorld, placeBox, worldToBox } from "../../src/render/placement";

/** The seated head of the e2e tests and the slice video (SEATED.position), looking down -z. */
const HEAD = new Vector3(0, 1.2, -1.38);
const J = (name: XRHandJoint) => HAND_JOINTS.indexOf(name);

class Idle implements LessonInputs {
  held = () => false;
  active = () => false;
  isOpen = () => false;
  aligned = () => false;
  warmth = () => 0;
  inBeam = () => false;
  rewardUp = () => false;
  stuck = () => false;
  suggestion = () => null;
  hand = () => false;
  settled = () => false;
  drawerPulled = () => false;
  reducedMotion = () => false;
  lantern = (out: V3): V3 => {
    out[0] = 0.35;
    out[1] = -0.3;
    out[2] = 1.35;
    return out;
  };
}

/**
 * Plays a lesson's example (its demo step) to its end with the box `sizeCm` across in the seated head's lap, placing
 * a real GhostHand each frame the hand shows (at opacity `minOpacity` or more) as the view does; `each` sees it.
 * Returns how many frames it saw.
 */
function play(
  id: LessonId,
  step: number,
  left: boolean,
  sizeCm: number,
  each: (f: LessonFrame, g: GhostHand, m: Matrix4, t: number) => void,
  minOpacity = 0.3,
): number {
  const d = new LessonsDirector({ inputs: new Idle(), leftHanded: () => left });
  d.start(id, step);
  const m = placeBox({ pos: HEAD.clone(), yaw: 0 }, sizeCm);
  const g = new GhostHand(left ? "left" : "right");
  const at = new Vector3(), fv = new Vector3(), pv = new Vector3();
  let t = 0, frames = 0;
  while (d.step === step && t < 60_000) {
    t += 16;
    d.update(t);
    const f = d.frame, h = f.hand;
    if (h.opacity < minOpacity) continue;
    frames++;
    g.side = h.side;
    g.setPose(h.poseA, h.poseB, h.poseT);
    boxToWorld(m, h.at, at);
    fv.set(h.fingers[0], h.fingers[1], h.fingers[2]).transformDirection(m);
    pv.set(h.palm[0], h.palm[1], h.palm[2]).transformDirection(m);
    g.place(h.anchor, at, fv, pv);
    each(f, g, m, t);
  }
  return frames;
}

interface Capsule {
  a: Vector3;
  b: Vector3;
  ra: number;
  rb: number;
}

/** The hand's capsules in the world as drawn (a flattened one counts at its widest). */
function capsules(g: GhostHand): Capsule[] {
  const geo = g.mesh.geometry;
  const A = geo.getAttribute("iA") as InstancedBufferAttribute, B = geo.getAttribute("iB") as InstancedBufferAttribute;
  const R = geo.getAttribute("iR") as InstancedBufferAttribute;
  return GHOST_BONES.map((_, i) => ({
    a: new Vector3(A.getX(i), A.getY(i), A.getZ(i)),
    b: new Vector3(B.getX(i), B.getY(i), B.getZ(i)),
    ra: R.getX(i),
    rb: R.getY(i),
  }));
}

/** Closest approach of segments p0-p1 and q0-q1: the distance and the parameter along q. */
function segSeg(p0: Vector3, p1: Vector3, q0: Vector3, q1: Vector3): { d: number; t: number } {
  const d1 = p1.clone().sub(p0), d2 = q1.clone().sub(q0), r = p0.clone().sub(q0);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (e < 1e-12) {
    s = Math.min(1, Math.max(0, -d1.dot(r) / a));
  } else {
    const c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
    s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
    t = (b * s + f) / e;
    if (t < 0) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else if (t > 1) {
      t = 1;
      s = Math.min(1, Math.max(0, (b - c) / a));
    }
  }
  const cp = p0.clone().addScaledVector(d1, s), cq = q0.clone().addScaledVector(d2, t);
  return { d: cp.distanceTo(cq), t };
}

/** Points along a closed polygon's edges, about `step` apart (box units, on the panel). */
function along(poly: readonly V2[], step: number, out: V2[]): void {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!, n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
}

/** The shadow on the panel of the point p from the light L. */
const cast = (p: Readonly<V3>, L: Readonly<V3>): V2 => {
  const k = L[2] / (L[2] - p[2]);
  return [L[0] + (p[0] - L[0]) * k, L[1] + (p[1] - L[1]) * k];
};

/** What an example teaches on the panel with its ghost lantern at L: the lock outline and its scraps' shadows. */
function teaching(target: readonly V2[][], elements: readonly Element[], L: Readonly<V3>): V2[] {
  const out: V2[] = [];
  for (const poly of target) along(poly, 0.02, out);
  for (const e of elements) {
    if (e.kind === "piece" && !e.missing) along(e.verts.map((v) => cast(v, L)), 0.02, out);
    if (e.kind === "ring") {
      const c = cast(e.c, L), r = (e.rOut * L[2]) / (L[2] - e.c[2]);
      for (let k = 0; k < 24; k++) out.push([c[0] + r * Math.cos((k / 24) * Math.PI * 2), c[1] + r * Math.sin((k / 24) * Math.PI * 2)]);
    }
  }
  return out;
}

const EXAMPLES: { name: string; id: LessonId; step: number; lock: number; lantern: boolean }[] = [
  { name: "Example 1 (near and far)", id: "l1", step: 2, lock: 1, lantern: true },
  { name: "Example 2 (the rings)", id: "l1", step: 4, lock: 2, lantern: true },
  { name: "Example 3 (the finger)", id: "l2", step: 1, lock: 0, lantern: false },
];
const SIDES = [false, true];

describe("the ghost hand at work", () => {
  for (const ex of EXAMPLES) {
    it(`never hides the lock outline or the scraps' shadows from the seated head: ${ex.name} (18, 24 and 30 cm boxes, both hands)`, () => {
      const report: string[] = [];
      let worst = 0, clear = Infinity;
      for (const sizeCm of [18, 24, 30]) {
        for (const left of SIDES) {
          const twin = lessonPlan(ex.id, left).twins[ex.lock]!, w = new Vector3();
          let most = 0, where = "";
          const frames = play(ex.id, ex.step, left, sizeCm, (f, g, m, t) => {
            if (!f.ghostLight) return;
            const caps = capsules(g);
            let hidden = 0, which = "";
            for (const p of teaching(twin.lock.target, twin.elements, f.lamp.at)) {
              boxToWorld(m, [p[0], p[1], 0], w);
              for (let i = 0; i < caps.length; i++) {
                const c = caps[i]!, { d, t: u } = segSeg(HEAD, w, c.a, c.b), r = c.ra + (c.rb - c.ra) * u;
                clear = Math.min(clear, d - r);
                if (d < r) {
                  hidden++;
                  which = `bone ${i} (${GHOST_BONES[i]!.a}-${GHOST_BONES[i]!.b}) over ${p.map((v) => v.toFixed(2))}`;
                  break;
                }
              }
            }
            if (hidden > most) {
              const wrist: V3 = [0, 0, 0];
              worldToBox(m, g.joint(0, new Vector3()), wrist);
              most = hidden;
              where = `${hidden} hidden at ${t} ms, ${which}, wrist at ${wrist.map((v) => v.toFixed(2))}`;
            }
          });
          expect(frames, `${sizeCm} cm`).toBeGreaterThan(100);
          worst = Math.max(worst, most);
          if (most) report.push(`${sizeCm} cm ${left ? "left" : "right"}: ${where}`);
        }
      }
      console.log(`${ex.name}: the nearest sight line to the panel passes ${(clear * 1000).toFixed(1)} mm from the hand`);
      expect(worst, report.join("\n")).toBe(0);
    }, 60_000);
  }

  it("holds the ghost lantern by its grip, the lantern between thumb and index, whenever it holds it", () => {
    for (const ex of EXAMPLES.filter((e) => e.lantern)) {
      for (const sizeCm of [18, 24]) {
        for (const left of SIDES) {
          let held = 0;
          const grip = new Vector3();
          play(ex.id, ex.step, left, sizeCm, (f, g, m) => {
            const h = f.hand;
            if (h.poseA !== "hold" || h.poseB !== "hold" || f.lamp.opacity < 0.5) return;
            held++;
            boxToWorld(m, gripOf(f.lamp.at), grip);
            // On the loop: within a fingertip's radius and the loop's (1.6% of the box) of its middle.
            const reach = ghostRadius(J("index-finger-tip")) + 0.016 * (sizeCm / 100);
            for (const tip of ["thumb-tip", "index-finger-tip"] as const) {
              expect(g.joint(J(tip), new Vector3()).distanceTo(grip), `${ex.name} ${sizeCm} cm ${tip}`).toBeLessThan(reach);
            }
          });
          expect(held, `${ex.name} ${sizeCm} cm`).toBeGreaterThan(200);
        }
      }
    }
  });

  it("never passes through the glass: every joint inside the box mouth is within the box (18 and 24 cm, both hands)", () => {
    for (const ex of EXAMPLES) {
      for (const sizeCm of [18, 24]) {
        for (const left of SIDES) {
          let worst = 0, where = "";
          const p = new Vector3(), b: V3 = [0, 0, 0];
          play(
            ex.id,
            ex.step,
            left,
            sizeCm,
            (f, g, m, t) => {
              for (let j = 0; j < JOINT_COUNT; j++) {
                worldToBox(m, g.joint(j, p), b);
                if (b[2] >= 1) continue;
                const out = Math.max(Math.abs(b[0]) - 0.5, Math.abs(b[1]) - 0.5, -b[2]);
                if (out > worst) [worst, where] = [out, `joint ${j} at ${b.map((v) => v.toFixed(2))} (${t} ms)`];
              }
            },
            0.01,
          );
          expect(worst, `${ex.name}, ${sizeCm} cm, ${left ? "left" : "right"}-handed: ${where}`).toBeLessThanOrEqual(0);
        }
      }
    }
    // The forearm fades out behind the wrist, never into the box.
    expect(GHOST_BONES.filter((x) => x.b === FOREARM).every((x) => x.a === J("wrist"))).toBe(true);
  });

  it("casts the ghost finger's own slim shadow over the twin's missing prong while it holds (lesson 2, 18 to 30 cm)", () => {
    const shadow = new HandShadow(GHOST_SHADOW_BONES);
    const out: V2[][] = Array.from({ length: shadow.maxOutlines }, () => []), finger: V2[][] = [];
    for (const sizeCm of [18, 24, 30]) {
      for (const left of SIDES) {
        const twin = lessonPlan("l2", left).twins[0]!.lock;
        const s = lockSamples(twin.target, RUNTIME_STEP, twin.missing), gap = s.missingIdx.map((i) => s.inside[i]!);
        let least = 1, held = 0;
        play("l2", 1, left, sizeCm, (f, g, m) => {
          if (f.fill <= 0 || f.fill >= 1) return;
          held++;
          const joints = { positions: (side: HandSide) => (side === g.side ? g.world : null) } as unknown as HandJoints;
          const r = shadow.update(joints, null, m, f.lamp.at, out, finger);
          let filled = 0;
          for (const p of gap) if (finger.slice(0, r.nFinger).some((poly) => inPoly(p, poly))) filled++;
          least = Math.min(least, filled / gap.length);
        });
        expect(held, `${sizeCm} cm`).toBeGreaterThan(10);
        expect(least, `${sizeCm} cm, ${left ? "left" : "right"}-handed`).toBeGreaterThanOrEqual(RULE.GAP_MIN);
      }
    }
  });
});
