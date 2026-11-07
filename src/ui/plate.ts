// The brass plate on the box: standing on the top of the frame at the back, leaning toward the player, it names the
// box ("Box No. 3", "Daily Box") and has a latch light for each lock (I, II, III) that comes on as the lock opens.
// After the reward is taken it offers the next box with a key above it. On the back of the box it is far more than
// 10 cm from the box mouth (the comfort rule for live keys). Sizes are in metres whatever the box size (the plate's
// group cancels the box's scale). Repainted only when the box or a latch changes; per frame only the key feels.
import { Group, Mesh, type Object3D, PlaneGeometry } from "@iwsdk/core";
import type { Box, BoxSpec } from "../core/types";
import { KEY_EVENT } from "../render/finger-key";
import { brassFace, LABEL_FONT, LabelCanvas, labelMaterial, roundRect } from "../render/label";
import { COPY, fill } from "./copy";
import type { Tips } from "./key-view";
import { PokeKey } from "./poke-key";

export const PLATE = {
  /** Where it stands on the box (box units): the top of the frame at the back. */
  at: [0, 0.535, 0.03] as const,
  /** It leans back this much more than the box (radians), to face a seated player's eyes. */
  lean: (-12 * Math.PI) / 180,
  /** Its size (m): room for the name beside three lights at full size, legible at 55 cm. */
  w: 0.17,
  h: 0.034,
  /** The Next key (m): above the plate, wide enough for its label at full size. */
  key: { w: 0.1, h: 0.044, above: 0.012 },
  /** The coach line's card (m): above the plate during play, about as wide as it, two lines of 13 mm lettering. */
  coach: { w: 0.2, h: 0.05, above: 0.012 },
} as const;

const ROMAN = ["I", "II", "III"];
const PX = 5000;
/** The name's lettering: this share of the plate's height, never smaller than the floor (it condenses instead). */
const NAME_SIZE = 0.46;
const NAME_FLOOR = 0.36;

/**
 * The plate's layout on its canvas (`w` x `h` px) with `n` latch lights: each light's centre and radius, and where the
 * name starts and how wide it may run, so it always stops short of the first light.
 */
export function plateLayout(w: number, h: number, n: number): { nameX: number; nameMax: number; lightX: number[]; lightR: number } {
  const lightR = h * 0.2, pitch = h * 0.72, right = w - h * 0.45, nameX = h * 0.4;
  const lightX = Array.from({ length: n }, (_, i) => right - (n - 1 - i) * pitch);
  const end = n > 0 ? lightX[0]! - lightR - h * 0.25 : w - nameX;
  return { nameX, nameMax: end - nameX, lightX, lightR };
}

/**
 * `text` in one line if it fits `max` (as `width` measures it), else in two broken between words where the longer
 * line is shortest.
 */
export function wrapTwo(text: string, width: (s: string) => number, max: number): string[] {
  if (width(text) <= max) return [text];
  const words = text.split(" ");
  let best: string[] = [text], bestW = Number.POSITIVE_INFINITY;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
    const w = Math.max(width(a), width(b));
    if (w < bestW) {
      bestW = w;
      best = [a, b];
    }
  }
  return best;
}

/** What the plate says for a box: its name, and a small cue under it ("Practice" for a `?box` practice box). */
export function plateText(spec: BoxSpec, practice: boolean): { name: string; cue: string } {
  const name = spec.kind === "box" ? fill(COPY.game.boxNo, { n: spec.n }) : spec.kind === "daily" ? COPY.game.daily : "";
  return { name, cue: practice ? COPY.game.practice : "" };
}

export class Plate {
  /** Cancels the box's scale: everything under it is in metres. */
  readonly group = new Group();
  readonly next = new PokeKey("plate-next", PLATE.key.w, PLATE.key.h, COPY.game.next);
  private readonly face: Mesh;
  private readonly label = new LabelCanvas(Math.round(PLATE.w * PX), Math.round(PLATE.h * PX));
  private name = "";
  /** A small line under the name ("Practice" for a `?box` box), or "". */
  private cue = "";
  private locks = 0;
  private readonly lit = [false, false, false];
  private scale = 0;
  /** The Next key's press was accepted (the press gate); its action comes when the finger lets go. */
  private armed = false;
  private readonly coachCard: Mesh;
  private readonly coachLabel = new LabelCanvas(Math.round(PLATE.coach.w * PX), Math.round(PLATE.coach.h * PX));
  private coachText = "";

  constructor(private readonly root: Object3D) {
    this.group.name = "Plate";
    this.group.position.set(PLATE.at[0], PLATE.at[1], PLATE.at[2]);
    this.group.rotation.x = PLATE.lean;
    this.face = new Mesh(new PlaneGeometry(PLATE.w, PLATE.h), labelMaterial(this.label.texture));
    this.face.name = "Plate Face";
    this.face.position.y = PLATE.h / 2;
    this.next.group.position.set(0, PLATE.h + PLATE.key.above + PLATE.key.h / 2, 0.002);
    this.next.show(false);
    const C = PLATE.coach;
    // Painted faces upload premultiplied (label.ts): drawn through labelMaterial, as the plate's own face is.
    this.coachCard = new Mesh(new PlaneGeometry(C.w, C.h), labelMaterial(this.coachLabel.texture));
    this.coachCard.name = "Coach Line";
    this.coachCard.position.set(0, PLATE.h + C.above + C.h / 2, 0.002);
    this.coachCard.visible = false;
    this.group.add(this.face, this.next.group, this.coachCard);
    this.group.visible = false;
    root.add(this.group);
  }

  /**
   * The coach line above the plate (during play, where the Next key stands after a box), or none. Task 15's coach line
   * takes over the `coach` event when it lands.
   */
  coach(text: string | null): void {
    this.coachCard.visible = text !== null;
    if (text === null || text === this.coachText) return;
    this.coachText = text;
    this.coachLabel.paint((g, w, h) => {
      roundRect(g, 4, 4, w - 8, h - 8, h * 0.14);
      g.fillStyle = "rgba(20, 16, 22, 0.86)";
      g.fill();
      g.fillStyle = "#f6e7c4";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `italic ${Math.round(h * 0.26)}px ${LABEL_FONT}`;
      // Two lines at most, broken between words (a longer line condenses to fit).
      const max = w * 0.9, lines = wrapTwo(text, (s) => g.measureText(s).width, max);
      const step = h * 0.34, top = h / 2 - ((lines.length - 1) * step) / 2;
      lines.forEach((l, i) => g.fillText(l, w / 2, top + i * step, max));
    });
  }

  /** A new box: its name (and "Practice" under it for a practice box), as many latch lights as it has locks, all off, no Next. */
  setBox(box: Box | null, spec: BoxSpec | null, practice = false): void {
    this.group.visible = box !== null;
    if (!box || !spec) return;
    const t = plateText(spec, practice);
    this.name = t.name;
    this.cue = t.cue;
    this.locks = box.locks.length;
    this.lit.fill(false);
    this.offerNext(false);
    this.paint();
  }

  /** Lock `lock`'s latch light. */
  latch(lock: number, on: boolean): void {
    if (lock < 0 || lock >= this.lit.length || this.lit[lock] === on) return;
    this.lit[lock] = on;
    this.paint();
  }

  offerNext(on: boolean): void {
    this.next.show(on);
    this.next.reset();
    this.next.live = on;
    this.armed = false;
  }

  /**
   * Per frame: the Next key (live only when offered). `press(id)` is told when it clicks down and says whether the
   * shared press gate took it. Returns true when an accepted press is let go (the action).
   */
  update(tips: Tips, press: (id: string) => boolean): boolean {
    // Follow the box size: the group cancels the root's scale.
    const s = this.root.scale.x;
    if (s !== this.scale && s > 0) {
      this.scale = s;
      this.group.scale.setScalar(1 / s);
    }
    if (!this.next.live) return false;
    const ev = this.next.feel(tips);
    if (ev === KEY_EVENT.press) this.armed = press(this.next.id);
    else if (ev === KEY_EVENT.click && this.armed) {
      this.armed = false;
      return true;
    }
    return false;
  }

  private paint(): void {
    const n = this.locks, lit = this.lit, name = this.name, cue = this.cue;
    this.label.paint((g, w, h) => {
      brassFace(g, w, h);
      g.fillStyle = "#2a1d0c";
      g.textBaseline = "middle";
      g.textAlign = "left";
      // The name in the room left of the lights: smaller down to the floor, then condensed (never into a light).
      const L = plateLayout(w, h, n);
      let size = Math.round(h * NAME_SIZE);
      g.font = `bold ${size}px ${LABEL_FONT}`;
      while (g.measureText(name).width > L.nameMax && size > h * NAME_FLOOR) {
        size -= 2;
        g.font = `bold ${size}px ${LABEL_FONT}`;
      }
      // With a cue, the name moves up and the cue sits small under it, in italics.
      g.fillText(name, L.nameX, cue ? h * 0.4 : h / 2, L.nameMax);
      if (cue) {
        g.font = `italic ${Math.round(h * 0.22)}px ${LABEL_FONT}`;
        g.fillText(cue, L.nameX, h * 0.78, L.nameMax);
      }
      // The latch lights: a lamp and its numeral each, from the right.
      const r = L.lightR;
      for (let i = 0; i < n; i++) {
        const x = L.lightX[i]!, y = h * 0.38;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = lit[i] ? "#fff3b0" : "#3b2a1c";
        g.fill();
        g.lineWidth = Math.max(2, h * 0.04);
        g.strokeStyle = lit[i] ? "#ffd36a" : "#5e4512";
        g.stroke();
        g.fillStyle = "#2a1d0c";
        g.textAlign = "center";
        g.font = `bold ${Math.round(h * 0.2)}px ${LABEL_FONT}`;
        g.fillText(ROMAN[i]!, x, h * 0.8);
      }
    });
  }
}
