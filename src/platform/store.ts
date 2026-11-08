import { migrate, newProfile, type Profile } from "../core/profile";
import { openIdbStore, type IdbStore } from "./idb-store";

/**
 * A stored profile and its revision. Every write stores the next revision; 0 is nothing stored yet (a save from before
 * revisions counts as 0 too).
 */
export interface Stored {
  profile: Profile;
  rev: number;
}

/**
 * Where the profile lives. IndexedDB is shared by every window of the site (the hosted link open in two tabs), so a
 * write names the revision it was made on and goes through only while that is still the one stored: no window ever
 * writes over a newer profile another wrote (app/profile-store.ts decides what a window does then).
 */
export interface Store {
  /** The stored profile, migrated as of `nowMs` on `build` (see core/profile), and its revision. */
  load(nowMs: number, build: string): Promise<Stored>;
  /**
   * Write `p` as the next revision if the stored one is still `rev`: resolves the revision written, or null when another
   * window has written since (and nothing is written).
   */
  save(p: Profile, rev: number): Promise<number | null>;
  readonly persistent: boolean;
}

const copy = (p: Profile): Profile => JSON.parse(JSON.stringify(p)) as Profile;

/** Memory only, this window's alone: `initial`, else nothing stored. */
function memoryStore(initial: Stored | null = null): Store {
  let held: Profile | null = initial ? copy(initial.profile) : null;
  let rev = initial?.rev ?? 0;
  return {
    persistent: false,
    load: async (nowMs, build) => ({ profile: held ? migrate(copy(held), nowMs, build) : newProfile(nowMs, build), rev }),
    save: async (p, at) => {
      if (at !== rev) return null;
      held = copy(p);
      return ++rev;
    },
  };
}

/**
 * IndexedDB when it works; else (now, or after any later failed write) memory only, keeping the latest profile. Only
 * the first read falls back to memory: a later one that fails (the page seen again) rejects, and the window keeps
 * what it has.
 */
export async function openStore(): Promise<Store> {
  let idb: IdbStore;
  try {
    if (typeof indexedDB === "undefined") return memoryStore();
    idb = await openIdbStore(indexedDB);
  } catch {
    return memoryStore();
  }
  let mem: Store | null = null;
  let read = false;
  return {
    get persistent() {
      return mem === null;
    },
    load: async (nowMs, build) => {
      if (mem) return mem.load(nowMs, build);
      try {
        const s = await idb.load(nowMs, build);
        read = true;
        return s;
      } catch (err) {
        if (read) throw err;
        mem = memoryStore();
        return mem.load(nowMs, build);
      }
    },
    save: async (p, rev) => {
      if (mem) return mem.save(p, rev);
      try {
        return await idb.save(p, rev);
      } catch {
        mem = memoryStore({ profile: p, rev: rev + 1 });
        return rev + 1;
      }
    },
  };
}
