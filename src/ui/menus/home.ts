// Home, for now: the name, the storage notice when progress cannot be saved, Recenter and
// Settings. (The real home, with Continue, the Daily Box, Lessons and the Collection, comes with
// the menus pass.)
import type { MenuSpec, PanelUi } from "./types";

export const HOME: MenuSpec = {
  node: "home-panel",
  screen: "home",
  keys: ["home-recenter", "home-settings"],
};

export interface HomeView {
  /** The storage notice to show once, else null. */
  notice: string | null;
}

export function homeView(notice: string | null): HomeView {
  return { notice };
}

export function paintHome(ui: PanelUi, v: HomeView): void {
  ui.show("home-notice", v.notice !== null);
  if (v.notice !== null) ui.text("home-notice-text", v.notice);
}
