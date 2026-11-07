// Phone AR (Chrome's WebXR on ARCore): no hands and no controllers, only the screen. A touch is a ray from the phone's
// camera through the finger: an XR input source with targetRayMode "screen", there only while the finger is down.
// This is the pure part: telling a phone's session, and the mappings a touch can have. The app's touch system
// (src/app/touch-system.ts) reads the rays and wires them in.
// - The lantern drag: a touch that starts on the lantern holds it at the depth it was touched at, so the lantern
//   follows the finger across the screen, and nearer or farther as the phone moves.
// - The finger in the light: any other touch on the box puts a fingertip in the beam, cast so its shadow lies under
//   the finger on the screen (a finger lock's gap is filled by touching it).
// - A key: a touch on a key pokes it, a fingertip coming in along its face and going back out.
// Allocation free.
import type { Lock, V2, V3 } from "../core/types";

/** What a session tells of its device (WebXR typings vary): enough to tell a phone. */
export interface SessionLike {
  readonly interactionMode?: string;
  readonly inputSources?: ArrayLike<{ readonly targetRayMode?: string }> | null;
}

/**
 * A handheld AR session (a phone), by what the session gives, never the user agent: the WebXR AR module's
 * "screen-space" interaction mode (headsets report "world-space"), or a screen touch among its input sources. Never
 * while a tracked pointer (a hand or a controller) is among them: a phone has none.
 */
export function isHandheld(s: SessionLike | null | undefined): boolean {
  if (!s || hasTrackedPointer(s)) return false;
  if (s.interactionMode === "screen-space") return true;
  const list = s.inputSources;
  if (list) for (let i = 0; i < list.length; i++) if (list[i]?.targetRayMode === "screen") return true;
  return false;
}

/** A hand or a controller (a tracked pointer) is among the session's input sources: a headset's, never a phone's. */
export function hasTrackedPointer(s: SessionLike | null | undefined): boolean {
  const list = s?.inputSources;
  if (list) for (let i = 0; i < list.length; i++) if (list[i]?.targetRayMode === "tracked-pointer") return true;
  return false;
}

/**
 * How far along a touch ray (origin `o`, unit direction `d`, metres) the lantern at `p` is, when the ray passes within
 * `radiusM` of it in front of the phone: the depth a drag then holds. NaN when the touch misses it.
 */
export function grabDepth(o: Readonly<V3>, d: Readonly<V3>, p: Readonly<V3>, radiusM: number): number {
  const px = p[0] - o[0], py = p[1] - o[1], pz = p[2] - o[2];
  const t = px * d[0] + py * d[1] + pz * d[2];
  if (!(t > 0)) return Number.NaN;
  const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t;
  return qx * qx + qy * qy + qz * qz <= radiusM * radiusM ? t : Number.NaN;
}

/**
 * Where a touch ray must pass the lantern (box units, from its light) to take it. A hand's 6 cm grab radius is far too
 * wide for a ray from a phone: at 45 cm it covers a third of the screen, and the gap a finger lock waits on is often
 * seen just past the lantern. So a touch takes it only over its drawn shape, and only over its body when the touch
 * reaches a finger lock's gap.
 */
export const TOUCH_GRAB = {
  /**
   * The lantern as drawn (lantern-view.ts), with a fingertip's slop: a capsule up its axis from `down` below the light
   * to `up` above it, `radius` round. It holds the foot (its rim at 0.058 out, 0.087 down), the core and fins (out to
   * 0.058), the spire (tip at 0.14) and the ring it hangs by (top at 0.174). Every point of it is within up + radius =
   * 0.19 of the light, so the drag's pinch point (the ray's nearest point to the light) is within 5.7 cm of it even at
   * the 30 cm box, and the lantern controller's own 6 cm grab check always passes. 2.2 cm round at the 24 cm box.
   */
  reach: { down: 0.03, up: 0.1, radius: 0.09 },
  /** Its body alone (the glass core and the fins round it), when the touch reaches a gap: 1.4 cm at the 24 cm box. */
  bodyRadius: 0.06,
  /** A touch this near a finger lock's missing piece (box units, on the panel) reaches its gap. */
  gapMargin: 0.03,
} as const;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * The ray (origin `o`, unit direction `d`) passes within `r` of the segment from `a` to `b`, in front of its origin.
 * The nearest points: the segment's to the ray's line, then the ray's (in front) to that, then the segment's again.
 */
export function rayNearSegment(o: Readonly<V3>, d: Readonly<V3>, a: Readonly<V3>, b: Readonly<V3>, r: number): boolean {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const wx = o[0] - a[0], wy = o[1] - a[1], wz = o[2] - a[2];
  const uu = ux * ux + uy * uy + uz * uz, ud = ux * d[0] + uy * d[1] + uz * d[2];
  const wd = wx * d[0] + wy * d[1] + wz * d[2], wu = wx * ux + wy * uy + wz * uz;
  const denom = uu - ud * ud;
  let s = uu > 0 ? clamp01(denom > 1e-12 ? (wu - ud * wd) / denom : 0) : 0;
  const t = Math.max(0, s * ud - wd);
  if (uu > 0) s = clamp01((wu + t * ud) / uu);
  const px = o[0] + d[0] * t - (a[0] + ux * s), py = o[1] + d[1] * t - (a[1] + uy * s), pz = o[2] + d[2] * t - (a[2] + uz * s);
  return t > 0 && px * px + py * py + pz * pz <= r * r;
}

/** The panel point `q` (box units) is on one of these prongs, or within `margin` of it. */
export function onProng(prongs: readonly Prong[], q: Readonly<V2>, margin: number): boolean {
  for (const p of prongs) {
    const dx = q[0] - p.cx, dy = q[1] - p.cy, c = Math.cos(p.angle), s = Math.sin(p.angle);
    if (Math.abs(dx * c + dy * s) <= p.half + margin && Math.abs(-dx * s + dy * c) <= p.width / 2 + margin) return true;
  }
  return false;
}

/** The drag's pinch point: `depth` along the touch ray, into `out`. */
export function dragPoint(o: Readonly<V3>, d: Readonly<V3>, depth: number, out: V3): V3 {
  out[0] = o[0] + d[0] * depth;
  out[1] = o[1] + d[1] * depth;
  out[2] = o[2] + d[2] * depth;
  return out;
}

/** Where a ray in box units (origin `o`, direction `d`) meets the panel (z = 0), into `out`; false when it does not. */
export function panelPoint(o: Readonly<V3>, d: Readonly<V3>, out: V2): boolean {
  if (!(o[2] > 0) || !(d[2] < 0)) return false;
  const t = -o[2] / d[2];
  out[0] = o[0] + d[0] * t;
  out[1] = o[1] + d[1] * t;
  return true;
}

/** A finger lock's missing piece as the touch finger fills it (box units, on the panel). */
export interface Prong {
  readonly lock: number;
  readonly cx: number;
  readonly cy: number;
  /** Its long axis, radians from the panel's x axis (the lock's fingerAngle). */
  readonly angle: number;
  /** Half its length along that axis, and its full width across it. */
  readonly half: number;
  readonly width: number;
}

/** A finger lock's prong: its missing piece's middle, long axis, length and width (as the lessons' ghost finger reads it). */
export function prongOf(lock: Lock): Prong | null {
  if (!lock.finger || lock.missing < 0) return null;
  const poly = lock.target[lock.missing];
  if (!poly || poly.length === 0) return null;
  let cx = 0, cy = 0;
  for (const p of poly) {
    cx += p[0] / poly.length;
    cy += p[1] / poly.length;
  }
  const dx = Math.cos(lock.fingerAngle), dy = Math.sin(lock.fingerAngle);
  let half = 0, side = 0;
  for (const p of poly) {
    half = Math.max(half, Math.abs((p[0] - cx) * dx + (p[1] - cy) * dy));
    side = Math.max(side, Math.abs(-(p[0] - cx) * dy + (p[1] - cy) * dx));
  }
  return { lock: lock.i, cx, cy, angle: lock.fingerAngle, half, width: 2 * side };
}

/** The prong nearest the panel point `q` (null with none). */
export function nearestProng(prongs: readonly Prong[], q: Readonly<V2>): Prong | null {
  let best: Prong | null = null, bestD = Infinity;
  for (const p of prongs) {
    const d = (p.cx - q[0]) ** 2 + (p.cy - q[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * The touch finger's shadow: how its finger sits when no finger lock is near (horizontal, 12% of the box long, twice
 * a finger's width), and the bounds a lock's prong may stretch it to.
 */
export const TOUCH_FINGER = {
  /** A finger's shadow covers this share of its prong's length (the lessons' ghost finger: 80% each way). */
  lengthShare: 0.8,
  /** Half its length (box units) with no prong to fit. */
  half: 0.06,
  /** How much bigger than the finger its shadow is with no prong to fit, and at most and least with one. */
  magnification: 2,
  minMagnification: 1.2,
  maxMagnification: 4,
  /** The finger never sits deeper in the box than this (box z), as the ghost finger does. */
  maxZ: 0.8,
} as const;

/**
 * The touch finger in the light: a finger-sized bar whose shadow from the lantern `L` (box units) lies on the panel
 * centred on `q`, where the touch meets the panel. Along a nearby finger lock's prong (`prong`), as long as 80% of it,
 * at the depth where a finger of radius `fingerR` (box units) casts a shadow as wide as the prong; else horizontal,
 * at twice a finger's width. Its two ends (box units) into out[0..2] and out[3..5], as HandShadow.castStandIn reads a
 * stand-in finger. False when the lantern is not in front of the panel.
 */
export function fingerEnds(L: Readonly<V3>, q: Readonly<V2>, prong: Prong | null, fingerR: number, out: Float64Array): boolean {
  const Lz = L[2];
  if (!(Lz > 0) || !(fingerR > 0)) return false;
  const F = TOUCH_FINGER;
  let mag: number = F.magnification, half: number = F.half, angle = 0;
  if (prong) {
    mag = Math.min(F.maxMagnification, Math.max(F.minMagnification, prong.width / (2 * fingerR)));
    half = prong.half * F.lengthShare;
    angle = prong.angle;
  }
  // A finger at depth z casts a shadow Lz / (Lz - z) times its size: the depth for that magnification.
  const z = Math.min(F.maxZ, Lz * (1 - 1 / mag));
  // A point at depth z on the line from the lantern to a panel point is that far (as a share) from the lantern.
  const k = (Lz - z) / Lz;
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let e = 0; e < 2; e++) {
    const sign = e === 0 ? 1 : -1, o = e * 3;
    const px = q[0] + sign * c * half, py = q[1] + sign * s * half;
    out[o] = L[0] + k * (px - L[0]);
    out[o + 1] = L[1] + k * (py - L[1]);
    out[o + 2] = z;
  }
  return true;
}

/** Where a touch ray meets a key, for its poke (world). */
export interface KeyHit {
  /** Along the ray (m). */
  t: number;
  /** The point on the key's plane, and the plane's unit normal (its front). */
  readonly point: V3;
  readonly normal: V3;
  /** How far the poke presses (m along the normal; negative: behind the plane). */
  press: number;
}

export const newKeyHit = (): KeyHit => ({ t: Infinity, point: [0, 0, 0], normal: [0, 0, 0], press: 0 });

/** A touch this close outside a key's edge (m) still pokes it: a fingertip on glass is less exact than one in the air. */
export const TOUCH_SLOP_M = 0.004;

/**
 * A touch ray (origin `o`, unit direction `d`, world) against a key: a face with the column-major matrix elements `e`
 * (origin at its centre, x along its width, z its facing direction; y taken square to both, as the keys read it),
 * `halfW` by `halfH` m. When the ray reaches the front of that face within TOUCH_SLOP_M of its edge, nearer than
 * `out.t`, the hit goes into `out` with `press` and it returns true.
 */
export function hitKey(o: Readonly<V3>, d: Readonly<V3>, e: ArrayLike<number>, halfW: number, halfH: number, press: number, out: KeyHit): boolean {
  let ax = e[0]!, ay = e[1]!, az = e[2]!, nx = e[8]!, ny = e[9]!, nz = e[10]!;
  const la = Math.hypot(ax, ay, az), ln = Math.hypot(nx, ny, nz);
  if (!(la > 0) || !(ln > 0)) return false;
  ax /= la;
  ay /= la;
  az /= la;
  nx /= ln;
  ny /= ln;
  nz /= ln;
  const denom = d[0] * nx + d[1] * ny + d[2] * nz;
  if (!(denom < 0)) return false;
  const t = ((e[12]! - o[0]) * nx + (e[13]! - o[1]) * ny + (e[14]! - o[2]) * nz) / denom;
  if (!(t > 0) || !(t < out.t)) return false;
  const hx = o[0] + d[0] * t, hy = o[1] + d[1] * t, hz = o[2] + d[2] * t;
  const rx = hx - e[12]!, ry = hy - e[13]!, rz = hz - e[14]!;
  // y = n x a.
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
  if (Math.abs(rx * ax + ry * ay + rz * az) > halfW + TOUCH_SLOP_M) return false;
  if (Math.abs(rx * bx + ry * by + rz * bz) > halfH + TOUCH_SLOP_M) return false;
  out.t = t;
  out.point[0] = hx;
  out.point[1] = hy;
  out.point[2] = hz;
  out.normal[0] = nx;
  out.normal[1] = ny;
  out.normal[2] = nz;
  out.press = press;
  return true;
}

/**
 * A key's poke for a touch: a fingertip that comes in along the key's face, presses past where the key clicks and goes
 * back out. Offsets along the key's normal (m; 0 is the key's plane, negative behind it).
 */
export const TOUCH_POKE = {
  /** Starts this far in front of the key... */
  fromM: 0.03,
  /** ...and comes in over this long (ms)... */
  inMs: 120,
  /** ...stays in while the finger is down, and goes back out over this long once it lifts (never before it is in). */
  outMs: 120,
} as const;

/**
 * Where a touch's poking fingertip is along a key's normal (m) `sinceStart` ms after the touch began, `sinceEnd` ms after
 * it lifted (NaN while it is down), pressing to `press` (the key's own depth, negative). NaN once the poke is over.
 */
export function pokeOffset(sinceStart: number, sinceEnd: number, press: number): number {
  const P = TOUCH_POKE;
  const inK = Math.min(1, Math.max(0, sinceStart / P.inMs));
  const at = P.fromM + (press - P.fromM) * inK;
  if (sinceEnd !== sinceEnd || inK < 1) return at;
  // It goes back out from the moment it is both in and lifted.
  const out = Math.min(sinceEnd, sinceStart - P.inMs);
  const k = out / P.outMs;
  if (k >= 1) return Number.NaN;
  return press + (P.fromM - press) * Math.max(0, k);
}
