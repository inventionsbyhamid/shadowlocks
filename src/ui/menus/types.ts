// What a screen module may do to its panel. Implemented over UIKit in `src/ui/panel-ui.ts`; kept
// structural so screen modules (view models and painting) load in unit tests without Three.
import type { Screen } from "../../app/screens";

export interface PanelUi {
  /** Set the text of an element. */
  text(id: string, s: string): void;
  /** Show or remove an element from the layout. */
  show(id: string, on: boolean): void;
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
