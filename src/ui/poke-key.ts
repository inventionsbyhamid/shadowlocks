// A key on the box itself (the plate's Next, the hint lantern and its choices): a flat brass face with its label
// painted on, pressed by a fingertip (or a controller's tip) the way every key in the game is (FingerKey: the face
// follows the finger, `press` at 80% of its travel, the action as the finger comes back out). Sizes are in metres
// (the key lives in a group that cancels the box's scale), so a key is at least 40 mm whatever the box size. One
// draw call; per frame it allocates nothing and repaints nothing.
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "@iwsdk/core";
import { FingerKey, KEY_EVENT, nearestFinger } from "../render/finger-key";
import { brassFace, LABEL_FONT, LabelCanvas } from "../render/label";
import type { Tips } from "./key-view";

/** How far the face travels under the finger (m). */
export const KEY_TRAVEL_M = 0.006;
/** Canvas pixels per metre of key. */
const PX_PER_M = 5000;

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

  constructor(
    readonly id: string,
    readonly width: number,
    readonly height: number,
    text: string,
  ) {
    this.group.name = id;
    this.label = new LabelCanvas(Math.round(width * PX_PER_M), Math.round(height * PX_PER_M));
    this.face = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: this.label.texture, transparent: true, toneMapped: false }));
    this.face.name = `${id} face`;
    this.group.add(this.face);
    this.setText(text);
  }

  /** The label (repainted only when it changes). */
  setText(text: string, lit = this.lit): void {
    if (text === this.text && lit === this.lit) return;
    this.text = text;
    this.lit = lit;
    this.label.paint((g, w, h) => {
      brassFace(g, w, h, lit);
      g.fillStyle = "#2a1d0c";
      g.textAlign = "center";
      g.textBaseline = "middle";
      let size = Math.round(h * 0.42);
      g.font = `bold ${size}px ${LABEL_FONT}`;
      while (g.measureText(text).width > w * 0.86 && size > 10) {
        size -= 2;
        g.font = `bold ${size}px ${LABEL_FONT}`;
      }
      g.fillText(text, w / 2, h / 2 + size * 0.04);
    });
  }

  /** A face painted some other way than a label (an icon). */
  paintWith(draw: Parameters<LabelCanvas["paint"]>[0]): void {
    this.text = "";
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
