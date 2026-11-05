// One keycap in UIKit: the key element is the fixed target (so the moving cap never pulls away from
// the finger), the cap and its legend move through signals, and the glow sits underneath. Fingertips
// are read every frame (`feel`) and drive the shared FingerKey rules: the cap follows the finger,
// `press` (the click) fires at 80% of the travel, the action on the way back out (plus a short delay
// for the pop), and a finger that arrives from behind or slides in from the side never presses.
// Rays (controllers, hand rays, the 2D mouse) use pointer events: press on pointer down, action on
// IWSDK's click. IWSDK's own touch pointer is ignored (it goes down 20 mm before the plate and
// hovers 20 cm out). The cap is a flat UIKit rectangle in the key's colour for now (the menus'
// placeholder look); its colour follows the key's state (`paintCap`).
import { signal, Vector3 } from "@iwsdk/core";
import type { Screen } from "../app/screens";
import { pressGate } from "../input/poke";
import { KEY_EVENT, nearestFinger } from "../render/finger-key";
import { KeyMotion } from "./keys";
import { MOTION } from "./motion";
import type { UiEl } from "./panel-ui";
import { UI } from "./theme";

/** Peak opacity of the underglow. */
const GLOW_MAX = 0.55;
const MM_TO_M = 0.001;

export interface KeyHooks {
  /** May this key act now (its screen is current and its panel is not leaving)? */
  live(k: KeyView): boolean;
  /** Hover may have changed: the owner decides which keys show it (a fingertip beats a ray). */
  hoverChanged(k: KeyView): void;
  /** A hover started (fingertip within 3 cm, or a ray): emit `hover`. */
  hover(k: KeyView): void;
  /** The key pressed (fingertip at 80% of the travel, or a ray's pointer down): emit `press`. */
  press(k: KeyView): void;
  /** Run the key's action (after the release and the short delay). */
  act(k: KeyView): void;
}

type PointerLike = { pointerType?: string };
const isTouch = (e: unknown) => (e as PointerLike).pointerType === "touch";
const scratch = new Vector3();
const tipDist = new Float64Array(2);
const tipOver = new Uint8Array(2);
const axisX = new Vector3();
const axisY = new Vector3();
const axisN = new Vector3();

/** Fingertip positions this frame (world metres); a lost hand is simply not listed. */
export interface Tips {
  readonly points: readonly Vector3[];
  count: number;
}

/** No fingertips: for keys that are not live (they let go). */
export const NO_TIPS: Tips = { points: [], count: 0 };

/** The cap and its legend sit this far above the cap position the key motion gives (mm). */
export const LEGEND_LIFT_MM = 0.4;

export class KeyView {
  readonly motion = new KeyMotion();
  private readonly z = signal<number>(MOTION.key.restMm + LEGEND_LIFT_MM);
  private readonly sx = signal(1);
  private readonly sy = signal(1);
  private readonly glow = signal(0);
  /** The key's own colour (its border colour in the stylesheet, which is never drawn). */
  readonly tone: string;
  /** A toggle that is on lights its cap brass. */
  lit = false;
  private readonly cap: UiEl | null;
  /** The colour last given to the cap element. */
  private capPainted = "";
  private rays = 0;
  private hoverShown = false;
  /**
   * Pressed since its action last ran, kept apart per input so one cannot run or clear the other's:
   * the finger's is cleared on its cancel and click, the ray's on leave, click and a rejected press.
   */
  private fingerPressed = false;
  private rayPressed = false;
  /** A disabled key still moves under the finger but never presses or acts (the end of a range). */
  enabled = true;

  constructor(
    readonly id: string,
    readonly screen: Screen,
    readonly el: UiEl,
    cap: UiEl | null,
    glowEl: UiEl | null,
    private readonly hooks: KeyHooks,
  ) {
    const tone = el.properties?.value.borderColor;
    this.tone = typeof tone === "string" ? tone : UI.graphiteKey;
    el.name = id;
    this.cap = cap;
    cap?.setProperties({
      transformTranslateZ: this.z,
      transformScaleX: this.sx,
      transformScaleY: this.sy,
    });
    glowEl?.setProperties({ opacity: this.glow });

    el.addEventListener("pointerenter", (e: unknown) => {
      if (isTouch(e)) return;
      this.rays++;
      hooks.hoverChanged(this);
    });
    el.addEventListener("pointerleave", (e: unknown) => {
      if (isTouch(e)) return;
      this.rays = Math.max(0, this.rays - 1);
      if (this.rays === 0) {
        if (this.motion.pressed) this.motion.setDown(false, false);
        this.rayPressed = false;
      }
      hooks.hoverChanged(this);
    });
    el.addEventListener("pointerdown", (e: unknown) => {
      if (isTouch(e) || !hooks.live(this)) return;
      this.motion.setDown(true);
      // A press the gate rejects leaves an earlier accepted one standing.
      if (this.enabled && this.press()) this.rayPressed = true;
    });
    el.addEventListener("pointerup", (e: unknown) => {
      if (!isTouch(e) && this.motion.pressed) this.motion.setDown(false, true);
    });
    el.addEventListener("click", (e: unknown) => {
      if (isTouch(e) || !this.rayPressed) return;
      this.rayPressed = false;
      if (hooks.live(this) && this.enabled) this.motion.queueAction();
    });
  }

  /**
   * Per frame: the nearest fingertip over the key (or none) drives its cap and its press. Pass no
   * tips (count 0) when the key is not live, so it lets go. Returns whether `touched` changed.
   * Allocation free.
   */
  feel(tips: Tips): boolean {
    const f = this.motion.finger;
    const was = this.motion.touched;
    let n = 0;
    if (tips.count > 0) {
      this.el.updateWorldMatrix(false, false);
      const m = this.el.matrixWorld.elements;
      axisX.set(m[0] as number, m[1] as number, m[2] as number);
      axisY.set(m[4] as number, m[5] as number, m[6] as number);
      const halfW = axisX.length() / 2;
      const halfH = axisY.length() / 2;
      axisN.set(m[8] as number, m[9] as number, m[10] as number).normalize();
      axisX.normalize();
      axisY.crossVectors(axisN, axisX);
      for (let i = 0; i < tips.count; i++) {
        scratch.copy(tips.points[i] as Vector3);
        scratch.x -= m[12] as number;
        scratch.y -= m[13] as number;
        scratch.z -= m[14] as number;
        tipOver[n] = Math.abs(scratch.dot(axisX)) <= halfW && Math.abs(scratch.dot(axisY)) <= halfH ? 1 : 0;
        tipDist[n] = scratch.dot(axisN) - this.motion.restZ * MM_TO_M;
        n++;
      }
    }
    // A fingertip far behind the face (past the travel and 10 mm) is not pressing: a hand resting
    // under the panel, or a poke gone through; if it was the one pressing, the key cancels.
    const best = nearestFinger(n, tipDist, tipOver, f.travel);
    f.dist = best;
    f.inside = best === best;
    const e = this.motion.stepFinger();
    if (e === KEY_EVENT.hoverIn) this.hooks.hover(this);
    else if (e === KEY_EVENT.press) {
      this.fingerPressed = this.hooks.live(this) && this.enabled && this.press();
    } else if (e === KEY_EVENT.click) {
      if (this.fingerPressed) {
        this.fingerPressed = false;
        if (this.hooks.live(this) && this.enabled) this.motion.queueAction();
      }
    } else if (e === KEY_EVENT.cancel) this.fingerPressed = false;
    return this.motion.touched !== was;
  }

  /** A press, through the press gate every button shares (one press per 150 ms across all keys). True when it counted. */
  private press(): boolean {
    if (!pressGate.accept(performance.now())) return false;
    this.hooks.press(this);
    return true;
  }

  /** Per frame: run the key's action once its delay is over (still live). Allocation free. */
  tick(dt: number): void {
    if (this.motion.actionDue(dt) && this.hooks.live(this) && this.enabled) this.hooks.act(this);
  }

  /** The key's action is waiting for its delay. */
  get acting(): boolean {
    return this.motion.pendingAction;
  }

  /** A fingertip is over this key, within 3 cm in front of its cap or pushing it. */
  get touched(): boolean {
    return this.motion.touched;
  }

  /** Ray hover shows when no fingertip is near any key of the panel (a fingertip's own hover is the cap's). */
  wantsHover(touchOnPanel: boolean): boolean {
    return this.rays > 0 && !touchOnPanel;
  }

  /** Show or drop ray hover; true when it just started. */
  showHover(on: boolean): boolean {
    if (on === this.hoverShown) return false;
    this.hoverShown = on;
    this.motion.setHover(on);
    return on;
  }

  /** Forget every pointer and the finger (the panel left or came back). */
  forgetPointers(): void {
    this.rays = 0;
    if (this.hoverShown) this.motion.setHover(false);
    this.hoverShown = false;
    this.fingerPressed = false;
    this.rayPressed = false;
    this.motion.finger.reset();
  }

  /** Is the key laid out (not display none, not inside a hidden part)? */
  get shown(): boolean {
    return this.el.isVisible?.peek() ?? true;
  }

  /** Copy the motion into UIKit (the legend rides on the cap). `fade` is the panel's opacity. Allocation free. */
  apply(fade: number): void {
    const m = this.motion;
    this.z.value = m.capZ + LEGEND_LIFT_MM;
    this.sx.value = m.scaleX;
    this.sy.value = m.scaleY;
    this.glow.value = m.glow * GLOW_MAX * fade;
  }

  /** The cap's colour now: brass when lit, darker when disabled (a range end), else its own tone. */
  get capColor(): string {
    return this.lit ? UI.putty : !this.enabled ? UI.capOff : this.tone;
  }

  /** Give the cap element its colour for the key's state (after `lit` or `enabled` changed). Writes only a change. */
  paintCap(): void {
    const c = this.capColor;
    if (c === this.capPainted) return;
    this.capPainted = c;
    this.cap?.setProperties({ backgroundColor: c });
  }
}
