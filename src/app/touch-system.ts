// A phone's touches in AR (Chrome's WebXR on ARCore), once a frame before the hands are read (priority -3.3,
// "touch"). Nothing here runs on a headset: only a session that is a phone's (touch.ts isHandheld: the AR module's
// screen-space mode, or a screen touch) turns it on, and a session that ever shows a hand or a controller (a tracked
// pointer) is never a phone's again. Each touch is a ray from the camera through the finger, read once a frame from the
// session's input sources; a tap shorter than a frame is caught through the session's selectstart and select.
// What a touch does is decided when it starts (never on the frame that first tells a phone, so the box has been placed
// in view first), by what its ray reaches first:
// - a live key (a menu key, the plate's Next, the hint lantern and its choices): a fingertip pokes it, in along its
//   face and back out when the finger lifts, so the keys' own rules press it; a quick second tap pokes after the first;
// - the reward, once it can be taken: taken (a screen cannot carry it toward the player);
// - the lantern, over its drawn shape from foot to ring (over its body alone when the touch reaches a finger lock's
//   gap, which is often seen just past it): held by the touch, as a hand would hold it (a stand-in for the right hand,
//   setVirtualHand), at the depth it was touched at: it follows the finger across the screen and nearer or farther as
//   the phone moves; lifting the finger lets it go;
// - the drawer's handle: opens it, as a pull would;
// - anything else: a finger in the light, cast so its shadow lies under the touch (the hands' TouchFinger), so a
//   finger lock's gap is filled by touching it and holding still.
// Up to two touches at once (a phone may report only one): the lantern held by one, the finger cast by the other.
// No touch is decided while the box waits, hidden, for its first placement (it is decided once the box shows).
// The lantern turns see-through on a phone (LanternView.setSeeThrough) while a touch holds it, or while its drawn shape,
// seen from the camera, stands in front of the panel: the finger and the lantern never hide the lock behind them.
// Allocation free per frame (the browser's own pose and event objects aside).
import { createSystem, Vector3, type World } from "@iwsdk/core";
import type { Box, V2, V3, Vec3 } from "../core/types";
import { type HandPinch, setVirtualHand } from "../input/grab-system";
import type { HandSide } from "../input/hand-joints";
import {
  dragPoint,
  fingerEnds,
  grabDepth,
  hasTrackedPointer,
  isHandheld,
  type KeyHit,
  nearestProng,
  newKeyHit,
  onProng,
  panelPoint,
  pokeOffset,
  type Prong,
  prongOf,
  rayNearSegment,
  TOUCH_GRAB,
  TOUCH_POKE,
} from "../input/touch";
import type { BoxScene } from "../render/box-scene";
import { FINGER_RADIUS_CM } from "../render/hand-shadow";
import type { LanternView } from "../render/lantern-view";
import { worldToBox } from "../render/placement";
import { frameTips } from "../ui/fingertips";
import type { TouchFinger } from "./hand-system";
import type { Lantern } from "./lantern-system";
import { registerAppSystem } from "./systems";

/** What a touch does, decided when it starts (null: nothing, such as a third finger). */
export type TouchRole = "key" | "reward" | "lantern" | "drawer" | "finger" | null;

/** The hand a touch holding the lantern stands in for. */
export const TOUCH_SIDE: 0 | 1 = 1;
const TOUCH_HAND: HandSide = "right";
/** Touches followed at once. */
const MAX_TOUCHES = 2;

/** What a phone's touch can reach besides the lantern and the box (wired once they exist). */
export interface TouchTargets {
  /** Keys: the menus' panel and the box's keys. The nearest hit along the ray goes into `out`. */
  keys: readonly { tapHit(o: Readonly<Vec3>, d: Readonly<Vec3>, out: KeyHit): boolean }[];
  reward?: { rewardDepth(o: Readonly<Vec3>, d: Readonly<Vec3>): number; tapReward(): void };
  drawer?: { tapDepth(o: Readonly<Vec3>, d: Readonly<Vec3>): number; tap(hand: HandSide): boolean };
}

export interface TouchDeps {
  scene: Pick<BoxScene, "root" | "box" | "size"> & { readonly lantern: Pick<LanternView, "allowSeeThrough" | "setSeeThrough"> };
  lantern: Pick<Lantern, "ctrl" | "grab" | "frozen" | "away">;
}

/**
 * The lantern's drawn shape round its light (box units: the foot's rim 0.058 out and 0.087 down, the ring's top 0.174
 * up): what must not stand in front of the panel as the camera sees it.
 */
const LANTERN_SHAPE = { side: 0.058, down: 0.087, up: 0.174 } as const;

/** A test build's touch: a ray from the head through `at` (world). */
export interface TestTouch {
  id: number;
  at: Vec3;
}

/** What the touch system reads of the player rig: the reference space to the world. */
interface Rig {
  matrixWorld: { elements: ArrayLike<number> };
}

/** The part of a session the tap events need (WebXR typings vary). */
interface Listenable {
  addEventListener?(type: string, fn: (e: XRInputSourceEvent) => void): void;
  removeEventListener?(type: string, fn: (e: XRInputSourceEvent) => void): void;
}

interface Slot {
  /** The input source (or a test touch's id) this slot follows; null when free. */
  id: unknown;
  role: TouchRole;
  /** Decided (a touch with no pose yet waits for one). */
  decided: boolean;
  /** This frame's ray (world): origin, unit direction; ok when it has a pose. */
  readonly o: Vec3;
  readonly d: Vec3;
  ok: boolean;
  /** The finger lifted (ms); NaN while it is down. A lantern touch lets go on that frame, a key's poke goes out. */
  endMs: number;
  /** When it was decided; for a key, when its poke starts (after an earlier poke is out). */
  startMs: number;
  /** A tap caught only by its events lifts as soon as it is decided. */
  endAfterDecide: boolean;
  /** The lantern's depth along the ray when it was touched (m). */
  depth: number;
  readonly key: KeyHit;
}

const newSlot = (): Slot => ({
  id: null,
  role: null,
  decided: false,
  o: [0, 0, 0],
  d: [0, 0, -1],
  ok: false,
  endMs: Number.NaN,
  startMs: 0,
  endAfterDecide: false,
  depth: 0,
  key: newKeyHit(),
});

/** A screen tap seen through the session's events (it may come and go between two frames). */
interface Tap {
  src: unknown;
  readonly o: Vec3;
  readonly d: Vec3;
  ended: boolean;
}

/** The ray of a pose (it runs along the pose's -z axis), carried into the world by the rig matrix `e`. */
function rayOf(pose: XRPose, e: ArrayLike<number>, o: Vec3, d: Vec3): boolean {
  const p = pose.transform.position, q = pose.transform.orientation;
  const lx = -2 * (q.x * q.z + q.w * q.y), ly = -2 * (q.y * q.z - q.w * q.x), lz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const dx = e[0]! * lx + e[4]! * ly + e[8]! * lz, dy = e[1]! * lx + e[5]! * ly + e[9]! * lz, dz = e[2]! * lx + e[6]! * ly + e[10]! * lz;
  const l = Math.hypot(dx, dy, dz);
  if (!(l > 0)) return false;
  o[0] = e[0]! * p.x + e[4]! * p.y + e[8]! * p.z + e[12]!;
  o[1] = e[1]! * p.x + e[5]! * p.y + e[9]! * p.z + e[13]!;
  o[2] = e[2]! * p.x + e[6]! * p.y + e[10]! * p.z + e[14]!;
  d[0] = dx / l;
  d[1] = dy / l;
  d[2] = dz / l;
  return true;
}

export class Touches implements TouchFinger {
  readonly slots: Slot[] = Array.from({ length: MAX_TOUCHES }, newSlot);
  private targets: TouchTargets = { keys: [] };
  private phoneFor: XRSession | null = null;
  /** A session that has shown a hand or a controller: never a phone's. */
  private vetoFor: XRSession | null = null;
  private live = false;
  /** This frame first told a phone: its touches are decided next frame, once the box is in view. */
  private latchedNow = false;
  private testTouches: TestTouch[] | null = null;
  private prongsFor: Box | null | undefined = undefined;
  private prongs: Prong[] = [];
  /** The session whose tap events are heard, and what the handlers read (this frame's reference space and rig). */
  private heard: (XRSession & Listenable) | null = null;
  private ref: XRReferenceSpace | null = null;
  private rig: Rig | null = null;
  private readonly taps: Tap[] = Array.from({ length: MAX_TOUCHES }, (): Tap => ({ src: null, o: [0, 0, 0], d: [0, 0, -1], ended: false }));
  private readonly hit = newKeyHit();
  private readonly drag: V3 = [0, 0, 0];
  private readonly at: V3 = [0, 0, 0];
  private readonly top: V3 = [0, 0, 0];
  private readonly bottom: V3 = [0, 0, 0];
  private readonly ob: V3 = [0, 0, 0];
  private readonly db: V3 = [0, 0, 0];
  private readonly q: V2 = [0, 0];
  private readonly v = new Vector3();
  /** The camera in box units (the see-through test). */
  private readonly cam: V3 = [0, 0, 0];
  /** The see-through last asked of the lantern (0 or 1). */
  private see = 0;

  constructor(private readonly d: TouchDeps) {}

  /** The menus, the box's keys, the reward and the drawer, once they exist. */
  connect(t: TouchTargets): void {
    this.targets = t;
  }

  /** The session is a phone's (this frame). */
  get phone(): boolean {
    return this.live;
  }

  /** A phone's touch is down, or the lantern is held: the box must not be placed again under it. */
  get busy(): boolean {
    if (!this.live) return false;
    if (this.d.lantern.grab.holder !== null) return true;
    for (const s of this.slots) if (s.id !== null && s.endMs !== s.endMs) return true;
    return false;
  }

  /** Test builds: touches as rays from the head through world points (null: back to the session's own). */
  inject(list: TestTouch[] | null): void {
    this.testTouches = list;
  }

  /** The role of each touch now (tests). */
  roles(): TouchRole[] {
    return this.slots.filter((s) => s.id !== null).map((s) => s.role);
  }

  /** One frame (the system's update). */
  update(frame: XRFrame | null, ref: XRReferenceSpace | null, rig: Rig, headAt: Vector3): void {
    const now = performance.now();
    const session = frame?.session ?? null;
    this.latchedNow = false;
    if (session && session !== this.vetoFor && hasTrackedPointer(session)) {
      // A hand or a controller: a headset, whatever else the session said. Never a phone's again.
      this.vetoFor = session;
      if (this.phoneFor === session) this.phoneFor = null;
    } else if (session && session !== this.vetoFor && session !== this.phoneFor) {
      // A test build's touches stand for screen touches among the session's input sources.
      if (isHandheld(session) || (this.testTouches?.length ?? 0) > 0) {
        this.phoneFor = session;
        this.latchedNow = true;
      }
    }
    this.live = session !== null && session === this.phoneFor;
    this.listen(this.live ? session : null);
    this.ref = ref;
    this.rig = rig;
    // Touches lifted on an earlier frame are done with (a lantern touch let go on the frame it lifted); a key's stays
    // until its poke is back out.
    for (const s of this.slots) {
      if (s.id === null || s.endMs !== s.endMs) continue;
      if (s.role !== "key" || this.pokeOver(s, now)) s.id = null;
    }
    if (!this.live || !frame || !ref) {
      for (const s of this.slots) s.id = null;
      for (const t of this.taps) t.src = null;
      this.seeThrough(headAt);
      return;
    }
    for (const s of this.slots) if (s.id !== null && s.endMs !== s.endMs) s.ok = false;
    let seen = this.read(frame, ref, rig, headAt, now);
    seen |= this.caught(now);
    // A touch no longer listed has lifted.
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (s.id !== null && s.endMs !== s.endMs && !(seen & (1 << i))) s.endMs = now;
    }
    // Not on the frame that first tells a phone, nor while the box waits hidden for its first placement.
    if (!this.latchedNow && this.d.scene.root.visible) {
      for (const s of this.slots) {
        if (s.id === null || s.decided || !s.ok || s.endMs === s.endMs) continue;
        this.decide(s, now);
        if (s.endAfterDecide) s.endMs = now;
      }
    }
    this.seeThrough(headAt);
  }

  /**
   * A phone's lantern see-through (its program asked for once): while a touch holds it, or while its drawn shape, seen
   * from the camera at `headAt`, stands in front of the panel. Told only when it changes.
   */
  private seeThrough(headAt: Vector3): void {
    const view = this.d.scene.lantern;
    let k = 0;
    if (this.live) {
      view.allowSeeThrough();
      if (this.down("lantern") || this.inFrontOfPanel(headAt)) k = 1;
    }
    if (k === this.see) return;
    this.see = k;
    view.setSeeThrough(k);
  }

  /**
   * The lantern's drawn shape round its light (LANTERN_SHAPE), seen from the camera at `headAt` (world), falls on the
   * panel: the light's place on the panel's plane, the shape's reach grown by how much nearer the camera it is.
   */
  private inFrontOfPanel(headAt: Vector3): boolean {
    const c = worldToBox(this.d.scene.root.matrixWorld, headAt, this.cam), L = this.d.lantern.ctrl.pos;
    const gap = c[2] - L[2];
    if (!(L[2] > 0) || !(gap > 0)) return false;
    const t = c[2] / gap, x = c[0] + (L[0] - c[0]) * t, y = c[1] + (L[1] - c[1]) * t, S = LANTERN_SHAPE;
    return Math.abs(x) <= 0.5 + S.side * t && y >= -0.5 - S.up * t && y <= 0.5 + S.down * t;
  }

  private pokeOver(s: Slot, now: number): boolean {
    return Number.isNaN(pokeOffset(now - s.startMs, now - s.endMs, s.key.press));
  }

  /** This frame's touch rays into their slots; returns a bit per slot seen. */
  private read(frame: XRFrame, ref: XRReferenceSpace, rig: Rig, headAt: Vector3, now: number): number {
    let seen = 0;
    const tests = this.testTouches;
    if (tests) {
      for (const t of tests) {
        const s = this.slotFor(t.id, now);
        if (!s) continue;
        seen |= 1 << this.slots.indexOf(s);
        const dx = t.at[0] - headAt.x, dy = t.at[1] - headAt.y, dz = t.at[2] - headAt.z, l = Math.hypot(dx, dy, dz);
        if (!(l > 0)) continue;
        s.o[0] = headAt.x;
        s.o[1] = headAt.y;
        s.o[2] = headAt.z;
        s.d[0] = dx / l;
        s.d[1] = dy / l;
        s.d[2] = dz / l;
        s.ok = true;
      }
      return seen;
    }
    const list = frame.session.inputSources;
    const e = rig.matrixWorld.elements;
    for (let i = 0; i < list.length; i++) {
      const src = list[i]!;
      if (src.targetRayMode !== "screen") continue;
      const s = this.slotFor(src, now);
      if (!s) continue;
      seen |= 1 << this.slots.indexOf(s);
      const pose = frame.getPose(src.targetRaySpace, ref);
      if (pose && rayOf(pose, e, s.o, s.d)) s.ok = true;
    }
    return seen;
  }

  /**
   * Taps the session's events caught since the last frame that the frame's own input sources did not list (it came
   * and went between two frames): each takes a slot with the ray it began with, and one that has already lifted lifts
   * as soon as it is decided. Returns a bit per slot it filled.
   */
  private caught(now: number): number {
    let seen = 0;
    for (const t of this.taps) {
      if (t.src === null) continue;
      const src = t.src;
      t.src = null;
      let known = false;
      for (const s of this.slots) if (s.id === src) known = true;
      if (known) continue;
      const s = this.slotFor(src, now);
      if (!s) continue;
      seen |= 1 << this.slots.indexOf(s);
      for (let i = 0; i < 3; i++) {
        s.o[i] = t.o[i]!;
        s.d[i] = t.d[i]!;
      }
      s.ok = true;
      s.endAfterDecide = t.ended;
    }
    return seen;
  }

  /** Hear the phone's session's tap events (and stop hearing the last one's). */
  private listen(session: XRSession | null): void {
    if (session === this.heard) return;
    const old = this.heard;
    old?.removeEventListener?.("selectstart", this.onTapStart);
    old?.removeEventListener?.("select", this.onTapEnd);
    old?.removeEventListener?.("selectend", this.onTapEnd);
    const s = session as (XRSession & Listenable) | null;
    this.heard = s;
    s?.addEventListener?.("selectstart", this.onTapStart);
    s?.addEventListener?.("select", this.onTapEnd);
    s?.addEventListener?.("selectend", this.onTapEnd);
  }

  /** A screen touch began: its ray, read from the event's frame, waits for the next update. */
  private readonly onTapStart = (e: XRInputSourceEvent): void => {
    const src = e.inputSource;
    if (src.targetRayMode !== "screen" || !this.ref || !this.rig) return;
    let t: Tap | null = null;
    for (const x of this.taps) if (x.src === null || x.src === src) t = x;
    if (!t) return;
    let pose: XRPose | undefined;
    try {
      pose = e.frame.getPose(src.targetRaySpace, this.ref);
    } catch {
      return;
    }
    if (!pose || !rayOf(pose, this.rig.matrixWorld.elements, t.o, t.d)) return;
    t.src = src;
    t.ended = false;
  };

  /** A screen touch lifted: a tap still waiting for its update lifts as soon as it is decided. */
  private readonly onTapEnd = (e: XRInputSourceEvent): void => {
    for (const t of this.taps) if (t.src === e.inputSource) t.ended = true;
  };

  /** The slot following `id` (a new touch takes a free one); null when every slot is taken. */
  private slotFor(id: unknown, now: number): Slot | null {
    for (const s of this.slots) if (s.id === id && s.endMs !== s.endMs) return s;
    for (const s of this.slots) {
      if (s.id !== null) continue;
      s.id = id;
      s.role = null;
      s.decided = false;
      s.ok = false;
      s.endMs = Number.NaN;
      s.startMs = now;
      s.endAfterDecide = false;
      return s;
    }
    return null;
  }

  /** What a new touch does: the first thing its ray reaches (see the module comment). */
  private decide(s: Slot, now: number): void {
    s.decided = true;
    s.startMs = now;
    const t = this.targets, o = s.o, d = s.d;
    const hit = this.hit;
    hit.t = Infinity;
    let keyT = Number.NaN;
    // One finger on the keys at a time; one that has lifted (its poke going out) does not stand in the way.
    if (!this.down("key")) {
      for (const k of t.keys) k.tapHit(o, d, hit);
      if (hit.t < Infinity) keyT = hit.t;
    }
    const rewardT = t.reward ? t.reward.rewardDepth(o, d) : Number.NaN;
    const lanternT = this.lanternDepth(o, d);
    const drawerT = t.drawer ? t.drawer.tapDepth(o, d) : Number.NaN;
    let role: TouchRole = this.down("finger") ? null : "finger";
    let best = Infinity;
    if (keyT < best) {
      best = keyT;
      role = "key";
    }
    if (rewardT < best) {
      best = rewardT;
      role = "reward";
    }
    if (lanternT < best) {
      best = lanternT;
      role = "lantern";
    }
    if (drawerT < best) {
      best = drawerT;
      role = "drawer";
    }
    s.role = role;
    if (role === "key") {
      const k = s.key;
      k.t = hit.t;
      k.press = hit.press;
      for (let i = 0; i < 3; i++) {
        k.point[i] = hit.point[i]!;
        k.normal[i] = hit.normal[i]!;
      }
      // A quick second tap: its poke starts once the first one is back out, so both press.
      s.startMs = Math.max(now, this.pokesOut(s));
    } else if (role === "reward") t.reward!.tapReward();
    else if (role === "lantern") s.depth = lanternT;
    else if (role === "drawer") t.drawer!.tap(TOUCH_HAND);
  }

  /** When every other key's poke is back out (ms; -Infinity with none). */
  private pokesOut(except: Slot): number {
    let end = -Infinity;
    for (const s of this.slots) {
      if (s === except || s.id === null || s.role !== "key") continue;
      const lifted = s.endMs === s.endMs ? s.endMs : Infinity;
      end = Math.max(end, Math.max(lifted, s.startMs + TOUCH_POKE.inMs) + TOUCH_POKE.outMs);
    }
    return end;
  }

  /** A touch in this role is down (not lifted). */
  private down(role: TouchRole): boolean {
    for (const s of this.slots) if (s.id !== null && s.role === role && s.endMs !== s.endMs) return true;
    return false;
  }

  /** The finger locks' prongs of the box shown (made once a box, never per frame). */
  private boxProngs(): readonly Prong[] {
    const box = this.d.scene.box;
    if (box !== this.prongsFor) {
      this.prongsFor = box;
      this.prongs = [];
      for (const l of box?.locks ?? []) {
        const p = prongOf(l);
        if (p) this.prongs.push(p);
      }
    }
    return this.prongs;
  }

  /** A touch ray (world) in box units, where it meets the panel, into `q`; false when it does not. */
  private panelOf(o: Readonly<Vec3>, d: Readonly<Vec3>, q: V2): boolean {
    const m = this.d.scene.root.matrixWorld;
    worldToBox(m, this.v.set(o[0], o[1], o[2]), this.ob);
    worldToBox(m, this.v.set(o[0] + d[0], o[1] + d[1], o[2] + d[2]), this.db);
    this.db[0] -= this.ob[0];
    this.db[1] -= this.ob[1];
    this.db[2] -= this.ob[2];
    return panelPoint(this.ob, this.db, q);
  }

  /**
   * Along the ray to the lantern's light when the ray passes over the lantern's drawn shape, foot to ring (over its body
   * alone when the touch reaches a finger lock's gap) and the lantern can be taken now; else NaN.
   */
  private lanternDepth(o: Readonly<Vec3>, d: Readonly<Vec3>): number {
    const l = this.d.lantern;
    if (l.frozen || l.away || l.grab.holder !== null || this.down("lantern")) return Number.NaN;
    const gap = this.panelOf(o, d, this.q) && onProng(this.boxProngs(), this.q, TOUCH_GRAB.gapMargin);
    const size = this.d.scene.size, p = l.ctrl.pos, m = this.d.scene.root.matrixWorld;
    const w = this.v.set(p[0], p[1], p[2]).applyMatrix4(m);
    this.at[0] = w.x;
    this.at[1] = w.y;
    this.at[2] = w.z;
    // Over a gap, its body alone (a sphere round the light).
    if (gap) return grabDepth(o, d, this.at, TOUCH_GRAB.bodyRadius * size);
    // Elsewhere, its drawn shape: the capsule up its axis (the box's own up: it stands in the box).
    const R = TOUCH_GRAB.reach, e = m.elements;
    for (let i = 0; i < 3; i++) {
      this.bottom[i] = this.at[i]! - e[4 + i]! * R.down;
      this.top[i] = this.at[i]! + e[4 + i]! * R.up;
    }
    if (!rayNearSegment(o, d, this.bottom, this.top, R.radius * size)) return Number.NaN;
    // The drag holds the ray's nearest point to the light: in front of the phone, within the controller's grab radius.
    return grabDepth(o, d, this.at, (R.up + R.radius) * size);
  }

  private find(role: TouchRole): Slot | null {
    for (const s of this.slots) if (s.id !== null && s.role === role) return s;
    return null;
  }

  /**
   * HandPinchSystem's stand-in (setVirtualHand): the touch holding the lantern as the right hand, a controller pinching
   * at the drag point; on the frame the finger lifts, not pinching (the lantern is let go there). Without a pose (the
   * phone lost tracking) it is out of tracking, so the lantern stays where it is, held.
   */
  readonly virtualHand = (side: 0 | 1, out: HandPinch): boolean => {
    if (side !== TOUCH_SIDE || !this.live) return false;
    const s = this.find("lantern");
    if (!s) return false;
    const was = out.kind === "controller" && out.pinching;
    const pinching = s.endMs !== s.endMs;
    out.kind = "controller";
    out.tracked = s.ok || !pinching;
    out.pinching = pinching;
    out.edge = pinching && !was ? "start" : !pinching && was ? "end" : null;
    if (s.ok) {
      dragPoint(s.o, s.d, s.depth, this.drag);
      out.point.set(this.drag[0], this.drag[1], this.drag[2]);
    }
    out.anchor.copy(out.point);
    out.rot.identity();
    return true;
  };

  /** The fingertip of a touch poking a key (FrameTips' extra), into `out`; false while none pokes. */
  readonly pokeTip = (out: Vector3): boolean => {
    if (!this.live) return false;
    const now = performance.now();
    // The earliest poke under way (a second tap's waits until the first is back out).
    let s: Slot | null = null;
    for (const x of this.slots) {
      if (x.id === null || x.role !== "key" || x.startMs > now || this.pokeOver(x, now)) continue;
      if (!s || x.startMs < s.startMs) s = x;
    }
    if (!s) return false;
    const off = pokeOffset(now - s.startMs, s.endMs === s.endMs ? now - s.endMs : Number.NaN, s.key.press);
    if (off !== off) return false;
    const p = s.key.point, n = s.key.normal;
    out.set(p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off);
    return true;
  };

  /** TouchFinger: this frame's touch finger in the light, for lantern `L` (box units). */
  ends(L: Readonly<V3>, out: Float64Array): boolean {
    if (!this.live) return false;
    const s = this.find("finger");
    if (!s || !s.ok || s.endMs === s.endMs) return false;
    if (!this.panelOf(s.o, s.d, this.q)) return false;
    const prongs = this.boxProngs();
    return fingerEnds(L, this.q, nearestProng(prongs, this.q), FINGER_RADIUS_CM / (this.d.scene.size * 100), out);
  }
}

let current: Touches | null = null;

export class TouchSystem extends createSystem({}) {
  private readonly headAt = new Vector3();

  update(): void {
    const t = current;
    if (!t) return;
    const frame = (this.xrFrame ?? null) as XRFrame | null;
    this.player.head.getWorldPosition(this.headAt);
    t.update(frame, frame ? this.renderer.xr.getReferenceSpace() : null, this.player, this.headAt);
  }
}

/** The session is a phone's (the touch system decided this frame); false before it runs or with none. */
export function onPhone(): boolean {
  return current?.phone ?? false;
}

/** On a phone, a touch is down or the lantern is held (Touches.busy); false on a headset or before the system runs. */
export function touchBusy(): boolean {
  return current?.busy ?? false;
}

/**
 * A phone's touches: registers TouchSystem (priority -3.3, "touch", before the hands), the right hand's stand-in and
 * the poking fingertip. Call once, after attachLantern; `connect` the menus, keys, reward and drawer once they exist.
 */
export function attachTouch(world: World, d: TouchDeps): Touches {
  const t = new Touches(d);
  current = t;
  setVirtualHand(t.virtualHand);
  frameTips(world).extra = t.pokeTip;
  registerAppSystem(world, TouchSystem, { priority: -3.3, name: "touch" });
  return t;
}
