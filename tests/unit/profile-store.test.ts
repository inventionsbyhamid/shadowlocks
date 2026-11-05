import { afterEach, describe, expect, it, vi } from "vitest";
import { NOT_SAVED_NOTICE, ProfileStore } from "../../src/app/profile-store";
import { type BoxSnapshot, defaultProfile, type Profile } from "../../src/core/profile";
import type { Store } from "../../src/platform/store";

afterEach(() => vi.restoreAllMocks());

class FakeStore implements Store {
  persistent = true;
  saves: Profile[] = [];
  gate: Promise<void> | null = null;
  failSave = false;
  constructor(private initial: Profile = defaultProfile()) {}
  async load() {
    return JSON.parse(JSON.stringify(this.initial)) as Profile;
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
    const p = defaultProfile();
    p.settings.boxSizeCm = 28;
    const ps = await ProfileStore.open(new FakeStore(p), () => {});
    expect(ps.profile.settings.boxSizeCm).toBe(28);
  });

  it("shows one notice when storage is not persistent from the start", async () => {
    const store = new FakeStore();
    store.persistent = false;
    const n = notices();
    const ps = await ProfileStore.open(store, n.emit);
    await ps.save();
    await ps.save();
    expect(n.out).toEqual([NOT_SAVED_NOTICE]);
    expect(NOT_SAVED_NOTICE).toBe("Progress will not be saved on this device.");
  });

  it("shows the notice once when storage fails after a save", async () => {
    const store = new FakeStore();
    const n = notices();
    const ps = await ProfileStore.open(store, n.emit);
    await ps.save();
    expect(n.out).toEqual([]);
    store.persistent = false;
    await ps.save();
    await ps.save();
    expect(n.out).toEqual([NOT_SAVED_NOTICE]);
  });

  it("keeps the notice pending for the headset until it is marked shown", async () => {
    const ok = await ProfileStore.open(new FakeStore(), () => {});
    expect(ok.pendingNotice).toBeNull();
    const store = new FakeStore();
    store.persistent = false;
    const ps = await ProfileStore.open(store, () => {});
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
    const ps = await ProfileStore.open(store, () => {});
    store.persistent = false;
    expect(ps.pendingNotice).toBeNull();
    await ps.save();
    expect(ps.pendingNotice).toBe(NOT_SAVED_NOTICE);
  });

  it("writes and clears the box in progress", async () => {
    const store = new FakeStore();
    const ps = await ProfileStore.open(store, () => {});
    const snap: BoxSnapshot = { key: "box-3", lantern: [0.3, -0.3, 1.3], open: [1], crystal: [], elapsedMs: 4200, hints: 1, hintLevel: { 0: 1 } };
    await ps.setInProgress(snap);
    expect(store.saves.at(-1)?.inProgress).toEqual(snap);
    await ps.setInProgress(null);
    expect(store.saves.at(-1)?.inProgress).toBeNull();
  });

  it("never overlaps writes and always ends with the latest profile", async () => {
    const store = new FakeStore();
    const ps = await ProfileStore.open(store, () => {});
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
    expect(store.saves.map((p) => p.settings.musicVol)).toEqual([0.1, 0.3]);
  });

  it("survives a failing write", async () => {
    const store = new FakeStore();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ps = await ProfileStore.open(store, () => {});
    store.failSave = true;
    await expect(ps.save()).resolves.toBeUndefined();
  });
});
