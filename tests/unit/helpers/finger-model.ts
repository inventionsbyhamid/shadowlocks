// A finger laid along a finger lock's gap, as tests/e2e/finger-strips.spec.ts and perf-budget.spec.ts lay IWER's
// index finger: its last two bones (intermediate joint to tip) in a straight line along the gap's long axis, their
// middle on the ray from the lantern spot through the gap's middle at FINGER_Z from the panel. Only those two bones
// count for the solve rule (src/render/hand-shadow.ts), so their two capsules, cast from the spot with the game's own
// outline, are the whole of what the rule sees of the hand. Lets a unit test judge every finger lock of thousands of
// boxes as the browser would one at a time.
import type { Box, Lock, V2, V3 } from "../../../src/core/types";
import { type Coverage, measure, prepareLock, shadowPolys, SKIP_MISSING } from "../../../src/core/solve";
import { capsuleOutline, FINGER_RADIUS_CM, OUTLINE_CORNERS } from "../../../src/render/hand-shadow";

/** How far from the panel the finger is laid (box units), as the e2e specs lay it. */
export const FINGER_Z = 0.5;
/** The box the e2e specs play: 24 cm. */
export const BOX_CM = 24;
/** The index finger's last two bones, intermediate joint to tip (cm), and the distal joint's place from their middle. */
export const CHAIN_CM = 4.6;
export const DISTAL_CM = 0.1;
/**
 * How far under the rule's spill limit a modelled finger must stay so IWER's real one does too. Against 20 locks
 * measured in the browser (finger-strips.spec.ts), the model with a 4.6 cm chain was within 0.029 of the spill
 * measured, rms 0.011; 4.0 and 5.2 cm fitted worse (rms 0.032 and 0.021).
 */
export const FINGER_MODEL_MARGIN = 0.03;

/** The gap's middle (mean of its corners) and long axis (radians), as the e2e helper axisOf reads them. */
export function axisOf(poly: V2[]): { mid: V2; angle: number } {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p[0] / poly.length;
    y += p[1] / poly.length;
  }
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of poly) {
    const dx = p[0] - x, dy = p[1] - y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return { mid: [x, y], angle: 0.5 * Math.atan2(2 * sxy, sxx - syy) };
}

/** The finger's two outlines on the panel with the lantern at the lock's spot. */
export function laidFinger(lock: Lock, o: { chainCm?: number; z?: number; boxCm?: number } = {}): V2[][] {
  const chain = o.chainCm ?? CHAIN_CM, z = o.z ?? FINGER_Z, cm = o.boxCm ?? BOX_CM, L = lock.L;
  const { mid, angle } = axisOf(lock.target[lock.missing]!);
  const k0 = (L[2] - z) / L[2];
  const m: V3 = [L[0] + (mid[0] - L[0]) * k0, L[1] + (mid[1] - L[1]) * k0, z];
  const u: V2 = [Math.cos(angle), Math.sin(angle)];
  const at = (cmAlong: number): V2 => [m[0] + (u[0] * cmAlong) / cm, m[1] + (u[1] * cmAlong) / cm];
  const joints = [at(-chain / 2), at(DISTAL_CM), at(chain / 2)];
  const k = L[2] / (L[2] - z), r = (FINGER_RADIUS_CM / cm) * k;
  const cast = (p: V2): [number, number] => [L[0] + (p[0] - L[0]) * k, L[1] + (p[1] - L[1]) * k];
  return [0, 1].map((i) => {
    const a = cast(joints[i]!), b = cast(joints[i + 1]!);
    const out = Array.from({ length: OUTLINE_CORNERS }, (): V2 => [0, 0]);
    capsuleOutline(Float64Array.from([a[0], a[1], r, b[0], b[1], r]), out);
    return out;
  });
}

/** The lock's coverage from its spot with the finger laid in its gap: what the game's rule judges. */
export function fingerCoverage(box: Box, lock: Lock, o?: Parameters<typeof laidFinger>[1]): Coverage {
  const scraps: V2[][] = [], n = shadowPolys(box.elements, lock.L, scraps, SKIP_MISSING);
  const finger = laidFinger(lock, o);
  return measure(prepareLock(lock), scraps, n, finger, finger.length, { cover: 0, spill: 0, spillAll: 0, gap: 0 });
}
