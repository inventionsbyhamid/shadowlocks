// The ring line's beam: while the held lantern rides a lock's ring line, a thin, faint additive beam runs from the
// lock's etched mark on the panel, through its two sight rings, toward the lantern, so the player sees the line they
// slide along. Brightest at the mark, fading toward the lantern, and stopping short of its body. Lives in the box
// root (box units). One draw call while shown, none while hidden; no allocation per frame.
import {
  AdditiveBlending,
  BufferAttribute,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "@iwsdk/core";
import type { V3 } from "../core/types";
import { COLORS } from "./theme";

export const BEAM = {
  /** Radius in box units (1.1 mm at the default 24 cm box). */
  radius: 0.0045,
  /** Faint: warm gold, added at this strength (on the ivory panel it barely shows; over the dark box it glows). */
  opacity: 0.32,
  /** Brightness at the lantern end, against 1 at the mark. */
  fadeTo: 0.2,
  /** The beam stops this far before the lantern's light (its body, box units). */
  gap: 0.065,
} as const;

const UP = new Vector3(0, 1, 0);

export class RingBeam {
  readonly mesh: Mesh;
  private readonly dir = new Vector3();

  constructor() {
    // A thin open tube along +y from 0 to 1, stretched to length each frame.
    const g = new CylinderGeometry(BEAM.radius, BEAM.radius, 1, 6, 1, true).translate(0, 0.5, 0);
    const pos = g.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = 1 - (1 - BEAM.fadeTo) * pos.getY(i);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    }
    g.setAttribute("color", new BufferAttribute(col, 3));
    this.mesh = new Mesh(
      g,
      new MeshBasicMaterial({
        color: COLORS.gold,
        vertexColors: true,
        transparent: true,
        opacity: BEAM.opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.name = "Ring Beam";
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /**
   * Show the beam on the line through `mark` along `dir` (box units), from the mark to just short of where the
   * lantern at `lantern` sits along the line. Hidden when the lantern is not out along the line.
   */
  show(mark: Readonly<V3>, dir: Readonly<V3>, lantern: Readonly<V3>): void {
    const n = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (!(n > 0)) {
      this.hide();
      return;
    }
    const d = this.dir.set(dir[0] / n, dir[1] / n, dir[2] / n);
    const t = (lantern[0] - mark[0]) * d.x + (lantern[1] - mark[1]) * d.y + (lantern[2] - mark[2]) * d.z - BEAM.gap;
    if (!(t > 0)) {
      this.hide();
      return;
    }
    const m = this.mesh;
    m.position.set(mark[0], mark[1], mark[2]);
    m.quaternion.setFromUnitVectors(UP, d);
    m.scale.set(1, t, 1);
    m.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  get shown(): boolean {
    return this.mesh.visible;
  }
}
