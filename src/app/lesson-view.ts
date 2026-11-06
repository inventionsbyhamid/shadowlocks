// What a lesson shows, frame by frame, from the director's LessonFrame: the pale-blue ghost hand (human-sized, in
// the world) and ghost lantern (in the box), the ghost's bones casting through the box's one shadow cast, the shadows
// cast from the ghost lantern while it solves an example, the scraps swinging between the twin's layout and the
// player's, the player's lantern flying into its cradle on the frame and out again, the near scrap's glow, the twin
// lit when the ghost clicks it, the ghost finger's piece forming, the coach line, and the box forming out of light.
//
// Reduced motion: the lantern goes to and from its cradle in one cut (no flight), the swing takes the director's
// no-overshoot curve, and every fade is opacity only. One click (one flash) per example. Allocation-free per frame.
import {
  AdditiveBlending,
  Color,
  type Matrix4,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type World,
} from "@iwsdk/core";
import { type LessonId, type LessonPlan, lessonPlan } from "../core/lessons-data";
import type { Box, V2, V3 } from "../core/types";
import type { HandJoints, HandSide } from "../input/hand-joints";
import type { BoxScene } from "../render/box-scene";
import { crystallise } from "../render/fx/crystallise";
import { GhostHand, GhostLantern } from "../render/ghost-hand";
import { HandShadow, MAX_HAND_OUTLINES } from "../render/hand-shadow";
import { radialTexture } from "../render/lantern-view";
import { boxToWorld } from "../render/placement";
import { COLORS } from "../render/theme";
import { CoachLine, CoachLineView } from "../ui/coach-line";
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
  /** The box forming out of light: a warm glow over the box (box units), fading as the box forms. */
  formGlowSize: 1.5,
  formGlowAlpha: 0.85,
  /** The ghost casts once it is this solid (a ghost fading in or out casts nothing). */
  castFrom: 0.3,
} as const;

export interface LessonViewDeps {
  world: World;
  scene: BoxScene;
  lantern: {
    readonly ctrl: { readonly pos: V3 };
    place(p: Readonly<V3>): void;
    freeze(on: boolean, tMs: number): void;
  };
  sound: { settle(): void; crystallise(lock: number): void };
  reducedMotion(): boolean;
}

/** Which lesson's box the frame is about now: the lesson's, or a replay's. */
export interface LessonOnScreen {
  lesson: LessonId | null;
}

export class LessonView {
  readonly ghost: GhostHand;
  readonly lamp: GhostLantern;
  readonly coach: CoachLine;
  readonly coachView: CoachLineView;
  private readonly cradle: Mesh;
  private readonly formGlow: Sprite;
  private readonly ghostShadow = new HandShadow();
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
  private sizeM = 0;
  private readonly vAt = new Vector3();
  private readonly vF = new Vector3();
  private readonly vP = new Vector3();

  constructor(private readonly d: LessonViewDeps) {
    const { scene, world } = d;
    this.ghost = new GhostHand("right");
    this.ghost.opacity = 0;
    world.scene.add(this.ghost.object);
    this.lamp = new GhostLantern();
    this.lamp.opacity = 0;
    scene.root.add(this.lamp.object);
    this.coachView = new CoachLineView();
    this.coachView.object.position.set(LESSON_LOOK.coachAt[0], LESSON_LOOK.coachAt[1], LESSON_LOOK.coachAt[2]);
    this.coachView.object.rotation.x = LESSON_LOOK.coachTilt;
    scene.root.add(this.coachView.object);
    this.coach = new CoachLine(this.coachView);
    this.cradle = new Mesh(
      new TorusGeometry(0.05, 0.007, 6, 24).rotateX(Math.PI / 2),
      new MeshBasicMaterial({ color: COLORS.metal, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.cradle.name = "Lantern Cradle";
    this.cradle.visible = false;
    scene.root.add(this.cradle);
    this.formGlow = new Sprite(
      new SpriteMaterial({ map: radialTexture(64, false), color: new Color(COLORS.lamp), blending: AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
    );
    this.formGlow.name = "Box Forming";
    this.formGlow.position.set(0, 0, 0.5);
    this.formGlow.scale.setScalar(LESSON_LOOK.formGlowSize);
    this.formGlow.visible = false;
    scene.root.add(this.formGlow);
    for (let i = 0; i < MAX_HAND_OUTLINES; i++) this.ghostOutlines.push([]);
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
      this.layoutBox = null;
      this.layout = null;
      this.plan = null;
    }
    const m = scene.root.matrixWorld, reduced = this.d.reducedMotion();
    const side = box?.mirrored ? -1 : 1;

    // The swing, and where the shadows are cast from.
    if (this.layout && box) for (let k = 0; k < box.locks.length && k < f.layout.length; k++) this.layout.set(k, f.layout[k]!, this.sink);
    scene.setLightFrom(ours && f.ghostLight ? f.lamp.at : null);

    // The ghost lantern and hand.
    this.lamp.setPos(f.lamp.at);
    this.lamp.opacity = ours ? f.lamp.opacity : 0;
    // The ghost hand only while a lesson or replay is on screen (a menu over the lesson puts it away).
    const h = f.hand, ho = on.lesson !== null ? h.opacity : 0;
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

    // The player's lantern to its cradle and back.
    this.park(f, side, reduced, tMs);

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
    const glow = ours ? (1 - f.form) * (1 - f.form) * LESSON_LOOK.formGlowAlpha : 0;
    this.formGlow.visible = glow > 0.002;
    this.formGlow.material.opacity = glow;
  }

  /** Ghost things put away (no lesson). */
  clear(tMs: number): void {
    this.ghost.opacity = 0;
    this.lamp.opacity = 0;
    this.d.scene.setGhostShadows(this.ghostOutlines, 0, this.ghostShadow.depth);
    this.d.scene.setLightFrom(null);
    if (this.parked) {
      this.parked = false;
      this.d.lantern.freeze(false, tMs);
    }
    this.cradle.visible = false;
    this.coach.show(null);
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
    this.cradle.visible = p > 0;
    this.cradle.position.set(cx, cy - 0.075, cz);
    (this.cradle.material as MeshBasicMaterial).opacity = Math.min(1, p * 3);
  }
}
