// The headset (camera) path of a shot, as a function of shot time. Pure math, no browser: the
// recorder asks for the pose of each frame and puts the emulated headset there before stepping.
//
// IWER's own `animate_to` (with minimum-jerk easing) holds IWER's single command queue while it
// runs, so a head move would stop every hand gesture until it ends. The track applies the same
// minimum-jerk curve itself, one frame at a time, so the head and the hands move together.

export type V3 = readonly [number, number, number];
export type Quat = [number, number, number, number];

/** Where the eyes are and the point they look at (no roll, like a seated player). */
export interface View {
  from: V3;
  at: V3;
}

export type Ease = "linear" | "minimum-jerk";

/** IWER's minimum-jerk profile: zero speed and acceleration at both ends. */
export function minimumJerk(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * x * (10 + x * (-15 + 6 * x));
}

export const EASE: Record<Ease, (t: number) => number> = {
  linear: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t),
  "minimum-jerk": minimumJerk,
};

/**
 * A person's head is never perfectly still. `mm` and `deg` set the size of a slow, smooth drift
 * (sums of slow sines, a few seconds per cycle; never a shake). Zero turns it off.
 */
export interface Sway {
  mm: number;
  deg: number;
}

const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Yaw then pitch, no roll; the same convention as the e2e helpers' `setHeadset`. */
export function yawPitch(v: View): { yaw: number; pitch: number } {
  const dx = v.at[0] - v.from[0];
  const dy = v.at[1] - v.from[1];
  const dz = v.at[2] - v.from[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

export function quatFromYawPitch(yaw: number, pitch: number): Quat {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

interface Move {
  t0: number;
  t1: number;
  from: View;
  to: View;
  ease: Ease;
}

/** Slow drift: two incommensurate sines per axis, so it never visibly repeats. */
function drift(t: number, phase: number): number {
  return 0.6 * Math.sin(2 * Math.PI * 0.13 * t + phase) + 0.4 * Math.sin(2 * Math.PI * 0.29 * t + 1.7 * phase);
}

/** The headset's path: a start view, then cuts and eased moves at shot times (seconds). */
export class CameraTrack {
  private readonly moves: Move[] = [];

  constructor(
    private readonly start: View,
    private readonly sway: Sway = { mm: 0, deg: 0 },
  ) {}

  /** Jump to `view` at time `t`. */
  cut(t: number, view: View): void {
    this.add({ t0: t, t1: t, from: view, to: view, ease: "linear" });
  }

  /**
   * From wherever the camera is at `t`, ease to `to` over `ms`. Eye point and look-at point move
   * together on the same curve, so the view turns the way a head does. A move that starts while
   * another runs takes over from where that one is.
   */
  move(t: number, to: View, ms: number, ease: Ease = "minimum-jerk"): void {
    this.add({ t0: t, t1: t + Math.max(0, ms) / 1000, from: this.viewAt(t), to, ease });
  }

  private add(m: Move): void {
    const last = this.moves[this.moves.length - 1];
    if (last && m.t0 < last.t0) throw new Error(`camera moves must come in time order (${m.t0} s after ${last.t0} s)`);
    this.moves.push(m);
  }

  /** The view at shot time `t` (seconds), without sway. */
  viewAt(t: number): View {
    let m: Move | undefined;
    for (let i = this.moves.length - 1; i >= 0; i--) {
      if ((this.moves[i] as Move).t0 <= t) {
        m = this.moves[i];
        break;
      }
    }
    if (!m) return this.start;
    if (t >= m.t1) return m.to;
    const k = EASE[m.ease]((t - m.t0) / (m.t1 - m.t0));
    return { from: lerp3(m.from.from, m.to.from, k), at: lerp3(m.from.at, m.to.at, k) };
  }

  /** Headset position and orientation at shot time `t`, sway included. */
  poseAt(t: number): { position: V3; quaternion: Quat } {
    const v = this.viewAt(t);
    const { yaw, pitch } = yawPitch(v);
    const s = this.sway;
    const mm = s.mm / 1000;
    const rad = (s.deg * Math.PI) / 180;
    const position: V3 = [v.from[0] + mm * drift(t, 0.3), v.from[1] + mm * 0.6 * drift(t, 2.1), v.from[2] + mm * drift(t, 4.4)];
    return { position, quaternion: quatFromYawPitch(yaw + rad * drift(t, 5.2), pitch + rad * 0.7 * drift(t, 1.3)) };
  }
}

/** Horizontal field of view to IWER's vertical one (`fovy`, radians) for a view of `w` x `h`. */
export function fovyFor(hfovDeg: number, w: number, h: number): number {
  const half = (hfovDeg * Math.PI) / 360;
  return 2 * Math.atan(Math.tan(half) * (h / w));
}
