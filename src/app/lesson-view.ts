// What a lesson shows, frame by frame, from the director's LessonFrame: the pale-blue ghost hand (human-sized, in
// the world) and ghost lantern (in the box), the ghost's bones casting through the box's one shadow cast, the shadows
// cast from the ghost lantern while it solves an example, the scraps swinging between the twin's layout and the
// player's, the player's lantern flying into its cradle on the frame and out again, the near scrap's glow, the twin
// lit when the ghost clicks it, the ghost finger's piece forming, lock I marked through its step (its outline
// breathing, its scraps lit), the coach line, and the box forming out of light.
//
// Reduced motion: the lantern goes to and from its cradle in one cut (no flight), the swing takes the director's
// no-overshoot curve, and every fade is opacity only. One click (one flash) per example. Allocation-free per frame.
import {
  Color,
  Euler,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type World,
} from "@iwsdk/core";
import { type LessonId, type LessonPlan, lessonPlan } from "../core/lessons-data";
import type { Box, Lock, V2, V3 } from "../core/types";
import { onLangChange } from "../i18n";
import type { HandJoints, HandSide } from "../input/hand-joints";
import type { BoxScene } from "../render/box-scene";
import { crystallise } from "../render/fx/crystallise";
import { GHOST_SHADOW_BONES, type GhostHand, type GhostLantern, GhostRig } from "../render/ghost-hand";
import { HandShadow } from "../render/hand-shadow";
import { radialTexture } from "../render/lantern-view";
import { LIGHT_BLEND } from "../render/light-blend";
import { BOX_BELOW_HEAD_M, BOX_FORWARD_M, boxToWorld, TILT_DEG } from "../render/placement";
import { COLORS } from "../render/theme";
import { CoachLine, CoachLineView } from "../ui/coach-line";
import { HINT_LOOK } from "./hints";
import { type LayoutSink, LessonLayout } from "./lesson-layout";
import type { LessonFrame } from "./lessons-director";

export const LESSON_LOOK = {
  /** The lantern's cradle on the frame (box units, on the weak side: x for a right-handed player). */
  cradle: [-0.62, -0.42, 1.04] as const,
  /**
   * The coach line's chip: above the plate and its Next key at the back of the box's top (so it never hides the
   * panel from a seated eye), turned up toward the eye.
   */
  coachAt: [0, 1.02, 0.05] as const,
  coachTilt: -0.2,
  /**
   * While lesson 1 asks for the lantern the chip sits by it instead, where the eyes are (about 15 degrees from it
   * rather than 52): its inner bottom corner this far from the lantern's light (box units, x toward the dominant
   * side), the chip running outward from there and facing the eye. That is above the lantern's loop and outside every
   * sight line to the panel (tests/unit/lesson-view.test.ts). It glides back over the box in this long.
   */
  coachNear: [0.04, 0.3, 0] as const,
  coachGlideMs: 600,
  /** The box forming out of light: a warm glow over the box (box units), fading as the box forms. */
  formGlowSize: 1.5,
  formGlowAlpha: 0.85,
  /** The ghost casts once it is this solid (a ghost fading in or out casts nothing). */
  castFrom: 0.3,
} as const;

const DEG = Math.PI / 180;

/**
 * Where a seated player's eyes are in box units for a box `sizeM` across, as placement.ts puts the box: the panel's
 * centre BOX_FORWARD_M ahead and BOX_BELOW_HEAD_M below the eyes, leaning back TILT_DEG. Into `out`.
 */
export function nominalEye(sizeM: number, out: Vector3): Vector3 {
  const t = TILT_DEG * DEG, c = Math.cos(t), s = Math.sin(t);
  return out.set(0, (BOX_BELOW_HEAD_M * c - BOX_FORWARD_M * s) / sizeM, (BOX_BELOW_HEAD_M * s + BOX_FORWARD_M * c) / sizeM);
}

const tmpLook = new Matrix4(), tmpEye = new Vector3(), tmpCorner = new Vector3(), tmpAxis = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * The coach chip by the lantern at `L` (box units; `side` 1 for a right-handed player, -1 mirrored) in a box `sizeM`
 * across, the chip painted `wMm` x `hMm`: its plane's centre into `pos` and its turn into `q` (box units, as the chip
 * hangs under the box root). LESSON_LOOK.coachNear puts its inner bottom corner; it faces the seated eye.
 * Allocation-free.
 */
export function coachNearPose(L: Readonly<V3>, side: number, sizeM: number, wMm: number, hMm: number, pos: Vector3, q: Quaternion): void {
  const o = LESSON_LOOK.coachNear, w = wMm / 1000 / sizeM, h = hMm / 1000 / sizeM;
  tmpCorner.set(L[0] + o[0] * side, L[1] + o[1], L[2] + o[2]);
  nominalEye(sizeM, tmpEye);
  pos.copy(tmpCorner);
  // Its front (+z) toward the eye from its middle, upright: the middle hangs off the corner along the chip's own axes,
  // so a few rounds settle it (each one turns it less).
  for (let i = 0; i < 3; i++) {
    tmpLook.lookAt(tmpEye, pos, UP);
    pos.copy(tmpCorner);
    pos.addScaledVector(tmpAxis.setFromMatrixColumn(tmpLook, 0), (side * w) / 2);
    pos.addScaledVector(tmpAxis.setFromMatrixColumn(tmpLook, 1), h / 2);
  }
  q.setFromRotationMatrix(tmpLook);
}

/** What lock I's mark changes: the panel's warmth per lock and the scraps' glow (the box scene has both). */
export interface MarkScene {
  readonly panelArt: { setWarmth(lock: number, w: number): void; warmthOf(lock: number): number };
  scrapMesh(lock: number, piece: number): { setGlow(v: number): void };
}

/**
 * Lock `lock` marked as the one to open: its outline at `warmth` or its own warmth (the session's, set earlier this
 * frame), whichever is more; as the mark starts (`starting`), its scraps glow as a first hint's do. The glow is left
 * as it is when the mark ends: the lock opening (its own celebration) or a new box takes it over.
 */
export function markLock(scene: MarkScene, lock: Lock, warmth: number, starting: boolean): void {
  const own = scene.panelArt.warmthOf(lock.i);
  scene.panelArt.setWarmth(lock.i, own > warmth ? own : warmth);
  if (!starting) return;
  for (let p = 0; p < lock.target.length; p++) if (p !== lock.missing) scene.scrapMesh(lock.i, p).setGlow(HINT_LOOK.scrapGlow);
}

export interface LessonViewDeps {
  world: World;
  scene: BoxScene;
  lantern: {
    readonly ctrl: { readonly pos: V3 };
    place(p: Readonly<V3>): void;
    freeze(on: boolean, tMs: number): void;
  };
  sound: { settle(): void; crystallise(lock: number): void; coachLine(): void };
  reducedMotion(): boolean;
}

/** Which lesson's box the frame is about now: the lesson's, or a replay's. */
export interface LessonOnScreen {
  lesson: LessonId | null;
  /** A tip's ghost demo is playing on the box in play (its ghost hand, lantern and light; nothing else). */
  tip?: boolean;
}

export class LessonView {
  /** The ghost hand and lantern: one capsule mesh in the world (one draw call). */
  readonly rig = new GhostRig();
  readonly ghost: GhostHand = this.rig.hand;
  readonly lamp: GhostLantern = this.rig.lamp;
  readonly coach: CoachLine;
  readonly coachView: CoachLineView;
  private readonly cradle: Mesh;
  private readonly formGlow: Sprite;
  /** The ghost hand's shadow, cast from its own bones (as slim as the hand drawn). */
  private readonly ghostShadow = new HandShadow(GHOST_SHADOW_BONES);
  private readonly ghostOutlines: V2[][] = [];
  private readonly ghostFinger: V2[][] = [];
  /** HandShadow reads joints through this: the ghost's world joints on its side, nothing on the other. */
  private readonly ghostJoints: HandJoints;
  private layout: LessonLayout | null = null;
  private layoutBox: Box | null = null;
  private plan: LessonPlan | null = null;
  private readonly sink: LayoutSink;
  private parked = false;
  private readonly from: V3 = [0, 0, 0];
  private readonly liftTo: V3 = [0, 0, 0];
  private lifting = false;
  private hasLift = false;
  private lastPark = 0;
  private readonly at: V3 = [0, 0, 0];
  private readonly L: V3 = [0, 0, 0];
  private clicks = 0;
  private formed = false;
  private glowLock = -1;
  private glowPiece = -1;
  private solvedLock = -1;
  /** The lock marked last frame (-1: none). */
  private marked = -1;
  private sizeM = 0;
  /** The chip over the box, and by the lantern (kept from the last frame it was asked for there), and how far over. */
  private readonly topPos = new Vector3(LESSON_LOOK.coachAt[0], LESSON_LOOK.coachAt[1], LESSON_LOOK.coachAt[2]);
  private readonly topQ = new Quaternion().setFromEuler(new Euler(LESSON_LOOK.coachTilt, 0, 0));
  private readonly nearPos = this.topPos.clone();
  private readonly nearQ = this.topQ.clone();
  private nearK = 0;
  private readonly vAt = new Vector3();
  private readonly vF = new Vector3();
  private readonly vP = new Vector3();

  constructor(private readonly d: LessonViewDeps) {
    const { scene, world } = d;
    this.ghost.opacity = 0;
    this.lamp.opacity = 0;
    world.scene.add(this.rig.mesh);
    this.coachView = new CoachLineView();
    this.coachView.object.position.copy(this.topPos);
    this.coachView.object.quaternion.copy(this.topQ);
    scene.root.add(this.coachView.object);
    // A new line comes with a soft tick, so the eyes go to it.
    this.coach = new CoachLine(this.coachView, () => d.sound.coachLine());
    // A font the chip letters with arrived, or the language changed: the next update paints the line up again, or
    // (a new language) paints the next frame's line in it, once.
    onLangChange(() => this.coach.relettered());
    this.cradle = new Mesh(
      new TorusGeometry(0.05, 0.007, 6, 24).rotateX(Math.PI / 2),
      new MeshBasicMaterial({ color: COLORS.metal, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.cradle.name = "Lantern Cradle";
    this.cradle.visible = false;
    scene.root.add(this.cradle);
    this.formGlow = new Sprite(
      // Light over the room (light-blend.ts): it adds colour and leaves the page's alpha alone.
      new SpriteMaterial({ map: radialTexture(64, false), color: new Color(COLORS.lamp), ...LIGHT_BLEND, depthWrite: false, transparent: true, toneMapped: false }),
    );
    this.formGlow.name = "Box Forming";
    this.formGlow.position.set(0, 0, 0.5);
    this.formGlow.scale.setScalar(LESSON_LOOK.formGlowSize);
    this.formGlow.visible = false;
    scene.root.add(this.formGlow);
    for (let i = 0; i < this.ghostShadow.maxOutlines; i++) this.ghostOutlines.push([]);
    const ghost = this.ghost;
    this.ghostJoints = { positions: (side: HandSide) => (side === ghost.side ? ghost.world : null) } as unknown as HandJoints;
    const scraps = scene.scraps;
    this.sink = {
      offsetPiece: (lock, piece, x, y, z) => scraps.offsetPiece(lock, piece, x, y, z),
      moveRing: (r, c, nrm, off) => scraps.moveRing(r, c, nrm, off),
      shadowsMoved: () => scene.shadowsMoved(),
    };
  }

  /**
   * Show frame `f` (`dtMs` since the last), about `on.lesson`'s box (its effects only once the scene shows that box),
   * with `line` on the coach line (the lesson's, or a tip's) and the lantern clock at `tMs`.
   */
  update(f: LessonFrame, on: LessonOnScreen, line: string | null, dtMs: number, tMs: number): void {
    const { scene, lantern } = this.d;
    const box = scene.box;
    const ours = box !== null && on.lesson !== null && box.spec.kind === "lesson" && box.spec.id === on.lesson;
    if (ours && box !== this.layoutBox) {
      this.layoutBox = box;
      this.plan = lessonPlan(on.lesson!, box.mirrored);
      this.layout = new LessonLayout(box, this.plan.twins);
      this.formed = false;
      this.glowLock = -1;
      this.solvedLock = -1;
    } else if (!ours && this.layoutBox) {
      // The box still shown gets its scraps back in the player's layout (a box no longer shown is let go as it is).
      if (box === this.layoutBox) this.layout?.reset(this.sink);
      this.layoutBox = null;
      this.layout = null;
      this.plan = null;
    }
    const m = scene.root.matrixWorld, reduced = this.d.reducedMotion();
    const side = box?.mirrored ? -1 : 1;

    // The swing, and where the shadows are cast from.
    if (this.layout && box) for (let k = 0; k < box.locks.length && k < f.layout.length; k++) this.layout.set(k, f.layout[k]!, this.sink);
    // A tip's demo shows its ghost (and casts from its lantern) on whatever box is in play.
    const ghostly = ours || on.tip === true;
    scene.setLightFrom(ghostly && f.ghostLight ? f.lamp.at : null);

    // The ghost lantern and hand.
    this.lamp.setPos(f.lamp.at);
    this.lamp.opacity = ghostly ? f.lamp.opacity : 0;
    if (this.lamp.opacity > 0) this.lamp.sync(m as Matrix4);
    // The ghost hand only while a lesson, a replay or a tip's demo is on screen (a menu over the lesson puts it away).
    const h = f.hand, ho = on.lesson !== null || on.tip === true ? h.opacity : 0;
    if (ho > 0) {
      const g = this.ghost;
      g.side = h.side;
      g.setPose(h.poseA, h.poseB, h.poseT);
      boxToWorld(m as Matrix4, h.at, this.vAt);
      this.vF.set(h.fingers[0], h.fingers[1], h.fingers[2]).transformDirection(m);
      this.vP.set(h.palm[0], h.palm[1], h.palm[2]).transformDirection(m);
      g.place(h.anchor, this.vAt, this.vF, this.vP);
    }
    this.ghost.opacity = ho;
    let n = 0;
    if (ho >= LESSON_LOOK.castFrom) {
      n = this.ghostShadow.update(this.ghostJoints, null, m as Matrix4, scene.lightPos(this.L), this.ghostOutlines, this.ghostFinger).n;
    }
    scene.setGhostShadows(this.ghostOutlines, n, this.ghostShadow.depth);

    // The player's lantern to its cradle and back, once the lesson's box is shown (a replay's box may still be on its
    // way); without it, a lantern in its cradle is let go where it stands.
    if (ours) this.park(f, side, reduced, tMs);
    else this.unpark(tMs);

    // The near scrap's glow, the twin lit when solved, the ghost finger's piece, the click.
    if (this.glowLock >= 0 && (f.glowLock !== this.glowLock || f.glowPiece !== this.glowPiece)) {
      scene.scraps.handle(this.glowLock, this.glowPiece).setGlow(0);
      this.glowLock = -1;
    }
    if (ours && f.glowLock >= 0) {
      this.glowLock = f.glowLock;
      this.glowPiece = f.glowPiece;
      scene.scraps.handle(f.glowLock, f.glowPiece).setGlow(f.glow);
    }
    if (ours && f.solvedLock >= 0 && f.solved > 0) {
      this.solvedLock = f.solvedLock;
      scene.panelArt.setWarmth(f.solvedLock, f.solved);
    } else if (this.solvedLock >= 0) {
      scene.panelArt.setWarmth(this.solvedLock, 0);
      this.solvedLock = -1;
    }
    // Lock I marked through its step: its outline breathing, its scraps lit (after the solved twin's warmth above,
    // so the mark comes back on the frame an example lets go of the lock).
    const mark = ours && box && f.mark >= 0 ? box.locks[f.mark] : undefined;
    if (mark) markLock(scene, mark, f.markWarmth, this.marked !== f.mark);
    this.marked = mark ? f.mark : -1;
    if (ours && f.fill >= 1 && !this.formed && this.plan && f.solvedLock >= 0) {
      const twin = this.plan.twins[f.solvedLock];
      if (twin) {
        this.formed = true;
        void crystallise(scene, twin.lock, h.at[2], { reducedMotion: reduced });
      }
    } else if (this.formed && f.fill <= 0) {
      // The twin's piece goes as the scraps swing home: the player's lock is short again.
      this.formed = false;
      scene.crystals.setBox(null);
    }
    if (f.clicks !== this.clicks) {
      this.clicks = f.clicks;
      if (ours) {
        if (h.anchor === "tip" && f.solvedLock >= 0) this.d.sound.crystallise(f.solvedLock);
        else this.d.sound.settle();
      }
    }

    // The coach line, and the box forming out of light.
    if (scene.size !== this.sizeM) {
      this.sizeM = scene.size;
      this.coachView.setBoxSize(scene.size);
    }
    this.coach.show(line);
    this.coach.update(dtMs);
    this.coachView.opacity = this.coach.opacity;
    this.placeCoach(ours && f.coachNear, side, reduced, dtMs);
    const glow = ours ? (1 - f.form) * (1 - f.form) * LESSON_LOOK.formGlowAlpha : 0;
    this.formGlow.visible = glow > 0.002;
    this.formGlow.material.opacity = glow;
  }

  /** How far the chip is over toward the lantern: 0 over the box, 1 by the lantern. */
  get coachNear(): number {
    return this.nearK;
  }

  /**
   * The chip by the lantern while `near`, else over the box. Unseen it moves at once; seen, it glides there over
   * coachGlideMs (with reduced motion it waits until it is unseen: a line changing fades it out first).
   */
  private placeCoach(near: boolean, side: number, reduced: boolean, dtMs: number): void {
    if (near && this.sizeM > 0) {
      const c = this.coachView.chipMm;
      coachNearPose(this.d.lantern.ctrl.pos, side, this.sizeM, c.w, c.h, this.nearPos, this.nearQ);
    }
    const target = near ? 1 : 0, k0 = this.nearK;
    if (this.coach.opacity <= 0) this.nearK = target;
    else if (!reduced) {
      const step = Math.max(0, dtMs) / LESSON_LOOK.coachGlideMs;
      this.nearK = target > k0 ? Math.min(target, k0 + step) : Math.max(target, k0 - step);
    }
    const k = this.nearK, e = k * k * (3 - 2 * k), o = this.coachView.object;
    o.position.lerpVectors(this.topPos, this.nearPos, e);
    o.quaternion.slerpQuaternions(this.topQ, this.nearQ, e);
  }

  /** Ghost things put away (no lesson). */
  clear(tMs: number): void {
    this.ghost.opacity = 0;
    this.lamp.opacity = 0;
    this.d.scene.setGhostShadows(this.ghostOutlines, 0, this.ghostShadow.depth);
    this.d.scene.setLightFrom(null);
    this.unpark(tMs);
    this.coach.show(null);
  }

  /** No cradle: a lantern in it is let go where it stands, its glow back. */
  private unpark(tMs: number): void {
    if (this.parked) {
      this.parked = false;
      this.d.lantern.freeze(false, tMs);
    }
    this.lastPark = 0;
    this.cradle.visible = false;
    this.d.scene.lantern.setQuiet(false);
  }

  /** The lantern flies into its cradle as `park` rises and out (to `lift`, else back where it was) as it falls. */
  private park(f: LessonFrame, side: number, reduced: boolean, tMs: number): void {
    const { lantern } = this.d;
    const p = f.park, c = LESSON_LOOK.cradle;
    const cx = c[0] * side, cy = c[1], cz = c[2];
    if (p > 0) {
      if (!this.parked) {
        this.parked = true;
        this.lifting = false;
        this.hasLift = false;
        const q = lantern.ctrl.pos;
        this.from[0] = q[0];
        this.from[1] = q[1];
        this.from[2] = q[2];
        lantern.freeze(true, tMs);
      }
      // Falling: it lifts out, to the frame's lift point if it has one, else back where it came from.
      if (p < this.lastPark) this.lifting = true;
      if (f.lift) {
        this.hasLift = true;
        this.liftTo[0] = f.lift[0];
        this.liftTo[1] = f.lift[1];
        this.liftTo[2] = f.lift[2];
      }
      const to = this.lifting && this.hasLift ? this.liftTo : this.from;
      const k = reduced ? (p >= 0.5 ? 1 : 0) : p;
      this.at[0] = to[0] + (cx - to[0]) * k;
      this.at[1] = to[1] + (cy - to[1]) * k;
      this.at[2] = to[2] + (cz - to[2]) * k;
      lantern.place(this.at);
    } else if (this.parked) {
      this.parked = false;
      lantern.place(this.hasLift ? this.liftTo : this.from);
      lantern.freeze(false, tMs);
    }
    this.lastPark = p;
    // In the cradle the lantern waits quiet (no glow): the example's ghost lantern does the lighting.
    this.d.scene.lantern.setQuiet(p > 0);
    this.cradle.visible = p > 0;
    this.cradle.position.set(cx, cy - 0.075, cz);
    (this.cradle.material as MeshBasicMaterial).opacity = Math.min(1, p * 3);
  }
}
