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
    expect((await s.load(NOW, BUILD)).settings.boxSizeCm).toBe(24);
    await s.save(withBox(28));
    const s2 = await openStore();
    expect((await s2.load(NOW, BUILD)).settings.boxSizeCm).toBe(28);
  });

  it("falls back to memory store when indexedDB is missing", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const s = await openStore();
    expect(s.persistent).toBe(false);
    await s.save(withBox(20));
    expect((await s.load(NOW, BUILD)).settings.boxSizeCm).toBe(20);
  });

  it("falls back to memory store when indexedDB.open throws", async () => {
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("blocked"); } });
    const s = await openStore();
    expect(s.persistent).toBe(false);
    expect((await s.load(NOW, BUILD)).settings.boxSizeCm).toBe(24);
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
    await expect(s.save(withBox(30))).resolves.toBeUndefined();
    expect(s.persistent).toBe(false);
    expect((await s.load(NOW, BUILD)).settings.boxSizeCm).toBe(30);
    vi.restoreAllMocks();
  });
});
