// The box's reward: a small brass plaque carrying the box's lock shapes in relief, rising out of the opened drawer
// with its story line on a card above it ("Off the desk of the Clockmaker. Inside: a night train ticket to Lisbon.").
// Pinch it, carry it toward you and let go: it is taken (shrinks away into the collection). Let go anywhere else and
// it floats back. A hand holding the lantern cannot take it. As it rises a gold glow blooms behind it (one
// brightening on the box's flash budget) and settles to a soft glow while it floats; with reduced motion it
// brightens in place. Lives in the box root in box units: three draw calls while shown. The plaque and card are made
// once per box; per frame nothing is allocated.
//
// Under it, once it is up, the box's result card (src/ui/result-card.ts: the box's name, a tile per lock, the time,
// the streak, the best, the site's name): one more draw call. It stays where the reward floated after the reward is
// taken, until the next box, so the player can take a system screenshot or show it in a cast at leisure.
import {
  DataTexture,
  ExtrudeGeometry,
  Group,
  LinearFilter,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  RGBAFormat,
  Shape,
  Vector3,
} from "@iwsdk/core";
import type { Box, V2, V3 } from "../core/types";
import { copy, type Lang, lang, storyLoot, storyOwner } from "../i18n";
import { fill } from "../ui/copy";
import type { ResultCard } from "../ui/result-card";
import { clamp01, outBack, outCubic, smoothstep } from "./fx/ease";
import type { FlashBudget } from "./fx/flash-budget";
import { fitLabel, LabelCanvas, labelFont, labelMaterial, roundRect, wrapLabel } from "./label";
import { LIGHT_BLEND } from "./light-blend";
import { mergeParts } from "./merge";
import { COLORS } from "./theme";

export const REWARD = {
  /** It starts rising this long after the box opens (with the tune), over this long. */
  riseAtS: 1.7,
  riseS: 0.8,
  /** It floats this high above the drawer top (box units). */
  rise: 0.5,
  /**
   * Risen, the plaque floats no further from the box's middle than this (box units), rising a little inward from the
   * drawer (which opens at DRAWER_X, 0.34): seen from the seated eye, its outer edge stays clear of the front post.
   */
  maxX: 0.17,
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
  /**
   * The story card above it (box units), and its canvas: room for the two sentences on a line each, or on two lines
   * each where a language's sentence is longer (the card drawn only as tall as its lines, centred where it was).
   */
  card: { w: 0.62, h: 0.2, above: 0.14, px: [1024, 330] as const },
  /**
   * The glow behind the plaque (box units): its size and depth behind it, its peak opacity as it rises, the share
   * of that it settles to while it floats, and the size it grows from (none with reduced motion). About three
   * plaques wide, so the plaque covers only its middle and the gold shows round it.
   */
  glow: { size: 1.05, z: -0.03, peak: 0.85, rest: 0.4, growFrom: 0.55, refused: 0.5 },
  /**
   * The result card (box units): its size, its gap under the plaque, and its canvas (the card drawn from the top, only
   * as tall as its lines). About 10.6 by 8 cm in the default box.
   */
  result: { w: 0.44, h: 0.33, gap: 0.025, px: [768, 576] as const },
} as const;

/** The result card's lettering and tiles (canvas px on the 768 px card). */
export const RESULT_LOOK = {
  pad: 26,
  title: 50,
  tile: 76,
  tileGap: 14,
  time: 100,
  line: 44,
  lineH: 1.32,
  site: 34,
  room: 768 - 60,
  /** A tile's colour: no hint, a hint, the spot shown (the share text's yellow, orange and red squares). */
  colors: { clear: "#f2c94c", hinted: "#f2994a", shown: "#e5534b" },
} as const;

/**
 * The story lines' lettering (canvas px on the 1024 px card): 54 px where both sentences fit a line each, smaller in
 * steps to no less than English itself needs for its longest sentence (44 px); past that a sentence wraps onto a
 * second line rather than shrink. Lines are this far apart (times the size), inside this much side room.
 */
export const STORY = { max: 54, floor: 44, lineH: 1.35, padY: 22, room: 1024 - 70, linesEach: 2 } as const;

/** How the story's two sentences are set: their size and lines, and whether one is still too wide (squeezed). */
export interface StoryLayout {
  size: number;
  lines: string[];
  squeezed: boolean;
}

/** Set the box's two story sentences in `g` (language `l`): one line each where they fit, else wrapped. */
export function storyLayout(g: Parameters<typeof fitLabel>[0], owner: string, loot: string, l: Lang = lang()): StoryLayout {
  const S = STORY;
  const a = fitLabel(g, owner, "italic", S.max, S.floor, S.room, l);
  const b = fitLabel(g, loot, "italic", S.max, S.floor, S.room, l);
  if (!a.squeezed && !b.squeezed) {
    const size = Math.min(a.size, b.size);
    g.font = labelFont("italic", size, l);
    return { size, lines: [owner, loot], squeezed: false };
  }
  // At the floor: each sentence on as many lines as it needs, up to two.
  g.font = labelFont("italic", S.floor, l);
  const lines = [...wrapLabel(g, owner, S.room, S.linesEach), ...wrapLabel(g, loot, S.room, S.linesEach)];
  return { size: S.floor, lines, squeezed: lines.some((l) => g.measureText(l).width > S.room) };
}

/**
 * The glow's texture: white, its alpha falling as (1 - r)² from the centre (r 0) to the edge (r 1). Broad, unlike the
 * lantern's halo with its bright core, since the plaque hides the middle.
 */
function glowTexture(size: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2, i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = r >= 1 ? 0 : Math.round((1 - r) * (1 - r) * 255);
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

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
  /** The box whose story the card tells (repainted in a new language). */
  private box: Box | null = null;
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
  /** The glow behind the plaque (its opacity: the bloom as it rises, then a soft glow). */
  readonly glow: Mesh;
  /** The glow's strength: 1, or half when the flash budget refused its bloom; NaN until it rises. */
  private glowStrength = Number.NaN;
  /** The result card under the plaque (in the box root, so it stays when the reward is taken). */
  readonly result: Mesh;
  private readonly resultLabel = new LabelCanvas(REWARD.result.px[0], REWARD.result.px[1]);
  private shownCard: ResultCard | null = null;
  /** The reward has been up since it rose for this box: the card shows (until the next box). */
  private risen = false;

  /** `budget`: the box's one flash budget (the box scene steps it): the rise's bloom is a brightening. */
  constructor(
    root: Object3D,
    private readonly budget?: FlashBudget,
  ) {
    this.group.name = "Reward";
    const trim = root.getObjectByName("Box Trim") as Mesh | undefined;
    const brass = (trim?.material as Material | undefined) ?? new MeshBasicMaterial({ color: COLORS.metal });
    this.trinket = new Mesh(undefined, brass);
    this.trinket.name = "Reward Trinket";
    this.card = new Mesh(new PlaneGeometry(REWARD.card.w, REWARD.card.h), labelMaterial(this.label.texture, { depthWrite: false }));
    this.card.name = "Reward Story";
    this.card.position.set(0, REWARD.card.above, 0);
    // A gold glow behind the plaque, added as light: flat and parallel to the plaque, behind its back face. A
    // camera-facing sprite would tilt through the plaque seen from above or aside and lay a bright wedge across it.
    this.glow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: glowTexture(64),
        color: COLORS.gold,
        ...LIGHT_BLEND,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        opacity: 0,
      }),
    );
    this.glow.name = "Reward Glow";
    this.glow.position.set(0, 0, REWARD.glow.z);
    this.glow.scale.set(REWARD.glow.size, REWARD.glow.size, 1);
    this.glow.visible = false;
    this.group.add(this.glow, this.trinket, this.card);
    this.group.visible = false;
    root.add(this.group);
    this.result = new Mesh(new PlaneGeometry(REWARD.result.w, REWARD.result.h), labelMaterial(this.resultLabel.texture, { depthWrite: false }));
    this.result.name = "Reward Result";
    this.result.visible = false;
    root.add(this.result);
  }

  /** Make this box's reward (hidden until the box opens). */
  setBox(box: Box | null): void {
    this.hide();
    this.setResult(null);
    this.risen = false;
    this.box = box;
    if (!box) return;
    this.trinket.geometry.dispose();
    this.trinket.geometry = trinketGeometry(box);
    this.paintStory();
  }

  /** The two story sentences in the language shown (the saved English words translated by place). */
  get story(): [string, string] {
    const b = this.box, g = copy().game;
    if (!b) return ["", ""];
    return [fill(g.storyOwner, { owner: storyOwner(b.owner) }), fill(g.storyLoot, { loot: storyLoot(b.loot) })];
  }

  /** The language changed (or its font arrived): the story card again. */
  relabel(): void {
    if (this.box) this.paintStory();
  }

  /** The result card shown under the plaque once it is up (null: none). Painted now, never per frame. */
  setResult(card: ResultCard | null): void {
    this.shownCard = card;
    if (card) this.paintResult(card);
    this.result.visible = card !== null && this.risen;
  }

  /** The result card given, or null. */
  get resultCard(): ResultCard | null {
    return this.shownCard;
  }

  private paintResult(card: ResultCard): void {
    const R = RESULT_LOOK;
    this.resultLabel.paint((g, w) => {
      const lineH = R.line * R.lineH;
      const h = R.pad + R.title * 1.2 + 14 + R.tile * 1.3 + 8 + card.lines.length * lineH + 10 + R.site * 1.3 + R.pad;
      roundRect(g, 4, 4, w - 8, h - 8, 26);
      g.fillStyle = "rgba(20, 16, 22, 0.9)";
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = COLORS.etch;
      g.stroke();
      g.textAlign = "center";
      g.textBaseline = "middle";
      let y = R.pad + (R.title * 1.2) / 2;
      fitLabel(g, card.title, "bold", R.title, R.title * 0.7, R.room);
      g.fillStyle = "#f6e7c4";
      g.fillText(card.title, w / 2, y, R.room);
      // The tiles and the time on one row, centred together.
      y += (R.title * 1.2) / 2 + 14 + (R.tile * 1.3) / 2;
      const n = card.tiles.length, tilesW = n * R.tile + (n - 1) * R.tileGap;
      g.font = labelFont("bold", R.time);
      const timeW = g.measureText(card.time).width, gap = 34;
      let x = (w - (tilesW + gap + timeW)) / 2;
      for (const t of card.tiles) {
        roundRect(g, x, y - R.tile / 2, R.tile, R.tile, 12);
        g.fillStyle = R.colors[t];
        g.fill();
        x += R.tile + R.tileGap;
      }
      g.textAlign = "left";
      g.fillStyle = "#fff3cf";
      g.fillText(card.time, x - R.tileGap + gap, y);
      g.textAlign = "center";
      y += (R.tile * 1.3) / 2 + 8 + lineH / 2;
      g.fillStyle = "#f6e7c4";
      for (const line of card.lines) {
        fitLabel(g, line, "600", R.line, R.line * 0.75, R.room);
        g.fillText(line, w / 2, y, R.room);
        y += lineH;
      }
      y += 10 + (R.site * 1.3) / 2 - lineH / 2;
      g.font = labelFont("italic", R.site, "en");
      g.fillStyle = COLORS.metal;
      g.fillText(card.site, w / 2, y, R.room);
    });
  }

  private paintStory(): void {
    const [a, b] = this.story;
    this.label.paint((g, w, h) => {
      const L = storyLayout(g, a, b);
      const lineH = L.size * STORY.lineH, block = L.lines.length * lineH, ch = block + 2 * STORY.padY;
      roundRect(g, 4, (h - ch) / 2, w - 8, ch, 26);
      g.fillStyle = "rgba(20, 16, 22, 0.86)";
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = COLORS.etch;
      g.stroke();
      g.fillStyle = "#f6e7c4";
      g.textAlign = "center";
      g.textBaseline = "middle";
      const top = (h - block) / 2 + lineH / 2;
      L.lines.forEach((line, i) => g.fillText(line, w / 2, top + i * lineH, STORY.room));
    });
  }

  /** The box opened: rise out of the drawer whose top is `drawer` (box units), REWARD.riseAtS from now. */
  rise(drawer: Readonly<V3>): void {
    this.from.set(drawer[0], drawer[1], drawer[2]);
    // Up and a little inward, clear of the front post (REWARD.maxX).
    const x = Math.sign(drawer[0]) * Math.min(Math.abs(drawer[0]), REWARD.maxX);
    this.rest.set(x, drawer[1] + REWARD.rise, drawer[2] - 0.04);
    // The card's top a gap under the plaque where it will float (the mesh is the canvas's full height: its painted
    // part starts at the top).
    const C = REWARD.result;
    this.result.position.set(x, this.rest.y - REWARD.plaque.h / 2 - C.gap - C.h / 2, this.rest.z);
    this.risen = false;
    this.result.visible = false;
    this.group.position.copy(this.from);
    this.group.scale.setScalar(0.4);
    this.group.visible = false;
    this.glow.visible = false;
    this.glowStrength = Number.NaN;
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
    this.glow.visible = false;
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
        this.bloom(k, reduced);
        if (k >= 1) {
          this.group.scale.setScalar(1);
          this.phase = "up";
          this.risen = true;
          this.result.visible = this.shownCard !== null;
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

  /**
   * The glow as it rises (`k` 0..1): one brightening on the box's flash budget (half when refused), up smoothly to
   * its peak half way, then settling to a soft glow that stays while it floats; it grows as it blooms, except with
   * reduced motion, where it brightens in place.
   */
  private bloom(k: number, reduced: boolean): void {
    const G = REWARD.glow;
    if (this.glowStrength !== this.glowStrength) this.glowStrength = !this.budget || this.budget.take() ? 1 : G.refused;
    const env = k < 0.5 ? smoothstep(0, 0.5, k) : 1 - (1 - G.rest) * smoothstep(0.5, 1, k);
    (this.glow.material as MeshBasicMaterial).opacity = G.peak * this.glowStrength * env;
    const s = G.size * (reduced ? 1 : G.growFrom + (1 - G.growFrom) * outCubic(k));
    this.glow.scale.set(s, s, 1);
    this.glow.visible = true;
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
