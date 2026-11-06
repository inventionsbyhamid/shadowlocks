// Lessons: one key per example ("Move the light", "Near and far", "Sight the rings", "Lend a hand"),
// always there, and one per tip seen so far, in the order they were met; each replays (a replay never
// touches box progress). Pure view model and painting.
import type { TipId } from "../../core/profile";
import { type Copy, copy } from "../../i18n";
import type { ExampleKey, MenuSpec, PanelUi } from "./types";

export const EXAMPLES: readonly ExampleKey[] = ["move", "near-far", "rings", "finger"];
/** Tip slots on the panel (every TipId fits). */
export const TIP_SLOTS = 4;

/** An example's key id. */
export const exampleKey = (e: ExampleKey): string => `lesson-${e}`;

export const LESSONS: MenuSpec = {
  node: "lessons-panel",
  screen: "lessons",
  keys: ["lessons-back", ...EXAMPLES.map(exampleKey), ...Array.from({ length: TIP_SLOTS }, (_, i) => `tip-${i}`)],
};

/** Each example's name in the language shown. */
export const EXAMPLE_LABELS: Readonly<Record<ExampleKey, (c: Copy) => string>> = {
  move: (c) => c.menus.lessons.move,
  "near-far": (c) => c.menus.lessons.nearFar,
  rings: (c) => c.menus.lessons.rings,
  finger: (c) => c.menus.lessons.finger,
};
/** Each tip's name in the language shown. */
export const TIP_LABELS: Readonly<Record<TipId, (c: Copy) => string>> = {
  decoys: (c) => c.menus.lessons.decoys,
  ringless: (c) => c.menus.lessons.ringless,
  hidden: (c) => c.menus.lessons.hidden,
  drawer: (c) => c.menus.lessons.drawer,
};

/** One row of the Lessons menu: its key, what it replays and its label. */
export type LessonRow = { key: string; label: string } & ({ kind: "example"; id: ExampleKey } | { kind: "tip"; id: TipId });

export interface LessonsView {
  rows: LessonRow[];
  /** No tip seen yet: the tips row says where they will appear. */
  noTips: boolean;
}

export function lessonsView(tipsSeen: readonly TipId[]): LessonsView {
  const c = copy();
  const rows: LessonRow[] = EXAMPLES.map((id) => ({ key: exampleKey(id), label: EXAMPLE_LABELS[id](c), kind: "example", id }));
  const tips = tipsSeen.filter((t, i) => Object.hasOwn(TIP_LABELS, t) && tipsSeen.indexOf(t) === i).slice(0, TIP_SLOTS);
  tips.forEach((id, i) => rows.push({ key: `tip-${i}`, label: TIP_LABELS[id](c), kind: "tip", id }));
  return { rows, noTips: tips.length === 0 };
}

/** What a key of the Lessons menu replays, or null. */
export function lessonRowOf(v: LessonsView, key: string): LessonRow | null {
  return v.rows.find((r) => r.key === key) ?? null;
}

export function paintLessons(ui: PanelUi, v: LessonsView): void {
  for (const r of v.rows) ui.text(`${r.key}-label`, r.label);
  const tips = v.rows.filter((r) => r.kind === "tip").length;
  ui.show("lessons-tips", !v.noTips);
  ui.show("lessons-none", v.noTips);
  // Unused slots keep their place, so a lone tip is one key wide, like the examples above it.
  for (let i = 0; i < TIP_SLOTS; i++) ui.visible(`tip-${i}-slot`, i < tips);
}
