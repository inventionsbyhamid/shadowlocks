// The box's reward: a small brass plaque carrying the box's lock shapes in relief, rising out of the opened drawer
// with its story line on a card above it ("Off the desk of the Clockmaker. Inside: a night train ticket to Lisbon.").
// Pinch it, carry it toward you and let go: it is taken (shrinks away into the collection). Let go anywhere else and
// it floats back. A hand holding the lantern cannot take it. Lives in the box root in box units: two draw calls while
// shown. The plaque and card are made once per box; per frame nothing is allocated.
import { ExtrudeGeometry, Group, type Material, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, Shape, Vector3 } from "@iwsdk/core";
import type { Box, V2, V3 } from "../core/types";
import { COPY, fill } from "../ui/copy";
import { clamp01, outBack, outCubic } from "./fx/ease";
import { LABEL_FONT, LabelCanvas, roundRect } from "./label";
import { mergeParts } from "./merge";
import { COLORS } from "./theme";

export const REWARD = {
  /** It starts rising this long after the box opens (with the tune), over this long. */
  riseAtS: 1.7,
  riseS: 0.8,
  /** It floats this high above the drawer top (box units). */
  rise: 0.5,
  /** A pinch starting this close to it takes hold (cm). */
  grabCm: 7,
  /** Let go this much nearer the player than where it floated (cm, toward +z): taken. */
  takeCm: 5,
  /** Let go elsewhere: it floats back over this long (s). */
  backS: 0.4,
  /** Taken: it shrinks away over this long (s). */
  takeS: 0.45,
  /** The plaque: size and thickness (box units); each shape's size on it and their spacing. */
  plaque: { w: 0.34, h: 0.14, d: 0.012, shape: 0.1, gap: 0.11, relief: 0.014 },
  /** The story card above it (box units), and its canvas. */
  card: { w: 0.62, h: 0.12, above: 0.14, px: [1024, 198] as const },
} as const;

/** The hands as the reward needs them: pinch points in box units this frame. */
export interface RewardHands {
  /** Hand `i`'s pinch point (box units) into `out`; false when it is not tracked. */
  point(i: 0 | 1, out: V3): boolean;
  pinching(i: 0 | 1): boolean;
  /** Its pinch started this frame. */
  started(i: 0 | 1): boolean;
  /** It holds the lantern. */
  busy(i: 0 | 1): boolean;
}

type Phase = "hidden" | "rising" | "up" | "held" | "back" | "taking";

/** A convex piece outline as an extruded relief (counter-clockwise or not). */
function relief(poly: V2[], depth: number): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(poly[0]![0], poly[0]![1]);
  for (let i = 1; i < poly.length; i++) s.lineTo(poly[i]![0], poly[i]![1]);
  s.closePath();
  return new ExtrudeGeometry(s, { depth, bevelEnabled: false });
}

/** The plaque with the box's lock shapes on it, one geometry (one draw call). */
export function trinketGeometry(box: Box) {
  const P = REWARD.plaque, n = box.locks.length;
  const plate = new Shape();
  const hw = P.w / 2, hh = P.h / 2, r = 0.025;
  plate.moveTo(-hw + r, -hh);
  plate.lineTo(hw - r, -hh);
  plate.quadraticCurveTo(hw, -hh, hw, -hh + r);
  plate.lineTo(hw, hh - r);
  plate.quadraticCurveTo(hw, hh, hw - r, hh);
  plate.lineTo(-hw + r, hh);
  plate.quadraticCurveTo(-hw, hh, -hw, hh - r);
  plate.lineTo(-hw, -hh + r);
  plate.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  const parts = [new ExtrudeGeometry(plate, { depth: P.d, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 })];
  box.locks.forEach((l, k) => {
    const s = P.shape / l.size, cx = (k - (n - 1) / 2) * P.gap;
    for (const piece of l.target) {
      const poly = piece.map((p): V2 => [cx + (p[0] - l.center[0]) * s, (p[1] - l.center[1]) * s]);
      parts.push(relief(poly, P.relief).translate(0, 0, P.d));
    }
  });
  return mergeParts(parts);
}

export class Reward {
  readonly group = new Group();
  private readonly trinket: Mesh;
  private readonly card: Mesh;
  private readonly label = new LabelCanvas(REWARD.card.px[0], REWARD.card.px[1]);
  private phase: Phase = "hidden";
  private t = 0;
  private wait = 0;
  /** Where it floats once up, where it rose from, where it is, and the grip while held (box units). */
  private readonly rest = new Vector3();
  private readonly from = new Vector3();
  private readonly backFrom = new Vector3();
  private readonly grip = new Vector3();
  private readonly hand: V3 = [0, 0, 0];
  private holder = -1;

  constructor(root: Object3D) {
    this.group.name = "Reward";
    const trim = root.getObjectByName("Box Trim") as Mesh | undefined;
    const brass = (trim?.material as Material | undefined) ?? new MeshBasicMaterial({ color: COLORS.metal });
    this.trinket = new Mesh(undefined, brass);
    this.trinket.name = "Reward Trinket";
    this.card = new Mesh(
      new PlaneGeometry(REWARD.card.w, REWARD.card.h),
      new MeshBasicMaterial({ map: this.label.texture, transparent: true, toneMapped: false, depthWrite: false }),
    );
    this.card.name = "Reward Story";
    this.card.position.set(0, REWARD.card.above, 0);
    this.group.add(this.trinket, this.card);
    this.group.visible = false;
    root.add(this.group);
  }

  /** Make this box's reward (hidden until the box opens). */
  setBox(box: Box | null): void {
    this.hide();
    if (!box) return;
    this.trinket.geometry.dispose();
    this.trinket.geometry = trinketGeometry(box);
    this.label.paint((g, w, h) => {
      roundRect(g, 4, 4, w - 8, h - 8, 26);
      g.fillStyle = "rgba(20, 16, 22, 0.86)";
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = COLORS.etch;
      g.stroke();
      g.fillStyle = "#f6e7c4";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const fit = (s: string, px: number) => {
        let size = px;
        g.font = `italic ${size}px ${LABEL_FONT}`;
        while (g.measureText(s).width > w - 70 && size > 20) {
          size -= 2;
          g.font = `italic ${size}px ${LABEL_FONT}`;
        }
      };
      const a = fill(COPY.game.storyOwner, { owner: box.owner }), b = fill(COPY.game.storyLoot, { loot: box.loot });
      fit(a, 54);
      g.fillText(a, w / 2, h * 0.33);
      fit(b, 54);
      g.fillText(b, w / 2, h * 0.7);
    });
  }

  /** The box opened: rise out of the drawer whose top is `drawer` (box units), REWARD.riseAtS from now. */
  rise(drawer: Readonly<V3>): void {
    this.from.set(drawer[0], drawer[1], drawer[2]);
    this.rest.set(drawer[0], drawer[1] + REWARD.rise, drawer[2] - 0.04);
    this.group.position.copy(this.from);
    this.group.scale.setScalar(0.4);
    this.group.visible = false;
    this.phase = "rising";
    this.t = 0;
    this.wait = REWARD.riseAtS;
  }

  /** Taken: it shrinks away. */
  take(): void {
    if (this.phase === "hidden") return;
    this.phase = "taking";
    this.t = 0;
    this.holder = -1;
  }

  hide(): void {
    this.phase = "hidden";
    this.group.visible = false;
    this.holder = -1;
  }

  /** Up (risen and floating, or held): it can be taken. */
  get up(): boolean {
    return this.phase === "up" || this.phase === "held" || this.phase === "back";
  }

  get held(): boolean {
    return this.phase === "held";
  }

  /** Where it is (box units). */
  position(out: V3): V3 {
    const p = this.group.position;
    out[0] = p.x;
    out[1] = p.y;
    out[2] = p.z;
    return out;
  }

  /**
   * Advance by `dt` seconds; `live` while it may be taken. Returns true on the frame it is let go nearer the player
   * (the session then takes it).
   */
  update(dt: number, hands: RewardHands, live: boolean, cmPerUnit: number, reduced: boolean): boolean {
    const d = dt > 0 ? dt : 0;
    switch (this.phase) {
      case "hidden":
        return false;
      case "rising": {
        if (this.wait > 0) {
          this.wait -= d;
          return false;
        }
        this.t += d;
        const k = clamp01(this.t / REWARD.riseS);
        this.group.visible = true;
        this.group.position.lerpVectors(this.from, this.rest, outCubic(k));
        this.group.scale.setScalar(reduced ? 1 : 0.4 + 0.6 * outBack(k, 1.2));
        if (k >= 1) {
          this.group.scale.setScalar(1);
          this.phase = "up";
        }
        return false;
      }
      case "taking": {
        this.t += d;
        const k = clamp01(this.t / REWARD.takeS);
        this.group.scale.setScalar(1 - outCubic(k));
        if (k >= 1) this.hide();
        return false;
      }
      case "back": {
        this.t += d;
        const k = clamp01(this.t / REWARD.backS);
        this.group.position.lerpVectors(this.backFrom, this.rest, outCubic(k));
        if (k >= 1) this.phase = "up";
        break;
      }
      default:
        break;
    }
    if (!live) return false;
    return this.phase === "held" ? this.carry(hands, cmPerUnit) : this.grabbed(hands, cmPerUnit);
  }

  /** A pinch starting on it takes hold. */
  private grabbed(hands: RewardHands, cmPerUnit: number): boolean {
    const p = this.group.position, h = this.hand;
    for (let i = 0; i < 2; i++) {
      const s = i as 0 | 1;
      if (hands.busy(s) || !hands.started(s) || !hands.point(s, h)) continue;
      const dx = h[0] - p.x, dy = h[1] - p.y, dz = h[2] - p.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) * cmPerUnit > REWARD.grabCm) continue;
      this.holder = i;
      this.grip.set(p.x - h[0], p.y - h[1], p.z - h[2]);
      this.phase = "held";
      return false;
    }
    return false;
  }

  /** Held: it follows the pinch; let go nearer the player than where it floated, it is taken. */
  private carry(hands: RewardHands, cmPerUnit: number): boolean {
    const s = this.holder as 0 | 1, h = this.hand, p = this.group.position;
    if (hands.point(s, h)) p.set(h[0] + this.grip.x, h[1] + this.grip.y, h[2] + this.grip.z);
    if (hands.pinching(s)) return false;
    this.holder = -1;
    if ((p.z - this.rest.z) * cmPerUnit >= REWARD.takeCm) return true;
    this.backFrom.copy(p);
    this.phase = "back";
    this.t = 0;
    return false;
  }
}
