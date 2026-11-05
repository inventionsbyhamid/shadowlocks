// The cursor IWSDK draws where a hand's or controller's ray meets a panel or key (rays press
// keys too). Ours is an amber aim ring in the keys' glow colour, so it reads as part of the game
// rather than a stray grey dot; IWSDK still sizes it and fades it up over a key.
import { CanvasTexture, type Mesh, type MeshBasicMaterial, SRGBColorSpace, type World } from "@iwsdk/core";
import { UI } from "./theme";

const RES = 128;

function ringTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = RES;
  c.height = RES;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.clearRect(0, 0, RES, RES);
  const r = RES * 0.36;
  // A dark rim first, so the ring stays clear on light keycaps too.
  g.strokeStyle = "rgba(20, 21, 24, 0.55)";
  g.lineWidth = RES * 0.16;
  g.beginPath();
  g.arc(RES / 2, RES / 2, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = UI.glow;
  g.lineWidth = RES * 0.1;
  g.beginPath();
  g.arc(RES / 2, RES / 2, r, 0, Math.PI * 2);
  g.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.userData.nsRayCursor = true;
  return t;
}

interface PointerSides {
  [side: string]: { cursorVisual?: { cursor?: Mesh } } | undefined;
}

/** Give both rays' cursors our ring (call once the world is made). Returns how many it styled. */
export function styleRayCursors(world: World): number {
  const pointers = (world.input as unknown as { xr?: { multiPointers?: PointerSides } }).xr?.multiPointers;
  if (!pointers) return 0;
  const tex = ringTexture();
  let n = 0;
  for (const side of ["left", "right"]) {
    const cursor = pointers[side]?.cursorVisual?.cursor;
    if (!cursor) continue;
    const m = cursor.material as MeshBasicMaterial;
    m.map = tex;
    m.needsUpdate = true;
    n++;
  }
  if (n === 0) console.warn("ray cursors not found: IWSDK's own cursor stays");
  return n;
}
