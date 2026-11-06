// The menu drawer in the app: while a box (or nothing) is in the lap and no menu is up, a hand can
// pinch the drawer's handle and pull it open; the drawer follows the hand, clunks open past 4 cm and
// the Home panel rises on it. Any menu screen keeps it open; going back to play slides it shut. Its
// gold glows as a hand comes near the handle. Runs as the "drawer" system after the lantern (a hand
// that grabbed the lantern this frame is busy) and before the menus. Allocation free per frame.
import { createSystem, type Mesh, type MeshStandardMaterial, type Object3D, Vector3, type World } from "@iwsdk/core";
import type { Vec3 } from "../core/types";
import { DRAWER_PULL, type DrawerFrame, type DrawerHands, DrawerPull } from "../input/drawer-pull";
import { type HandPinch, handJoints, hands, SIDES } from "../input/grab-system";
import type { HandJoints, HandSide } from "../input/hand-joints";
import { DrawerView } from "../render/drawer";
import { emit, on } from "./bus";
import { go, isMenuScreen, type Screen } from "./screens";
import { registerAppSystem } from "./systems";

/** The handle glows from this far (m)... */
export const DRAWER_GLOW_FAR_M = 0.14;
/** ...fully from this close: the grip radius, so "fully lit" means "pinch now and you have it". */
export const DRAWER_GLOW_NEAR_M = DRAWER_PULL.gripM;

/** Hands and controllers as the drawer reads them: a controller's trigger or squeeze is its pinch, at its grip. */
export function drawerHands(pinches: readonly [HandPinch, HandPinch], joints: HandJoints): DrawerHands {
  const at = (h: HandSide) => pinches[h === "left" ? 0 : 1];
  return {
    tracked: (h) => {
      const p = at(h);
      return p.kind === "hand" ? joints.tracked(h) : p.kind === "controller" && p.tracked;
    },
    pinchPoint: (h, out) => {
      const p = at(h);
      if (p.kind === "hand") return joints.pinchPoint(h, out);
      if (p.kind !== "controller" || !p.tracked) return false;
      out.copy(p.point);
      return true;
    },
    pinchDistance: (h) => {
      const p = at(h);
      if (p.kind === "hand") return joints.pinchDistance(h);
      return p.kind === "controller" ? (p.pinching ? 0 : 1) : Number.NaN;
    },
    joint: (h, j, out) => {
      const p = at(h);
      if (p.kind === "hand") return joints.joint(h, j, out);
      if (p.kind !== "controller" || !p.tracked) return false;
      out.copy(p.point);
      return true;
    },
  };
}

export interface MenuDrawerDeps {
  /** The box root (box units to world). */
  root: Object3D;
  /** The lantern's holder: that hand never pulls the drawer. */
  busy?: (side: 0 | 1) => boolean;
  /** Pulling is allowed now beyond "no menu up" (false while the box is opening, say). */
  allowed?: () => boolean;
  reducedMotion: () => boolean;
  /** The drawer was pulled open by `hand`, its handle at `at` (world): its sound and haptics. */
  pulled?: (at: Vec3, hand: HandSide) => void;
  /** A menu came up over play (true) or went away back to play (false). */
  menuOpen?: (open: boolean) => void;
  /** Any menu is up (true) or none (false): the lantern is put away, so it never stands in front of a panel. */
  away?: (away: boolean) => void;
  pinches?: readonly [HandPinch, HandPinch];
  joints?: HandJoints;
}

export class MenuDrawer {
  readonly view: DrawerView;
  readonly pull: DrawerPull;
  private readonly hands: DrawerHands;
  private readonly frame: DrawerFrame;
  private screen: Screen = "boot";
  private opened = 0;
  private lastT = Number.NaN;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly at: Vec3 = [0, 0, 0];

  constructor(private readonly d: MenuDrawerDeps) {
    const trim = d.root.getObjectByName("Box Trim") as Mesh | undefined;
    const env = (trim?.material as MeshStandardMaterial | undefined)?.envMap ?? null;
    this.view = new DrawerView(d.root, env);
    this.hands = drawerHands(d.pinches ?? hands, d.joints ?? handJoints);
    const root = d.root;
    this.frame = {
      handle: (out) => this.view.handle(out).applyMatrix4(root.matrixWorld),
      toward: (out) => {
        const e = root.matrixWorld.elements;
        return out.set(e[8]!, e[9]!, e[10]!).normalize();
      },
    };
    this.pull = new DrawerPull(this.frame, {
      busy: d.busy,
      enabled: () => this.screen === "play" && (d.allowed?.() ?? true),
    });
    on("screen", (e) => this.screenChanged(e.from, e.to));
  }

  /** Per frame at `tMs`. */
  update(tMs: number): void {
    const dt = Number.isNaN(this.lastT) ? 0 : Math.min(0.1, Math.max(0, (tMs - this.lastT) / 1000));
    this.lastT = tMs;
    const pull = this.pull;
    const hand = pull.hand;
    pull.update(this.hands, tMs);
    if (pull.state === "opening") {
      // Under the fingers, 1:1: the pull so far, in box units.
      this.view.follow((pull.progress * DRAWER_PULL.openM) / this.d.root.scale.x);
      this.view.sync();
    } else if (pull.opened !== this.opened) {
      this.opened = pull.opened;
      this.view.setOpen(true);
      const h = this.frame.handle(this.tmp);
      this.at[0] = h.x;
      this.at[1] = h.y;
      this.at[2] = h.z;
      const side = hand ?? "right";
      this.d.pulled?.(this.at, side);
      emit({ type: "drawer", hand: side });
      go("home");
    } else if (pull.state === "closed" && this.view.out > 0 && !isMenuScreen(this.screen)) {
      this.view.setOpen(false);
    }
    this.view.update(dt, this.d.reducedMotion());
    this.glow();
  }

  /** The gold lights up as a pinch point comes near the handle (only while it can be pulled). */
  private glow(): void {
    if (this.pull.state === "opening") {
      this.view.setGlow(1);
      return;
    }
    // No "pinch here" while it cannot be pulled: a menu is up, or the box is opening or its reward is up.
    if (this.screen !== "play" || !(this.d.allowed?.() ?? true)) {
      this.view.setGlow(0);
      return;
    }
    const handle = this.frame.handle(this.tmp);
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i]!;
      if (this.d.busy?.(i as 0 | 1)) continue;
      if (!this.hands.pinchPoint(side, this.tmp2)) continue;
      const dist = this.tmp2.distanceTo(handle);
      if (dist < best) best = dist;
    }
    this.view.setGlow((DRAWER_GLOW_FAR_M - best) / (DRAWER_GLOW_FAR_M - DRAWER_GLOW_NEAR_M));
  }

  private screenChanged(from: Screen, to: Screen): void {
    this.screen = to;
    const menu = isMenuScreen(to);
    if (menu !== isMenuScreen(from)) this.d.away?.(menu);
    if (menu) {
      if (this.pull.state !== "open") this.pull.open();
      this.view.setOpen(true);
      if (from === "play") this.d.menuOpen?.(true);
    } else {
      this.pull.close();
      this.view.setOpen(false);
      if (isMenuScreen(from) && to === "play") this.d.menuOpen?.(false);
    }
  }
}

let current: MenuDrawer | null = null;

export class DrawerSystem extends createSystem({}) {
  update(): void {
    current?.update(performance.now());
  }
}

/** The menu drawer in the box: registers DrawerSystem ("drawer", priority -2.7, after the lantern). Call once. */
export function attachDrawer(world: World, d: MenuDrawerDeps): MenuDrawer {
  const drawer = new MenuDrawer(d);
  current = drawer;
  registerAppSystem(world, DrawerSystem, { priority: -2.7, name: "drawer" });
  return drawer;
}
