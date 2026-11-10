// Where the box sits: in the lap, placed from the seated head when an XR session starts and again on
// Recenter (no plane detection: a headset cannot find a lap). One matrix carries box units to world
// metres: the back panel's centre is the origin, 1 unit = the box size, the open front faces the
// player and leans back by the tilt like a book on the lap. A size change scales everything around
// the panel, so lantern positions and solve state (all in box units) never move in the box.
import { Euler, Matrix4, Quaternion, Vector3 } from "@iwsdk/core";
import type { V3, Vec3 } from "../core/types";

/** The back panel's centre this far in front of the eyes, horizontally. */
export const BOX_FORWARD_M = 0.55;
/** The back panel's centre this far below the eyes (the box's own centre sits about 4 cm higher). */
export const BOX_BELOW_HEAD_M = 0.28;
/**
 * How far the box leans back, in degrees. The comfort spike (plan comfort-spike.md) chose 10: at the
 * planned 20 the open front points so far up that lantern spots in front of it rise above the sternum
 * line (only 15 cm below the eyes) and sit within 6 degrees of the line of sight to the panel.
 */
export const TILT_DEG = 10;
/** The box size setting's default, in cm (the setting runs 18-30). */
export const DEFAULT_BOX_CM = 24;
/** Seated eye height used until a session gives a real head pose. */
export const DEFAULT_EYE_Y_M = 1.2;
/** The box root's scene name (the perf panel and tests find the box by it). */
export const BOX_ROOT_NAME = "Box";

/** A head for placement: where the eyes are and which way they face (yaw about +Y; 0 looks down -Z). */
export interface Eye {
  pos: Vector3;
  yaw: number;
}

const DEG = Math.PI / 180;
const tmpEuler = new Euler(0, 0, 0, "YXZ");
const tmpQuat = new Quaternion();
const tmpPos = new Vector3();
const tmpScale = new Vector3();

/**
 * The box-to-world matrix for a head: the panel centre `forwardM` ahead of the eyes (along the head's
 * heading, flattened; 0.55 m) and `belowM` below them (0.28 m), turned to face the head and leaning
 * back `tiltDeg`, scaled so one box unit is `sizeCm`.
 */
export function placeBox(
  eye: Eye,
  sizeCm: number,
  tiltDeg = TILT_DEG,
  out = new Matrix4(),
  forwardM = BOX_FORWARD_M,
  belowM = BOX_BELOW_HEAD_M,
): Matrix4 {
  tmpPos.set(eye.pos.x - Math.sin(eye.yaw) * forwardM, eye.pos.y - belowM, eye.pos.z - Math.cos(eye.yaw) * forwardM);
  tmpQuat.setFromEuler(tmpEuler.set(-tiltDeg * DEG, eye.yaw, 0, "YXZ"));
  const s = sizeCm / 100;
  tmpScale.set(s, s, s);
  return out.compose(tmpPos, tmpQuat, tmpScale);
}

/** A point in box units to world metres. */
export function boxToWorld(m: Matrix4, v: V3, out: Vector3): Vector3 {
  return out.set(v[0], v[1], v[2]).applyMatrix4(m);
}

/**
 * A world point to box units, for a matrix from placeBox (a turn and one uniform scale): each box
 * axis is a column of the matrix, so the point is its offset from the panel dotted with each column
 * over the scale squared. No inverse, no allocation.
 */
export function worldToBox(m: Matrix4, v: Vector3, out: V3): V3 {
  const e = m.elements;
  const dx = v.x - e[12]!, dy = v.y - e[13]!, dz = v.z - e[14]!;
  const s2 = e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!;
  out[0] = (e[0]! * dx + e[1]! * dy + e[2]! * dz) / s2;
  out[1] = (e[4]! * dx + e[5]! * dy + e[6]! * dz) / s2;
  out[2] = (e[8]! * dx + e[9]! * dy + e[10]! * dz) / s2;
  return out;
}

/**
 * Heading of a head (camera) quaternion: the direction its -Z axis points, flattened onto the floor.
 * Looking up or down does not change it.
 */
export function yawFromQuaternion(x: number, y: number, z: number, w: number): number {
  const fx = -2 * (x * z + w * y);
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz);
}

/** How far a head (camera) quaternion looks up (positive) or down (negative), in radians: its -Z axis above the floor. */
export function pitchFromQuaternion(x: number, y: number, z: number, w: number): number {
  const fx = -2 * (x * z + w * y);
  const fy = 2 * (w * x - y * z);
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(fy, Math.hypot(fx, fz));
}

/** A phone pointed steeper than this, down or up (degrees), places the box as if it were not: upright, still ahead. */
export const IN_VIEW_PITCH_DEG = { down: 60, up: 10 } as const;

const clampPitch = (pitch: number) => Math.min(IN_VIEW_PITCH_DEG.up * DEG, Math.max(-IN_VIEW_PITCH_DEG.down * DEG, pitch));

/**
 * How far above the box's own axis a phone's camera sees it from (degrees): the seated eye's angle (the eye 55 cm ahead
 * of and 28 cm above the panel sees the box's middle about 21 degrees above its axis). The lantern spots sit below the
 * box's centre so that, seen from there, the lantern stays under the line of sight to the panel.
 */
export const VIEW_ELEVATION_DEG = 20;
/** A phone's box leans back at most this much, and toward the phone (negative) at most this much (degrees). */
export const PHONE_LEAN_DEG = { min: -20, max: 40 } as const;

/**
 * How far a phone's box leans back (degrees) for a camera pitched `pitch` radians: so the camera sees it from
 * VIEW_ELEVATION_DEG above its axis. Pointed 30 degrees down: 10 (the lap's); held level: its top leans 20 toward the
 * phone; 45 down: back 25. Past PHONE_LEAN_DEG it stops (pointed up past level, the camera then sees it from lower).
 */
export function phoneLean(pitch: number): number {
  const deg = clampPitch(pitch) / DEG;
  return Math.min(PHONE_LEAN_DEG.max, Math.max(PHONE_LEAN_DEG.min, -deg - VIEW_ELEVATION_DEG));
}

/**
 * What of the box a phone's view must show, from the box's middle (box units; the middle is half a box in front of the
 * panel): the frame and its posts across and up, the plinth under it (bottom at -0.645, back at -0.06; box-scene's
 * PLINTH) and the drawer's handle in front of the plinth (HANDLE_AT, z 1.072, and its bar's radius).
 */
export const BOX_EXTENT = { x: 0.56, up: 0.56, down: 0.65, back: 0.56, front: 0.59 } as const;
/** The box fills at most this share of a phone's view each way from its middle: a margin all round. */
export const IN_VIEW_FILL = 0.88;
/**
 * A phone's view as the tangents of its half-angles across and up, when the session gives none: the narrow side of a
 * 20:9 screen (about 33 degrees) both ways, so it fits in portrait and in landscape.
 */
export const PHONE_VIEW = { tanH: Math.tan(16.5 * DEG), tanV: Math.tan(16.5 * DEG) } as const;
/** The box's middle never stands nearer the phone than this, nor farther (m). */
export const IN_VIEW_RANGE_M = { near: 0.4, far: 1.6 } as const;

/** A view's half-angle tangents: across (x) and up and down (y). */
export interface ViewTangents {
  tanH: number;
  tanV: number;
}

/**
 * A camera's view from its projection matrix's elements `e`, as half-angle tangents, taking the narrower side each way:
 * a phone's camera can be off centre. Right is (1 + P[8]) / P[0] and left (1 - P[8]) / P[0], so the narrower is
 * (1 - |P[8]|) / P[0]; up and down the same with P[9] and P[5]. PHONE_VIEW's where the matrix gives none. Into `out`.
 */
export function viewOf(e: ArrayLike<number> | null | undefined, out: ViewTangents): ViewTangents {
  const sx = e ? e[0]! : Number.NaN, sy = e ? e[5]! : Number.NaN, ox = e ? e[8]! : 0, oy = e ? e[9]! : 0;
  const h = (1 - Math.abs(ox)) / sx, v = (1 - Math.abs(oy)) / sy;
  out.tanH = h > 0 && Number.isFinite(h) ? h : PHONE_VIEW.tanH;
  out.tanV = v > 0 && Number.isFinite(v) ? v : PHONE_VIEW.tanV;
  return out;
}

/**
 * The same with the wider side each way, (1 + |P[8]|) / P[0] and (1 + |P[9]|) / P[5]: for a headset's left eye, about
 * the view of both eyes together (whether anything of the box can still be seen). PHONE_VIEW's where the matrix gives
 * none. Into `out`.
 */
export function wideViewOf(e: ArrayLike<number> | null | undefined, out: ViewTangents): ViewTangents {
  const sx = e ? e[0]! : Number.NaN, sy = e ? e[5]! : Number.NaN, ox = e ? e[8]! : 0, oy = e ? e[9]! : 0;
  const h = (1 + Math.abs(ox)) / sx, v = (1 + Math.abs(oy)) / sy;
  out.tanH = h > 0 && Number.isFinite(h) ? h : PHONE_VIEW.tanH;
  out.tanV = v > 0 && Number.isFinite(v) ? v : PHONE_VIEW.tanV;
  return out;
}

/**
 * How far along a phone camera's view (m) the box's middle must stand for the whole box (BOX_EXTENT: plinth and
 * drawer handle too) to show within IN_VIEW_FILL of a view with half-angle tangents `view`, the camera pitched `pitch`
 * radians, the box `sizeM` m, facing the camera and leaning back `tiltDeg`. Every corner of the box's extent must be
 * inside the view: a corner `cz` nearer the camera, `cx` across and `cy` up from the middle (camera axes) needs the
 * middle at least cz + |cx| / (fill * tanH) and cz + |cy| / (fill * tanV) away.
 */
export function inViewDistance(pitch: number, sizeM: number, view: ViewTangents = PHONE_VIEW, tiltDeg = TILT_DEG): number {
  const p = clampPitch(pitch), t = tiltDeg * DEG, E = BOX_EXTENT, k = IN_VIEW_FILL;
  const tanH = view.tanH > 0 ? view.tanH : PHONE_VIEW.tanH, tanV = view.tanV > 0 ? view.tanV : PHONE_VIEW.tanV;
  // In the heading's frame (x right, y up, z toward the viewer): the box's up axis leans back, its out axis tips up;
  // the camera's up and back axes turn with its pitch.
  const yy = Math.cos(t), yz = -Math.sin(t), zy = Math.sin(t), zz = Math.cos(t);
  const uy = Math.cos(p), uz = Math.sin(p), by = -Math.sin(p), bz = Math.cos(p);
  let need = 0;
  for (const bx of [-E.x, E.x]) {
    for (const ty of [-E.down, E.up]) {
      for (const tz of [-E.back, E.front]) {
        const vy = (ty * yy + tz * zy) * sizeM, vz = (ty * yz + tz * zz) * sizeM, vx = bx * sizeM;
        const cy = vy * uy + vz * uz, cz = vy * by + vz * bz;
        need = Math.max(need, cz + Math.abs(vx) / (k * tanH), cz + Math.abs(cy) / (k * tanV));
      }
    }
  }
  return Math.min(IN_VIEW_RANGE_M.far, Math.max(IN_VIEW_RANGE_M.near, need));
}

/**
 * Where the panel centre goes so the box's middle (half a box in front of the panel, along the box's own tilted axis)
 * is `distanceM` along a camera pitched `pitch` radians: how far ahead (flattened) and below the camera, for placeBox.
 */
export function inViewOffsets(pitch: number, sizeM: number, distanceM: number, tiltDeg = TILT_DEG): { forwardM: number; belowM: number } {
  const p = clampPitch(pitch);
  const t = tiltDeg * DEG, half = sizeM / 2;
  return {
    forwardM: distanceM * Math.cos(p) + half * Math.cos(t),
    belowM: -distanceM * Math.sin(p) + half * Math.sin(t),
  };
}

/** The back panel's centre (world), the box's heading and its lean, for what lays itself out around the box. */
export interface BoxPose {
  position: Vec3;
  yaw: number;
  /** How far it leans back (degrees): TILT_DEG in the lap, a phone's lean in its view (phoneLean). */
  tiltDeg: number;
}

export interface HeadPose {
  position: Readonly<Vec3>;
  yaw: number;
}

/** "default" until a session starts and the box is placed from the head ("head"), or in a phone's view ("view"). */
export type PlacementSource = "default" | "head" | "view";

/**
 * Where the box sits: the head it was placed from and the box size. Placing again (Recenter) keeps
 * the size; a size change keeps the panel where it is. No allocation after creation.
 */
export class Placement {
  /** Increments on every change, so systems can tell cheaply. */
  version = 0;
  source: PlacementSource = "default";
  private readonly eye: Eye = { pos: new Vector3(0, DEFAULT_EYE_Y_M, 0), yaw: 0 };
  private sizeCm = DEFAULT_BOX_CM;
  /** The panel centre ahead of and below the eyes: the lap's, or a phone's view's (startInView). */
  private forwardM = BOX_FORWARD_M;
  private belowM = BOX_BELOW_HEAD_M;
  /** Placed in a phone's view: how far its middle stands along the camera's view (m); NaN for the lap. */
  inViewM = Number.NaN;
  /** How far the box leans back (degrees): TILT_DEG in the lap, phoneLean in a phone's view. */
  tiltDeg = TILT_DEG;
  private readonly m = new Matrix4();
  private readonly current: BoxPose = { position: [0, 0, 0], yaw: 0, tiltDeg: TILT_DEG };

  constructor() {
    this.apply();
  }

  /** The panel centre and heading (the same object every call). */
  pose(): Readonly<BoxPose> {
    return this.current;
  }

  /** Box units to world metres (the same object every call). */
  matrix(): Readonly<Matrix4> {
    return this.m;
  }

  /** The box edge in metres. */
  get sizeM(): number {
    return this.sizeCm / 100;
  }

  /** Place the box from the head (session start, Recenter). The size stays. */
  start(head: HeadPose): void {
    this.eye.pos.set(head.position[0], head.position[1], head.position[2]);
    this.eye.yaw = head.yaw;
    this.forwardM = BOX_FORWARD_M;
    this.belowM = BOX_BELOW_HEAD_M;
    this.inViewM = Number.NaN;
    this.tiltDeg = TILT_DEG;
    this.source = "head";
    this.apply();
  }

  /**
   * Place the box in a phone's view (session start, Recenter): its middle along the camera's view, `pitch` radians up
   * or down, as far as the whole box needs to show in a view with half-angle tangents `view` (the camera's own
   * projection; inViewDistance), facing it and leaning so the camera sees it from the seated eye's angle (phoneLean). A
   * size change after keeps the panel where it is, as for the lap.
   */
  startInView(head: HeadPose, pitch: number, view: ViewTangents = PHONE_VIEW): void {
    this.tiltDeg = phoneLean(pitch);
    this.inViewM = inViewDistance(pitch, this.sizeM, view, this.tiltDeg);
    const o = inViewOffsets(pitch, this.sizeM, this.inViewM, this.tiltDeg);
    this.eye.pos.set(head.position[0], head.position[1], head.position[2]);
    this.eye.yaw = head.yaw;
    this.forwardM = o.forwardM;
    this.belowM = o.belowM;
    this.source = "view";
    this.apply();
  }

  /** The box size setting (cm); the box grows or shrinks around its panel. */
  setSize(cm: number): void {
    if (cm === this.sizeCm) return;
    this.sizeCm = cm;
    this.apply();
  }

  private apply(): void {
    placeBox(this.eye, this.sizeCm, this.tiltDeg, this.m, this.forwardM, this.belowM);
    const e = this.m.elements;
    this.current.position[0] = e[12]!;
    this.current.position[1] = e[13]!;
    this.current.position[2] = e[14]!;
    this.current.yaw = this.eye.yaw;
    this.current.tiltDeg = this.tiltDeg;
    this.version++;
  }
}

/**
 * The steady pose a placement waits for: the head (a phone's camera) turning under `turnDegPerS` for `stillMs`, looking
 * between `pitchDeg.down` below the horizon and `pitchDeg.up` above it; a first placement goes ahead after `capMs`
 * anyway. The turn rate is smoothed over about `smoothMs`, so one jittery frame does not restart the wait.
 */
export const STEADY = { turnDegPerS: 30, stillMs: 400, capMs: 2500, pitchDeg: { down: 60, up: 20 }, smoothMs: 100 } as const;

/**
 * Whether the head (or a phone's camera) is held still in a looking pose, fed its forward each frame. A box placed from
 * the first tracked frame stays wherever the head or phone happened to point as the session started (a phone still
 * turning as AR starts, a head turned away): the first placement waits for `ready`, a phone's re-place for `steady`.
 * Allocation free.
 */
export class PlaceGate {
  private firstMs = Number.NaN;
  private lastMs = Number.NaN;
  private stillSince = Number.NaN;
  /** The smoothed turn rate (degrees a second). */
  private rate = 0;
  private looking = false;
  private fx = 0;
  private fy = 0;
  private fz = -1;

  /** Start over (a new session). */
  reset(): void {
    this.firstMs = this.lastMs = this.stillSince = Number.NaN;
    this.rate = 0;
    this.looking = false;
  }

  /** This frame's forward (a unit vector, world, y up) at `nowMs`; feed only tracked frames. */
  update(nowMs: number, fx: number, fy: number, fz: number): void {
    const pitch = Math.asin(Math.max(-1, Math.min(1, fy))) / DEG;
    this.looking = pitch >= -STEADY.pitchDeg.down && pitch <= STEADY.pitchDeg.up;
    if (this.firstMs !== this.firstMs) {
      this.firstMs = this.stillSince = nowMs;
      this.rate = 0;
    } else {
      const dt = nowMs - this.lastMs;
      if (dt > 0) {
        const cx = this.fy * fz - this.fz * fy, cy = this.fz * fx - this.fx * fz, cz = this.fx * fy - this.fy * fx;
        const turn = Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), this.fx * fx + this.fy * fy + this.fz * fz) / DEG;
        this.rate += ((turn * 1000) / dt - this.rate) * (1 - Math.exp(-dt / STEADY.smoothMs));
      }
    }
    if (!this.looking || this.rate > STEADY.turnDegPerS) this.stillSince = nowMs;
    this.fx = fx;
    this.fy = fy;
    this.fz = fz;
    this.lastMs = nowMs;
  }

  /** Held still for STEADY.stillMs in a looking pose (as of the last frame fed). */
  get steady(): boolean {
    return this.looking && this.lastMs - this.stillSince >= STEADY.stillMs;
  }

  /** Steady, or fed for STEADY.capMs already: a first placement goes ahead. */
  get ready(): boolean {
    return this.steady || this.lastMs - this.firstMs >= STEADY.capMs;
  }
}

/** The app's box placement. */
export const placement = new Placement();

export function boxPose(): Readonly<BoxPose> {
  return placement.pose();
}
