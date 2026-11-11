// Every piece of lettering the box draws, in every language, measured with the same fits its painters use (the
// plate's name beside three latch lights, the box's keys, every line the lessons' coach chip shows, both story
// sentences for every owner and every loot): the layout check (tests/e2e/i18n-box.spec.ts) fails on any that does
// not fit at a readable size. Test builds only.
import { type Copy, LANGS, type Lang, storyLoot, storyOwner, tableFor } from "../i18n";
import { storyLayout } from "../render/reward";
import { coachLayout } from "./coach-line";
import { COPY, fill } from "./copy";
import { HINT_LANTERN } from "./hint-lantern";
import { keyLabelFit } from "./poke-key";
import { PLATE, plateCueFit, plateNameFit } from "./plate";

/** One piece of lettering in one language: where it is drawn, its size (px) and whether it had to be squeezed. */
export interface BoxTextFit {
  lang: Lang;
  where: string;
  text: string;
  size: number;
  /** Lines it was set on (the story card wraps rather than shrink). */
  lines: number;
  squeezed: boolean;
}

type Measure = Parameters<typeof keyLabelFit>[0];

/**
 * Every line the coach chip shows: each lesson's lines (not the lessons' names), the tips, the session's suggestion,
 * and a phone's and a controller's wording of the lines about hands.
 */
export function coachLines(c: Copy): string[] {
  const said = Object.values(c.lessons).filter((v): v is string => typeof v === "string");
  return [...said, ...Object.values(c.lessons.tips), c.game.controllerFinger, ...Object.values(c.phone), ...Object.values(c.controller)];
}

/** Measure every piece of the box's lettering in every language with `g` (its fonts loaded). */
export function boxTextFits(g: Measure): BoxTextFit[] {
  const out: BoxTextFit[] = [];
  for (const l of LANGS) {
    const t = tableFor(l), G = t.game;
    const add = (where: string, text: string, f: { size: number; squeezed: boolean; lines?: readonly string[] }) =>
      out.push({ lang: l, where, text, size: f.size, lines: f.lines?.length ?? 1, squeezed: f.squeezed });
    // The plate with three latch lights (the least room), box numbers up to three digits, and the Daily Box.
    for (const name of [fill(G.boxNo, { n: 1 }), fill(G.boxNo, { n: 88 }), fill(G.boxNo, { n: 888 }), G.daily]) add("plate", name, plateNameFit(g, name, 3, l));
    add("plate cue", G.practice, plateCueFit(g, G.practice, 3, l));
    add("plate-next", G.next, keyLabelFit(g, G.next, PLATE.key.w, PLATE.key.h, l));
    // The coach chip: one size, at most two lines, never condensed.
    for (const s of coachLines(t)) add("coach", s, coachLayout(g, s, l));
    for (const [id, s] of [
      ["hint-choice", G.hint],
      ["hint-show-me", G.showMe],
    ] as const)
      add(id, s, keyLabelFit(g, s, HINT_LANTERN.choice.w, HINT_LANTERN.choice.h, l));
    // The story card: every owner's sentence and every loot's, each beside the other's first.
    const owners = COPY.story.owners.map((o) => fill(G.storyOwner, { owner: storyOwner(o, t) }));
    const loot = COPY.story.loot.map((o) => fill(G.storyLoot, { loot: storyLoot(o, t) }));
    for (const a of owners) add("story", a, storyLayout(g, a, loot[0] as string, l));
    for (const b of loot) add("story", b, storyLayout(g, owners[0] as string, b, l));
  }
  return out;
}
