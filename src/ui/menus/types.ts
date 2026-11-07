// What a screen module may do to its panel, and the small data interfaces the menus paint from.
// Painting is implemented over UIKit in `src/ui/panel-ui.ts`; kept structural so screen modules
// (view models and painting) load in unit tests without Three.
import type { Screen } from "../../app/screens";
import type { Ent } from "../../core/entitlement";

export interface PanelUi {
  /** Set the text of an element. */
  text(id: string, s: string): void;
  /** Show or remove an element from the layout. */
  show(id: string, on: boolean): void;
  /** Seen or not, keeping its place in the layout (its children follow). */
  visible(id: string, on: boolean): void;
  /** Background colour. */
  fill(id: string, color: string): void;
  /** Text colour (inherited by the element's text). */
  ink(id: string, color: string): void;
  /** Border colour. */
  edge(id: string, color: string): void;
  /** Roll a text element through `steps` (count up), starting after `delayS`. */
  roll(id: string, steps: readonly string[], delayS: number): void;
}

/** A menu panel: its scene node, its screen and the ids of its keys. */
export interface MenuSpec {
  node: string;
  screen: Screen;
  /** Every key on the panel (hidden ones are not offered for pokes). */
  keys: readonly string[];
}

/** What waits behind the menus, paused in the lap (Continue goes back to it), or null. */
export type Behind = { kind: "box"; n: number } | { kind: "daily" } | { kind: "lesson" } | null;

/** The lesson examples the Lessons menu replays (the lessons' ExampleId). */
export type ExampleKey = "move" | "near-far" | "rings" | "finger";

/** What the menus read beyond the profile and settings. The shell (and the game, once in) provide it. */
export interface MenuData {
  /** What is paused behind the menus. */
  behind(): Behind;
  /**
   * What the player may play now (the shell resolves it from the edition, the profile and billing), or null while
   * it is still being worked out.
   */
  ent(): Ent | null;
  /** Billing can sell here (the installed store app); a browser gets the store link instead. */
  canBuy(): boolean;
  /** Today's day key on this device (YYYY-MM-DD). */
  today(): string;
}
