// Shadow geometry in box units: the back panel is the plane z = 0, the lantern is in front of it (z > 1).
// Ported from the Shadow Locks mock (spikes/shadow-locks-mock/shadowgen.js) with the same behaviour.
import type { V2, V3 } from "./types";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** mulberry32: a seeded generator of numbers in [0, 1). Same seed, same sequence, everywhere. */
export function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string, as an unsigned seed. */
export function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Where point P's shadow lands on the panel when the lantern is at L: L + (P - L) * Lz / (Lz - Pz). */
export function proj(P: V3, L: V3): V2 {
  const k = L[2] / (L[2] - P[2]);
  return [L[0] + (P[0] - L[0]) * k, L[1] + (P[1] - L[1]) * k];
}

/** Even-odd test: is pt inside the polygon? */
export function inPoly(pt: V2, poly: V2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!, pj = poly[j]!;
    const xi = pi[0], yi = pi[1], xj = pj[0], yj = pj[1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Distance from p to the segment ab. */
export function segDist(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Distance from pt to the polygon: 0 inside, else to the nearest edge. */
export function polyDist(pt: V2, poly: V2[]): number {
  if (inPoly(pt, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(pt, poly[i]!, poly[(i + 1) % poly.length]!));
  return d;
}

/** Unsigned area (shoelace). */
export function area(poly: V2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** [minX, minY, maxX, maxY]. */
export function bbox(pts: V2[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** The average of the vertices (not the area centroid), as in the mock. */
export function centroid(poly: V2[]): V2 {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

/** n points on a circle of radius r around c, in the plane with normal nrm. */
export function circlePts(c: V3, nrm: V3, r: number, n: number): V3[] {
  const helper: V3 = Math.abs(nrm[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(nrm, helper)), e2 = cross(nrm, e1), out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
    out.push([c[0] + e1[0] * ca + e2[0] * sa, c[1] + e1[1] * ca + e2[1] * sa, c[2] + e1[2] * ca + e2[2] * sa]);
  }
  return out;
}

/**
 * How long, and which way, a piece runs (from its vertices' spread): `ratio` is long side over short side,
 * `angle` the long axis in radians from horizontal, in [-pi/2, pi/2]. Picks a finger-shaped missing piece
 * and aims the fingertip.
 */
export function elongation(poly: V2[]): { ratio: number; angle: number } {
  const c = centroid(poly);
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of poly) {
    const dx = x - c[0], dy = y - c[1];
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det)), l2 = Math.max(1e-9, tr - l1);
  return { ratio: Math.sqrt(l1 / l2), angle: 0.5 * Math.atan2(2 * sxy, sxx - syy) };
}
