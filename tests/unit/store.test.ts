import { describe, it, expect, afterEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { openStore } from "../../src/platform/store";
import { newProfile, type Profile } from "../../src/core/profile";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const BUILD = "1.0.0";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A profile told apart by its box size. */
function withBox(cm: number): Profile {
  const p = newProfile(NOW, BUILD);
  p.settings.boxSizeCm = cm;
  return p;
}

describe("store", () => {
  it("round trips through IndexedDB", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const s = await openStore();
    expect(s.persistent).toBe(true);
    expect(await s.load(NOW, BUILD)).toMatchObject({ profile: { settings: { boxSizeCm: 24 } }, rev: 0 });
    expect(await s.save(withBox(28), 0)).toBe(1);
    const s2 = await openStore();
    expect(await s2.load(NOW, BUILD)).toMatchObject({ profile: { settings: { boxSizeCm: 28 } }, rev: 1 });
  });

  it("writes only on top of the revision it names: another window's newer write is never written over", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    // Two windows over one IndexedDB.
    const a = await openStore(), b = await openStore();
    expect(await a.save(withBox(20), 0)).toBe(1);
    expect(await b.save(withBox(22), 1)).toBe(2);
    // Window a still names revision 1: nothing is written.
    expect(await a.save(withBox(30), 1)).toBeNull();
    expect(await a.load(NOW, BUILD)).toMatchObject({ profile: { settings: { boxSizeCm: 22 } }, rev: 2 });
    expect(await a.save(withBox(30), 2)).toBe(3);
    expect((await b.load(NOW, BUILD)).profile.settings.boxSizeCm).toBe(30);
  });

  it("reads a save from before revisions as revision 0, and keeps the revision out of the profile", async () => {
    const fake = new IDBFactory();
    vi.stubGlobal("indexedDB", fake);
    const s = await openStore();
    await s.load(NOW, BUILD);
    // An older build's write: the profile alone.
    const db = await new Promise<IDBDatabase>((res) => {
      const r = fake.open("shadow-locks", 1);
      r.onsuccess = () => res(r.result);
    });
    await new Promise<void>((res) => {
      const tx = db.transaction("profile", "readwrite");
      tx.objectStore("profile").put(withBox(26), "me");
      tx.oncomplete = () => res();
    });
    const back = await s.load(NOW, BUILD);
    expect(back.rev).toBe(0);
    expect(back.profile.settings.boxSizeCm).toBe(26);
    expect("rev" in back.profile).toBe(false);
    expect(await s.save(withBox(27), 0)).toBe(1);
  });

  it("falls back to memory store when indexedDB is missing", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const s = await openStore();
    expect(s.persistent).toBe(false);
    expect(await s.save(withBox(20), 0)).toBe(1);
    expect(await s.load(NOW, BUILD)).toMatchObject({ profile: { settings: { boxSizeCm: 20 } }, rev: 1 });
  });

  it("falls back to memory store when indexedDB.open throws", async () => {
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("blocked"); } });
    const s = await openStore();
    expect(s.persistent).toBe(false);
    expect((await s.load(NOW, BUILD)).profile.settings.boxSizeCm).toBe(24);
  });

  it("falls back when a later save fails and keeps the profile", async () => {
    const fake = new IDBFactory();
    vi.stubGlobal("indexedDB", fake);
    const s = await openStore();
    const db = await new Promise<IDBDatabase>((res) => {
      const r = fake.open("shadow-locks", 1);
      r.onsuccess = () => res(r.result);
    });
    vi.spyOn(Object.getPrototypeOf(db), "transaction").mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(s.save(withBox(30), 0)).resolves.toBe(1);
    expect(s.persistent).toBe(false);
    expect(await s.load(NOW, BUILD)).toMatchObject({ profile: { settings: { boxSizeCm: 30 } }, rev: 1 });
    expect(await s.save(withBox(29), 1)).toBe(2);
    vi.restoreAllMocks();
  });

  it("a read that fails after the first rejects (the window keeps what it has) instead of starting a new profile", async () => {
    const fake = new IDBFactory();
    vi.stubGlobal("indexedDB", fake);
    const s = await openStore();
    expect(await s.save(withBox(28), (await s.load(NOW, BUILD)).rev)).toBe(1);
    const db = await new Promise<IDBDatabase>((res) => {
      const r = fake.open("shadow-locks", 1);
      r.onsuccess = () => res(r.result);
    });
    vi.spyOn(Object.getPrototypeOf(db), "transaction").mockImplementation(() => {
      throw new Error("gone");
    });
    await expect(s.load(NOW, BUILD)).rejects.toThrow("gone");
    expect(s.persistent).toBe(true);
    vi.restoreAllMocks();
    expect((await s.load(NOW, BUILD)).profile.settings.boxSizeCm).toBe(28);
  });
});
