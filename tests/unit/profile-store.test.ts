import { afterEach, describe, expect, it, vi } from "vitest";
import { NOT_SAVED_NOTICE, ProfileStore } from "../../src/app/profile-store";
import { type BoxSnapshot, newProfile, type Profile } from "../../src/core/profile";
import type { Store } from "../../src/platform/store";

afterEach(() => vi.restoreAllMocks());

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const ENV = { now: () => NOW, build: "1.0.0" };

class FakeStore implements Store {
  persistent = true;
  saves: Profile[] = [];
  gate: Promise<void> | null = null;
  failSave = false;
  constructor(private initial: Profile | null = null) {}
  async load(nowMs: number, build: string) {
    return this.initial ? (JSON.parse(JSON.stringify(this.initial)) as Profile) : newProfile(nowMs, build);
  }
  async save(p: Profile) {
    if (this.gate) await this.gate;
    if (this.failSave) throw new Error("disk full");
    this.saves.push(JSON.parse(JSON.stringify(p)));
  }
}

const notices = () => {
  const out: string[] = [];
  return { out, emit: (e: { type: string; text?: string }) => e.type === "notice" && out.push(e.text ?? "") };
};

describe("profile store", () => {
  it("loads the profile from the store", async () => {
    const p = newProfile(NOW, "1.0.0");
    p.settings.boxSizeCm = 28;
    const ps = await ProfileStore.open(new FakeStore(p), () => {}, ENV);
    expect(ps.profile.settings.boxSizeCm).toBe(28);
  });

  it("shows one notice when storage is not persistent from the start", async () => {
    const store = new FakeStore();
    store.persistent = false;
    const n = notices();
    const ps = await ProfileStore.open(store, n.emit, ENV);
    await ps.save();
    await ps.save();
    expect(n.out).toEqual([NOT_SAVED_NOTICE]);
    expect(NOT_SAVED_NOTICE).toBe("Progress will not be saved on this device.");
  });

  it("shows the notice once when storage fails after a save", async () => {
    const store = new FakeStore();
    const n = notices();
    const ps = await ProfileStore.open(store, n.emit, ENV);
    await ps.save();
    expect(n.out).toEqual([]);
    store.persistent = false;
    await ps.save();
    await ps.save();
    expect(n.out).toEqual([NOT_SAVED_NOTICE]);
  });

  it("keeps the notice pending for the headset until it is marked shown", async () => {
    const ok = await ProfileStore.open(new FakeStore(), () => {}, ENV);
    expect(ok.pendingNotice).toBeNull();
    const store = new FakeStore();
    store.persistent = false;
    const ps = await ProfileStore.open(store, () => {}, ENV);
    expect(ps.persistent).toBe(false);
    expect(ps.pendingNotice).toBe(NOT_SAVED_NOTICE);
    await ps.save();
    expect(ps.pendingNotice).toBe(NOT_SAVED_NOTICE);
    ps.markNoticeShown();
    expect(ps.pendingNotice).toBeNull();
    await ps.save();
    expect(ps.pendingNotice).toBeNull();
  });

  it("raises the pending notice when storage fails after a save", async () => {
    const store = new FakeStore();
    const ps = await ProfileStore.open(store, () => {}, ENV);
    store.persistent = false;
    expect(ps.pendingNotice).toBeNull();
    await ps.save();
    expect(ps.pendingNotice).toBe(NOT_SAVED_NOTICE);
  });

  it("writes and clears the numbered box in progress", async () => {
    const store = new FakeStore();
    const ps = await ProfileStore.open(store, () => {}, ENV);
    const snap: BoxSnapshot = { key: "box-3", lantern: [0.3, -0.3, 1.3], open: [1], crystal: [], elapsedMs: 4200, hints: 1, hintLevel: { 0: 1 } };
    await ps.setCurrent(snap);
    expect(store.saves.at(-1)?.current).toEqual(snap);
    await ps.setCurrent(null);
    expect(store.saves.at(-1)?.current).toBeNull();
  });

  it("writes the profile at open: the first-launch marker and the latest time seen", async () => {
    const store = new FakeStore();
    let t = NOW;
    const ps = await ProfileStore.open(store, () => {}, { now: () => t, build: "1.0.0" });
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0]).toMatchObject({ firstLaunch: { atMs: NOW, build: "1.0.0" }, lastSeenMs: NOW });
    t = NOW + 5000;
    await ps.save();
    expect(store.saves.at(-1)?.lastSeenMs).toBe(NOW + 5000);
    t = NOW - 86_400_000;
    await ps.save();
    expect(store.saves.at(-1)?.lastSeenMs).toBe(NOW + 5000);
    expect(store.saves.at(-1)?.firstLaunch).toEqual({ atMs: NOW, build: "1.0.0" });
  });

  it("never overlaps writes and always ends with the latest profile", async () => {
    const store = new FakeStore();
    const ps = await ProfileStore.open(store, () => {}, ENV);
    await ps.save();
    const before = store.saves.length;
    let open!: () => void;
    store.gate = new Promise<void>((r) => (open = r));
    ps.profile.settings.musicVol = 0.1;
    const a = ps.save();
    ps.profile.settings.musicVol = 0.2;
    const b = ps.save();
    ps.profile.settings.musicVol = 0.3;
    const c = ps.save();
    open();
    await Promise.all([a, b, c]);
    expect(store.saves.slice(before).map((p) => p.settings.musicVol)).toEqual([0.1, 0.3]);
  });

  it("survives a failing write", async () => {
    const store = new FakeStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ps = await ProfileStore.open(store, () => {}, ENV);
    store.failSave = true;
    await expect(ps.save()).resolves.toBeUndefined();
  });
});
