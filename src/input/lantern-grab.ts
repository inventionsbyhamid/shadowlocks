// Holding the lantern: real hands and controllers, through the feel layer (LanternController), to the lantern in the
// box. Runs once a frame after the hands are read (HandPinchSystem); allocates nothing.
//
// One pinch stream. The controller grabs on the frame a pinch *starts* (`wasPinching` going from false to true), so
// it hears exactly one hand: the one holding the lantern, or, while nobody does, a hand whose pinch starts this very
// frame within GRAB_RADIUS_CM of the lantern (the nearer one if both do). Otherwise it hears "not pinching". Any
// other pinch, such as the other hand pulling the drawer or a hand that closed elsewhere and then came over, never
// reaches it: it can neither hide a grab start nor count as one. A controller's trigger (or squeeze) is that
// hand's pinch, at its grip.
//
// Tracking lost while holding (the rule): the lantern stands exactly where it is, stays held, and nothing lets it go
// (the controller gets no pinch point; no release event). The hand's pinch does not time out meanwhile
// (HandPinchSystem's `holding` hook). When the hand comes back:
//   - fingers open (or the trigger up): treated as a release where the lantern stood, at once. The release looks
//     back 150 ms, to the standstill, so it does not move;
//   - fingers still pinched (or the trigger held): it is still in the hand, with the same grip, and follows the
//     hand from there (after a long loss the lantern springs to where the hand now holds it).
// After TRACKING_GRACE_MS out of tracking `lostBy` names the hand once (the bus's `tracking-lost`). From then on the
// other hand may take the lantern: a pinch of it starting within the grab radius lets the lost hand's hold go (where
// the lantern stands) and grabs, in that frame.
//
// `drop` lets a hold go at once (a new box is coming: the lantern is put at its start, not carried there).
//
// The view: the holder's pinch point goes through One Euro (the raw joint) into box units; the controller moves the
// lantern (kept in front of the box by ctx.minZ); the lantern flares on a grab and ripples on a settle; it brightens
// as a hand comes near (0 at 30 cm, 1 at 6 cm, the grab radius); the ring beam shows while it rides a ring line.
import { type Matrix4, type Object3D, Vector3 } from "@iwsdk/core";
import type { V3, Vec3 } from "../core/types";
import { LANTERN_MIN_Z } from "../feel/constants";
import type { FeelEvent, LanternController, LanternCtx, LanternInput } from "../feel/lantern-controller";
import type { LanternView } from "../render/lantern-view";
import { worldToBox } from "../render/placement";
import { RingBeam } from "../render/ring-beam";
import { TRACKING_GRACE_MS } from "./constants";
import { type HandPinch, hands, SIDES, type Side } from "./grab-system";
import type { HandJoints } from "./hand-joints";
import { OneEuroVec3 } from "./one-euro";

/** The lantern brightens as a pinch point comes near: not at all from this far (cm)... */
export const GLOW_FAR_CM = 30;
/** ...fully from this close: the grab radius, so "fully lit" means "pinch now and you have it". */
export const GLOW_NEAR_CM = 6;
/** The brightness follows with this time constant (ms): a hand dropping out of view fades it, never snaps it. */
export const GLOW_MS = 80;
/**
 * A hand or controller this close to the lantern (cm) is reaching for it: its ray goes off, so its pinch or trigger
 * cannot click a panel (it is off before the grab, which needs GRAB_RADIUS_CM).
 */
export const REACH_CM = 12;

/** What LanternGrab needs of the box scene: the box root (box units to world) and the lantern's view. */
export interface LanternScene {
  readonly root: { readonly matrixWorld: Matrix4; add(o: Object3D): unknown };
  readonly lantern: Pick<LanternView, "setPos" | "flare" | "ripple" | "setBrightness">;
}

/** Room for every event one frame can drain (the controller keeps at most 32). */
const EVENT_ROOM = 32;

const finite = (v: Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

function dist(a: Readonly<V3>, b: Readonly<V3>): number {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return Math.sqrt(x * x + y * y + z * z);
}

export class LanternGrab {
  /**
   * This frame's feel events, `events[0..eventCount)`. Pooled by the controller: read them before the next update,
   * and copy any you keep.
   */
  readonly events: FeelEvent[] = [];
  eventCount = 0;
  /** The hand that picked the lantern up this frame, or null. */
  grabbedBy: Side | null = null;
  /** The hand that let it go this frame, or null. */
  releasedBy: Side | null = null;
  /** The holding hand, on the frame it has been out of tracking for TRACKING_GRACE_MS (once a loss), or null. */
  lostBy: Side | null = null;
  readonly beam = new RingBeam();

  /** The holding hand's index, or -1. */
  private who = -1;
  /** When the holder dropped out of tracking (ms), or -1. */
  private lostAt = -1;
  private lostSaid = false;
  /** The hand `drop` let go of since the last update (reported as that update's `releasedBy`). */
  private dropped: Side | null = null;
  private glowV = 0;
  private lastT = Number.NaN;
  private readonly ok: [boolean, boolean] = [false, false];
  private readonly near: [boolean, boolean] = [false, false];
  /** Each hand's pinch point this frame: world, and box units. */
  private readonly at: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private readonly pt: [V3, V3] = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  private readonly euro: [OneEuroVec3, OneEuroVec3] = [new OneEuroVec3(), new OneEuroVec3()];
  private readonly raw: Vec3 = [0, 0, 0];
  private readonly smooth: Vec3 = [0, 0, 0];
  private readonly tmp = new Vector3();
  /** The holder's smoothed pinch point (box units); "nowhere in particular" while nobody pinches; a placed point. */
  private readonly held: V3 = [0, 0, 0];
  private readonly idle: V3 = [0, 0, 0];
  private readonly placed: V3 = [0, 0, 0];
  private readonly input: LanternInput = { tMs: 0, pinching: false, pinchPos: null };

  constructor(
    readonly ctrl: LanternController,
    private readonly joints: HandJoints,
    private readonly scene: LanternScene,
    private readonly pinches: readonly [HandPinch, HandPinch] = hands,
  ) {
    for (let i = 0; i < EVENT_ROOM; i++) this.events.push({ type: "grab" });
    scene.root.add(this.beam.mesh);
    scene.lantern.setPos(ctrl.pos);
    scene.lantern.setBrightness(0);
  }

  /** The hand holding the lantern, or null. */
  get holder(): Side | null {
    return this.who < 0 ? null : SIDES[this.who as 0 | 1];
  }

  /** How bright the hands make the lantern now (0..1). */
  get brightness(): number {
    return this.glowV;
  }

  /** A hand holding the lantern or reaching for it: its ray goes off (HandPinchSystem's `busy`). */
  busy(side: 0 | 1): boolean {
    return this.who === side || this.near[side];
  }

  /** The hand holding the lantern: its pinch rides out any tracking loss (HandPinchSystem's `holding`). */
  holding(side: 0 | 1): boolean {
    return this.who === side;
  }

  /**
   * Where the tracked hand (or controller) nearest the lantern pinches, as of the last update, into `out` (box units);
   * false when none is in tracking. The lessons keep their ghost hand clear of it.
   */
  nearestPinch(out: V3): boolean {
    let best = Infinity, who = -1;
    for (let i = 0; i < 2; i++) {
      if (!this.ok[i]) continue;
      const d = dist(this.pt[i]!, this.ctrl.pos);
      if (d < best) {
        best = d;
        who = i;
      }
    }
    if (who < 0) return false;
    const p = this.pt[who]!;
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    return true;
  }

  /** Put the lantern at `p` (box units), never deeper than the box's open front. A hand holding it holds on. */
  place(p: Readonly<V3>): void {
    this.placed[0] = p[0];
    this.placed[1] = p[1];
    this.placed[2] = Math.max(p[2], LANTERN_MIN_Z);
    this.ctrl.place(this.placed);
    this.scene.lantern.setPos(this.ctrl.pos);
  }

  /**
   * Let a hold go now, where the lantern stands (before a new box: then `place` puts it at the box's start instead of
   * the hand carrying it there). Its `release` comes with the next update's events and `releasedBy`. Nothing when
   * nobody holds it. `ctx` is the box the lantern is leaving.
   */
  drop(tMs: number, ctx: LanternCtx): void {
    if (this.who < 0) return;
    this.dropped = SIDES[this.who as 0 | 1];
    this.who = -1;
    this.lostAt = -1;
    this.letGo(tMs, ctx);
  }

  /** One frame at `tMs` (the frame clock) against the box as `ctx` describes it. */
  update(tMs: number, ctx: LanternCtx): void {
    this.grabbedBy = null;
    this.releasedBy = this.dropped;
    this.dropped = null;
    this.lostBy = null;
    const m = this.scene.root.matrixWorld;
    for (let i = 0; i < 2; i++) this.ok[i] = this.read(i as 0 | 1, m);

    const inp = this.input;
    let grabber = -1;
    if (this.who < 0) {
      // Nobody holds it: only a pinch starting on it this frame reaches the controller.
      grabber = this.starter(ctx.cmPerUnit, -1);
      inp.tMs = tMs;
      if (grabber >= 0) this.feedGrab(grabber, tMs);
      else {
        // "Not pinching", somewhere finite (where the lantern is), so the controller keeps its dial ticks counted.
        this.idle[0] = this.ctrl.pos[0];
        this.idle[1] = this.ctrl.pos[1];
        this.idle[2] = this.ctrl.pos[2];
        inp.pinching = false;
        inp.pinchPos = this.idle;
      }
    } else {
      const h = this.who;
      inp.tMs = tMs;
      if (!this.ok[h]) {
        // Out of tracking: no pinch point, so the lantern stands still and stays held.
        if (this.lostAt < 0) {
          this.lostAt = tMs;
          this.lostSaid = false;
        } else if (!this.lostSaid && tMs - this.lostAt > TRACKING_GRACE_MS) {
          this.lostSaid = true;
          this.lostBy = SIDES[h as 0 | 1];
        }
        // Once the loss has been told, the other hand may take it: let the lost hold go where the lantern stands,
        // then the new pinch grabs (the release and the grab come in this frame's events, in that order).
        grabber = this.lostSaid ? this.starter(ctx.cmPerUnit, h) : -1;
        if (grabber >= 0) {
          this.letGo(tMs, ctx);
          this.feedGrab(grabber, tMs);
        } else {
          inp.pinching = true;
          inp.pinchPos = null;
        }
      } else {
        const euro = this.euro[h]!;
        const raw = this.toVec3(this.at[h]!);
        // Back from a loss: the filter starts over from the hand where it is now.
        if (this.lostAt >= 0) euro.reset(raw, tMs);
        this.lostAt = -1;
        euro.filter(raw, tMs, this.smooth);
        worldToBox(m, this.tmp.set(this.smooth[0], this.smooth[1], this.smooth[2]), this.held);
        inp.pinching = this.pinches[h]!.pinching;
        inp.pinchPos = this.held;
      }
    }
    this.ctrl.update(inp, ctx);

    const n = this.ctrl.drain(this.events);
    this.eventCount = n;
    const view = this.scene.lantern;
    for (let k = 0; k < n; k++) {
      const type = this.events[k]!.type;
      if (type === "grab") {
        this.who = grabber;
        this.lostAt = -1;
        this.grabbedBy = SIDES[grabber as 0 | 1];
        view.flare();
      } else if (type === "release") {
        if (this.who >= 0) this.releasedBy = SIDES[this.who as 0 | 1];
        this.who = -1;
        this.lostAt = -1;
      } else if (type === "settle") {
        view.ripple();
      }
    }
    view.setPos(this.ctrl.pos);
    this.glow(tMs, ctx.cmPerUnit);
    this.ringBeam(ctx);
  }

  /** The nearer hand, other than `except`, whose pinch starts this frame within the grab radius; -1 if none. */
  private starter(cmPerUnit: number, except: number): number {
    let best = Infinity;
    let who = -1;
    for (let i = 0; i < 2; i++) {
      if (i === except || !this.ok[i] || this.pinches[i]!.edge !== "start") continue;
      const p = this.pt[i]!;
      if (!this.ctrl.canGrab(p, cmPerUnit)) continue;
      const d = dist(p, this.ctrl.pos);
      if (d < best) {
        best = d;
        who = i;
      }
    }
    return who;
  }

  /** This frame the controller hears hand `i` start a pinch at its raw point (it grabs); its filter starts there. */
  private feedGrab(i: number, tMs: number): void {
    this.input.pinching = true;
    this.input.pinchPos = this.pt[i]!;
    this.euro[i]!.reset(this.toVec3(this.at[i]!), tMs);
  }

  /** One controller frame of "not pinching" where the lantern is: a held lantern is let go there. */
  private letGo(tMs: number, ctx: LanternCtx): void {
    const inp = this.input;
    inp.tMs = tMs;
    this.idle[0] = this.ctrl.pos[0];
    this.idle[1] = this.ctrl.pos[1];
    this.idle[2] = this.ctrl.pos[2];
    inp.pinching = false;
    inp.pinchPos = this.idle;
    this.ctrl.update(inp, ctx);
  }

  /** Hand `i`'s pinch point this frame (world and box units); false when it has none. */
  private read(i: 0 | 1, m: Matrix4): boolean {
    const pin = this.pinches[i]!;
    const at = this.at[i]!;
    let ok = false;
    if (pin.kind === "hand") ok = this.joints.pinchPoint(SIDES[i], at);
    else if (pin.kind === "controller" && pin.tracked) {
      at.copy(pin.point);
      ok = true;
    }
    ok = ok && finite(at);
    if (ok) worldToBox(m, at, this.pt[i]!);
    return ok;
  }

  private toVec3(v: Vector3): Vec3 {
    this.raw[0] = v.x;
    this.raw[1] = v.y;
    this.raw[2] = v.z;
    return this.raw;
  }

  /** Brighter as a hand comes near; full while held; held as it was while the holder is out of tracking. */
  private glow(tMs: number, cmPerUnit: number): void {
    let dMin = Infinity;
    for (let i = 0; i < 2; i++) {
      if (!this.ok[i]) {
        this.near[i] = false;
        continue;
      }
      const d = dist(this.pt[i]!, this.ctrl.pos) * cmPerUnit;
      this.near[i] = d <= REACH_CM;
      if (d < dMin) dMin = d;
    }
    let want: number;
    if (this.who >= 0) want = this.ok[this.who] ? 1 : this.glowV;
    else want = Math.min(1, Math.max(0, (GLOW_FAR_CM - dMin) / (GLOW_FAR_CM - GLOW_NEAR_CM)));
    const dt = tMs - this.lastT;
    this.lastT = tMs;
    let next = Number.isNaN(dt) ? want : dt > 0 ? this.glowV + (want - this.glowV) * (1 - Math.exp(-dt / GLOW_MS)) : this.glowV;
    if (Math.abs(want - next) < 1e-3) next = want;
    if (next !== this.glowV) {
      this.glowV = next;
      this.scene.lantern.setBrightness(next);
    }
  }

  /** The beam along the ridden ring line, while the lantern rides one. */
  private ringBeam(ctx: LanternCtx): void {
    if (this.ctrl.mode === "line") {
      const lock = this.ctrl.lock;
      const lines = ctx.lines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.lock !== lock) continue;
        this.beam.show(line.mark, line.dir, this.ctrl.pos);
        return;
      }
    }
    this.beam.hide();
  }
}
