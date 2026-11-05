import { migrate, newProfile, type Profile } from "../core/profile";
import { openIdbStore, type IdbStore } from "./idb-store";

/** Where the profile lives. `load` migrates what is stored as of `nowMs` on `build` (see core/profile). */
export interface Store {
  load(nowMs: number, build: string): Promise<Profile>;
  save(p: Profile): Promise<void>;
  readonly persistent: boolean;
}

function memoryStore(initial: Profile | null = null): Store {
  let held: Profile | null = initial;
  return {
    persistent: false,
    load: async (nowMs, build) => (held ? migrate(JSON.parse(JSON.stringify(held)), nowMs, build) : newProfile(nowMs, build)),
    save: async (p) => {
      held = JSON.parse(JSON.stringify(p));
    },
  };
}

/** IndexedDB when it works; else (now, or after any later failure) memory only, keeping the latest profile. */
export async function openStore(): Promise<Store> {
  let idb: IdbStore;
  try {
    if (typeof indexedDB === "undefined") return memoryStore();
    idb = await openIdbStore(indexedDB);
  } catch {
    return memoryStore();
  }
  let mem: Store | null = null;
  return {
    get persistent() {
      return mem === null;
    },
    load: async (nowMs, build) => {
      if (mem) return mem.load(nowMs, build);
      try {
        return await idb.load(nowMs, build);
      } catch {
        mem = memoryStore();
        return mem.load(nowMs, build);
      }
    },
    save: async (p) => {
      if (mem) return mem.save(p);
      try {
        await idb.save(p);
      } catch {
        mem = memoryStore(p);
      }
    },
  };
}
