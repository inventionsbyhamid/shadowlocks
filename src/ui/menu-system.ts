// Per-frame menu work (panel springs, keycaps, count-ups) as its own app system, so the test
// hooks time it with the rest of our JS. Allocation free.
import { createSystem } from "@iwsdk/core";
import type { Menus } from "./menus";

let menus: Menus | null = null;

/** Hand the menus to the system (systems cannot take constructor arguments). */
export function useMenus(m: Menus): void {
  menus = m;
}

export class MenuSystem extends createSystem({}) {
  update(delta: number): void {
    menus?.update(delta);
  }
}
