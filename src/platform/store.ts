import { defaultProfile, migrate, type Profile } from "../core/profile";
import { openIdbStore, type IdbStore } from "./idb-store";

export interface Store {
  load(): Promise<Profile>;
  save(p: Profile): Promise<void>;
  readonly persistent: boolean;
}

function memoryStore(initial: Profile | null = null): Store {
  let held: Profile | null = initial;
  return {
    persistent: false,
    load: async () => (held ? migrate(JSON.parse(JSON.stringify(held))) : defaultProfile()),
    save: async (p) => {
      held = JSON.parse(JSON.stringify(p));
    },
  };
}

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
    load: async () => {
      if (mem) return mem.load();
      try {
        return await idb.load();
      } catch {
        mem = memoryStore();
        return mem.load();
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
