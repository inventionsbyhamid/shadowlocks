// Two windows over one IndexedDB (the hosted link open in two tabs; fake-indexeddb keeps IndexedDB's own rules: one
// database, write transactions one at a time). A window never writes over a newer profile from another: a stale one's
// write is refused and it takes the stored profile instead (app/profile-store.ts), so a tab left behind can never roll
// back the progress made in another, a replay's kept box included. A window that only opened changes nothing for the
// other, and one window alone (the store and Competition apps) behaves as before. The clock moves on between every
// look at it, as a real one does between two windows' opens and writes, so every write carries its own time seen.
import type { World } from "@iwsdk/core";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LessonView } from "../../src/app/lesson-view";
import { Lessons, type LessonsDeps } from "../../src/app/lessons";
import { Lifecycle, type LifecycleSession } from "../../src/app/lifecycle";
import { ProfileStore, slotMoved } from "../../src/app/profile-store";
import { currentScreen, go } from "../../src/app/screens";
import type { Stage } from "../../src/app/session-deps";
import { SettingsStore } from "../../src/app/settings";
import { type BoxSnapshot, migrate, type Profile } from "../../src/core/profile";
import type { Box, BoxSpec } from "../../src/core/types";
import { openStore } from "../../src/platform/store";
import type { BoxScene } from "../../src/render/box-scene";

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const BUILD = "1.0.0";
/** The wall clock: a second later at every look. */
let clock = NOW;
const env = { now: () => (clock += 1000), build: BUILD };

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

/**
 * Tab A's game under its lessons (lessons.test.ts's bench, on tab A's own profile store): the box session as the
 * lessons see it, and the game playing a box into it, which the lifecycle then saves where the shell does (shell.ts
 * persist: a numbered box to the box in progress; a lesson's box or a practice box nowhere).
 */
function tabWithLessons(ps: ProfileStore) {
  let writing: Promise<void> = Promise.resolve();
  const session = {
    stage: "idle" as Stage,
    spec: null as BoxSpec | null,
    box: null as Box | null,
    practice: false,
    revealed: true,
    elapsedMs: 60_000,
    isOpen: () => false,
    snapshot: (): BoxSnapshot => {
      const s = session.spec;
      return { ...snap(s?.kind === "box" ? s.n : 0, [0]), elapsedMs: session.elapsedMs };
    },
  };
  const life = new Lifecycle({
    persist: (s) => {
      if (session.spec?.kind === "box" && !session.practice) writing = ps.setCurrent(s);
    },
  });
  const lap: LifecycleSession = { phase: "playing", pause: () => {}, resume: () => {}, snapshot: () => session.snapshot() };
  let t = 1000;
  const plays: { spec: BoxSpec; snap: BoxSnapshot | null; practice: boolean }[] = [];
  const game = {
    play: (spec: BoxSpec, s: BoxSnapshot | null = null, practice = false) => {
      plays.push({ spec, snap: s, practice });
      session.spec = spec;
      session.practice = practice;
      session.stage = "playing";
      if (s) session.elapsedMs = s.elapsedMs;
      session.box = { key: spec.kind === "box" ? `shadow-locks/${spec.n}` : `lesson ${JSON.stringify(spec)}`, spec, locks: [], elements: [] } as unknown as Box;
      life.attach(lap, t);
      go("play");
    },
  };
  const deps = {
    world: {} as World,
    scene: {} as BoxScene,
    profiles: ps,
    settings: new SettingsStore(ps),
    lantern: { grab: { holder: null, brightness: 0 }, feel: { aligned: () => false }, ctrl: { pos: [0.3, -0.3, 1.3] } },
    hands: { n: 0 },
    sound: { game: { lessonStep: () => {}, settle: () => {}, crystallise: () => {} } },
    play: { game, session, view: { coachLine: null } },
    presenting: () => true,
    autoStart: () => false,
    view: { update: () => {} } as unknown as LessonView,
  } as unknown as LessonsDeps;
  const lessons = new Lessons(deps);
  life.setXrVisibility("visible", 0);
  return {
    lessons,
    game,
    plays,
    /** `ms` of frames: the lessons' and the lifecycle's (its due saves). */
    run(ms: number) {
      for (const end = t + ms; t < end; ) {
        lessons.update((t += 16));
        life.tick(t);
      }
    },
    /** The page hidden: the lifecycle saves the lap at once, as when the player leaves the tab. */
    async hide() {
      life.setDocumentHidden(true, t);
      await writing;
    },
    async show() {
      life.setDocumentHidden(false, t);
      await ps.refresh();
    },
    /** The writes the lifecycle started, done. */
    written: () => writing,
  };
}

beforeEach(() => {
  clock = NOW;
  vi.stubGlobal("indexedDB", new IDBFactory());
});
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
    // The shell's wiring (shell.ts adopted): the settings follow a profile taken from another window.
    const told: number[] = [];
    settingsA.subscribe((s) => told.push(s.boxSizeCm));
    a.onAdopt((_before, held) => settingsA.replaced(held.settings));
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

  it("a settings change refused in the old tab is undone on screen, where the new tab left the settings as they were", async () => {
    const a = await openWindow();
    const settingsA = new SettingsStore(a);
    a.onAdopt((_before, held) => settingsA.replaced(held.settings));
    // What tab A draws (the box at its size, mirrored for its hand), as the settings' subscribers set it.
    const drawn = { boxSizeCm: settingsA.get().boxSizeCm, handed: settingsA.get().handed };
    let told = 0;
    settingsA.subscribe((s) => {
      told++;
      drawn.boxSizeCm = s.boxSizeCm;
      drawn.handed = s.handed;
    });
    // B plays on and leaves the settings alone.
    const b = await openWindow();
    playOn(b.profile);
    await b.save();
    // A, not looked again yet, changes the box size and the hand: drawn at once, then its save is refused.
    await settingsA.set({ boxSizeCm: 28, handed: "left" });
    const now = await stored();
    expect(now).toMatchObject({ nextBox: 7, settings: { boxSizeCm: 24, handed: "right" } });
    // A shows the stored settings again: the profile, and what it draws.
    expect(a.profile.settings).toEqual(now.settings);
    expect(drawn).toEqual({ boxSizeCm: 24, handed: "right" });
    expect(told).toBe(2);
    // A later profile taken with the settings A shows already tells nobody (the hand would rebuild the box for nothing).
    b.profile.nextBox = 8;
    await b.save();
    await a.refresh();
    expect(a.profile.nextBox).toBe(8);
    expect(told).toBe(2);
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
    const seenByA = (await stored()).lastSeenMs;
    const b = await openWindow();
    expect(b.profile.nextBox).toBe(3);
    // B's open wrote a later time seen, and nothing else.
    const opened = await stored();
    expect(opened.lastSeenMs).toBeGreaterThan(seenByA);
    expect({ ...opened, lastSeenMs: 0 }).toEqual({ ...a.profile, lastSeenMs: 0 });
    const seen: Profile[] = [];
    a.onAdopt((before) => seen.push(before));
    a.profile.nextBox = 4;
    a.profile.current = snap(4);
    await a.save();
    expect(seen).toEqual([]);
    expect(await stored()).toMatchObject({ nextBox: 4, current: snap(4) });
    // The time seen never moves back.
    expect((await stored()).lastSeenMs).toBeGreaterThan(opened.lastSeenMs);
    await a.refresh();
    expect(seen).toEqual([]);
    expect(a.profile.nextBox).toBe(4);
    // B opened and closed again meanwhile: the same.
    await openWindow();
    a.profile.nextBox = 5;
    await a.save();
    await a.refresh();
    expect(seen).toEqual([]);
    expect(await stored()).toMatchObject({ nextBox: 5 });
  });

  // The review's case (task-29-review.md, M1): a replay keeps the box in play to put back as it ends, and the new tab
  // moved that box's save on meanwhile. As a control, the same with the new tab leaving it alone: the box comes back.
  for (const moved of [true, false]) {
    const did = moved ? "solves box 5 and starts box 6" : "changes a setting only";
    const then = moved ? "B's box 6 survives: nothing is put back, the replay ends on Home" : "box 5 comes back and is saved on top";
    it(`tab A replays an example over box 5, tab B ${did}, A finishes the replay: ${then}`, async () => {
      const a = await openWindow();
      const tab = tabWithLessons(a);
      // Box 5 in play in A, saved as the lifecycle does (1 s after a change).
      tab.game.play({ kind: "box", n: 5 });
      tab.run(1500);
      await tab.written();
      expect((await stored()).current).toEqual(snap(5, [0]));
      // An example from the Lessons menu: box 5 kept to put back, the example's lesson box (practice) in play.
      expect(tab.lessons.replay("move")).toBe(true);
      expect(tab.plays.at(-1)).toEqual({ spec: { kind: "lesson", id: "l1" }, snap: null, practice: true });
      tab.run(500);
      // The player leaves A for tab B (A hidden mid-replay: nothing of box 5 is saved, the lesson box saves nowhere).
      await tab.hide();
      const b = await openWindow();
      expect(b.profile.current).toEqual(snap(5, [0]));
      if (moved) {
        b.profile.collection.push({ key: "shadow-locks/5", owner: "a clockmaker", loot: "a key", shapes: ["Key"], atMs: NOW, timeMs: 90_000, hints: 0 });
        b.profile.nextBox = 6;
        b.profile.current = snap(6, [1]);
      } else b.profile.settings = { ...b.profile.settings, musicVol: 0.3 };
      await b.save();
      const made = progress(await stored());
      // Back in A: seen again, it takes B's profile; the replay plays on (the lessons did not move) to its end.
      await tab.show();
      expect(progress(a.profile)).toEqual(made);
      expect(tab.lessons.running).toBe(true);
      tab.run(40_000);
      expect([tab.lessons.running, tab.lessons.director.replaying]).toEqual([false, null]);
      await tab.written();
      // A is closed (its pagehide saves what is in play).
      await tab.hide();
      const now = await stored();
      if (moved) {
        expect(tab.plays.filter((p) => p.spec.kind === "box")).toHaveLength(1);
        expect(currentScreen()).toBe("home");
        expect(progress(now)).toEqual(made);
        expect(now).toMatchObject({ nextBox: 6, current: snap(6, [1]) });
        expect(now.collection.map((c) => c.key)).toContain("shadow-locks/5");
      } else {
        expect(tab.plays.at(-1)).toEqual({ spec: { kind: "box", n: 5 }, snap: snap(5, [0]), practice: false });
        expect(currentScreen()).toBe("play");
        expect(now).toMatchObject({ nextBox: 1, current: snap(5, [0]), settings: { musicVol: 0.3 } });
      }
    });
  }

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
