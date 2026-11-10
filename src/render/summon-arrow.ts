// What brings a headset's lost box back (lost-box.ts, app/summon.ts): a small gold arrow at the edge of the view that
// points toward the box, and a short fade of the whole view while the box is placed in front.
// - The arrow: a flat shape with a dark rim (one mesh, one draw call), no text. It stands ARROW.distM from the eyes,
//   ARROW.edgeDeg off the middle of the view toward the box, facing the eyes; it follows the head loosely (eased, never
//   head-locked). A pinch on it (or a controller's trigger at it), a pinch with the hand's or controller's ray on it, or
//   a fingertip poking it takes it.
// - The fade: an inside-out black sphere round the head, drawn last over everything (one draw call while it fades), so
//   the box is placed unseen: a fade out and in, no slide.
// Both are in the scene from the start, hidden, so the session's prewarm compiles them. Allocation free per frame.
import {
  BackSide,
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
} from "@iwsdk/core";
import type { HandPinch } from "../input/grab-system";
import { mergeColored } from "./merge";
import { COLORS } from "./theme";

const DEG = Math.PI / 180;

export const ARROW = {
  /** From the eyes (m): within reach. */
  distM: 0.45,
  /** Off the middle of the view, toward the box (degrees): at its edge, still easy to see. */
  edgeDeg: 24,
  /** Tip to tail (m). */
  lengthM: 0.05,
  /** How loosely it follows the head: the time constant of its easing (s). */
  followS: 0.25,
  /** A pinch (or a controller's grip) this near its middle takes it (m). */
  reachM: 0.08,
  /** A fingertip this near its middle pokes it (m). */
  pokeM: 0.035,
  /** A ray passing this near its middle, with a pinch or a trigger, takes it (m). */
  rayM: 0.06,
} as const;

export const FADE = {
  /** The black sphere's radius round the head (m): past the near plane, inside everything else. */
  radiusM: 0.25,
  /** Drawn after everything. */
  renderOrder: 1e6,
} as const;

/** A flat arrow pointing +x, its middle at the origin, `len` long. */
function arrowShape(len: number): Shape {
  const h = len / 2, head = len * 0.44, wing = len * 0.34, shaft = len * 0.13;
  const s = new Shape();
  s.moveTo(h, 0);
  s.lineTo(h - head, wing);
  s.lineTo(h - head, shaft);
  s.lineTo(-h, shaft);
  s.lineTo(-h, -shaft);
  s.lineTo(h - head, -shaft);
  s.lineTo(h - head, -wing);
  s.lineTo(h, 0);
  return s;
}

/** The arrow's geometry: the gold shape over a dark rim a little bigger, just behind it (one mesh). */
export function arrowGeometry(): ReturnType<typeof mergeColored> {
  const gold = new ShapeGeometry(arrowShape(ARROW.lengthM));
  const rim = new ShapeGeometry(arrowShape(ARROW.lengthM * 1.3)).translate(-ARROW.lengthM * 0.03, 0, -0.0015);
  return mergeColored([
    [rim, new Color(COLORS.frame)],
    [gold, new Color(COLORS.gold)],
  ]);
}

/** What can take the arrow: both fingertips (and a phone's), as the keys read them. */
export interface ArrowTips {
  count: number;
  readonly points: readonly Vector3[];
}

/** The hands' and controllers' target rays: each looks down its -z from its origin. */
export interface ArrowRays {
  readonly left: Object3D;
  readonly right: Object3D;
}

const rel = new Vector3();
const want = new Vector3();
const nrm = new Vector3();
const ax = new Vector3();
const ay = new Vector3();
const inv = new Quaternion();
const turnTo = new Quaternion();
const basis = new Matrix4();

export class SummonView {
  readonly arrow: Mesh;
  readonly fade: Mesh;
  /** The arrow's middle now (world). */
  readonly at = new Vector3();
  private readonly turn = new Quaternion();
  private placed = false;
  private readonly fadeMat: MeshBasicMaterial;

  constructor() {
    this.arrow = new Mesh(arrowGeometry(), new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false }));
    this.arrow.name = "Summon Arrow";
    this.arrow.visible = false;
    this.fadeMat = new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      side: BackSide,
      toneMapped: false,
    });
    this.fade = new Mesh(new SphereGeometry(FADE.radiusM, 16, 12), this.fadeMat);
    this.fade.name = "Summon Fade";
    this.fade.renderOrder = FADE.renderOrder;
    this.fade.frustumCulled = false;
    this.fade.visible = false;
  }

  /** Show or hide the arrow; shown again, it starts where it should be (no easing in from where it was). */
  show(on: boolean): void {
    this.arrow.visible = on;
    if (!on) this.placed = false;
  }

  /**
   * Stand the arrow for the head at `eye` turned `head` (it looks down its -z) and the box's middle at `box` (world):
   * ARROW.distM away, ARROW.edgeDeg off the middle of the view toward the box, facing the eyes, its tip toward the box;
   * eased there over ARROW.followS (`dtS` since the last frame).
   */
  follow(eye: Readonly<Vector3>, head: Readonly<Quaternion>, box: Readonly<Vector3>, dtS: number): void {
    // The box's way in the head's frame, across the view.
    rel.copy(box).sub(eye).applyQuaternion(inv.copy(head).invert());
    let ux = rel.x, uy = rel.y;
    const l = Math.hypot(ux, uy);
    if (l > 1e-6) {
      ux /= l;
      uy /= l;
    } else {
      ux = 1;
      uy = 0;
    }
    const s = Math.sin(ARROW.edgeDeg * DEG), c = Math.cos(ARROW.edgeDeg * DEG), d = ARROW.distM;
    want.set(ux * s * d, uy * s * d, -c * d);
    // Facing the eyes (its +z toward them), its +x (the tip) along the box's way, across that face.
    nrm.copy(want).normalize().negate();
    ax.set(ux, uy, 0).addScaledVector(nrm, -(ux * nrm.x + uy * nrm.y)).normalize();
    ay.crossVectors(nrm, ax);
    turnTo.setFromRotationMatrix(basis.makeBasis(ax, ay, nrm)).premultiply(head as Quaternion);
    want.applyQuaternion(head).add(eye);
    if (!this.placed) {
      this.at.copy(want);
      this.turn.copy(turnTo);
      this.placed = true;
    } else {
      const k = 1 - Math.exp(-Math.max(0, dtS) / ARROW.followS);
      this.at.lerp(want, k);
      this.turn.slerp(turnTo, k);
    }
    this.arrow.position.copy(this.at);
    this.arrow.quaternion.copy(this.turn);
  }

  /**
   * Whether the arrow is taken this frame: a pinch (a controller's trigger or squeeze) starting within ARROW.reachM of
   * it, or with that hand's or controller's ray passing within ARROW.rayM of it; or a fingertip within ARROW.pokeM.
   */
  taken(hands: readonly HandPinch[], tips: ArrowTips, rays: ArrowRays | null): boolean {
    if (!this.arrow.visible) return false;
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i]!;
      if (h.edge !== "start" || !h.tracked) continue;
      if (h.point.distanceTo(this.at) <= ARROW.reachM) return true;
      const ray = rays ? (i === 0 ? rays.left : rays.right) : null;
      if (ray && this.onRay(ray)) return true;
    }
    for (let i = 0; i < tips.count; i++) if (tips.points[i]!.distanceTo(this.at) <= ARROW.pokeM) return true;
    return false;
  }

  /** The ray (its origin, down its -z) passes within ARROW.rayM of the arrow, in front of it. */
  private onRay(ray: Object3D): boolean {
    ray.updateWorldMatrix(true, false);
    const e = ray.matrixWorld.elements;
    let dx = -e[8]!, dy = -e[9]!, dz = -e[10]!;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(l > 0)) return false;
    dx /= l;
    dy /= l;
    dz /= l;
    const vx = this.at.x - e[12]!, vy = this.at.y - e[13]!, vz = this.at.z - e[14]!;
    const t = vx * dx + vy * dy + vz * dz;
    if (t < 0) return false;
    return vx * vx + vy * vy + vz * vz - t * t <= ARROW.rayM * ARROW.rayM;
  }

  /** The view's fade: 0 clear (not drawn) to 1 black, round the head at `eye`. */
  setFade(a: number, eye: Readonly<Vector3>): void {
    this.fadeMat.opacity = a;
    this.fade.visible = a > 0;
    if (a > 0) this.fade.position.copy(eye);
  }

  /** The fade now (0: none). */
  get fadeNow(): number {
    return this.fade.visible ? this.fadeMat.opacity : 0;
  }
}
