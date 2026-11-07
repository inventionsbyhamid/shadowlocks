import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeedbackEvent } from "../../src/app/bus";
import { NOT_SAVED_NOTICE, ProfileStore } from "../../src/app/profile-store";
import { type BoxSnapshot, type CollectionItem, isSnapshot, migrate, newProfile, type Profile, withProgressReset } from "../../src/core/profile";
import { openStore } from "../../src/platform/store";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const DAY = 86_400_000;
const BUILD = "1.0.0";
const clock = (t = NOW) => ({ now: () => t, build: BUILD });

const snap = (key = "shadow-locks/3"): BoxSnapshot => ({
  key,
  lantern: [0.35, -0.3, 1.35],
  open: [0, 2],
  crystal: [{ lock: 1, z: 0.45 }],
  elapsedMs: 61_000,
  hints: 2,
  hintLevel: { 1: 2 },
});

const item = (): CollectionItem => ({
  key: "shadow-locks/2",
  owner: "a lighthouse keeper",
  loot: "a brass compass",
  shapes: ["Key", "Moon"],
  atMs: NOW - DAY,
  timeMs: 95_000,
  hints: 1,
});

/** A profile with every field away from its default. */
function played(): Profile {
  const p = newProfile(NOW - 3 * DAY, "0.9.0");
  p.lastSeenMs = NOW - DAY;
  p.nextBox = 6;
  p.current = snap("shadow-locks/6");
  p.lessons = { l1: true, l2: false, step: { id: "l2", index: 1 } };
  p.tipsSeen = ["decoys", "drawer"];
  p.collection = [item()];
  p.daily = { streak: 2, best: 4, lastDay: "2026-11-05", current: snap("shadow-locks/daily/2026-11-06") };
  p.settings = { ...p.settings, warmth: false, boxSizeCm: 28, handed: "left", musicVol: 0.4, language: "fr" };
  return p;
}

const notices = () => {
  const out: string[] = [];
  return {
    out,
    emit: (e: FeedbackEvent) => {
      if (e.type === "notice") out.push(e.text);
    },
  };
};

describe("profile", () => {
  it("a saved box keeps which way it was mirrored (a hand change resumes it the other way round)", () => {
    const s = { ...snap(), mirrored: true };
    expect(isSnapshot(s)).toBe(true);
    expect(isSnapshot({ ...snap(), mirrored: "yes" })).toBe(false);
    const p = { ...newProfile(NOW, BUILD), current: s };
    expect(migrate(JSON.parse(JSON.stringify(p)), NOW, BUILD).current).toEqual(s);
    // Older saves say nothing about it, and stay so.
    expect(migrate(JSON.parse(JSON.stringify({ ...p, current: snap() })), NOW, BUILD).current).not.toHaveProperty("mirrored");
  });

  it("newProfile defaults: box 1, nothing played, the first-launch marker and default settings", () => {
    expect(newProfile(NOW, BUILD)).toEqual({
      version: 1,
      firstLaunch: { atMs: NOW, build: BUILD },
      lastSeenMs: NOW,
      nextBox: 1,
      current: null,
      lessons: { l1: false, l2: false, step: null },
      tipsSeen: [],
      collection: [],
      daily: { streak: 0, best: 0, lastDay: null, current: null },
      settings: {
        warmth: true,
        boxSizeCm: 24,
        musicVol: 0.7,
        sfxVol: 0.9,
        reducedMotion: false,
        captions: true,
        dimming: true,
        handed: "right",
        language: "auto",
      },
    });
  });

  it("a save from before the Language setting keeps everything and follows the headset", () => {
    const p = played();
    const { language: _none, ...old } = p.settings;
    const raw = JSON.parse(JSON.stringify({ ...p, settings: old }));
    expect(migrate(raw, NOW, BUILD)).toEqual({ ...p, lastSeenMs: NOW, settings: { ...p.settings, language: "auto" } });
  });

  it("keeps a chosen language and drops one the game does not speak", () => {
    const lang = (language: unknown) => migrate({ version: 1, settings: { language } }, NOW, BUILD).settings.language;
    expect(lang("ja")).toBe("ja");
    expect(lang("pt-BR")).toBe("pt-BR");
    expect(lang("pt-br")).toBe("pt-BR");
    expect(lang("auto")).toBe("auto");
    expect(lang("it")).toBe("auto");
    expect(lang(7)).toBe("auto");
    expect(lang(null)).toBe("auto");
  });

  it("migrate of garbage returns a new profile", () => {
    for (const raw of [null, undefined, 3, "x", [], {}, { version: 2 }, { version: "1" }]) {
      expect(migrate(raw, NOW, BUILD)).toEqual(newProfile(NOW, BUILD));
    }
  });

  it("keeps every valid field, and the first launch's build after an update", () => {
    const p = played();
    const later = NOW + 2 * DAY;
    expect(migrate(JSON.parse(JSON.stringify(p)), later, "2.0.0")).toEqual({ ...p, lastSeenMs: later });
  });

  it("lastSeenMs is the latest time ever seen: a clock moved back never lowers it", () => {
    const p = played();
    expect(migrate(JSON.parse(JSON.stringify(p)), NOW - 3 * DAY, BUILD).lastSeenMs).toBe(NOW - DAY);
    expect(migrate({ ...p, lastSeenMs: "soon" }, NOW - 3 * DAY, BUILD).lastSeenMs).toBe(NOW - 3 * DAY);
    // Never earlier than the first launch either.
    expect(migrate({ ...p, lastSeenMs: 5 }, 0, BUILD).lastSeenMs).toBe(NOW - 3 * DAY);
  });

  it("a stored profile without a first-launch marker gets one now", () => {
    const { firstLaunch: _gone, ...rest } = played();
    expect(migrate(rest, NOW, BUILD).firstLaunch).toEqual({ atMs: NOW, build: BUILD });
    expect(migrate({ ...rest, firstLaunch: { atMs: -1, build: "1.0.0" } }, NOW, BUILD).firstLaunch).toEqual({ atMs: NOW, build: BUILD });
    expect(migrate({ ...rest, firstLaunch: { atMs: NOW - DAY, build: "" } }, NOW, BUILD).firstLaunch).toEqual({ atMs: NOW, build: BUILD });
  });

  it("defaults or drops each bad field on its own", () => {
    const p = played();
    const raw = {
      ...p,
      nextBox: 0,
      lessons: { l1: "yes", l2: true, step: { id: "l3", index: 0 } },
      tipsSeen: ["decoys", "secret", "decoys", 4, "hidden"],
      collection: [item(), { ...item(), key: "" }, { ...item(), hints: -1 }, { ...item(), shapes: ["Moon", "Dragon"] }, "junk"],
      daily: { streak: -2, best: 1.5, lastDay: "2026-11-5", current: { key: "x" } },
    };
    const m = migrate(raw, NOW, BUILD);
    expect(m.nextBox).toBe(1);
    expect(m.lessons).toEqual({ l1: false, l2: true, step: null });
    expect(m.tipsSeen).toEqual(["decoys", "hidden"]);
    expect(m.collection).toEqual([item(), { ...item(), shapes: ["Moon"] }]);
    expect(m.daily).toEqual({ streak: 0, best: 0, lastDay: null, current: null });
    expect(m.current).toEqual(p.current);
    expect(m.settings).toEqual(p.settings);
    expect(migrate({ ...p, nextBox: 7.5 }, NOW, BUILD).nextBox).toBe(1);
    expect(migrate({ ...p, lessons: { l1: true, l2: true, step: { id: "l1", index: 3 } } }, NOW, BUILD).lessons.step).toEqual({ id: "l1", index: 3 });
    // The best streak is never below the current one.
    expect(migrate({ ...p, daily: { ...p.daily, streak: 6, best: 4 } }, NOW, BUILD).daily.best).toBe(6);
  });

  it("clamps and defaults each setting", () => {
    const p = migrate({ version: 1, settings: { boxSizeCm: 99, musicVol: -2, sfxVol: "loud", captions: false, handed: "left" } }, NOW, BUILD);
    expect(p.settings.boxSizeCm).toBe(30);
    expect(p.settings.musicVol).toBe(0);
    expect(p.settings.sfxVol).toBe(0.9);
    expect(p.settings.captions).toBe(false);
    expect(p.settings.handed).toBe("left");
    const low = migrate({ version: 1, settings: { boxSizeCm: 2, handed: "both" } }, NOW, BUILD);
    expect(low.settings).toMatchObject({ boxSizeCm: 18, handed: "right" });
  });

  it("drops a saved box that is not the real shape (never half restored)", () => {
    expect(isSnapshot(snap())).toBe(true);
    const bad: unknown[] = [
      { ...snap(), key: "" },
      { ...snap(), lantern: [0, 0] },
      { ...snap(), lantern: [0, Number.NaN, 1] },
      { ...snap(), open: [-1] },
      { ...snap(), crystal: [{ lock: 0 }] },
      { ...snap(), elapsedMs: -5 },
      { ...snap(), hints: 1.5 },
      { ...snap(), hintLevel: { a: 1 } },
      { phase: "playing", index: 2 },
    ];
    for (const b of bad) {
      expect(isSnapshot(b), JSON.stringify(b)).toBe(false);
      const m = migrate({ version: 1, current: b, daily: { streak: 1, best: 1, lastDay: "2026-11-05", current: b } }, NOW, BUILD);
      expect(m.current).toBeNull();
      expect(m.daily.current).toBeNull();
    }
  });

  it("restores a saved box with only its own fields", () => {
    const m = migrate({ version: 1, current: { ...snap(), extra: "x", crystal: [{ lock: 1, z: 0.45, junk: 1 }] } }, NOW, BUILD);
    expect(m.current).toEqual(snap());
  });

  it("keeps the generator version a box was saved under, and drops a broken one", () => {
    const m = migrate({ version: 1, current: { ...snap(), gen: 3 }, daily: { current: { ...snap("shadow-locks/daily/2026-11-06"), gen: 2 } } }, NOW, BUILD);
    expect(m.current).toEqual({ ...snap(), gen: 3 });
    expect(m.daily.current?.gen).toBe(2);
    expect(isSnapshot({ ...snap(), gen: 1.5 })).toBe(false);
    expect(isSnapshot({ ...snap(), gen: "3" })).toBe(false);
    expect("gen" in migrate({ version: 1, current: snap() }, NOW, BUILD).current!).toBe(false);
  });

  it("snapshot round trip through the store", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const s = await openStore();
    expect(s.persistent).toBe(true);
    expect(await s.load(NOW, BUILD)).toEqual(newProfile(NOW, BUILD));
    const p = played();
    await s.save(p);
    const again = await openStore();
    const back = await again.load(NOW, "2.0.0");
    expect(back).toEqual({ ...p, lastSeenMs: NOW });
    expect(back.current).toEqual(snap("shadow-locks/6"));
    expect(back.daily.current).toEqual(snap("shadow-locks/daily/2026-11-06"));
  });

  it("the profile store writes the first-launch marker and last-seen time at once", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const ps = await ProfileStore.open(await openStore(), () => {}, clock());
    await ps.save();
    expect(await (await openStore()).load(NOW + DAY, "2.0.0")).toMatchObject({ firstLaunch: { atMs: NOW, build: BUILD }, lastSeenMs: NOW + DAY });
  });

  it("each save records the latest time seen, never an earlier one", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    let t = NOW;
    const ps = await ProfileStore.open(await openStore(), () => {}, { now: () => t, build: BUILD });
    t = NOW + 2 * DAY;
    await ps.save();
    expect(ps.profile.lastSeenMs).toBe(NOW + 2 * DAY);
    t = NOW;
    await ps.save();
    expect(ps.profile.lastSeenMs).toBe(NOW + 2 * DAY);
    expect((await (await openStore()).load(NOW, BUILD)).lastSeenMs).toBe(NOW + 2 * DAY);
  });

  it("falls back to memory store when IndexedDB throws (one notice flag)", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("blocked");
      },
    });
    const n = notices();
    const ps = await ProfileStore.open(await openStore(), n.emit, clock());
    expect(ps.persistent).toBe(false);
    expect(ps.profile).toEqual(newProfile(NOW, BUILD));
    ps.profile.nextBox = 4;
    await ps.setCurrent(snap());
    await ps.save();
    expect(n.out).toEqual([NOT_SAVED_NOTICE]);
    expect(ps.pendingNotice).toBe(NOT_SAVED_NOTICE);
    ps.markNoticeShown();
    expect(ps.pendingNotice).toBeNull();
    expect(ps.profile).toMatchObject({ nextBox: 4, current: snap() });
  });

  it("falls back to memory store when IndexedDB starts throwing mid-game, and keeps the progress", async () => {
    const fake = new IDBFactory();
    vi.stubGlobal("indexedDB", fake);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await openStore();
    const n = notices();
    const ps = await ProfileStore.open(store, n.emit, clock());
    await ps.save();
    expect(n.out).toEqual([]);
    const db = await new Promise<IDBDatabase>((res) => {
      const r = fake.open("shadow-locks", 1);
      r.onsuccess = () => res(r.result);
    });
    vi.spyOn(Object.getPrototypeOf(db), "transaction").mockImplementation(() => {
      throw new Error("quota");
    });
    ps.profile.nextBox = 7;
    await ps.save();
    await ps.save();
    expect(ps.persistent).toBe(false);
    expect(n.out).toEqual([NOT_SAVED_NOTICE]);
    expect((await store.load(NOW, BUILD)).nextBox).toBe(7);
  });
});

describe("reset progress", () => {
  it("starts boxes, lessons, tips, the collection and the daily streak over; settings and the trial clock stay", () => {
    const p = played();
    const r = withProgressReset(p);
    expect(r).toEqual({
      ...newProfile(p.firstLaunch.atMs, p.firstLaunch.build),
      lastSeenMs: p.lastSeenMs,
      settings: p.settings,
    });
    expect(r.nextBox).toBe(1);
    expect(r.current).toBeNull();
    expect(r.collection).toEqual([]);
    expect(r.daily).toEqual({ streak: 0, best: 0, lastDay: null, current: null });
    expect(r.firstLaunch).toEqual({ atMs: NOW - 3 * DAY, build: "0.9.0" });
    // A copy: the old profile is untouched and shares nothing.
    expect(p.nextBox).toBe(6);
    expect(r.settings).not.toBe(p.settings);
  });

  it("the profile store resets in place and saves", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    const ps = await ProfileStore.open(await openStore(), () => {}, clock());
    Object.assign(ps.profile, played());
    await ps.save();
    const before = ps.profile;
    await ps.resetProgress();
    expect(ps.profile).toBe(before);
    expect(ps.profile.nextBox).toBe(1);
    expect(ps.profile.settings.boxSizeCm).toBe(28);
    const back = await (await openStore()).load(NOW, BUILD);
    expect(back.nextBox).toBe(1);
    expect(back.tipsSeen).toEqual([]);
    expect(back.settings.handed).toBe("left");
    expect(back.firstLaunch).toEqual({ atMs: NOW - 3 * DAY, build: "0.9.0" });
  });
});
