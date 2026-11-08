// Two windows over one IndexedDB (the hosted link open in two tabs; fake-indexeddb keeps IndexedDB's own rules: one
// database, write transactions one at a time). A window never writes over a newer profile from another: a stale one's
// write is refused and it takes the stored profile instead (app/profile-store.ts), so a tab left behind can never roll
// back the progress made in another. A window that only opened changes nothing for the other, and one window alone
// (the store and Competition apps) behaves as before.
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lifecycle, type LifecycleSession } from "../../src/app/lifecycle";
import { ProfileStore, slotMoved } from "../../src/app/profile-store";
import { SettingsStore } from "../../src/app/settings";
import { type BoxSnapshot, migrate, type Profile } from "../../src/core/profile";
import { openStore } from "../../src/platform/store";

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const BUILD = "1.0.0";
const env = { now: () => NOW, build: BUILD };

const snap = (n: number, open: number[] = []): BoxSnapshot => ({
  key: `shadow-locks/${n}`,
  gen: 4,
  mirrored: false,
  lantern: [0.3, -0.3, 1.3],
  open,
  crystal: [],
  elapsedMs: 60_000,
  hints: 1,
  hintLevel: { 0: 1 },
});

/** A window opening the game: its own store over the shared IndexedDB, its open write done. */
async function openWindow(): Promise<ProfileStore> {
  const ps = await ProfileStore.open(await openStore(), () => {}, env);
  await ps.save();
  return ps;
}

/** What is stored now, as a third window would read it. */
async function stored(): Promise<Profile> {
  return (await (await openStore()).load(NOW, BUILD)).profile;
}

/** Window B plays on: boxes 3 to 6 solved, both lessons done, a streak, box 7 under way. */
function playOn(p: Profile): void {
  p.nextBox = 7;
  for (const n of [3, 4, 5, 6]) p.collection.push({ key: `shadow-locks/${n}`, owner: "a clockmaker", loot: "a key", shapes: ["Key"], atMs: NOW, timeMs: 60_000, hints: 0 });
  p.lessons = { l1: true, l2: true, step: null };
  p.tipsSeen.push("decoys");
  p.daily = { streak: 3, best: 3, lastDay: "2026-11-08", current: null };
  p.current = snap(7, [1]);
}

const progress = (p: Profile) => ({
  nextBox: p.nextBox,
  current: p.current,
  collection: p.collection.map((c) => c.key),
  lessons: p.lessons,
  tipsSeen: p.tipsSeen,
  daily: p.daily,
});

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("two windows over one store", () => {
  it("the old tab's last save as it closes (pagehide) does not roll back the progress made in the new tab", async () => {
    // Tab A: box 3 in play, saved as the page was hidden.
    const a = await openWindow();
    let writing: Promise<void> = Promise.resolve();
    const life = new Lifecycle({ persist: (s) => (writing = a.setCurrent(s)) });
    let box = snap(3, [0]);
    const session: LifecycleSession = { phase: "playing", pause: () => {}, resume: () => {}, snapshot: () => box };
    life.setXrVisibility("visible", 0);
    life.attach(session, 0);
    life.setDocumentHidden(true, 1);
    await writing;
    // Tab B opens later (or a restored tab) and plays on.
    const b = await openWindow();
    expect(b.profile.current).toEqual(snap(3, [0]));
    playOn(b.profile);
    await b.save();
    const made = progress(await stored());
    expect(made.nextBox).toBe(7);
    // Tab A is closed: its pagehide saves its box once more (shell.ts: lifecycle.flush(now, true)).
    const seen: Profile[] = [];
    a.onAdopt((before) => seen.push(before));
    box = { ...box, elapsedMs: box.elapsedMs + 5 };
    life.flush(2, true);
    await writing;
    expect(progress(await stored())).toEqual(made);
    // Tab A took B's profile in place of its own (the same object), and heard what it had before.
    expect(progress(a.profile)).toEqual(made);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.current).toEqual(snap(3, [0]));
    expect(slotMoved(seen[0]!, a.profile, "box")).toBe(true);
    // Saving again from A now goes on top of B's, keeping it.
    await a.save();
    expect(progress(await stored())).toEqual(made);
  });

  it("a settings change in the old tab does not roll back the new tab's progress either", async () => {
    const a = await openWindow();
    const settingsA = new SettingsStore(a);
    const b = await openWindow();
    playOn(b.profile);
    b.profile.settings = { ...b.profile.settings, boxSizeCm: 28 };
    await b.save();
    const made = await stored();
    // The shell's wiring: the settings follow a profile taken from another window.
    const told: number[] = [];
    settingsA.subscribe((s) => told.push(s.boxSizeCm));
    a.onAdopt(() => settingsA.changed());
    await settingsA.set({ musicVol: 0.2 });
    const now = await stored();
    expect(progress(now)).toEqual(progress(made));
    // The old tab's change is refused with its write: the tab now shows the stored settings, B's.
    expect(now.settings).toEqual(made.settings);
    expect(a.profile.settings).toEqual(made.settings);
    expect(told).toEqual([24, 28]);
    // Changed again, now on top of B's profile, it is kept.
    await settingsA.set({ musicVol: 0.2 });
    expect(await stored()).toMatchObject({ nextBox: 7, settings: { boxSizeCm: 28, musicVol: 0.2 } });
  });

  it("seen again, the old tab takes the profile the new tab played on, and plays on on top of it", async () => {
    const a = await openWindow();
    const b = await openWindow();
    playOn(b.profile);
    await b.save();
    const seen: Profile[] = [];
    a.onAdopt((before) => seen.push(before));
    await a.refresh();
    expect(progress(a.profile)).toEqual(progress(await stored()));
    expect(seen).toHaveLength(1);
    // A second look finds nothing new.
    await a.refresh();
    expect(seen).toHaveLength(1);
    a.profile.tipsSeen.push("hidden");
    await a.save();
    expect(await stored()).toMatchObject({ nextBox: 7, tipsSeen: ["decoys", "hidden"], current: snap(7, [1]) });
  });

  it("a tab that only opened (and closed) changes nothing for the other: its next save goes through, nothing dropped", async () => {
    const a = await openWindow();
    a.profile.nextBox = 3;
    await a.save();
    const b = await openWindow();
    expect(b.profile.nextBox).toBe(3);
    const seen: Profile[] = [];
    a.onAdopt((before) => seen.push(before));
    a.profile.nextBox = 4;
    a.profile.current = snap(4);
    await a.save();
    expect(seen).toEqual([]);
    expect(await stored()).toMatchObject({ nextBox: 4, current: snap(4) });
    await a.refresh();
    expect(seen).toEqual([]);
    expect(a.profile.nextBox).toBe(4);
  });

  it("two tabs saving at the same moment: one write goes through, the other tab takes it", async () => {
    const a = await openWindow();
    const b = await openWindow();
    // B's open write came after A's: A first moves on to it (B only opened).
    await a.refresh();
    a.profile.nextBox = 5;
    b.profile.nextBox = 9;
    await Promise.all([a.save(), b.save()]);
    const now = await stored();
    expect([5, 9]).toContain(now.nextBox);
    expect(a.profile.nextBox).toBe(now.nextBox);
    expect(b.profile.nextBox).toBe(now.nextBox);
  });

  it("one window alone (the installed apps) never takes anything: every save goes through, a look finds nothing", async () => {
    const a = await openWindow();
    const seen: Profile[] = [];
    a.onAdopt((before) => seen.push(before));
    const settings = new SettingsStore(a);
    for (let n = 2; n < 6; n++) {
      a.profile.nextBox = n;
      await a.setCurrent(snap(n));
      await settings.set({ boxSizeCm: 18 + n });
      await a.refresh();
    }
    expect(seen).toEqual([]);
    expect(await stored()).toMatchObject({ nextBox: 5, current: snap(5), settings: { boxSizeCm: 23 } });
  });
});

describe("which save in the lap another window moved", () => {
  const base = (): Profile => {
    const p = migrate({ version: 1 }, NOW, BUILD);
    p.current = snap(3, [0]);
    p.daily.current = { ...snap(1), key: "shadow-locks/daily/2026-11-08" };
    p.lessons = { l1: true, l2: false, step: { id: "l2", index: 1 } };
    return p;
  };

  it("compares only the lap's own save", () => {
    const before = base();
    const after = base();
    after.nextBox = 9;
    after.settings.boxSizeCm = 30;
    for (const slot of ["box", "daily", "lesson"] as const) expect(slotMoved(before, after, slot), slot).toBe(false);
    after.current = snap(3, [0, 1]);
    expect(slotMoved(before, after, "box")).toBe(true);
    expect(slotMoved(before, after, "daily")).toBe(false);
    after.daily.current = null;
    expect(slotMoved(before, after, "daily")).toBe(true);
    after.lessons = { ...after.lessons, step: { id: "l2", index: 2 } };
    expect(slotMoved(before, after, "lesson")).toBe(true);
  });
});
