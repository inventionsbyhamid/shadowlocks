// The hint lantern: a small brass lantern plaque on the frame's outer edge (the side away from the playing hand),
// well clear of the box mouth. It glows when the stuck watch says the player is stuck (a slow breathing glow, steady
// with reduced motion; never a dialog). Poking it shows its choices beside it: "Hint", and "Show me" once the lessons
// can replay an example; poking it again, choosing, or waiting puts them away. Sizes in metres whatever the box size.
// Per frame: the keys feel the fingertips and the glow eases; nothing is allocated or repainted.
import { AdditiveBlending, Group, type Object3D, Sprite, SpriteMaterial, Vector3 } from "@iwsdk/core";
import type { Vec3 } from "../core/types";
import { KEY_EVENT } from "../render/finger-key";
import { brassFace, roundRect } from "../render/label";
import { radialTexture } from "../render/lantern-view";
import { COLORS } from "../render/theme";
import { COPY } from "./copy";
import type { Tips } from "./key-view";
import { PokeKey } from "./poke-key";

export const HINT_LANTERN = {
  /** Where it sits (box units), for a right-handed player: outside the left side of the frame, toward the back. */
  at: [-0.66, 0.26, 0.16] as const,
  /** It turns this much toward the player's middle (radians about y; mirrored with the side). */
  turn: (25 * Math.PI) / 180,
  /** The lantern key and the choice keys (m); the choices stand outward of it, this far apart. */
  key: 0.046,
  choice: { w: 0.088, h: 0.042, gap: 0.014, out: 0.016 },
  /** The choices put themselves away after this long untouched (s). */
  choicesS: 8,
  /** The stuck glow: its size (m), and its breathing period (s): far slower than any flash. */
  glow: 0.11,
  breatheS: 2.4,
} as const;

/** What a frame of the hint lantern asked for. */
export const HINT_ASK = { none: 0, hint: 1, showMe: 2 } as const;

export class HintLantern {
  /** Cancels the box's scale: everything under it is in metres. */
  readonly group = new Group();
  readonly lantern = new PokeKey("hint-lantern", HINT_LANTERN.key, HINT_LANTERN.key, "");
  readonly hint = new PokeKey("hint-choice", HINT_LANTERN.choice.w, HINT_LANTERN.choice.h, COPY.game.hint);
  readonly showMe = new PokeKey("hint-show-me", HINT_LANTERN.choice.w, HINT_LANTERN.choice.h, COPY.game.showMe);
  private readonly glow: Sprite;
  private readonly glowMat: SpriteMaterial;
  private glowOn = false;
  private level = 0;
  private t = 0;
  private open = false;
  private openS = 0;
  private scale = 0;
  private side = -1;
  /** A key whose press the gate took, waiting for the finger to let go: its action then. */
  private armed: PokeKey | null = null;
  private readonly tmp = new Vector3();

  constructor(
    private readonly root: Object3D,
    /** "Show me" is offered only while this says so (the lessons wire it). */
    private readonly canShowMe: () => boolean = () => false,
  ) {
    this.group.name = "Hint Lantern";
    this.lantern.paintWith((g, w, h) => {
      brassFace(g, w, h);
      // A small lantern: a cage, its glass, a ring to hold it by.
      const cx = w / 2, cy = h * 0.55, bw = w * 0.34, bh = h * 0.42;
      g.fillStyle = "#fff0c8";
      roundRect(g, cx - bw / 2, cy - bh / 2, bw, bh, bw * 0.2);
      g.fill();
      g.strokeStyle = "#2a1d0c";
      g.lineWidth = w * 0.05;
      g.stroke();
      g.beginPath();
      g.moveTo(cx - bw * 0.62, cy - bh / 2);
      g.lineTo(cx, cy - bh * 0.95);
      g.lineTo(cx + bw * 0.62, cy - bh / 2);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy - bh * 1.05, w * 0.06, 0, Math.PI * 2);
      g.stroke();
    });
    this.glowMat = new SpriteMaterial({
      map: radialTexture(64, false),
      color: COLORS.lamp,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
      toneMapped: false,
    });
    this.glow = new Sprite(this.glowMat);
    this.glow.name = "Hint Lantern Glow";
    this.glow.scale.set(HINT_LANTERN.glow, HINT_LANTERN.glow, 1);
    this.glow.position.z = -0.004;
    this.glow.visible = false;
    this.lantern.live = true;
    this.hint.show(false);
    this.showMe.show(false);
    this.group.add(this.glow, this.lantern.group, this.hint.group, this.showMe.group);
    this.group.visible = false;
    root.add(this.group);
    this.setSide(-1);
  }

  /** Show it (a box in play) on side `side` (-1 left, +1 right), or hide it. Choices away, no glow. */
  reset(visible: boolean, side: number): void {
    this.group.visible = visible;
    this.setSide(side);
    this.setGlow(false);
    this.close();
    this.lantern.reset();
    this.lantern.live = visible;
  }

  /** The stuck glow. */
  setGlow(on: boolean): void {
    this.glowOn = on;
  }

  get glowing(): boolean {
    return this.glowOn;
  }

  get choicesOpen(): boolean {
    return this.open;
  }

  /** Where the lantern is in the world (its glow's sound plays there). */
  worldPos(out: Vec3): boolean {
    if (!this.group.visible) return false;
    this.lantern.group.getWorldPosition(this.tmp);
    out[0] = this.tmp.x;
    out[1] = this.tmp.y;
    out[2] = this.tmp.z;
    return true;
  }

  /**
   * Per frame (`dt` s): the glow, the keys. `press(id)` is told when a key clicks down and says whether the shared
   * press gate took it. Returns a HINT_ASK.
   */
  update(dt: number, tips: Tips, reduced: boolean, press: (id: string) => boolean): number {
    const s = this.root.scale.x;
    if (s !== this.scale && s > 0) {
      this.scale = s;
      this.group.scale.setScalar(1 / s);
    }
    if (!this.group.visible) return HINT_ASK.none;
    this.breathe(dt, reduced);
    if (this.open) {
      this.openS += dt;
      if (this.openS >= HINT_LANTERN.choicesS) this.close();
    }
    let ask: number = HINT_ASK.none;
    if (this.feel(this.lantern, tips, press)) {
      if (this.open) this.close();
      else this.openChoices();
    }
    if (this.feel(this.hint, tips, press)) {
      this.close();
      ask = HINT_ASK.hint;
    }
    if (this.feel(this.showMe, tips, press)) {
      this.close();
      ask = HINT_ASK.showMe;
    }
    return ask;
  }

  /** A key's frame: true on the frame an accepted press is let go. */
  private feel(k: PokeKey, tips: Tips, press: (id: string) => boolean): boolean {
    if (!k.live) return false;
    const ev = k.feel(tips);
    if (ev === KEY_EVENT.press) {
      if (press(k.id)) this.armed = k;
    } else if (ev === KEY_EVENT.click && this.armed === k) {
      this.armed = null;
      return true;
    } else if (ev === KEY_EVENT.cancel && this.armed === k) this.armed = null;
    return false;
  }

  private openChoices(): void {
    this.open = true;
    this.openS = 0;
    const more = this.canShowMe();
    this.hint.show(true);
    this.hint.reset();
    this.hint.live = true;
    this.showMe.show(more);
    this.showMe.reset();
    this.showMe.live = more;
  }

  private close(): void {
    this.open = false;
    this.hint.show(false);
    this.showMe.show(false);
    if (this.armed !== this.lantern) this.armed = null;
  }

  private setSide(side: number): void {
    this.side = side < 0 ? -1 : 1;
    const A = HINT_LANTERN.at, C = HINT_LANTERN.choice;
    this.group.position.set(this.side * Math.abs(A[0]), A[1], A[2]);
    // Turned toward the player's middle.
    this.group.rotation.y = -this.side * HINT_LANTERN.turn;
    // The choices stand outward of the lantern, one above the other.
    const x = this.side * (HINT_LANTERN.key / 2 + C.out + C.w / 2);
    this.hint.group.position.set(x, C.h / 2 + C.gap / 2, 0);
    this.showMe.group.position.set(x, -(C.h / 2 + C.gap / 2), 0);
  }

  /** The stuck glow eases in and out; it breathes slowly while on (steady with reduced motion). */
  private breathe(dt: number, reduced: boolean): void {
    const target = this.glowOn ? 1 : 0;
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.35) : 0;
    this.level += (target - this.level) * k;
    if (Math.abs(target - this.level) < 1e-3) this.level = target;
    this.t = this.glowOn ? this.t + dt : 0;
    const wave = reduced ? 1 : 0.75 + 0.25 * Math.cos((this.t / HINT_LANTERN.breatheS) * Math.PI * 2);
    this.glow.visible = this.level > 0;
    this.glowMat.opacity = this.level * wave;
  }
}
