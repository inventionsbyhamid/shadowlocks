// Merges built geometries into one (positions and normals, no index), so a set of parts that share a
// material draws in one call. Used when a box scene is built, never per frame.
import { BufferAttribute, BufferGeometry } from "@iwsdk/core";

export function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    if (!f.getAttribute("normal")) f.computeVertexNormals();
    return f;
  });
  const count = flat.reduce((n, g) => n + g.getAttribute("position").count, 0);
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  let at = 0;
  for (const g of flat) {
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++, at++) {
      pos[at * 3] = p.getX(i);
      pos[at * 3 + 1] = p.getY(i);
      pos[at * 3 + 2] = p.getZ(i);
      nrm[at * 3] = n.getX(i);
      nrm[at * 3 + 1] = n.getY(i);
      nrm[at * 3 + 2] = n.getZ(i);
    }
  }
  for (const g of parts) g.dispose();
  for (const g of flat) g.dispose();
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(pos, 3));
  out.setAttribute("normal", new BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}
