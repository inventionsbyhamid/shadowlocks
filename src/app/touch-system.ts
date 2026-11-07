// A phone's touches in AR (Chrome's WebXR on ARCore), once a frame before the hands are read (priority -3.3,
// "touch"). Nothing here runs on a headset: only a session that is a phone's (touch.ts isHandheld: the AR module's
// screen-space mode, or a screen touch) turns it on, and then each touch is a ray from the camera through the finger.
// What a touch does is decided when it starts, by what its ray reaches first:
// - a live key (a menu key, the plate's Next, the hint lantern and its choices): a fingertip pokes it, in along its
//   face and back out when the finger lifts, so the keys' own rules press it;
// - the reward, once it can be taken: taken (a screen cannot carry it toward the player);
// - the lantern: held by the touch, as a hand would hold it (a stand-in for the right hand, setVirtualHand), at the
//   depth it was touched at: it follows the finger across the screen and nearer or farther as the phone moves;
//   lifting the finger lets it go;
// - the drawer's handle: opens it, as a pull would;
// - anything else: a finger in the light, cast so its shadow lies under the touch (the hands' TouchFinger), so a
//   finger lock's gap is filled by touching it and holding still.
// Up to two touches at once (a phone may report only one): the lantern held by one, the finger cast by the other.
// Allocation free per frame (the browser's own pose objects aside).
import { createSystem, Vector3, type World } from "@iwsdk/core";
import type { Box, V2, V3, Vec3 } from "../core/types";
import { GRAB_RADIUS_CM } from "../feel/constants";
import { type HandPinch, setVirtualHand } from "../input/grab-system";
import type { HandSide } from "../input/hand-joints";
import {
  dragPoint,
  fingerEnds,
  grabDepth,
  isHandheld,
  type KeyHit,
  nearestProng,
  newKeyHit,
  panelPoint,
  pokeOffset,
  type Prong,
  prongOf,
} from "../input/touch";
import type { BoxScene } from "../render/box-scene";
import { FINGER_RADIUS_CM } from "../render/hand-shadow";
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
  scene: Pick<BoxScene, "root" | "box" | "size">;
  lantern: Pick<Lantern, "ctrl" | "grab" | "frozen" | "away">;
}

/** A test build's touch: a ray from the head through `at` (world). */
export interface TestTouch {
  id: number;
  at: Vec3;
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
  startMs: number;
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
  depth: 0,
  key: newKeyHit(),
});

export class Touches implements TouchFinger {
  readonly slots: Slot[] = Array.from({ length: MAX_TOUCHES }, newSlot);
  private targets: TouchTargets = { keys: [] };
  private phoneFor: XRSession | null = null;
  private live = false;
  private testTouches: TestTouch[] | null = null;
  private prongsFor: Box | null = null;
  private prongs: Prong[] = [];
  private readonly hit = newKeyHit();
  private readonly drag: V3 = [0, 0, 0];
  private readonly at: V3 = [0, 0, 0];
  private readonly ob: V3 = [0, 0, 0];
  private readonly db: V3 = [0, 0, 0];
  private readonly q: V2 = [0, 0];
  private readonly v = new Vector3();
  private readonly head = new Vector3();

  constructor(private readonly d: TouchDeps) {}

  /** The menus, the box's keys, the reward and the drawer, once they exist. */
  connect(t: TouchTargets): void {
    this.targets = t;
  }

  /** The session is a phone's (this frame). */
  get phone(): boolean {
    return this.live;
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
  update(frame: XRFrame | null, ref: XRReferenceSpace | null, origin: { matrixWorld: { elements: ArrayLike<number> } }, headAt: Vector3): void {
    const now = performance.now();
    const session = frame?.session ?? null;
    if (session && session !== this.phoneFor && isHandheld(session)) this.phoneFor = session;
    this.live = session !== null && session === this.phoneFor;
    // Touches lifted on an earlier frame are done with (a lantern touch let go on the frame it lifted); a key's stays
    // until its poke is back out.
    for (const s of this.slots) {
      if (s.id === null || s.endMs !== s.endMs) continue;
      if (s.role !== "key" || this.pokeOver(s, now)) s.id = null;
    }
    if (!this.live || !frame || !ref) {
      for (const s of this.slots) s.id = null;
      return;
    }
    for (const s of this.slots) if (s.id !== null && s.endMs !== s.endMs) s.ok = false;
    const seen = this.read(frame, ref, origin, headAt, now);
    // A touch no longer listed has lifted.
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      if (s.id !== null && s.endMs !== s.endMs && !(seen & (1 << i))) s.endMs = now;
    }
    for (const s of this.slots) if (s.id !== null && !s.decided && s.ok && s.endMs !== s.endMs) this.decide(s, now);
  }

  private pokeOver(s: Slot, now: number): boolean {
    return Number.isNaN(pokeOffset(now - s.startMs, now - s.endMs, s.key.press));
  }

  /** This frame's touch rays into their slots; returns a bit per slot seen. */
  private read(frame: XRFrame, ref: XRReferenceSpace, origin: { matrixWorld: { elements: ArrayLike<number> } }, headAt: Vector3, now: number): number {
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
    const e = origin.matrixWorld.elements;
    for (let i = 0; i < list.length; i++) {
      const src = list[i]!;
      if (src.targetRayMode !== "screen") continue;
      const s = this.slotFor(src, now);
      if (!s) continue;
      seen |= 1 << this.slots.indexOf(s);
      const pose = frame.getPose(src.targetRaySpace, ref);
      if (!pose) continue;
      const p = pose.transform.position, q = pose.transform.orientation;
      // The ray runs along the pose's -z axis.
      const lx = -2 * (q.x * q.z + q.w * q.y), ly = -2 * (q.y * q.z - q.w * q.x), lz = -(1 - 2 * (q.x * q.x + q.y * q.y));
      // Into the world through the player rig, as the hands' joints are.
      s.o[0] = e[0]! * p.x + e[4]! * p.y + e[8]! * p.z + e[12]!;
      s.o[1] = e[1]! * p.x + e[5]! * p.y + e[9]! * p.z + e[13]!;
      s.o[2] = e[2]! * p.x + e[6]! * p.y + e[10]! * p.z + e[14]!;
      const dx = e[0]! * lx + e[4]! * ly + e[8]! * lz, dy = e[1]! * lx + e[5]! * ly + e[9]! * lz, dz = e[2]! * lx + e[6]! * ly + e[10]! * lz;
      const l = Math.hypot(dx, dy, dz);
      if (!(l > 0)) continue;
      s.d[0] = dx / l;
      s.d[1] = dy / l;
      s.d[2] = dz / l;
      s.ok = true;
    }
    return seen;
  }

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
    if (!this.has("key")) {
      for (const k of t.keys) k.tapHit(o, d, hit);
      if (hit.t < Infinity) keyT = hit.t;
    }
    const rewardT = t.reward ? t.reward.rewardDepth(o, d) : Number.NaN;
    const lanternT = this.lanternDepth(o, d);
    const drawerT = t.drawer ? t.drawer.tapDepth(o, d) : Number.NaN;
    let role: TouchRole = this.has("finger") ? null : "finger";
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
    } else if (role === "reward") t.reward!.tapReward();
    else if (role === "lantern") s.depth = lanternT;
    else if (role === "drawer") t.drawer!.tap(TOUCH_HAND);
  }

  private has(role: TouchRole): boolean {
    for (const s of this.slots) if (s.id !== null && s.role === role) return true;
    return false;
  }

  /** Along the ray to the lantern when it passes within the grab radius and the lantern can be taken now; else NaN. */
  private lanternDepth(o: Readonly<Vec3>, d: Readonly<Vec3>): number {
    const l = this.d.lantern;
    if (l.frozen || l.away || l.grab.holder !== null || this.has("lantern")) return Number.NaN;
    const p = l.ctrl.pos, m = this.d.scene.root.matrixWorld;
    const w = this.v.set(p[0], p[1], p[2]).applyMatrix4(m);
    this.at[0] = w.x;
    this.at[1] = w.y;
    this.at[2] = w.z;
    return grabDepth(o, d, this.at, GRAB_RADIUS_CM / 100);
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
    const s = this.live ? this.find("key") : null;
    if (!s) return false;
    const now = performance.now();
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
    const scene = this.d.scene, m = scene.root.matrixWorld;
    worldToBox(m, this.v.set(s.o[0], s.o[1], s.o[2]), this.ob);
    worldToBox(m, this.v.set(s.o[0] + s.d[0], s.o[1] + s.d[1], s.o[2] + s.d[2]), this.db);
    this.db[0] -= this.ob[0];
    this.db[1] -= this.ob[1];
    this.db[2] -= this.ob[2];
    if (!panelPoint(this.ob, this.db, this.q)) return false;
    const box = scene.box;
    if (box !== this.prongsFor) {
      // Once a box, never per frame.
      this.prongsFor = box;
      this.prongs = [];
      for (const l of box?.locks ?? []) {
        const p = prongOf(l);
        if (p) this.prongs.push(p);
      }
    }
    return fingerEnds(L, this.q, nearestProng(this.prongs, this.q), FINGER_RADIUS_CM / (scene.size * 100), out);
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
