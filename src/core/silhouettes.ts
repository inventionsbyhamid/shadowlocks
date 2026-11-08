// The silhouettes added in generator version 4: animals, everyday objects and things from a workshop at night, each a
// recognisable side or front view whose outline a player names from its shadow alone. Built like the first three
// (shapes.ts): convex pieces, counter-clockwise, each on its neighbour's edge (or with its corners on one, a
// T-junction), so they meet only along shared edges. Every one has a finger-sized strip on its outline, near
// horizontal and at least 8% of its area: a tail, a stock, a rim, a ledge, a branch, a neck. The library centres and
// scales them (shapes.ts), so coordinates here only need the right proportions.
import { atX, atY, bulge, cap, DEG, ellAt, lerp, lobe, mirrorX, onCircle, rect, strip } from "./shape-kit";
import type { AddedSilhouette, V2 } from "./types";

/** A piece of a ring between radii ri and ro, from a0 to a1 degrees (taken round 360, so neighbours share corners). */
const sector = (c: V2, ro: number, ri: number, a0: number, a1: number): V2[] => [
  onCircle(c, ro, a0 % 360),
  onCircle(c, ro, a1 % 360),
  onCircle(c, ri, a1 % 360),
  onCircle(c, ri, a0 % 360),
];
/** An anchor: a ring on top, the stock across the shank (the finger strip), arms curving up to two flukes. */
function anchor(): V2[][] {
  const rc: V2 = [0, 0.4], ro = 0.1, ri = 0.055;
  // Five ring pieces from 300 to 600 degrees; the sixth, at the bottom, is the top of the shank.
  const ring = [300, 360, 420, 480, 540].map((d) => sector(rc, ro, ri, d, d + 60));
  const o240 = onCircle(rc, ro, 240), o300 = onCircle(rc, ro, 300), i240 = onCircle(rc, ri, 240), i300 = onCircle(rc, ri, 300);
  const yStockTop = 0.22, yStockBot = 0.15, hw = 0.05;
  const shankTop: V2[] = [[-hw, yStockTop], [hw, yStockTop], o300, i300, i240, o240];
  const stock = rect(-0.28, yStockBot, 0.28, yStockTop);
  // The arms: a band between radii 0.3 and 0.37 round (0, -0.02), from 200 to 340 degrees. The shank stands on the
  // bottom piece's inner edge. The right side is the left one mirrored.
  const ac: V2 = [0, -0.02], Ri = 0.3, Ro = 0.37;
  const armL = [sector(ac, Ro, Ri, 200, 225), sector(ac, Ro, Ri, 225, 250)];
  const o250 = onCircle(ac, Ro, 250), i250 = onCircle(ac, Ri, 250);
  const bottom: V2[] = [o250, [-o250[0], o250[1]], [-i250[0], i250[1]], i250];
  const shankLow: V2[] = [[-hw, i250[1]], [hw, i250[1]], [hw, yStockBot], [-hw, yStockBot]];
  // A fluke: an arrowhead across the arm's end, pointing on round the arc (up and out).
  const r0 = 0.26, r1 = 0.41, t: V2 = [Math.sin(200 * DEG), -Math.cos(200 * DEG)];
  const b1 = onCircle(ac, r0, 200), b2 = onCircle(ac, r1, 200), mid = lerp(b1, b2, 0.5);
  const flukeL: V2[] = [b2, b1, [mid[0] + 0.15 * t[0], mid[1] + 0.15 * t[1]]];
  return [...ring, shankTop, stock, shankLow, ...armL, bottom, ...armL.map(mirrorX), flukeL, mirrorX(flukeL)];
}

/** A sailboat: the hull, its keel band along the bottom (the finger strip), and two sails with light between them. */
function sailboat(): V2[][] {
  const bl: V2 = [-0.3, -0.44], br: V2 = [0.28, -0.44], tr: V2 = [0.48, -0.22], tl: V2 = [-0.42, -0.22];
  const ml = atY(bl, tl, -0.36), mr = atY(br, tr, -0.36);
  const band: V2[] = [bl, br, mr, ml];
  const hull: V2[] = [ml, mr, tr, tl];
  const mainTop: V2 = [-0.04, 0.5], mainFoot: V2 = [-0.38, -0.22], cut = atY(mainFoot, mainTop, 0.12);
  const mainLow: V2[] = [mainFoot, [-0.04, -0.22], [-0.04, 0.12], cut];
  const mainHigh: V2[] = [cut, [-0.04, 0.12], mainTop];
  const jib: V2[] = [[0.04, -0.22], [0.4, -0.22], [0.04, 0.36]];
  return [hull, band, mainLow, mainHigh, jib];
}

/** A toadstool: a domed cap in three slices, the rim under it (the finger strip), a stem and its rounded foot. */
function mushroom(): V2[][] {
  const rx = 0.46, ry = 0.34, D = (deg: number) => ellAt([0, 0], rx, ry, deg);
  const a1 = Math.acos(0.15 / rx) / DEG;
  const right: V2[] = [[0.15, 0], D(0), D(15), D(30), D(45), D(60), D(a1)];
  const middle: V2[] = [[-0.15, 0], [0.15, 0], D(a1), D(80), D(90), D(100), D(180 - a1)];
  const left: V2[] = [D(180), [-0.15, 0], D(180 - a1), D(120), D(135), D(150), D(165)];
  const rim: V2[] = [[-0.43, -0.075], [0.43, -0.075], D(0), D(180)];
  const stem: V2[] = [[-0.15, -0.44], [0.15, -0.44], [0.105, -0.075], [-0.105, -0.075]];
  const foot = bulge([-0.15, -0.44], [0.15, -0.44], 0.05, 4);
  return [left, middle, right, rim, stem, foot];
}

/** A house on its footing (the finger strip): walls round a door, a pitched roof over the eaves, and a chimney. */
function house(): V2[][] {
  const wall = 0.32, door = 0.075, yBase = -0.42, yTop = 0.02, eave = 0.42, apex: V2 = [0, 0.42];
  const footing = rect(-0.38, -0.5, 0.38, yBase);
  const left = rect(-wall, yBase, -door, yTop);
  const lintel = rect(-door, -0.14, door, yTop);
  const right = rect(door, yBase, wall, yTop);
  const roofL: V2[] = [[-eave, yTop], [0, yTop], apex];
  const roofR: V2[] = [[0, yTop], [eave, yTop], apex];
  const slope = (x: number) => atX([eave, yTop], apex, x);
  const chimney: V2[] = [slope(0.19), slope(0.28), [0.28, 0.42], [0.19, 0.42]];
  return [footing, left, lintel, right, roofL, roofR, chimney];
}

/** A fish facing right: head, body, the belly (the finger strip), a forked tail and a dorsal fin. */
function fish(): V2[][] {
  const c: V2 = [0.06, 0], rx = 0.3, ry = 0.18, E = (deg: number) => ellAt(c, rx, ry, deg);
  const yb = -0.11, ab = Math.asin(yb / ry) / DEG;
  const b0 = 180 - ab, b1 = 360 + ab;
  const belly = [b0, 235, 255, 270, 285, 305, b1].map(E);
  const xs = 0.14, as = Math.acos((xs - c[0]) / rx) / DEG, cutBot: V2 = [xs, yb];
  const front: V2[] = [cutBot, E(b1), E(335), E(350), E(5), E(20), E(35), E(50), E(62), E(as)];
  // The back ends in an upright edge at x = -0.19, where the tail's two lobes meet it.
  const xr = -0.19, hr = ry * Math.sqrt(1 - ((xr - c[0]) / rx) ** 2), rTop: V2 = [xr, hr], rBot: V2 = [xr, -hr];
  const back: V2[] = [E(b0), cutBot, E(as), E(90), E(130), rTop, rBot];
  const m: V2 = [xr, 0], notch: V2 = [-0.33, 0];
  const lobeTop: V2[] = [rTop, [-0.44, 0.24], notch, m];
  const lobeBot: V2[] = [m, notch, [-0.44, -0.24], rBot];
  const dorsal: V2[] = [E(90), [-0.12, 0.33], E(130)];
  return [back, front, belly, lobeTop, lobeBot, dorsal];
}

/**
 * A whale facing left, its tail raised: a long body (head and back), the belly (the finger strip), a flipper, a spout
 * of two plumes, the tail and two broad flukes.
 */
function whale(): V2[][] {
  const c: V2 = [-0.06, -0.1], rx = 0.38, ry = 0.17, E = (deg: number) => ellAt(c, rx, ry, deg);
  const yb = c[1] - 0.6 * ry, ab = Math.asin(-0.6) / DEG;
  const b0 = 180 - ab, b1 = 360 + ab;
  const belly = [b0, 228, 240, 255, 270, 285, 305, b1].map(E);
  const xs = -0.14, as = Math.acos((xs - c[0]) / rx) / DEG, cutBot: V2 = [xs, yb], cutTop = E(as);
  const head: V2[] = [cutBot, cutTop, E(110), E(124), E(140), E(155), E(170), E(185), E(200), E(b0)];
  const back: V2[] = [cutBot, E(b1), E(338), E(352), E(28), E(64), E(80), cutTop];
  const flipper: V2[] = [E(228), [-0.17, -0.33], E(240)];
  // The spout: a stalk, then two plumes leaning apart, each on half of its top edge.
  const stalk = strip(E(110), E(124), 92, 0.1, 0.024);
  const p1 = stalk[1]!, p2 = stalk[2]!, pm = lerp(p1, p2, 0.5);
  const plumeR = lobe(p1, pm, 58, 0.09, 0.024, 5);
  const plumeL = lobe(pm, p2, 122, 0.09, 0.024, 5);
  // The tail rises from the back's end to the flukes, which spread across its tip.
  const f1: V2 = [0.42, 0.15], f2: V2 = [0.31, 0.19];
  const stock: V2[] = [E(352), f1, f2, E(28)];
  const m = lerp(f1, f2, 0.5), base = lerp(E(352), E(28), 0.5);
  const ul = Math.hypot(m[0] - base[0], m[1] - base[1]), u: V2 = [(m[0] - base[0]) / ul, (m[1] - base[1]) / ul];
  const at = (s: number, k: number): V2 => [m[0] + s * u[1] + k * u[0], m[1] - s * u[0] + k * u[1]];
  const notch = at(0, 0.06);
  const flukeR: V2[] = [f1, at(0.23, 0.04), at(0.17, 0.11), notch, m];
  const flukeL: V2[] = [m, notch, at(-0.17, 0.11), at(-0.23, 0.04), f2];
  return [head, back, belly, flipper, stalk, plumeR, plumeL, stock, flukeR, flukeL];
}

/** A snail facing right: the shell in four pieces, the foot under it (the finger strip), the head and two eye stalks. */
function snail(): V2[][] {
  const foot: V2[] = [[-0.32, -0.38], [0.34, -0.38], [0.42, -0.31], [0.36, -0.26], [-0.36, -0.26], [-0.46, -0.32]];
  const sc: V2 = [-0.12, -0.03], r = 0.26, S = (deg: number) => onCircle(sc, r, deg);
  const lo = Math.asin((-0.26 - sc[1]) / r) / DEG;
  const a0 = 180 - lo, a1 = 360 + lo;
  const right: V2[] = [sc, S(a1), S(315), S(330), S(345), S(0), S(15), S(30), S(45), S(60)];
  const top: V2[] = [sc, S(60), S(78), S(96), S(114), S(132), S(150), S(170)];
  const left: V2[] = [sc, S(170), S(188), S(206), S(224), S(a0)];
  const under: V2[] = [sc, S(a0), S(a1)];
  const head: V2[] = [[0.12, -0.26], [0.34, -0.26], [0.38, -0.18], [0.36, -0.11], [0.33, -0.08], [0.28, -0.05], [0.23, -0.05], [0.18, -0.09], [0.14, -0.16]];
  const stalkFront = strip([0.33, -0.08], [0.28, -0.05], 62, 0.19, 0.024);
  const stalkBack = strip([0.23, -0.05], [0.18, -0.09], 88, 0.17, 0.024);
  return [foot, under, left, top, right, head, stalkFront, stalkBack];
}

/** An owl on a branch, from the front: body, a face with two eye holes, ear tufts, and the branch (the finger strip). */
function owl(): V2[][] {
  const branch: V2[] = [[-0.3, -0.49], [0.3, -0.49], [0.34, -0.44], [0.31, -0.39], [-0.31, -0.39], [-0.34, -0.44]];
  const bc: V2 = [0, -0.15], B = (deg: number) => ellAt(bc, 0.22, 0.3, deg);
  const lo = Math.asin(-0.24 / 0.3) / DEG, hi = Math.asin(0.15 / 0.3) / DEG;
  const bodyR: V2[] = [[0, -0.39], B(360 + lo), B(320), B(335), B(350), B(5), B(18), B(hi), [0, 0]];
  const neck = B(hi);
  // The face: a middle column, and round each eye hole a piece below, one outside and one above.
  const middle = rect(-0.045, 0, 0.045, 0.315);
  const below: V2[] = [[0.045, 0], neck, [0.215, 0.05], [0.228, 0.1], [0.045, 0.1]];
  const outer: V2[] = [[0.145, 0.1], [0.228, 0.1], [0.236, 0.15], [0.228, 0.2], [0.145, 0.2]];
  const above: V2[] = [[0.045, 0.2], [0.228, 0.2], [0.222, 0.245], [0.15, 0.315], [0.045, 0.315]];
  const tuft: V2[] = [[0.222, 0.245], [0.25, 0.43], [0.15, 0.315]];
  const half = [bodyR, below, outer, above, tuft];
  return [branch, middle, ...half, ...half.map(mirrorX)];
}

/** A rabbit sitting, facing right: body, head, two long ears, a round tail and the long hind foot (the finger strip). */
function rabbit(): V2[][] {
  const c: V2 = [-0.06, -0.12], E = (deg: number) => ellAt(c, 0.25, 0.23, deg);
  const yf = -0.32, lo = Math.asin((yf - c[1]) / 0.23) / DEG;
  const a0 = 180 - lo, a1 = 360 + lo;
  const front: V2[] = [[c[0], yf], E(a1), E(315), E(335), E(0), E(20), E(75), E(90)];
  const back: V2[] = [E(a0), [c[0], yf], E(90), E(110), E(130), E(150), E(170), E(200), E(220)];
  const head = cap(E(20), E(75), 0.13, [-50, -25, 0, 25, 50, 70, 88, 118, 148, 165]);
  const h = (deg: number) => onCircle(head.c, 0.13, deg);
  const earFront = lobe(h(88), h(118), 100, 0.3, 0.033);
  const earBack = lobe(h(118), h(148), 118, 0.27, 0.033);
  const tail = cap(E(170), E(200), 0.065, [100, 140, 180, 220, 260]).poly;
  const foot: V2[] = [[-0.3, -0.4], [0.2, -0.4], [0.24, -0.37], [0.21, yf], [-0.22, yf], [-0.32, -0.37]];
  return [back, front, head.poly, earFront, earBack, tail, foot];
}

/** A candle in its holder: the dish (the finger strip), socket, candle, wick, flame and a ring handle. */
function candle(): V2[][] {
  const dish: V2[] = [[-0.34, -0.48], [0.34, -0.48], [0.44, -0.41], [-0.44, -0.41]];
  const socket: V2[] = [[-0.11, -0.41], [0.11, -0.41], [0.1, -0.33], [-0.1, -0.33]];
  const low = rect(-0.075, -0.33, 0.075, -0.02);
  const high = rect(-0.075, -0.02, 0.075, 0.2);
  const wick = rect(-0.013, 0.2, 0.013, 0.25);
  // The flame: round below, pointed above; its sides leave the circle where they touch it, so it stays convex.
  const fc: V2 = [0, 0.318], fr = 0.068, F = (deg: number) => onCircle(fc, fr, deg);
  const flame: V2[] = [[-0.013, 0.25], [0.013, 0.25], F(-70), F(-40), F(-10), F(18), [0, 0.5], F(162), F(190), F(220), F(250)];
  const legL = rect(0.2, -0.41, 0.25, -0.3);
  const legR = rect(0.36, -0.41, 0.41, -0.3);
  const arch: V2[] = [[0.2, -0.3], [0.41, -0.3], [0.41, -0.27], [0.38, -0.24], [0.305, -0.225], [0.23, -0.24], [0.2, -0.27]];
  return [dish, socket, low, high, wick, flame, legL, arch, legR];
}

/**
 * A teacup on its saucer: the cup's rim (the finger strip, lit only above, as the bowl lies under it), the bowl in two
 * halves, a foot, a loop handle, and the saucer in three pieces (each too small to be the finger's: the saucer is lit
 * on both sides, and a finger laid along it darkens both).
 */
function teacup(): V2[][] {
  const sL: V2[] = [[-0.36, -0.48], [-0.12, -0.48], [-0.12, -0.42], [-0.47, -0.42]];
  const sM = rect(-0.12, -0.48, 0.12, -0.42);
  const foot: V2[] = [[-0.12, -0.42], [0.12, -0.42], [0.14, -0.38], [-0.14, -0.38]];
  const B = (deg: number) => ellAt([0, 0.04], 0.3, 0.47, deg);
  const lo = Math.asin(-0.42 / 0.47) / DEG, rimLo = Math.asin(-0.085 / 0.47) / DEG;
  const right: V2[] = [[0, -0.38], B(lo), B(-50), B(-38), B(-26), B(-14), B(rimLo), [0, B(rimLo)[1]]];
  const rim: V2[] = [mirrorX([B(rimLo)])[0]!, B(rimLo), B(0), [-0.3, 0.04]];
  const hx = 0.43, y = (deg: number) => B(deg)[1];
  const armTop: V2[] = [B(-26), [hx, y(-26)], [hx, y(-14)], B(-14)];
  const armLow: V2[] = [B(-50), [hx, y(-50)], [hx, y(-38)], B(-38)];
  const grip: V2[] = [[hx, y(-50)], [hx + 0.06, y(-50) + 0.035], [hx + 0.06, y(-14) - 0.035], [hx, y(-14)]];
  return [rim, mirrorX(right), right, foot, sL, sM, mirrorX(sL), armLow, grip, armTop];
}

/** A chess knight facing left: the base (the finger strip), a collar, the neck, head, muzzle, ear and mane. */
function knight(): V2[][] {
  const base: V2[] = [[-0.36, -0.5], [0.36, -0.5], [0.32, -0.42], [-0.32, -0.42]];
  const collar = rect(-0.23, -0.42, 0.23, -0.34);
  const neck: V2[] = [[-0.18, -0.34], [0.21, -0.34], [0.24, -0.12], [0.22, 0.04], [-0.07, 0.02], [-0.16, -0.18]];
  const head: V2[] = [[0.22, 0.04], [0.2, 0.22], [0.12, 0.34], [0, 0.38], [-0.14, 0.32], [-0.07, 0.02]];
  const muzzle: V2[] = [[-0.14, 0.32], [-0.3, 0.24], [-0.4, 0.12], [-0.38, 0.05], [-0.07, 0.02]];
  const ear: V2[] = [[0.12, 0.34], [0.1, 0.5], [0, 0.38]];
  const mane = bulge([0.22, 0.04], [0.2, 0.22], 0.045, 3);
  return [base, collar, neck, head, muzzle, ear, mane];
}

/** A saguaro cactus: the trunk and two arms; the left arm's elbow (the finger strip) and the right's run sideways. */
function cactus(): V2[][] {
  const w = 0.085, round = (c: V2, r: number) => [30, 60, 90, 120, 150].map((d) => onCircle(c, r, d));
  const low = rect(-w, -0.46, w, -0.08);
  const middle = rect(-w, -0.08, w, 0.14);
  const top: V2[] = [[-w, 0.14], [w, 0.14], [w, 0.38], ...round([0, 0.38], w), [-w, 0.38]];
  const elbowL: V2[] = [[-0.31, -0.13], [-w, -0.13], [-w, -0.02], [-0.37, -0.02], [-0.355, -0.09]];
  const armL: V2[] = [[-0.37, -0.02], [-0.25, -0.02], [-0.25, 0.2], ...round([-0.31, 0.2], 0.06), [-0.37, 0.2]];
  const elbowR: V2[] = [[w, 0.02], [0.29, 0.02], [0.33, 0.07], [0.33, 0.12], [w, 0.12]];
  const armR: V2[] = [[0.22, 0.12], [0.33, 0.12], [0.33, 0.3], ...round([0.275, 0.3], 0.055), [0.22, 0.3]];
  return [low, middle, top, elbowL, armL, elbowR, armR];
}

/**
 * A fir tree: the trunk and three tiers of branches, the lowest tier's hem (the finger strip) under the rest of it,
 * so a finger laid along it darkens the lit band on one side only.
 */
function tree(): V2[][] {
  const trunk = rect(-0.06, -0.43, 0.06, -0.27);
  const bl: V2 = [-0.38, -0.27], br: V2 = [0.38, -0.27], tl: V2 = [-0.17, -0.02], tr: V2 = [0.17, -0.02];
  const hl = atY(bl, tl, -0.17), hr = atY(br, tr, -0.17);
  const hem: V2[] = [bl, br, hr, hl];
  const low: V2[] = [hl, hr, tr, tl];
  const middle: V2[] = [[-0.3, -0.02], [0.3, -0.02], [0.12, 0.2], [-0.12, 0.2]];
  const top: V2[] = [[-0.22, 0.2], [0.22, 0.2], [0, 0.48]];
  return [trunk, hem, low, middle, top];
}

/** The added silhouettes, built (not yet centred and scaled), in the order the library lists them. */
export function newSilhouettes(): Record<AddedSilhouette, V2[][]> {
  return {
    Anchor: anchor(),
    Sailboat: sailboat(),
    Mushroom: mushroom(),
    House: house(),
    Fish: fish(),
    Whale: whale(),
    Snail: snail(),
    Owl: owl(),
    Rabbit: rabbit(),
    Candle: candle(),
    Teacup: teacup(),
    Knight: knight(),
    Cactus: cactus(),
    Tree: tree(),
  };
}
