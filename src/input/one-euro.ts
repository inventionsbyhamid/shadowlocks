import type { Vec3 } from "../core/types";
import { ONE_EURO } from "./constants";

export interface OneEuroParams {
  /** Cutoff (Hz) when still: lower is smoother. */
  minCutoff: number;
  /** How fast the cutoff opens with speed (per unit/s of the filtered value). */
  beta: number;
  /** Cutoff (Hz) for the speed estimate. */
  dCutoff: number;
}

/** Smoothing factor of a first-order low-pass at `cutoffHz` over `dtS` seconds. */
function alpha(cutoffHz: number, dtS: number): number {
  const r = 2 * Math.PI * cutoffHz * dtS;
  return r / (r + 1);
}

/**
 * The One Euro filter (Casiez et al.): a low-pass whose cutoff rises with speed, so a still hand is
 * steady and a moving hand has little lag. One scalar; no allocation.
 */
export class OneEuroFilter {
  private x = 0;
  private dx = 0;
  private t = 0;
  private primed = false;

  constructor(private readonly p: OneEuroParams = ONE_EURO) {}

  /** Forget the history; the next sample passes straight through. */
  reset(): void {
    this.primed = false;
    this.dx = 0;
  }

  /** Start from `value` at `timeMs` (the next samples are filtered against it). */
  prime(value: number, timeMs: number): void {
    this.x = value;
    this.dx = 0;
    this.t = timeMs;
    this.primed = true;
  }

  filter(value: number, timeMs: number): number {
    if (!this.primed) {
      this.prime(value, timeMs);
      return value;
    }
    const dt = (timeMs - this.t) / 1000;
    if (!(dt > 0)) return this.x; // same frame, or the clock went back
    this.t = timeMs;
    this.dx += alpha(this.p.dCutoff, dt) * ((value - this.x) / dt - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

const MM = 1000;

/**
 * One Euro on a position in metres, filtered as millimetres (see ONE_EURO). Writes into `out`;
 * no allocation after construction.
 */
export class OneEuroVec3 {
  private readonly f: [OneEuroFilter, OneEuroFilter, OneEuroFilter];

  constructor(p: OneEuroParams = ONE_EURO) {
    this.f = [new OneEuroFilter(p), new OneEuroFilter(p), new OneEuroFilter(p)];
  }

  /** Jump to `v` (start of a grab): no lag from where it was before. */
  reset(v: Readonly<Vec3>, timeMs: number): void {
    for (let i = 0; i < 3; i++) this.f[i]!.prime(v[i]! * MM, timeMs);
  }

  filter(v: Readonly<Vec3>, timeMs: number, out: Vec3): Vec3 {
    out[0] = this.f[0].filter(v[0] * MM, timeMs) / MM;
    out[1] = this.f[1].filter(v[1] * MM, timeMs) / MM;
    out[2] = this.f[2].filter(v[2] * MM, timeMs) / MM;
    return out;
  }
}
