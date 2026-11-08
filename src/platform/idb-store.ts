import { migrate, type Profile } from "../core/profile";
import type { Stored } from "./store";

const DB = "shadow-locks";
const STORE = "profile";
const KEY = "me";

export interface IdbStore {
  load(nowMs: number, build: string): Promise<Stored>;
  save(p: Profile, rev: number): Promise<number | null>;
}

/** The revision a stored record carries (a field beside the profile's own): a whole number, else 0. */
function revOf(v: unknown): number {
  const r = typeof v === "object" && v !== null ? (v as { rev?: unknown }).rev : undefined;
  return typeof r === "number" && Number.isSafeInteger(r) && r >= 0 ? r : 0;
}

export function openIdbStore(factory: IDBFactory): Promise<IdbStore> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onerror = () => reject(req.error ?? new Error("indexeddb open failed"));
    req.onblocked = () => reject(new Error("indexeddb open blocked"));
    req.onsuccess = () => {
      const db = req.result;
      resolve({
        load: (nowMs, build) =>
          new Promise<Stored>((res, rej) => {
            try {
              const r = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
              // Nothing stored yet (undefined) starts a new profile, like any value that is not one.
              r.onsuccess = () => res({ profile: migrate(r.result, nowMs, build), rev: revOf(r.result) });
              r.onerror = () => rej(r.error);
            } catch (e) {
              rej(e);
            }
          }),
        save: (p, rev) =>
          new Promise<number | null>((res, rej) => {
            try {
              // The look and the write in one transaction: IndexedDB runs the windows' write transactions one at a
              // time, so no other window's write can come between them.
              const tx = db.transaction(STORE, "readwrite");
              const os = tx.objectStore(STORE);
              let wrote: number | null = null;
              const r = os.get(KEY);
              r.onsuccess = () => {
                const at = revOf(r.result);
                if (at !== rev) return;
                wrote = at + 1;
                os.put({ ...(JSON.parse(JSON.stringify(p)) as Profile), rev: wrote }, KEY);
              };
              tx.oncomplete = () => res(wrote);
              tx.onerror = () => rej(tx.error);
              tx.onabort = () => rej(tx.error ?? new Error("indexeddb write aborted"));
            } catch (e) {
              rej(e);
            }
          }),
      });
    };
  });
}
