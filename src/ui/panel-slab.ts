// Placeholder panel bodies: one plain rounded slab mesh per menu panel, so a panel has a visible
// body behind its UIKit layout (the look pass restyles it). Each frame the slab copies its root
// element's place, size and fade, so springs and layout changes carry over. The slab's face sits
// just behind the UIKit plane, so panel parts never share its depth. Its geometry is rebuilt only
// when the panel's laid out size changes; per frame nothing is allocated.
import {
  BufferAttribute,
  Color,
  ExtrudeGeometry,
  Mesh,
  MeshBasicMaterial,
  Shape,
  Vector3,
  type World,
} from "@iwsdk/core";
import type { UiEl } from "./panel-ui";

/** Sizes in mm (one UIKit unit). */
export const SLAB = {
  thickness: 9,
  corner: 14,
  bevel: 2.5,
  /** The face sits this far behind the UIKit plane. */
  sink: 0.6,
} as const;

/** The slabs' draw order: after the theatre's veil (-100) and the hand mask (-10), before the box (0). */
export const SLAB_ORDER = -1;

/** Sides and bevels read darker than the face (a cheap stand-in for lighting). */
const SIDE_SHADE = 0.62;

function noRaycast(): void {}

function roundedRect(w: number, h: number, r: number): Shape {
  const x = -w / 2;
  const y = -h / 2;
  const k = Math.min(r, w / 2, h / 2);
  const s = new Shape();
  s.moveTo(x + k, y);
  s.lineTo(x + w - k, y);
  s.quadraticCurveTo(x + w, y, x + w, y + k);
  s.lineTo(x + w, y + h - k);
  s.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  s.lineTo(x + k, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - k);
  s.lineTo(x, y + k);
  s.quadraticCurveTo(x, y, x + k, y);
  return s;
}

/** A slab of `w` x `h` mm: its face at z = -sink, its back `thickness` behind it, shaded by facing. */
export function slabGeometry(w: number, h: number): ExtrudeGeometry {
  const b = SLAB.bevel;
  const g = new ExtrudeGeometry(roundedRect(Math.max(1, w - 2 * b), Math.max(1, h - 2 * b), Math.max(0, SLAB.corner - b)), {
    depth: SLAB.thickness - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
    curveSegments: 6,
  });
  // Extruded from z = -bevel to depth + bevel; turn it to face +z with the face just behind the plane.
  g.translate(0, 0, -(SLAB.thickness - b) - SLAB.sink);
  const n = g.getAttribute("normal");
  const colors = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const shade = SIDE_SHADE + (1 - SIDE_SHADE) * Math.max(0, n.getZ(i));
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  return g;
}

interface Slab {
  mesh: Mesh;
  material: MeshBasicMaterial;
  w: number;
  h: number;
}

const ax = new Vector3();
const ay = new Vector3();
const az = new Vector3();

export class PanelSlabs {
  private readonly slabs = new Map<UiEl, Slab>();
  private readonly color: Color;

  constructor(
    private readonly world: World,
    hex: string,
  ) {
    this.color = new Color(hex);
  }

  /** The slab under `root` this frame, at the panel's `fade` (0 hides it). Allocation free unless the size changed. */
  draw(root: UiEl, fade: number): void {
    let s = this.slabs.get(root);
    if (!s) {
      s = this.make();
      this.slabs.set(root, s);
    }
    const mesh = s.mesh;
    const size = root.size?.peek();
    if (fade <= 0.001 || !size || size[0] <= 0 || size[1] <= 0) {
      mesh.visible = false;
      return;
    }
    if (Math.abs(size[0] - s.w) > 0.01 || Math.abs(size[1] - s.h) > 0.01) {
      mesh.geometry.dispose();
      mesh.geometry = slabGeometry(size[0], size[1]);
      s.w = size[0];
      s.h = size[1];
    }
    // UIKit keeps world matrices current only for elements it draws or hit-tests: compute it.
    root.updateWorldMatrix(true, false);
    const e = root.matrixWorld.elements;
    ax.set(e[0] as number, e[1] as number, e[2] as number);
    const width = ax.length();
    az.set(e[8] as number, e[9] as number, e[10] as number);
    if (width < 1e-9 || az.lengthSq() < 1e-18) {
      mesh.visible = false;
      return;
    }
    // Metres per mm. Built from the columns (not decompose): UIKit's matrices can carry a flip.
    const k = width / size[0];
    ax.multiplyScalar(1 / width);
    az.normalize();
    ay.crossVectors(az, ax);
    mesh.matrixWorld.set(
      ax.x * k, ay.x * k, az.x * k, e[12] as number,
      ax.y * k, ay.y * k, az.y * k, e[13] as number,
      ax.z * k, ay.z * k, az.z * k, e[14] as number,
      0, 0, 0, 1,
    );
    s.material.opacity = Math.min(1, fade);
    mesh.visible = true;
  }

  /** Slabs shown last frame (tests). */
  get shown(): number {
    let n = 0;
    for (const s of this.slabs.values()) if (s.mesh.visible) n++;
    return n;
  }

  private make(): Slab {
    // Its own material, so two panels can fade at once. Hashed alpha keeps it opaque (no sorting
    // against UIKit) while the panel fades.
    const material = new MeshBasicMaterial({ color: this.color, vertexColors: true, alphaHash: true });
    material.name = "panel-slab";
    const mesh = new Mesh(slabGeometry(100, 100), material);
    mesh.name = "Panel Slab";
    // Drawn ahead of the box's opaque parts (order 0; three sorts opaque draws by material before distance): the panel
    // stands in front of the box, so the lacquer behind it fails the depth test instead of being shaded and covered.
    // The picture is the same either way.
    mesh.renderOrder = SLAB_ORDER;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.visible = false;
    // Never a pointer target: no raycast, no spherecast (IWSDK's touch sphere), no pointer events.
    mesh.raycast = noRaycast;
    (mesh as unknown as { spherecast: () => void }).spherecast = noRaycast;
    (mesh as unknown as { pointerEvents: string }).pointerEvents = "none";
    this.world.scene.add(mesh);
    return { mesh, material, w: 100, h: 100 };
  }
}
