// A key on the box itself (the plate's Next, the hint lantern and its choices): a flat brass face with its label
// painted on, pressed by a fingertip (or a controller's tip) the way every key in the game is (FingerKey: the face
// follows the finger, `press` at 80% of its travel, the action as the finger comes back out). Sizes are in metres
// (the key lives in a group that cancels the box's scale), so a key is at least 40 mm whatever the box size. One
// draw call; per frame it allocates nothing and repaints nothing.
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "@iwsdk/core";
import type { Lang } from "../i18n";
import { FingerKey, KEY_EVENT, nearestFinger } from "../render/finger-key";
import { brassFace, fitLabel, LabelCanvas, type LabelFit, labelMaterial } from "../render/label";
import type { Tips } from "./key-view";

/** How far the face travels under the finger (m). */
export const KEY_TRAVEL_M = 0.006;
/** Canvas pixels per metre of key. */
const PX_PER_M = 5000;
/**
 * A label's lettering: this share of the key's height (about 18 mm on a 44 mm key), never below the floor (about
 * 15 mm, over a degree at 55 cm); a label too long for the key's width at the floor is condensed, not shrunk.
 */
export const LABEL_SIZE = 0.42;
export const LABEL_FLOOR = 0.34;
/** The share of the key's width the label may use. */
const LABEL_ROOM = 0.86;

type Measure = Parameters<typeof fitLabel>[0];

/** How `text` sits on a key `width` x `height` m (canvas px) in language `l`: the fit its label is painted with. */
export function keyLabelFit(g: Measure, text: string, width: number, height: number, l?: Lang): LabelFit {
  const w = Math.round(width * PX_PER_M), h = Math.round(height * PX_PER_M);
  return fitLabel(g, text, "bold", h * LABEL_SIZE, h * LABEL_FLOOR, w * LABEL_ROOM, l);
}

const tipDist = new Float64Array(2);
const tipOver = new Uint8Array(2);
const rel = new Vector3();
const ax = new Vector3();
const ay = new Vector3();
const an = new Vector3();

export class PokeKey {
  /** The key at rest: its face is this group's z = 0 plane, facing +z. */
  readonly group = new Group();
  readonly face: Mesh;
  readonly finger = new FingerKey(KEY_TRAVEL_M);
  /** Only a live key feels fingers (a hidden or idle one lets go). */
  live = false;
  private readonly label: LabelCanvas;
  private text = "";
  private lit = false;
  /** An icon face instead of a label (the hint lantern), kept to repaint. */
  private icon: Parameters<LabelCanvas["paint"]>[0] | null = null;

  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
    text: string,
  ) {
    this.group.name = id;
    this.label = new LabelCanvas(Math.round(width * PX_PER_M), Math.round(height * PX_PER_M));
    this.face = new Mesh(new PlaneGeometry(width, height), labelMaterial(this.label.texture));
    this.face.name = `${id} face`;
    this.group.add(this.face);
    this.setText(text);
  }

  /** The label now on the key. */
  get labelText(): string {
    return this.text;
  }

  /** The label (repainted only when it changes). */
  setText(text: string, lit = this.lit): void {
    if (text === this.text && lit === this.lit && !this.icon) return;
    this.text = text;
    this.lit = lit;
    this.icon = null;
    this.paintLabel();
  }

  /** Paint the label again as it is (its font arrived, or the language changed and the words did not). */
  refresh(): void {
    if (this.icon) this.label.paint(this.icon);
    else this.paintLabel();
  }

  private paintLabel(): void {
    const text = this.text, lit = this.lit;
    this.label.paint((g, w, h) => {
      brassFace(g, w, h, lit);
      g.fillStyle = "#2a1d0c";
      g.textAlign = "center";
      g.textBaseline = "middle";
      // Full size where it fits; smaller only down to the floor, then condensed: the letters never get too small to read.
      const f = keyLabelFit(g, text, this.width, this.height);
      g.fillText(text, w / 2, h / 2 + f.size * 0.04, f.room);
    });
  }

  /** A face painted some other way than a label (an icon). */
  paintWith(draw: Parameters<LabelCanvas["paint"]>[0]): void {
    this.text = "";
    this.icon = draw;
    this.label.paint(draw);
  }

  /** Show or hide it; a hidden key is not live. */
  show(on: boolean): void {
    this.group.visible = on;
    if (!on) this.live = false;
  }

  /**
   * Per frame: the nearest fingertip over the face (world `tips`) moves it and may press it. Returns a KEY_EVENT
   * (press: the click; click: the action). Not live: lets go and returns none.
   */
  feel(tips: Tips): number {
    const k = this.finger;
    if (!this.live || !this.group.visible || tips.count === 0) {
      k.dist = Number.NaN;
      k.inside = false;
    } else {
      this.group.updateWorldMatrix(true, false);
      const e = this.group.matrixWorld.elements;
      ax.set(e[0]!, e[1]!, e[2]!).normalize();
      ay.set(e[4]!, e[5]!, e[6]!).normalize();
      an.set(e[8]!, e[9]!, e[10]!).normalize();
      const hw = this.width / 2, hh = this.height / 2;
      for (let i = 0; i < tips.count; i++) {
        const p = tips.points[i]!;
        rel.set(p.x - e[12]!, p.y - e[13]!, p.z - e[14]!);
        const x = rel.dot(ax), y = rel.dot(ay);
        tipDist[i] = rel.dot(an);
        tipOver[i] = x >= -hw && x <= hw && y >= -hh && y <= hh ? 1 : 0;
      }
      k.dist = nearestFinger(tips.count, tipDist, tipOver, k.travel);
      k.inside = k.dist === k.dist;
    }
    const ev = k.step();
    this.face.position.z = -k.depth;
    return ev;
  }

  /** Forget any finger (the key went away). */
  reset(): void {
    this.finger.reset();
    this.face.position.z = 0;
  }

  /** Its face's centre and facing direction in the world, and its size (m), for the test hooks. */
  pose(): { world: [number, number, number]; normal: [number, number, number]; size: [number, number] } {
    this.group.updateWorldMatrix(true, false);
    const e = this.group.matrixWorld.elements;
    const n = new Vector3(e[8]!, e[9]!, e[10]!).normalize();
    return { world: [e[12]!, e[13]!, e[14]!], normal: [n.x, n.y, n.z], size: [this.width, this.height] };
  }
}

export { KEY_EVENT };
