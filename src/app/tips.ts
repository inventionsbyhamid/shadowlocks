// Just-in-time tips: the first time a mechanic matters, one line on the coach line until the player has done it.
// Decoys at box 2, a lock without rings at box 4, a hidden outline at box 5 (the difficulty curve brings each in
// there). A player who skips ahead (a field flag, the Daily Box) gets the earliest tip not yet seen, one a box.
// Lessons never show tips; the drawer is lesson 2's to teach.
// This module says which tip a box shows, the lock it is about (tipLock) and when it is done. The ghost demo of
// about 6 s that plays once as the line first shows (the finger pointing at two decoys, or a ghost lantern swept
// just above the lock's spot) is built in lesson-scripts.ts (buildTipScript) and run by lessons.ts, which also
// replays it from a Lessons row.
import type { TipId } from "../core/profile";
import type { Box } from "../core/types";
import { COPY } from "../ui/copy";

type BoxTip = Exclude<TipId, "drawer">;

/** The first box number each tip may show at. */
export const TIP_FROM: Readonly<Record<BoxTip, number>> = { decoys: 2, ringless: 4, hidden: 5 };
const ORDER: readonly BoxTip[] = ["decoys", "ringless", "hidden"];

/** The coach line for each tip. */
export const TIP_LINES: Readonly<Record<TipId, string>> = { ...COPY.lessons.tips, drawer: COPY.lessons.drawer };

/**
 * The lock a tip is about (the first without rings, the first hidden), or -1 (decoys belong to no lock). Read every
 * frame while a tip shows: plain loops, no closures.
 */
export function tipLock(tip: TipId, box: Box): number {
  if (tip !== "ringless" && tip !== "hidden") return -1;
  const locks = box.locks;
  for (let k = 0; k < locks.length; k++) {
    const l = locks[k]!;
    if (tip === "ringless" ? !l.rings : l.hidden) return l.i;
  }
  return -1;
}

function applies(tip: BoxTip, box: Box): boolean {
  return tip === "decoys" ? box.elements.some((e) => e.kind === "decoy") : tipLock(tip, box) >= 0;
}

/** The tip to show as `box` starts, or null: the earliest one the box has a reason for that `seen` lacks. */
export function tipFor(box: Box, seen: readonly TipId[]): TipId | null {
  const spec = box.spec;
  if (spec.kind === "lesson") return null;
  // The Daily Box plays like a late box: any tip may show there.
  const n = spec.kind === "box" ? spec.n : Number.POSITIVE_INFINITY;
  for (const tip of ORDER) if (n >= TIP_FROM[tip] && !seen.includes(tip) && applies(tip, box)) return tip;
  return null;
}

/** The player has done what the tip asks: any lock opened past the decoys, or the tip's own lock opened. */
export function tipDone(tip: TipId, box: Box, isOpen: (lock: number) => boolean): boolean {
  if (tip === "drawer") return false;
  if (tip === "decoys") {
    for (let k = 0; k < box.locks.length; k++) if (isOpen(box.locks[k]!.i)) return true;
    return false;
  }
  const lock = tipLock(tip, box);
  return lock >= 0 && isOpen(lock);
}
