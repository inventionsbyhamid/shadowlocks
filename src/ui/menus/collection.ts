// Collection: every solved box's reward, newest first, three cards at a time ("Box No. 3", whose
// desk it came off, what was inside), with Newer and Older to page. Pure view model and painting.
import { specOfKey } from "../../core/generator";
import type { CollectionItem } from "../../core/profile";
import { COPY, fill } from "../copy";
import type { MenuSpec, PanelUi } from "./types";

/** Cards on one page. */
export const CARDS = 3;

export const COLLECTION: MenuSpec = {
  node: "collection-panel",
  screen: "collection",
  keys: ["collection-back", "coll-newer", "coll-older"],
};

/** The numbered box a box key names ("shadow-locks/3"), else null. */
export function boxNumberOf(key: string): number | null {
  const spec = specOfKey(key);
  return spec?.kind === "box" ? spec.n : null;
}

/** A reward's title from its box key: "Box No. 3", or "Daily Box 2026-11-02" for a daily. */
export function titleOf(key: string): string {
  const c = COPY.menus.collection;
  const spec = specOfKey(key);
  if (spec?.kind === "box") return fill(c.box, { n: spec.n });
  if (spec?.kind === "daily") return fill(c.daily, { day: spec.day });
  return key;
}

export interface CardView {
  title: string;
  owner: string;
  loot: string;
}

export interface CollectionView {
  count: string;
  cards: CardView[];
  empty: boolean;
  /** Paging: shown only with more than one page. */
  pager: boolean;
  newer: boolean;
  older: boolean;
  page: string;
  /** The page shown (clamped). */
  index: number;
  disabled: string[];
}

/** Page `page` (0 = newest) of the collection. */
export function collectionView(items: readonly CollectionItem[], page: number): CollectionView {
  const c = COPY.menus.collection;
  const n = items.length;
  const pages = Math.max(1, Math.ceil(n / CARDS));
  const index = Math.min(pages - 1, Math.max(0, Math.floor(page)));
  // Newest first: the collection is stored oldest first.
  const from = index * CARDS;
  const cards: CardView[] = [];
  for (let k = from; k < Math.min(n, from + CARDS); k++) {
    const it = items[n - 1 - k] as CollectionItem;
    // The same story lines the reward card carries as it rises out of the box.
    cards.push({ title: titleOf(it.key), owner: fill(COPY.game.storyOwner, { owner: it.owner }), loot: fill(COPY.game.storyLoot, { loot: it.loot }) });
  }
  const newer = index > 0;
  const older = index < pages - 1;
  const disabled: string[] = [];
  if (!newer) disabled.push("coll-newer");
  if (!older) disabled.push("coll-older");
  return {
    count: n === 0 ? c.none : n === 1 ? c.one : fill(c.many, { n }),
    cards,
    empty: n === 0,
    pager: pages > 1,
    newer,
    older,
    page: fill(c.page, { from: from + 1, to: from + cards.length, n }),
    index,
    disabled,
  };
}

export function paintCollection(ui: PanelUi, v: CollectionView): void {
  ui.text("coll-count", v.count);
  ui.show("coll-cards", !v.empty);
  ui.show("coll-empty", v.empty);
  for (let i = 0; i < CARDS; i++) {
    const card = v.cards[i];
    // A short last page keeps its cards' places (the row does not stretch two cards wide).
    ui.visible(`coll-card-${i}`, !!card);
    if (card) {
      ui.text(`coll-card-${i}-title`, card.title);
      ui.text(`coll-card-${i}-owner`, card.owner);
      ui.text(`coll-card-${i}-loot`, card.loot);
    }
  }
  ui.show("coll-pager", v.pager);
  ui.text("coll-page", v.page);
  // Only the ways there are to go show (each keeps its place).
  ui.visible("coll-newer-slot", v.newer);
  ui.visible("coll-older-slot", v.older);
}
