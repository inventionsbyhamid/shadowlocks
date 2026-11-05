// Video builds only (VITE_VIDEO=1, never production): what main.ts sets up for demo video renders.
import { migrate, newProfile, type Profile } from "../core/profile";
import type { Store } from "../platform/store";

export { installVideoMode } from "./hand-look";

/**
 * Progress in memory for a render: IndexedDB answers in real time, so a save or load could land on
 * a different frame in every run. It reports itself as persistent so no "not saved" notice appears
 * in the footage. A shot can start from a player's history (boxes opened, a streak, the collection):
 * the render puts that profile in `window.__nsVideoProfile` before the app loads; it goes through
 * the same migration as a stored profile.
 */
export function videoStore(initial: unknown = shotProfile()): Store {
  let held: unknown = initial;
  return {
    persistent: true,
    load: async (nowMs, build): Promise<Profile> =>
      held ? migrate(JSON.parse(JSON.stringify(held)), nowMs, build) : newProfile(nowMs, build),
    save: async (p) => {
      held = JSON.parse(JSON.stringify(p));
    },
  };
}

/** The shot's stored profile as given (load() migrates it with the app's clock and build). */
function shotProfile(): unknown {
  return (window as unknown as { __nsVideoProfile?: unknown }).__nsVideoProfile ?? null;
}
