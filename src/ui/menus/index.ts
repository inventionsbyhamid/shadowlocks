// The menus: one UIKitML panel per screen, floating in front of the box and pressed with a
// fingertip (or a ray). Paints each screen when it opens, springs panels in and out, moves every
// keycap, emits `hover` and `press` on the bus (audio turns them into clicks) and acts on presses.
// Each panel has a placeholder slab for a body (src/ui/panel-slab.ts). Per-frame work (`update`)
// does not allocate.
import { type Object3D, type UIKitMLAsset, Vector3, type World } from "@iwsdk/core";
import { emit, on } from "../../app/bus";
import type { BoxPose } from "../../render/placement";
import type { ProfileStore } from "../../app/profile-store";
import { go, type Screen } from "../../app/screens";
import type { SettingsStore } from "../../app/settings";
import { type FrameTips, frameTips } from "../fingertips";
import { KeyView, NO_TIPS } from "../key-view";
import { MOTION } from "../motion";
import { PanelSlabs } from "../panel-slab";
import { PanelView } from "../panel-ui";
import { UI } from "../theme";
import { PanelMotion } from "../transitions";
import { HOME, homeView, paintHome } from "./home";
import { paintSettings, SETTINGS, settingAction, settingsView, sliderPosition, TOGGLES } from "./settings";
import type { MenuSpec } from "./types";

export const MENU_SPECS: readonly MenuSpec[] = [HOME, SETTINGS];

/**
 * Where panels float, from the box pose (its back panel's centre): the bottom edge level with the
 * bottom of a 24 cm box and 16 cm toward the player, leaning back 35 degrees so the face looks up
 * at the seated player's eyes. Panels grow upward from that edge (UIKit anchor bottom). The menus
 * pass moves them into the drawer.
 */
export const MENU_PLACE = { up: -0.12, toward: 0.16, tiltRad: (-35 * Math.PI) / 180 };

/** One UIKit unit is 1 mm (scene scale 0.1, UIKit pixel size 1 cm): 1 mm in the panel's local units. */
const MM = 1 / 100;

export interface MenuActions {
  /** Place the box again from where the head is now. */
  recenter(): void;
}

export interface MenuDeps {
  profiles: ProfileStore;
  settings: SettingsStore;
  actions: MenuActions;
}

/** A pokeable key, for the test hooks. */
export interface MenuButton {
  id: string;
  screen: Screen;
  object: Object3D;
}

interface LivePanel {
  spec: MenuSpec;
  asset: UIKitMLAsset;
  view: PanelView;
  motion: PanelMotion;
  keys: KeyView[];
}

export class Menus {
  private readonly live: LivePanel[] = [];
  private readonly byScreen = new Map<Screen, LivePanel>();
  private screen: Screen = "boot";
  /** The box pose panels follow, and whether a move waits for the finger to leave. */
  private readonly pose: BoxPose = { position: [0, 0, 0], yaw: 0 };
  private hasPose = false;
  private layoutWaiting = false;
  /** Placeholder panel bodies. */
  private readonly slabs: PanelSlabs;
  private slabsShown = false;
  private readonly tips: FrameTips;
  private readonly countEvent: { type: "count"; id: string; k: number; done: boolean } = { type: "count", id: "", k: 0, done: false };

  constructor(
    world: World,
    private readonly deps: MenuDeps,
  ) {
    this.slabs = new PanelSlabs(world, UI.slab);
    this.tips = frameTips(world);
    const hooks = {
      live: (k: KeyView) => this.isLive(k),
      hoverChanged: (k: KeyView) => this.hoverChanged(k),
      hover: (k: KeyView) => {
        if (this.isLive(k)) emit({ type: "hover", id: k.id });
      },
      press: (k: KeyView) => emit({ type: "press", id: k.id }),
      act: (k: KeyView) => this.act(k.id),
    };
    for (const spec of MENU_SPECS) {
      const asset = world.getSceneObject<UIKitMLAsset>(spec.node);
      if (!asset) {
        console.warn(`menu panel "${spec.node}" is missing from the scene`);
        continue;
      }
      asset.visible = false;
      const view = new PanelView(asset, spec);
      // Numbers counting up: their ticks and landings are sounds. One event object, refilled for
      // every step (a count-up steps on many frames); listeners keep a copy if they need one.
      view.onRoll = (id, k, done) => {
        const e = this.countEvent;
        e.id = id;
        e.k = k;
        e.done = done;
        emit(e);
      };
      const keys: KeyView[] = [];
      for (const id of spec.keys) {
        const el = view.el(id);
        if (!el) continue;
        keys.push(new KeyView(id, spec.screen, el, view.el(`${id}-cap`), view.el(`${id}-glow`), hooks));
      }
      const p: LivePanel = { spec, asset, view, motion: new PanelMotion(), keys };
      this.live.push(p);
      this.byScreen.set(spec.screen, p);
    }
    deps.settings.subscribe(() => {
      if (this.screen === "settings") this.paint("settings");
    });
    // A save that finds storage gone raises the notice later; show it if Home is up.
    on("notice", () => {
      if (this.screen === "home") this.paint("home");
    });
  }

  /** The screen changed: the old panel leaves, the new one is painted and springs in. */
  show(to: Screen): void {
    const from = this.screen;
    if (from === to) return;
    this.screen = to;
    if (this.layoutWaiting) this.placePanels();
    const out = this.byScreen.get(from);
    const into = this.byScreen.get(to);
    let delay = 0;
    if (out && out !== into) {
      out.motion.exit();
      for (const k of out.keys) {
        k.forgetPointers();
        k.motion.release();
      }
      // With reduced motion both run at once: the whole change takes 40 ms.
      if (out.motion.visible && !this.deps.settings.get().reducedMotion) delay = MOTION.panel.enterDelayS;
    }
    if (into) {
      this.paint(to);
      for (const k of into.keys) {
        k.forgetPointers();
        k.motion.reset();
        k.apply(0);
      }
      into.motion.enter(delay);
      into.asset.visible = true;
      this.applyPanel(into);
    }
  }

  /**
   * Put every panel in front of the box. Not per frame: only when the box moves. While a fingertip
   * is on a key of the current panel the move waits (a panel moving onto a finger would press a key
   * again, say right after Recenter); it happens once the finger leaves or the screen changes.
   */
  layout(pose: Readonly<BoxPose>): void {
    this.pose.position[0] = pose.position[0];
    this.pose.position[1] = pose.position[1];
    this.pose.position[2] = pose.position[2];
    this.pose.yaw = pose.yaw;
    this.hasPose = true;
    if (this.fingerOnCurrent()) {
      this.layoutWaiting = true;
      return;
    }
    this.placePanels();
  }

  /** A layout is waiting for the finger to leave the current panel (tests). */
  get layoutHeld(): boolean {
    return this.layoutWaiting;
  }

  private fingerOnCurrent(): boolean {
    const p = this.byScreen.get(this.screen);
    if (!p) return false;
    for (const k of p.keys) if (k.touched) return true;
    return false;
  }

  private placePanels(): void {
    this.layoutWaiting = false;
    if (!this.hasPose) return;
    const pose = this.pose;
    const [x, y, z] = pose.position;
    const s = Math.sin(pose.yaw);
    const c = Math.cos(pose.yaw);
    for (const p of this.live) {
      const o = p.asset;
      o.position.set(x + s * MENU_PLACE.toward, y + MENU_PLACE.up, z + c * MENU_PLACE.toward);
      o.rotation.set(MENU_PLACE.tiltRad, pose.yaw, 0, "YXZ");
      o.updateMatrixWorld(true);
    }
  }

  /** Per frame. Allocation free. */
  update(dt: number): void {
    const d = Math.min(Math.max(dt, 0), 0.1);
    const reduced = this.deps.settings.get().reducedMotion;
    // Fingertips only matter while the current screen has a panel up.
    const cur = this.byScreen.get(this.screen);
    const tips = cur && cur.motion.visible ? this.tips.read() : NO_TIPS;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i] as LivePanel;
      if (!p.motion.visible) continue;
      // Fingertips reach only the keys of the current panel; the rest let go.
      const current = p.spec.screen === this.screen && p.motion.entering;
      let touchChanged = false;
      for (let j = 0; j < p.keys.length; j++) {
        const k = p.keys[j] as KeyView;
        // A key hidden by the layout (display none) keeps an old rectangle: it must not feel anything.
        if (k.feel(current && k.shown ? tips : NO_TIPS)) touchChanged = true;
      }
      if (touchChanged) this.hoverChanged(p.keys[0] as KeyView);
      if (p.motion.moving) {
        p.motion.step(d, reduced);
        this.applyPanel(p);
        if (!p.motion.visible) continue;
      }
      p.view.step(d, reduced);
      const fade = p.motion.opacity;
      for (let j = 0; j < p.keys.length; j++) {
        const k = p.keys[j] as KeyView;
        k.tick(d);
        if (!k.motion.active) continue;
        k.motion.step(d, reduced);
        k.apply(fade);
      }
    }
    this.drawSlabs();
  }

  /** A slab under every visible panel, from where UIKit has it now. */
  private drawSlabs(): void {
    let any = false;
    for (let i = 0; i < this.live.length; i++) if ((this.live[i] as LivePanel).motion.visible) any = true;
    if (!any && !this.slabsShown) return;
    this.slabsShown = any;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i] as LivePanel;
      this.slabs.draw(p.view.root, p.motion.visible ? p.motion.opacity : 0);
    }
  }

  /** Pokeable keys of a screen (shown ones only). For test hooks. */
  buttons(screen: Screen): MenuButton[] {
    const p = this.byScreen.get(screen);
    if (!p) return [];
    return p.keys.filter((k) => k.shown).map((k) => ({ id: k.id, screen, object: k.el }));
  }

  /** Keycaps on visible panels (tests: keys really draw). */
  get capCount(): number {
    let n = 0;
    for (const p of this.live) if (p.motion.visible) for (const k of p.keys) if (k.shown) n++;
    return n;
  }

  /** Panel bodies drawn last frame (tests). */
  get slabCount(): number {
    return this.slabs.shown;
  }

  /** True while a panel is moving, a number is still counting, or a key's action is waiting. */
  get busy(): boolean {
    for (const p of this.live) {
      if (p.motion.visible && (p.motion.moving || p.view.rolling)) return true;
      for (const k of p.keys) if (k.acting) return true;
    }
    return false;
  }

  /** A key of the current screen (tests). */
  keyState(id: string): { capZ: number; enabled: boolean; lit: boolean } | null {
    const k = this.byScreen.get(this.screen)?.keys.find((x) => x.id === id);
    return k ? { capZ: k.motion.capZ, enabled: k.enabled, lit: k.lit } : null;
  }

  /** A screen's panel as laid out: world centre and size in metres (tests and screenshots). */
  panelBox(screen: Screen): { center: [number, number, number]; width: number; height: number } | null {
    const p = this.byScreen.get(screen);
    if (!p) return null;
    const e = p.view.root.matrixWorld.elements;
    return {
      center: [e[12] as number, e[13] as number, e[14] as number],
      width: Math.hypot(e[0] as number, e[1] as number, e[2] as number),
      height: Math.hypot(e[4] as number, e[5] as number, e[6] as number),
    };
  }

  /** The panel node of a screen (tests). */
  panelObject(screen: Screen): Object3D | null {
    return this.byScreen.get(screen)?.asset ?? null;
  }

  /** Text an element of the current screen shows (tests). */
  textOf(id: string): string | null {
    return this.byScreen.get(this.screen)?.view.textOf(id) ?? null;
  }

  /** World size of a key in metres. UIKit scales each element's object to its laid-out size. */
  static sizeOf(el: Object3D): [number, number] {
    const scale = el.getWorldScale(new Vector3());
    return [scale.x, scale.y];
  }

  /** Which keys of a panel show hover, and a `hover` event for each that starts (live keys only). */
  private hoverChanged(k: KeyView): void {
    const p = this.byScreen.get(k.screen);
    if (!p) return;
    let touchOnPanel = false;
    for (const x of p.keys) if (x.touched) touchOnPanel = true;
    for (const x of p.keys) {
      if (x.showHover(x.wantsHover(touchOnPanel)) && this.isLive(x)) emit({ type: "hover", id: x.id });
    }
    if (this.layoutWaiting && !this.fingerOnCurrent()) this.placePanels();
  }

  private isLive(k: KeyView): boolean {
    const p = this.byScreen.get(k.screen);
    return k.screen === this.screen && !!p && p.motion.entering && k.shown;
  }

  private applyPanel(p: LivePanel): void {
    const root = p.view.root;
    root.position.y = p.motion.liftMm * MM;
    root.scale.setScalar(p.motion.scale);
    p.view.opacity.value = p.motion.opacity;
    p.asset.visible = p.motion.visible;
  }

  private paint(screen: Screen): void {
    const p = this.byScreen.get(screen);
    if (!p) return;
    switch (screen) {
      case "home": {
        // The storage notice shows once: it stays on this Home and is gone the next time.
        const notice = this.deps.profiles.pendingNotice;
        paintHome(p.view, homeView(notice));
        if (notice !== null) this.deps.profiles.markNoticeShown();
        break;
      }
      case "settings": {
        const s = this.deps.settings.get();
        const v = settingsView(s);
        paintSettings(p.view, v);
        for (const k of p.keys) {
          k.enabled = !v.disabled.includes(k.id);
          k.lit = v.toggles.some((t) => t.id === k.id && t.on);
        }
        for (const t of TOGGLES) {
          const k = p.keys.find((x) => x.id === t.id);
          if (k) k.motion.latched = s[t.key];
        }
        break;
      }
    }
    for (const k of p.keys) k.paintCap();
  }

  /** A key's action (its `press` was emitted when it clicked). */
  private act(id: string): void {
    switch (id) {
      case "home-settings":
        go("settings");
        return;
      case "settings-done":
        go("home");
        return;
      case "home-recenter":
      case "settings-recenter":
        this.deps.actions.recenter();
        return;
    }
    const patch = settingAction(id, this.deps.settings.get());
    if (!patch) return;
    void this.deps.settings.set(patch);
    // A slider step ticks at a pitch that follows the new value.
    const k = sliderPosition(id, this.deps.settings.get());
    if (k !== null) emit({ type: "slider", id, k });
  }
}
