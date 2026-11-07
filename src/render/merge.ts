// Merges built geometries into one (positions and normals, no index), so a set of parts that share a
// material draws in one call. Used when a box scene is built, never per frame.
import { BufferAttribute, BufferGeometry, type Color } from "@iwsdk/core";

/**
 * `parts` as one geometry, each part with its own vertex colour (linear, the working space vertex colours are read in):
 * parts that differ only in material can then draw in one call, their material telling them apart by colour.
 */
export function mergeColored(parts: readonly (readonly [BufferGeometry, Color])[]): BufferGeometry {
  const counts = parts.map(([g]) => (g.index ? g.index.count : g.getAttribute("position").count));
  const out = mergeParts(parts.map(([g]) => g));
  const col = new Float32Array(out.getAttribute("position").count * 3);
  let at = 0;
  parts.forEach(([, c], k) => {
    for (let i = 0; i < counts[k]!; i++, at++) {
      col[at * 3] = c.r;
      col[at * 3 + 1] = c.g;
      col[at * 3 + 2] = c.b;
    }
  });
  out.setAttribute("color", new BufferAttribute(col, 3));
  return out;
}

/** `parts` as one geometry: positions and normals, and the `keep` attributes (3 floats a vertex) every part has. */
export function mergeParts(parts: BufferGeometry[], keep: readonly string[] = []): BufferGeometry {
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    if (!f.getAttribute("normal")) f.computeVertexNormals();
    return f;
  });
  const count = flat.reduce((n, g) => n + g.getAttribute("position").count, 0);
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  const extra = keep.map(() => new Float32Array(count * 3));
  let at = 0;
  for (const g of flat) {
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    const kept = keep.map((name) => {
      const a = g.getAttribute(name);
      if (!a) throw new Error(`mergeParts: a part has no "${name}"`);
      return a;
    });
    for (let i = 0; i < p.count; i++, at++) {
      pos[at * 3] = p.getX(i);
      pos[at * 3 + 1] = p.getY(i);
      pos[at * 3 + 2] = p.getZ(i);
      nrm[at * 3] = n.getX(i);
      nrm[at * 3 + 1] = n.getY(i);
      nrm[at * 3 + 2] = n.getZ(i);
      for (let k = 0; k < kept.length; k++) {
        const a = kept[k]!, e = extra[k]!;
        e[at * 3] = a.getX(i);
        e[at * 3 + 1] = a.getY(i);
        e[at * 3 + 2] = a.getZ(i);
      }
    }
  }
  for (const g of parts) g.dispose();
  for (const g of flat) g.dispose();
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(pos, 3));
  out.setAttribute("normal", new BufferAttribute(nrm, 3));
  keep.forEach((name, k) => out.setAttribute(name, new BufferAttribute(extra[k]!, 3)));
  out.computeBoundingSphere();
  return out;
}
