// The difficulty curve: every mechanic by box 5 (decoys from box 2, a finger lock from box 3, a lock without rings
// from box 4, a hidden outline from box 5), then more of each up to box 9. From box 10 the boxes take turns in five
// kinds, so the game never settles into one recipe: blocks of six boxes whose difficulty rises and falls (boxKind).
import { hash, rng32 } from "./geom";
import type { BoxParams } from "./types";

/**
 * What kind of box a box is, from box 10:
 * - standard: the full mix, three locks, two finger locks, two hidden outlines, one lock with rings;
 * - silhouettes: every outline hidden, two of them silhouettes, rings on two locks to find the spots by;
 * - fingers: a finger lock in each of the three locks, every lock with rings;
 * - expert: no sight rings at all, so the spots are read from the shadows alone;
 * - breather: one or two big locks after the block's hardest box, one of them a big hidden silhouette.
 * Boxes 1 to 9 are "standard" too: the curve's own rows.
 */
export type BoxKind = "standard" | "silhouettes" | "fingers" | "expert" | "breather";

type Row = Pick<BoxParams, "locks" | "fingerLocks" | "decoys" | "ringless" | "hidden">;

/** Boxes 1 to 9: the lessons' curve, the same in every generator version. */
function early(n: number): Row {
  if (n === 1) return { locks: 1, fingerLocks: 0, decoys: 2, ringless: 0, hidden: 0 };
  if (n === 2) return { locks: 2, fingerLocks: 0, decoys: 6, ringless: 0, hidden: 0 };
  if (n === 3) return { locks: 2, fingerLocks: 1, decoys: 8, ringless: 0, hidden: 0 };
  if (n === 4) return { locks: 2, fingerLocks: 1, decoys: 10, ringless: 1, hidden: 0 };
  if (n === 5) return { locks: 3, fingerLocks: 1, decoys: 12, ringless: 1, hidden: 1 };
  if (n <= 7) return { locks: 3, fingerLocks: 1, decoys: 12 + (n - 5), ringless: 1, hidden: 1 };
  return { locks: 3, fingerLocks: 2, decoys: 12 + (n - 5), ringless: 2, hidden: 2 };
}

/** Each kind's row from box 10; a breather's depends on its locks. */
const KIND_ROWS: Record<Exclude<BoxKind, "breather">, Row> = {
  standard: { locks: 3, fingerLocks: 2, decoys: 16, ringless: 2, hidden: 2 },
  silhouettes: { locks: 3, fingerLocks: 1, decoys: 14, ringless: 1, hidden: 3 },
  fingers: { locks: 3, fingerLocks: 3, decoys: 14, ringless: 0, hidden: 1 },
  expert: { locks: 3, fingerLocks: 2, decoys: 16, ringless: 3, hidden: 1 },
};
const BREATHER_ROWS: Record<1 | 2, Row> = {
  1: { locks: 1, fingerLocks: 1, decoys: 8, ringless: 0, hidden: 1 },
  2: { locks: 2, fingerLocks: 1, decoys: 10, ringless: 0, hidden: 1 },
};

/** The first box of the kinds, and how many boxes a block of the rhythm holds. */
export const KINDS_FROM = 10;
export const BLOCK = 6;

export interface Block {
  /** The block's boxes, in order. */
  kinds: BoxKind[];
  /** How many locks its breather has. */
  breatherLocks: 1 | 2;
}

/**
 * Block k of the rhythm (boxes 10 + 6k to 15 + 6k). Hard and easy boxes alternate: the 1st, 3rd and 5th box are the
 * two twists (silhouettes and fingers) and the expert box, the others two standard boxes and the breather, which
 * always comes right after the expert box. The expert box is 3rd or 5th, so two expert boxes are four to eight boxes
 * apart. The seed picks the expert box's place, the twists' order and the breather's locks; the first block is set:
 * the curve used to go flat at box 10, so it opens with its most striking box, two silhouettes, and its breather is a
 * single big lock.
 */
export function rhythmBlock(k: number): Block {
  if (k === 0) return { kinds: ["silhouettes", "standard", "expert", "breather", "fingers", "standard"], breatherLocks: 1 };
  const rnd = rng32(hash("shadow-locks/rhythm/" + k));
  const expertLate = rnd() < 0.5;
  const [t1, t2]: [BoxKind, BoxKind] = rnd() < 0.5 ? ["silhouettes", "fingers"] : ["fingers", "silhouettes"];
  const breatherLocks = rnd() < 0.5 ? 1 : 2;
  const kinds: BoxKind[] = expertLate ? [t1, "standard", t2, "standard", "expert", "breather"] : [t1, "standard", "expert", "breather", t2, "standard"];
  return { kinds, breatherLocks };
}

/** Box n's place in the rhythm: its block and its index in it; null before box 10. */
function place(n: number): { k: number; i: number } | null {
  return n < KINDS_FROM ? null : { k: Math.floor((n - KINDS_FROM) / BLOCK), i: (n - KINDS_FROM) % BLOCK };
}

const check = (n: number) => {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Box numbers start at 1, got ${n}`);
};

/** What kind of box box n is (boxes 1 to 9 are standard). */
export function boxKind(n: number): BoxKind {
  check(n);
  const p = place(n);
  return p ? rhythmBlock(p.k).kinds[p.i]! : "standard";
}

/** How many of a box's hidden locks are silhouettes, by its kind and hidden locks: two in a silhouettes box, else one. */
export function kindSilhouettes(kind: BoxKind, hidden: number): number {
  return hidden <= 0 ? 0 : kind === "silhouettes" ? Math.min(2, hidden) : 1;
}

/** How many of box n's hidden locks are silhouettes. */
export function silhouetteCount(n: number): number {
  return kindSilhouettes(boxKind(n), boxParams(n).hidden);
}

/**
 * How many silhouettes block k's boxes show before its i-th, and in all (i = BLOCK): from its kinds and their rows.
 * Every block holds the same kinds (in another order), so every block shows as many.
 */
export function blockSilhouettes(k: number, i: number = BLOCK): number {
  let sum = 0;
  for (let j = 0; j < i; j++) sum += silhouetteCount(KINDS_FROM + k * BLOCK + j);
  return sum;
}

/** The shared tail of every box's settings: `amp` is the share of the envelope's x range the spots may use. */
const shape = (n: number, r: Row): BoxParams => ({ ...r, tilt: Math.min(0.03 + 0.012 * n, 0.14), amp: Math.min(0.4 + 0.06 * n, 1) });

/** The settings for box n (1, 2, 3, ...). */
export function boxParams(n: number): BoxParams {
  check(n);
  const p = place(n);
  if (!p) return shape(n, early(n));
  const b = rhythmBlock(p.k), kind = b.kinds[p.i]!;
  return shape(n, kind === "breather" ? BREATHER_ROWS[b.breatherLocks] : KIND_ROWS[kind]);
}

/** Box n's settings under generator version 3: the curve flat from box 10, more hidden outlines from box 15. */
export function boxParamsV3(n: number): BoxParams {
  check(n);
  if (n <= 9) return shape(n, early(n));
  return shape(n, { locks: 3, fingerLocks: 2, decoys: 16, ringless: 2, hidden: n <= 14 ? 2 : 3 });
}

/** The Daily Box plays like box 7: three locks, one finger lock, one without rings, one hidden. */
export function dailyParams(): BoxParams {
  return boxParams(7);
}
