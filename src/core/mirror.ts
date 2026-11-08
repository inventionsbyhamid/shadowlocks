// Left-handed play: the same box reflected left to right, so the lantern starts on the left and every spot, scrap,
// ring and outline swaps sides. Reflection keeps every guarantee (coverage, spill, distances, the envelope), because
// the envelope is symmetric in x.
import type { Box, Element, Lock, V2, V3 } from "./types";

const flip2 = (p: V2): V2 => [-p[0], p[1]];
const flip3 = (p: V3): V3 => [-p[0], p[1], p[2]];

/** An element reflected left to right, as mirrorBox reflects it. */
export function mirrorElement(e: Element): Element {
  if (e.kind === "ring") return { ...e, c: flip3(e.c), nrm: flip3(e.nrm) };
  return { ...e, verts: e.verts.map(flip3) };
}

/** A lock reflected left to right, as mirrorBox reflects it. */
export function mirrorLock(l: Lock): Lock {
  return {
    ...l,
    center: flip2(l.center),
    // The outline is the shape's mirror image turned the other way. Vertices keep their order (and so their match
    // with the scraps' vertices), which reverses each polygon's winding.
    rot: -l.rot,
    target: l.target.map((poly) => poly.map(flip2)),
    L: flip3(l.L),
    fingerAngle: -l.fingerAngle,
    mark: l.mark && flip2(l.mark),
  };
}

/** The box with every x negated. Mirroring a mirrored box gives the original back. Returns a new box. */
export function mirrorBox(box: Box): Box {
  return {
    ...box,
    spec: { ...box.spec },
    params: { ...box.params },
    start: flip3(box.start),
    elements: box.elements.map(mirrorElement),
    locks: box.locks.map(mirrorLock),
    mirrored: !box.mirrored,
  };
}
