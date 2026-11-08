// The shape library: each shape is a set of convex pieces that tile its outline without overlapping. Ported from
// the Shadow Locks mock (spikes/shadow-locks-mock/shadowgen.js, buildShapes), plus the silhouettes: the first three
// here, the rest in silhouettes.ts.
import { cap, DEG, onCircle, onEllipse, rect, strip } from "./shape-kit";
import { newSilhouettes } from "./silhouettes";
import type { ShapeName, V2 } from "./types";

// The silhouettes are built counter-clockwise, and pieces meet only along shared edges: each one is a corner list on
// its neighbour's edge (a cap, a strip or a triangle on it), so nothing overlaps. The cat's tail, the bird's tail and
// the teapot's spout are the finger-sized strips: long, near horizontal and at least 8% of the area.

/** A sitting cat seen from behind: body, head, two ears, and a tail along the ground that curls up. */
function cat(): V2[][] {
  // The body is an egg, 0.46 wide: a flat half-ellipse below the middle and a tall one above. The head sits on its
  // edge 56 -> 124, the tail on 335 -> 366.
  const body = (deg: number): V2 => {
    const s = Math.sin(deg * DEG);
    return [0.23 * Math.cos(deg * DEG), (s < 0 ? 0.09 : 0.48) * s];
  };
  const bodyPiece = [124, 142, 160, 180, 200, 225, 250, 270, 290, 315, 335, 366, 25, 56].map(body);
  const r = 0.165;
  const head = cap(body(56), body(124), r, [-15, 8, 30, 85, 95, 150, 172, 195]);
  const hc = head.c;
  const earR: V2[] = [onCircle(hc, r, 30), onCircle(hc, r + 0.17, 64), onCircle(hc, r, 85)];
  const earL: V2[] = [onCircle(hc, r, 95), onCircle(hc, r + 0.17, 116), onCircle(hc, r, 150)];
  const tb: V2 = [0.6, -0.09], tt: V2 = [0.6, 0];
  const tail: V2[] = [body(335), tb, tt, body(366)];
  const tip: V2[] = [tb, [0.66, -0.075], [0.7, -0.025], [0.715, 0.065], [0.69, 0.145], [0.645, 0.165], tt];
  return [bodyPiece, head.poly, earR, earL, tail, tip];
}

/** A bird in flight, facing right: body, one wing raised, head, beak and a tail streaming out behind. */
function bird(): V2[][] {
  // The body is an ellipse tipped up 10 degrees. The head sits on its edge 25 -> 65, the wing on 80 -> 140, the tail
  // on 170 -> 195.
  const E = (deg: number) => onEllipse(0.22, 0.13, 10, deg);
  const body = [80, 140, 170, 195, 220, 250, 280, 310, 340, 385, 425].map(E);
  const r = 0.09;
  const head = cap(E(25), E(65), r, [-45, -8, 18, 45, 80, 115, 150, 185]);
  const beak: V2[] = [onCircle(head.c, r, -8), onCircle(head.c, r + 0.085, 4), onCircle(head.c, r, 18)];
  const wing: V2[] = [E(140), E(80), [0, 0.25], [-0.08, 0.4], [-0.22, 0.5], [-0.34, 0.53]];
  const tail = strip(E(170), E(195), 189, 0.3, 0.05);
  return [body, wing, head.poly, beak, tail];
}

/** A teapot in profile: body, lid, knob, a spout rising to the right and a loop handle on the left. */
function teapot(): V2[][] {
  // The body is an ellipse cut flat at y = 0.18 (the lid sits there) and y = -0.22. The spout grows from its edge
  // -32 -> 8; the handle's arms meet it on 150 -> 164.4 and 195.6 -> 210 and end on the grip's inner side.
  const B = (deg: number) => onEllipse(0.27, 0.26, 0, deg);
  const tTop = Math.asin(0.18 / 0.26) / DEG, tBot = Math.asin(0.22 / 0.26) / DEG;
  const body = [-tBot, -32, 8, 26, tTop, 180 - tTop, 150, 164.4, 195.6, 210, 180 + tBot].map(B);
  const lidAt = (deg: number): V2 => [0.15 * Math.cos(deg * DEG), 0.18 + 0.08 * Math.sin(deg * DEG)];
  const lid = [0, 30, 70, 110, 150, 180].map(lidAt);
  const knob = cap(lidAt(70), lidAt(110), 0.06, [0, 45, 90, 135, 180]).poly;
  const spout = strip(B(-32), B(8), 34, 0.38, 0.028);
  const hx = -0.41, a = B(150), b = B(164.4), c = B(195.6), d = B(210);
  const armTop: V2[] = [[hx, b[1]], b, a, [hx, a[1]]];
  const armBottom: V2[] = [[hx, d[1]], d, c, [hx, c[1]]];
  const grip: V2[] = [
    [hx - 0.03, d[1]],
    [hx, d[1]],
    [hx, a[1]],
    [hx - 0.03, a[1]],
    [hx - 0.06, a[1] - 0.03],
    [hx - 0.06, d[1] + 0.03],
  ];
  return [body, lid, knob, spout, armTop, grip, armBottom];
}

function buildShapes(): { shapes: Record<ShapeName, V2[][]>; moonOutline: V2[]; added: ShapeName[] } {
  const oct = (cx: number, cy: number, r: number): V2[] =>
    Array.from({ length: 8 }, (_, i) => [
      cx + r * Math.cos(Math.PI / 8 + (i * Math.PI) / 4),
      cy + r * Math.sin(Math.PI / 8 + (i * Math.PI) / 4),
    ]);
  const head = oct(-0.24, 0, 0.21);
  // The shaft starts at the head's right edge (the mock started it 0.014 inside the head).
  const Key = [
    head.slice(0, 5),
    head.slice(4).concat([head[0]!]),
    rect(head[0]![0], -0.055, 0.2, 0.055),
    rect(0.2, -0.055, 0.48, 0.055),
    rect(0.26, -0.21, 0.34, -0.055),
    rect(0.4, -0.16, 0.48, -0.055),
  ];

  const outer: V2[] = [], inner: V2[] = [];
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 5;
    outer.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
    const b = a + Math.PI / 5;
    inner.push([0.19 * Math.cos(b), 0.19 * Math.sin(b)]);
  }
  const Star = [inner.slice()].concat(outer.map((p, i) => [inner[(i + 4) % 5]!, p, inner[i]!]));

  // Six pieces between an outer and an inner circle. Each piece's outer edge follows its arc in three steps (the
  // mock used one chord); the inner edge stays one chord so the piece stays convex. The two horn pieces end in a
  // point, so they have no inner corner there.
  const Ro = 0.46, Ri = 0.38, dx = 0.2, xi = (Ro * Ro - Ri * Ri + dx * dx) / (2 * dx), yi = Math.sqrt(Ro * Ro - xi * xi);
  const ao = Math.atan2(yi, xi), ai = Math.atan2(yi, xi - dx);
  const outerAt = (t: number): V2 => {
    const a = ao + (2 * Math.PI - 2 * ao) * t;
    return [Ro * Math.cos(a), Ro * Math.sin(a)];
  };
  const innerAt = (t: number): V2 => {
    const a = ai + (2 * Math.PI - 2 * ai) * t;
    return [dx + Ri * Math.cos(a), Ri * Math.sin(a)];
  };
  const Moon: V2[][] = [], moonOutline: V2[] = [];
  for (let k = 0; k < 6; k++) {
    const piece = [0, 1, 2, 3].map((j) => outerAt((k + j / 3) / 6));
    if (k < 5) piece.push(innerAt((k + 1) / 6));
    if (k > 0) piece.push(innerAt(k / 6));
    Moon.push(piece);
    moonOutline.push(...piece.slice(0, 3));
  }
  // The outline is the pieces' own boundary: the outer arc's 19 points, then the 5 inner corners back up.
  moonOutline.push(outerAt(1));
  for (let k = 5; k >= 1; k--) moonOutline.push(innerAt(k / 6));

  const D: V2[] = [[0, 0.5], [0.32, 0], [0, -0.5], [-0.32, 0]];
  const Diamond = D.map((p, i): V2[] => [[0, 0], p, D[(i + 1) % 4]!]);
  // The prongs meet at x = +-0.16 (the mock's middle prong overlapped its neighbours between 0.15 and 0.17).
  const Crown: V2[][] = [
    rect(-0.45, -0.36, 0, -0.12),
    rect(0, -0.36, 0.45, -0.12),
    [[-0.45, -0.12], [-0.16, -0.12], [-0.4, 0.38]],
    [[-0.16, -0.12], [0.16, -0.12], [0, 0.44]],
    [[0.16, -0.12], [0.45, -0.12], [0.4, 0.38]],
  ];
  // The shaft ends where the head starts, at x = 0.04 (the mock ran it on to 0.08, under the head).
  const Arrow: V2[][] = [
    rect(-0.5, -0.08, -0.15, 0.08),
    rect(-0.15, -0.08, 0.04, 0.08),
    [[0.04, 0], [0.5, 0], [0.04, 0.3]],
    [[0.04, 0], [0.04, -0.3], [0.5, 0]],
  ];
  const Hourglass: V2[][] = [
    rect(-0.4, 0.4, 0.4, 0.5),
    [[-0.32, 0.4], [0, 0], [0.32, 0.4]],
    [[-0.32, -0.4], [0.32, -0.4], [0, 0]],
    rect(-0.4, -0.5, 0.4, -0.4),
  ];
  const added = newSilhouettes();
  const S: Record<ShapeName, V2[][]> = {
    Key, Star, Moon, Diamond, Crown, Arrow, Hourglass, Cat: cat(), Bird: bird(), Teapot: teapot(),
    ...added,
  };

  // Centre and scale every shape to fit a unit square; the Moon's outline moves with the Moon.
  let outline = moonOutline;
  for (const k of Object.keys(S) as ShapeName[]) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of S[k].flat()) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const s = 1 / Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const fit = ([x, y]: V2): V2 => [(x - cx) * s, (y - cy) * s];
    S[k] = S[k].map((p) => p.map(fit));
    if (k === "Moon") outline = outline.map(fit);
  }
  return { shapes: S, moonOutline: outline, added: Object.keys(added) as ShapeName[] };
}

const built = buildShapes();
/** Every shape's convex pieces, centred on the origin, the larger side of its bounding box 1. */
export const SHAPES: Record<ShapeName, V2[][]> = built.shapes;
/** The silhouettes of generator version 3 and before, in their order: boxes saved then are rebuilt with these. */
export const FIRST_SILHOUETTES: ShapeName[] = ["Cat", "Bird", "Teapot"];
/** Shapes for hidden outlines: things a player names on sight. */
export const SILHOUETTES: ShapeName[] = [...FIRST_SILHOUETTES, ...built.added];
/** The Moon as one simple polygon (lesson 1's single scrap), in the same frame as SHAPES.Moon. */
export const MOON_OUTLINE: V2[] = built.moonOutline;
