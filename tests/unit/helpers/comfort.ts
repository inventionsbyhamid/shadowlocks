// The seated comfort rules (global constraints: the airplane-seat test), shared by the envelope sweep
// (tests/unit/comfort-envelope.test.ts) and the in-app check (tests/e2e/comfort.spec.ts). World metres.
import type { Vec3 } from "../../../src/core/types";

/** A lantern spot sits at sternum height or lower, near the chest, clear of the face and off the line of sight. */
export const RULE = { belowEyesMin: 0.25, chestMax: 0.6, eyesMin: 0.15, offSightMinDeg: 12 } as const;
/** A seated player's chest: 30 cm below the eyes and 10 cm in front of them. */
export const CHEST = { below: 0.3, forward: 0.1 } as const;

export interface Comfort {
  /** How far below the eyes (m). */
  belowEyes: number;
  /** Distance from the chest (m). */
  chest: number;
  /** Distance from the eyes (m). */
  eyes: number;
  /** Angle off the line from the eyes to the panel centre (degrees). */
  offSight: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** How lantern point `p` sits for eyes at `eye` facing heading `yaw` (0 looks down -Z) with the panel centre at `panel`. */
export function comfortOf(eye: Vec3, yaw: number, panel: Vec3, p: Vec3): Comfort {
  const chest: Vec3 = [eye[0] - Math.sin(yaw) * CHEST.forward, eye[1] - CHEST.below, eye[2] - Math.cos(yaw) * CHEST.forward];
  const a = sub(p, eye), b = sub(panel, eye);
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b));
  return {
    belowEyes: eye[1] - p[1],
    chest: len(sub(p, chest)),
    eyes: len(a),
    offSight: (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI,
  };
}

/** The rules a point breaks, as readable lines. */
export function broken(c: Comfort, tag: string): string[] {
  const out: string[] = [];
  if (c.belowEyes < RULE.belowEyesMin) out.push(`${tag}: only ${(c.belowEyes * 100).toFixed(1)} cm below the eyes`);
  if (c.chest > RULE.chestMax) out.push(`${tag}: ${(c.chest * 100).toFixed(1)} cm from the chest`);
  if (c.eyes < RULE.eyesMin) out.push(`${tag}: ${(c.eyes * 100).toFixed(1)} cm from the eyes`);
  if (c.offSight < RULE.offSightMinDeg) out.push(`${tag}: ${c.offSight.toFixed(2)} deg off the line of sight`);
  return out;
}

/** The worst of each measure over many points. */
export class Worst {
  belowEyes = Infinity;
  chest = 0;
  eyes = Infinity;
  offSight = Infinity;
  add(c: Comfort): void {
    this.belowEyes = Math.min(this.belowEyes, c.belowEyes);
    this.chest = Math.max(this.chest, c.chest);
    this.eyes = Math.min(this.eyes, c.eyes);
    this.offSight = Math.min(this.offSight, c.offSight);
  }
  /** One line: each worst value and its margin to the rule. */
  line(): string {
    const cm = (m: number) => (m * 100).toFixed(1);
    return (
      `below eyes ${cm(this.belowEyes)} cm (margin ${cm(this.belowEyes - RULE.belowEyesMin)}); ` +
      `from chest ${cm(this.chest)} cm (margin ${cm(RULE.chestMax - this.chest)}); ` +
      `from eyes ${cm(this.eyes)} cm (margin ${cm(this.eyes - RULE.eyesMin)}); ` +
      `off sight ${this.offSight.toFixed(2)} deg (margin ${(this.offSight - RULE.offSightMinDeg).toFixed(2)})`
    );
  }
}
