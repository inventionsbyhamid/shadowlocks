// Which silhouettes a box shows, so a player meets them all and never the same one again a few boxes on. The boxes'
// silhouettes, one after another from box 5 (two in a silhouettes box), are dealt from decks of every silhouette, each
// deck shuffled by its own seed; where one deck ends and the next begins, the next one's first cards are swapped for
// ones the last deck did not just deal. So any REPEAT_GAP + 1 silhouettes in a row are all different. The Daily Box
// deals from decks of its own, one card a day. Pure and cheap: box n's silhouettes come from its number alone, never
// from building the boxes before it, so the same box number always gives the same box.
import { hash, rng32 } from "./geom";
import { BLOCK, blockSilhouettes, KINDS_FROM, silhouetteCount } from "./params";
import { SILHOUETTES } from "./shapes";
import type { BoxSpec, ShapeName } from "./types";

const N = SILHOUETTES.length;
/**
 * How many cards at a deck's start never repeat the last as many of the deck before (a third of the deck, so the swaps
 * always find cards). A deck's own cards all differ, so any REPEAT_GAP + 1 in a row do: such a run that spans two decks
 * takes at most REPEAT_GAP from each end.
 */
export const REPEAT_GAP = Math.floor(N / 3);
/**
 * The first silhouettes a player meets, boxes 5 to 9, while hidden outlines are new: the ones named fastest. The cat
 * stays box 5's, the game's first "it's a cat!"; the rest of the first deck is shuffled as any other, except the owl,
 * whose tufted outline is the cat's, which comes last.
 */
const OPENING: ShapeName[] = ["Cat", "Fish", "House", "Rabbit", "Anchor"];
const LATE: ShapeName = "Owl";
/** Silhouettes shown by boxes 1 to 9, before the rhythm, and by each block of it (every block has the same kinds). */
const BEFORE_RHYTHM = Array.from({ length: KINDS_FROM - 1 }, (_, i) => silhouetteCount(i + 1)).reduce((a, b) => a + b, 0);
const PER_BLOCK = blockSilhouettes(0);

function shuffled(seed: string): ShapeName[] {
  const rnd = rng32(hash(seed)), a = SILHOUETTES.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** The boxes' first deck: the opening five, then the others as shuffled, the owl last. */
function firstDeck(): ShapeName[] {
  return [...OPENING, ...shuffled("box/0").filter((s) => !OPENING.includes(s) && s !== LATE), LATE];
}

/**
 * Deck d of a series. Its first REPEAT_GAP cards are swapped, in order, with the first cards after them that the last
 * deck did not end with, never with its own last REPEAT_GAP: so those stay as shuffled, and the next deck reads them
 * without building any deck before.
 */
function deck(series: "box" | "daily", d: number): ShapeName[] {
  if (series === "box" && d === 0) return firstDeck();
  const order = shuffled(`${series}/${d}`);
  if (d === 0) return order;
  const g = REPEAT_GAP;
  const last = new Set((series === "box" && d === 1 ? firstDeck() : shuffled(`${series}/${d - 1}`)).slice(N - g));
  for (let i = 0; i < g; i++) {
    if (!last.has(order[i]!)) continue;
    let j = g;
    while (j < N - g && last.has(order[j]!)) j++;
    if (j >= N - g) throw new Error(`no card to swap into deck ${d} of ${series}`);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** The k-th silhouette dealt in a series (k from 0; the Daily Box's k is negative for days before 1970). */
export function dealt(series: "box" | "daily", k: number): ShapeName {
  return deck(series, Math.floor(k / N))[((k % N) + N) % N]!;
}

/** How many silhouettes the boxes before box n dealt: counted from the boxes' kinds, block by block from box 10. */
function dealtBefore(n: number): number {
  if (n < KINDS_FROM) {
    let sum = 0;
    for (let m = 1; m < n; m++) sum += silhouetteCount(m);
    return sum;
  }
  const k = Math.floor((n - KINDS_FROM) / BLOCK), i = (n - KINDS_FROM) % BLOCK;
  return BEFORE_RHYTHM + PER_BLOCK * k + blockSilhouettes(k, i);
}

/** Days since 1970-01-01 for a day key. */
function dayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** The silhouettes a box shows, in the order its hidden locks take them (none before box 5). */
export function boxSilhouettes(spec: BoxSpec): ShapeName[] {
  if (spec.kind === "daily") return [dealt("daily", dayIndex(spec.day))];
  if (spec.kind !== "box") return [];
  const first = dealtBefore(spec.n);
  return Array.from({ length: silhouetteCount(spec.n) }, (_, j) => dealt("box", first + j));
}
