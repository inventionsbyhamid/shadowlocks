// A lock's outline as the panel etches it: the boundary of its pieces' union. Pure, so the browser
// tests can find where the outline runs too.
import type { V2 } from "../core/types";

const key = (p: V2) => `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;

/**
 * The outline of a lock's pieces: their edges, split where another piece's corner lies on them
 * (T-junctions), less every stretch two pieces share. Etching these, and not every piece's edges,
 * keeps the seams between pieces off the panel.
 */
export function outlineEdges(polys: V2[][]): [V2, V2][] {
  const corners = polys.flat();
  const segs: [V2, V2][] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      if (l2 < 1e-18) continue;
      const cuts: { t: number; p: V2 }[] = [{ t: 0, p: a }, { t: 1, p: b }];
      for (const p of corners) {
        const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        const ex = a[0] + t * dx - p[0], ey = a[1] + t * dy - p[1];
        if (ex * ex + ey * ey < 1e-16) cuts.push({ t, p });
      }
      cuts.sort((u, v) => u.t - v.t);
      for (let k = 0; k + 1 < cuts.length; k++) {
        if (key(cuts[k]!.p) !== key(cuts[k + 1]!.p)) segs.push([cuts[k]!.p, cuts[k + 1]!.p]);
      }
    }
  }
  const id = ([a, b]: [V2, V2]) => {
    const ka = key(a), kb = key(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const count = new Map<string, number>();
  for (const s of segs) count.set(id(s), (count.get(id(s)) ?? 0) + 1);
  return segs.filter((s) => count.get(id(s)) === 1);
}
