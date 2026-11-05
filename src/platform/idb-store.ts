import { defaultProfile, migrate, type Profile } from "../core/profile";

const DB = "shadow-locks";
const STORE = "profile";
const KEY = "me";

export interface IdbStore {
  load(): Promise<Profile>;
  save(p: Profile): Promise<void>;
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
        load: () =>
          new Promise<Profile>((res, rej) => {
            try {
              const r = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
              r.onsuccess = () => res(r.result === undefined ? defaultProfile() : migrate(r.result));
              r.onerror = () => rej(r.error);
            } catch (e) {
              rej(e);
            }
          }),
        save: (p) =>
          new Promise<void>((res, rej) => {
            try {
              const tx = db.transaction(STORE, "readwrite");
              tx.objectStore(STORE).put(JSON.parse(JSON.stringify(p)), KEY);
              tx.oncomplete = () => res();
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
