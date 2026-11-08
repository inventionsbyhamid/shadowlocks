// Drawing tools for the shape library (shapes.ts, silhouettes.ts): points on circles and ellipses, and pieces built on
// a neighbour's edge. A piece built on the edge a -> b of a counter-clockwise neighbour starts at a, goes round on the
// far side and ends at b, so it is counter-clockwise too and the two meet only along that edge.
import type { V2 } from "./types";

export const DEG = Math.PI / 180;

export const rect = (x0: number, y0: number, x1: number, y1: number): V2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export const onCircle = (c: V2, r: number, deg: number): V2 => [c[0] + r * Math.cos(deg * DEG), c[1] + r * Math.sin(deg * DEG)];

/** The point at `deg` on an ellipse around the origin, turned by `rotDeg`. */
export const onEllipse = (rx: number, ry: number, rotDeg: number, deg: number): V2 => {
  const x = rx * Math.cos(deg * DEG), y = ry * Math.sin(deg * DEG), c = Math.cos(rotDeg * DEG), s = Math.sin(rotDeg * DEG);
  return [x * c - y * s, x * s + y * c];
};

/** The point at `deg` on the upright ellipse around c. */
export const ellAt = (c: V2, rx: number, ry: number, deg: number): V2 => [c[0] + rx * Math.cos(deg * DEG), c[1] + ry * Math.sin(deg * DEG)];

export const lerp = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The point of segment a -> b at height y. */
export const atY = (a: V2, b: V2, y: number): V2 => lerp(a, b, (y - a[1]) / (b[1] - a[1]));

/** The point of segment a -> b at x. */
export const atX = (a: V2, b: V2, x: number): V2 => lerp(a, b, (x - a[0]) / (b[0] - a[0]));

/** A piece mirrored left to right, still counter-clockwise. */
export const mirrorX = (poly: V2[]): V2[] => poly.map(([x, y]): V2 => [-x, y]).reverse();

/**
 * A round cap on the edge p -> q of a counter-clockwise piece: the circle of radius r through p and q, bulging away
 * from that piece. Returns the cap (counter-clockwise, p first, q last) with arc points at `degs` (around the centre,
 * strictly between p's angle and q's, increasing), and the centre.
 */
export function cap(p: V2, q: V2, r: number, degs: number[]): { poly: V2[]; c: V2 } {
  const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy), h = Math.sqrt(r * r - (l * l) / 4);
  const c: V2 = [(p[0] + q[0]) / 2 + (dy / l) * h, (p[1] + q[1]) / 2 - (dx / l) * h];
  const ap = Math.atan2(p[1] - c[1], p[0] - c[0]) / DEG;
  let aq = Math.atan2(q[1] - c[1], q[0] - c[0]) / DEG;
  if (aq <= ap) aq += 360;
  degs.forEach((d, i) => {
    if (d <= ap || d >= aq || (i > 0 && d <= degs[i - 1]!)) {
      throw new Error(`cap: arc angle ${d} is out of order or outside (${ap.toFixed(1)}, ${aq.toFixed(1)})`);
    }
  });
  return { poly: [p, ...degs.map((d) => onCircle(c, r, d)), q], c };
}

/**
 * A strip growing out of the edge a -> b of a counter-clockwise piece: `len` long from the edge's middle in direction
 * `deg`, its far end `halfEnd` either side of its axis. Counter-clockwise, a first, b last.
 */
export function strip(a: V2, b: V2, deg: number, len: number, halfEnd: number): V2[] {
  const d: V2 = [Math.cos(deg * DEG), Math.sin(deg * DEG)], n: V2 = [-d[1], d[0]];
  const e: V2 = [(a[0] + b[0]) / 2 + len * d[0], (a[1] + b[1]) / 2 + len * d[1]];
  return [a, [e[0] - halfEnd * n[0], e[1] - halfEnd * n[1]], [e[0] + halfEnd * n[0], e[1] + halfEnd * n[1]], b];
}

/**
 * A strip with a round end on the edge a -> b of a counter-clockwise piece: the end is a circle of radius r centred
 * `len` from the edge's middle in direction `deg`, and the sides run from a and b to where they touch it, so the piece
 * stays convex. `n` points round the end. Counter-clockwise, a first, b last.
 */
export function lobe(a: V2, b: V2, deg: number, len: number, r: number, n = 6): V2[] {
  const e: V2 = [(a[0] + b[0]) / 2 + len * Math.cos(deg * DEG), (a[1] + b[1]) / 2 + len * Math.sin(deg * DEG)];
  const touch = (p: V2, side: 1 | -1) => {
    const dist = Math.hypot(p[0] - e[0], p[1] - e[1]);
    if (dist <= r) throw new Error("lobe: the end circle reaches the edge");
    return Math.atan2(p[1] - e[1], p[0] - e[0]) + side * Math.acos(r / dist);
  };
  const t0 = touch(a, 1);
  let t1 = touch(b, -1);
  while (t1 <= t0) t1 += 2 * Math.PI;
  const end = Array.from({ length: n }, (_, i): V2 => {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    return [e[0] + r * Math.cos(t), e[1] + r * Math.sin(t)];
  });
  return [a, ...end, b];
}

/**
 * A shallow round bulge on the edge a -> b of a counter-clockwise piece: the arc through a and b that stands `sag` off
 * the edge at its middle, away from that piece, with `n` points between. Counter-clockwise, a first, b last.
 */
export function bulge(a: V2, b: V2, sag: number, n: number): V2[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), half = l / 2;
  const r = (half * half + sag * sag) / (2 * sag);
  // The centre sits on the piece's side of the edge (its left), r - sag from the edge's middle.
  const c: V2 = [(a[0] + b[0]) / 2 - (dy / l) * (r - sag), (a[1] + b[1]) / 2 + (dx / l) * (r - sag)];
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  let a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  // The minor arc on the far side runs counter-clockwise round the centre, from a to b.
  if (a1 <= a0) a1 += 2 * Math.PI;
  const pts: V2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / (n + 1);
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return [a, ...pts, b];
}
