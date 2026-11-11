// The box session on a fake clock and fake frames: no renderer, no XR. The scene, lantern, sound and
// view are recording fakes; boxes come from the real generator, and the solve rule is the real one.
import { describe, expect, it } from "vitest";
import { BoxSession, LOCK_TO_BOX_MS, REWARD_AUTO_MS, REWARD_UP_MS } from "../../src/app/box-session";
import { ACT_HINT, ACT_NEXT, ACT_TAKE, type BoxSessionDeps, type SessionView } from "../../src/app/session-deps";
import { withLessons } from "../../src/app/lesson-boxes";
import { COACH_HOLD_MS, CRYSTAL_MS, type FingerLoop } from "../../src/app/session-fingers";
import type { FeedbackEvent } from "../../src/app/bus";
import { ENVELOPE } from "../../src/core/envelope";
import { GENERATOR_VERSION, generateBox } from "../../src/core/generator";
import { mirrorBox } from "../../src/core/mirror";
import { type BoxSnapshot, defaultSettings, migrate, newProfile, type Profile, type Settings } from "../../src/core/profile";
import type { BoxResult } from "../../src/core/result";
import { type Coverage, measure, meets, prepareLock, SKIP_MISSING, shadowBuffers, shadowPolys } from "../../src/core/solve";
import type { Box, BoxSpec, Lock, V2, V3, Vec3 } from "../../src/core/types";
import { GAZE_DWELL_MS, LANTERN_MIN_Z, LESSON_STUCK_MS, OPEN_DWELL_MS, STUCK_MS } from "../../src/feel/constants";
import { FingerHold } from "../../src/feel/finger-hold";
import { type FeelEvent, LanternController } from "../../src/feel/lantern-controller";
import { LanternCtxBuilder } from "../../src/feel/lantern-ctx";

const DT = 1000 / 72;
const BOX = (n: number): BoxSpec => ({ kind: "box", n });

/** A finger lock's hold as the hand system's loop runs it (FingerHold fed `meets` with the finger). */
function fingerLoop(): FingerLoop {
  const hold = new FingerHold();
  let state: "idle" | "holding" | "done" = "idle";
  return {
    update(dt, c, tracked) {
      if (state !== "done") state = hold.update(dt, tracked && meets(c, true), tracked);
      return state;
    },
    get state() {
      return state;
    },
    get progress() {
      return state === "done" ? 1 : hold.progress;
    },
  };
}

interface Harness {
  session: BoxSession;
  events: FeedbackEvent[];
  calls: string[];
  profile: Profile;
  /** The settings the session reads (change them as the settings screen does). */
  settings: Settings;
  /** Times Next asked for a box the entitlement refused. */
  refused: () => number;
  /** Every warmth the panel was given, by lock. */
  panelWarmth: Map<number, number[]>;
  panelOpen: Set<number>;
  feelOpen: Set<number>;
  aligned: Set<number>;
  pos: V3;
  finger: {
    finger: V2[][];
    nFinger: number;
    fingerZ: number;
    tracked: boolean;
    version: number;
    controllers: boolean;
    depthOver(gap: readonly V2[]): number;
    tip(out: Vec3): boolean;
  };
  fingerCalls: { progress: number | null; at: Vec3 | null }[];
  head: { hit: V3 | null };
  view: { acts: number; calls: string[] };
  /** The results the session reported as boxes opened. */
  results: BoxResult[];
  saves: () => number;
  /** Which hand holds the lantern, and whether it is at rest (LanternController.atRest). */
  holder: { side: "left" | "right" | null; rest: boolean };
  feel(e: FeelEvent): void;
  place(p: readonly number[]): void;
  frames(n: number): void;
  /** Frames until `pred`, at most `maxMs` of play. */
  until(pred: () => boolean, maxMs: number): void;
  now(): number;
  types(type: string): FeedbackEvent[];
}

function harness(o: { warmth?: boolean; profile?: Profile; handed?: "left" | "right"; canPlayBox?: () => boolean } = {}): Harness {
  let refused = 0;
  const events: FeedbackEvent[] = [];
  const calls: string[] = [];
  const panelWarmth = new Map<number, number[]>();
  const panelOpen = new Set<number>();
  const feelOpen = new Set<number>();
  const aligned = new Set<number>();
  const pos: V3 = [0.35, -0.3, 1.35];
  const listeners: ((e: FeelEvent) => void)[] = [];
  const holder = { side: null as "left" | "right" | null, rest: true };
  const profile = o.profile ?? newProfile(0, "test");
  let saves = 0;
  const settings = { ...defaultSettings(), warmth: o.warmth ?? true, handed: o.handed ?? "right" };
  const scene = {
    box: null as Box | null,
    setBox(b: Box | null) {
      this.box = b;
      panelOpen.clear();
      if (b) scene.lantern.setPos(b.start);
    },
    panelArt: {
      etched: true,
      setWarmth(lock: number, w: number) {
        const list = panelWarmth.get(lock) ?? [];
        list.push(w);
        panelWarmth.set(lock, list);
      },
      setOpen(lock: number, open = true) {
        if (open) panelOpen.add(lock);
        else panelOpen.delete(lock);
      },
    },
    scrapMesh: () => ({ setGlow: () => {}, setVisible: () => {} }),
    lantern: {
      setPos(p: V3) {
        pos[0] = p[0];
        pos[1] = p[1];
        pos[2] = p[2];
      },
      getPos(out: V3) {
        out[0] = pos[0];
        out[1] = pos[1];
        out[2] = pos[2];
        return out;
      },
    },
  };
  const lantern = {
    grab: {
      get holder() {
        return holder.side;
      },
    },
    // Put where the test puts it, as by the test hooks: at rest unless the test says it moves.
    get atRest() {
      return holder.rest;
    },
    feel: {
      setOpen: (lock: number, open: boolean) => (open ? feelOpen.add(lock) : feelOpen.delete(lock)),
      aligned: (lock: number) => aligned.has(lock),
    },
    onFeel(fn: (e: FeelEvent) => void) {
      listeners.push(fn);
      return () => {};
    },
  };
  const rec =
    (name: string) =>
    (...args: unknown[]) =>
      calls.push(`${name} ${args.map((a) => JSON.stringify(a)).join(" ")}`.trim());
  const sound = {
    boxStart: rec("boxStart"),
    warmth: (lock: number, v: number) => {
      if (v > 0) calls.push(`warmth ${lock}`);
    },
    focus: rec("focus"),
    dialTick: rec("dialTick"),
    settle: rec("settle"),
    ring: rec("ring"),
    finger: (progress: number | null, _hold?: number, at?: Vec3) => fingerCalls.push({ progress, at: at ? [at[0], at[1], at[2]] : null }),
    crystallise: rec("crystallise"),
    lockOpened: rec("lockOpened"),
    boxOpened: rec("boxOpened"),
    hint: rec("hint"),
    muteRelease: rec("muteRelease"),
  };
  const view = { acts: 0, calls: [] as string[] };
  const results: BoxResult[] = [];
  const vrec =
    (name: string) =>
    (...args: unknown[]) =>
      view.calls.push(`${name} ${args.filter((a) => typeof a !== "object").join(" ")}`.trim());
  const fakeView: SessionView = {
    setBox: vrec("setBox"),
    reveal: vrec("reveal"),
    lockOpened: vrec("lockOpened"),
    focus: vrec("focus"),
    stuck: vrec("stuck"),
    hint: vrec("hint"),
    clearHint: vrec("clearHint"),
    boxOpened: vrec("boxOpened"),
    result: (r) => results.push(r),
    rewardTaken: vrec("rewardTaken"),
    offerNext: vrec("offerNext"),
    hintLanternAt: () => false,
    coach: vrec("coach"),
    update: () => {
      const a = view.acts;
      view.acts = 0;
      return a;
    },
  };
  // One hand: the finger over the gap is the one finger there is (HandsInBox picks the hand whose finger covers it).
  // The test bumps `version` whenever it changes the finger, as the hand system does when the shadow changed.
  const finger = {
    finger: [] as V2[][],
    nFinger: 0,
    fingerZ: Number.NaN,
    tracked: false,
    version: 0,
    controllers: false,
    depthOver(gap: readonly V2[]) {
      return gap.length > 0 && this.nFinger > 0 ? this.fingerZ : Number.NaN;
    },
    tip(out: Vec3) {
      if (this.nFinger === 0) return false;
      out[0] = 0.1;
      out[1] = 1.0;
      out[2] = -0.5;
      return true;
    },
  };
  const fingerCalls: { progress: number | null; at: Vec3 | null }[] = [];
  const head = { hit: null as V3 | null };
  let wall = Date.UTC(2026, 10, 6, 12);
  const deps: BoxSessionDeps = {
    scene,
    lantern,
    // The lessons' boxes as the game serves them; every other spec generated.
    boxes: withLessons({ get: async (spec) => generateBox(spec), prefetch: () => {} }),
    profiles: {
      profile,
      save: async () => {
        saves++;
      },
    },
    settings: { get: () => settings },
    sound,
    emit: (e) => events.push(e.type === "warmth" || e.type === "finger" ? { ...e } : e),
    wallNow: () => wall++,
    head: {
      read(_frame, origin, dir) {
        if (!head.hit) return false;
        // From in front of the box straight at the point on the panel.
        origin[0] = head.hit[0];
        origin[1] = head.hit[1];
        origin[2] = 3;
        dir[0] = 0;
        dir[1] = 0;
        dir[2] = -1;
        return true;
      },
    },
    fingers: finger,
    makeFingerLoop: fingerLoop,
    crystals: { crystallise: rec("crystals.crystallise"), place: rec("crystals.place") },
    view: fakeView,
    canPlayBox: o.canPlayBox,
    boxRefused: () => {
      refused++;
    },
  };
  const session = new BoxSession(deps);
  let t = 1000;
  const h: Harness = {
    session,
    events,
    calls,
    profile,
    settings,
    refused: () => refused,
    panelWarmth,
    panelOpen,
    feelOpen,
    aligned,
    pos,
    finger,
    fingerCalls,
    head,
    view,
    results,
    saves: () => saves,
    holder,
    feel: (e) => {
      for (const fn of listeners) fn(e);
    },
    place: (p) => scene.lantern.setPos([p[0]!, p[1]!, p[2]!]),
    frames(n) {
      for (let i = 0; i < n; i++) {
        t += DT;
        session.update(t, null);
      }
    },
    until(pred, maxMs) {
      for (let ms = 0; !pred(); ms += DT) {
        if (ms > maxMs) throw new Error(`still false after ${maxMs} ms`);
        h.frames(1);
      }
    },
    now: () => t,
    types: (type) => events.filter((e) => e.type === type),
  };
  return h;
}

/** Open every plain lock of the box shown with the lantern on its spot. */
function openPlainLocks(h: Harness): void {
  for (const l of h.session.box!.locks) {
    if (l.finger) continue;
    h.place(l.L);
    h.until(() => h.session.isOpen(l.i), 1000);
  }
}

/** A finger whose shadow is `poly` at depth `z` (none: the finger leaves), as the hand system reports a change. */
function setFinger(h: Harness, poly: V2[] | null, z = 0.45): void {
  h.finger.finger = poly ? [poly] : [];
  h.finger.nFinger = poly ? 1 : 0;
  h.finger.fingerZ = poly ? z : Number.NaN;
  h.finger.tracked = true;
  h.finger.version++;
}

/**
 * A real lantern (LanternController) held by a scripted hand, run each frame before the session's frame (as the
 * lantern system runs before the game), the session reading where it is and whether it is at rest. Without `spots`
 * the feel knows none of the box's spots, so nothing settles.
 */
function heldLantern(h: Harness, o: { spots?: boolean } = {}) {
  const feel = new LanternCtxBuilder();
  feel.setBox(o.spots === false ? null : h.session.box);
  const ctl = new LanternController([h.pos[0], h.pos[1], h.pos[2]]);
  const out: FeelEvent[] = [];
  let hand: V3 = [h.pos[0], h.pos[1], h.pos[2]];
  /** Called after every frame. */
  let watch: (() => void) | null = null;
  const frame = (pinching = true) => {
    ctl.update({ tMs: h.now() + DT, pinching, pinchPos: [hand[0], hand[1], hand[2]] }, feel.update(ctl.pos, 24));
    ctl.drain(out);
    h.place(ctl.pos);
    h.holder.rest = ctl.atRest;
    h.frames(1);
    watch?.();
  };
  frame(false);
  frame(true);
  return {
    ctl,
    set watch(fn: (() => void) | null) {
      watch = fn;
    },
    hold(ms: number) {
      for (let i = Math.round(ms / DT); i > 0; i--) frame();
    },
    /** The hand in a straight line to `to` at `cmps` (24 cm box units). */
    moveTo(to: V3, cmps: number) {
      const from = hand;
      const n = Math.max(1, Math.ceil((Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) * 24) / cmps / (DT / 1000)));
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        hand = [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
        frame();
      }
    },
  };
}

/** Whether plain lock `lock`'s rule holds with the lantern at `L` (measured as the session measures it). */
function ruleAt(box: Box, lock: Lock): (L: Readonly<V3>) => boolean {
  const s = prepareLock(lock), polys = shadowBuffers(box.elements, SKIP_MISSING);
  const c: Coverage = { cover: 0, spill: 0, spillAll: 0, gap: 0 };
  return (L) => meets(measure(s, polys, shadowPolys(box.elements, [L[0], L[1], L[2]], polys, SKIP_MISSING), [], 0, c), false);
}

/** The point `cm` centimetres out along lock `lock`'s ray (from its outline's centre on the panel through its spot). */
function onRay(lock: Lock, cm: number): V3 {
  const L = lock.L, d = [L[0] - lock.center[0], L[1] - lock.center[1], L[2]], n = Math.hypot(d[0]!, d[1]!, d[2]!);
  const k = cm / 24 / n;
  return [L[0] + d[0]! * k, L[1] + d[1]! * k, L[2] + d[2]! * k];
}

/** Open a finger lock: the lantern on its spot and a finger whose shadow is exactly the missing piece. */
function openFingerLock(h: Harness, l: Lock): void {
  h.place(l.L);
  setFinger(h, l.target[l.missing]!);
  h.until(() => h.session.isOpen(l.i), 3000);
  setFinger(h, null);
}

describe("box session", () => {
  it("opens a lock once the rule holds at its spot for the dwell, and never from a sweep through it", async () => {
    const h = harness();
    await h.session.start(BOX(1));
    const lock = h.session.box!.locks[0]!;
    // A sweep through the spot at 20 cm/s: on the spot for one frame only.
    const step = 0.2 / 0.24 / 72;
    for (let k = -20; k <= 20; k++) {
      h.place([lock.L[0] + k * step, lock.L[1], lock.L[2]]);
      h.frames(1);
    }
    expect(h.session.isOpen(0)).toBe(false);
    h.place(lock.L);
    const t0 = h.now();
    h.until(() => h.session.isOpen(0), 1000);
    expect(h.now() - t0).toBeGreaterThanOrEqual(OPEN_DWELL_MS);
    expect(h.now() - t0).toBeLessThan(OPEN_DWELL_MS + 2 * DT);
    expect(h.types("lock-open")).toEqual([{ type: "lock-open", lock: 0, order: 1 }]);
    expect(h.calls).toContain("lockOpened 0");
    expect(h.panelOpen.has(0)).toBe(true);
    expect(h.feelOpen.has(0)).toBe(true);
  });

  it("a held lantern swept along a lock's exact ray at 5 to 30 cm/s never opens it, though the rule holds there", async () => {
    for (const cmps of [5, 10, 20, 30]) {
      const h = harness();
      await h.session.start(BOX(1));
      const box = h.session.box!, lock = box.locks[0]!, rule = ruleAt(box, lock);
      // In along the ray from 8 cm out to as far past the spot as the box front allows (up to 4 cm).
      let inCm = 4;
      while (onRay(lock, -inCm)[2] < LANTERN_MIN_Z + 0.005) inCm -= 0.1;
      const lan = heldLantern(h);
      lan.moveTo(onRay(lock, 8), 10);
      lan.hold(600);
      expect(h.holder.rest).toBe(true);
      let run = 0, longest = 0;
      lan.watch = () => {
        run = rule(h.pos) ? run + DT : 0;
        longest = Math.max(longest, run);
      };
      lan.moveTo(onRay(lock, -inCm), cmps);
      expect(h.session.isOpen(0), `${cmps} cm/s`).toBe(false);
      expect(h.types("lock-open")).toEqual([]);
      // The rule held along the way: at 5 cm/s for longer than the dwell, which once opened such sweeps.
      expect(longest, `${cmps} cm/s`).toBeGreaterThan(0);
      if (cmps === 5) expect(longest).toBeGreaterThan(OPEN_DWELL_MS);
    }
  });

  it("a move at 8 to 15 cm/s from a deliberate hold just outside a lock's rule, along its ray, never opens it", async () => {
    // The window the dwell must cover (constants.ts, OPEN_DWELL_MS): a hand held still is at rest, and starting to move
    // it stays at rest until the speed gate catches up. Held a hair outside where the rule begins on the lock's ray
    // (where the rule holds for centimetres), the move meets the rule at once, while still at rest. A feel without
    // spots, so no settle: the gate alone.
    const seen: string[] = [];
    for (const n of [1, 2, 4]) {
      for (const cmps of [8, 10, 12, 15]) {
        const h = harness();
        await h.session.start(BOX(n));
        const box = h.session.box!, lock = box.locks.find((l) => !l.finger)!, rule = ruleAt(box, lock);
        // The rule's outer edge on the ray, to 0.01 mm: it holds at `inside` cm out, not at `outside`.
        let inside = 0, outside = 12;
        expect(rule(onRay(lock, inside))).toBe(true);
        expect(rule(onRay(lock, outside))).toBe(false);
        while (outside - inside > 0.001) {
          const mid = (inside + outside) / 2;
          if (rule(onRay(lock, mid))) inside = mid;
          else outside = mid;
        }
        const lan = heldLantern(h, { spots: false });
        lan.moveTo(onRay(lock, outside + 3), 10);
        lan.moveTo(onRay(lock, outside), 2);
        lan.hold(600);
        expect(h.holder.rest, `box ${n}, held still`).toBe(true);
        expect(rule(h.pos), `box ${n}, held just outside the rule`).toBe(false);
        // In along the ray, through the spot, to as far past it as the box front allows (up to 4 cm).
        let inCm = 4;
        while (onRay(lock, -inCm)[2] < LANTERN_MIN_Z + 0.005) inCm -= 0.1;
        let run = 0, longest = 0;
        lan.watch = () => {
          run = h.holder.rest && rule(h.pos) ? run + DT : 0;
          longest = Math.max(longest, run);
        };
        lan.moveTo(onRay(lock, -inCm), cmps);
        seen.push(`box ${n} ${cmps} cm/s: at rest and meeting for ${longest.toFixed(0)} ms (edge ${outside.toFixed(3)} cm out)`);
        expect(h.session.isOpen(lock.i), seen[seen.length - 1]).toBe(false);
        // 139 ms at 8 cm/s, 111 at 10, 97 at 12, 83 at 15 (constants.ts quotes these).
        expect(longest, seen[seen.length - 1]).toBeLessThan(OPEN_DWELL_MS);
      }
    }
  });

  it("a settled lantern opens its lock about 150 ms after the rule holds", async () => {
    const h = harness();
    await h.session.start(BOX(1));
    const box = h.session.box!, lock = box.locks[0]!, rule = ruleAt(box, lock);
    const lan = heldLantern(h);
    // Brought in at 8 cm/s from 6 cm off, to 1 cm short of the spot, and held there: it settles onto the spot.
    lan.moveTo([lock.L[0] + 6 / 24, lock.L[1] + 1 / 24, lock.L[2] + 2 / 24], 10);
    lan.hold(300);
    let lastNot = Number.NaN, openAt = Number.NaN, settled = false;
    lan.watch = () => {
      if (!h.session.isOpen(0) && !(h.holder.rest && rule(h.pos))) lastNot = h.now();
      if (h.session.isOpen(0) && Number.isNaN(openAt)) {
        openAt = h.now();
        settled = lan.ctl.mode === "settled";
      }
    };
    lan.moveTo([lock.L[0] + 1 / 24, lock.L[1], lock.L[2]], 8);
    lan.hold(1500);
    expect(settled).toBe(true);
    expect(openAt - lastNot).toBeGreaterThanOrEqual(OPEN_DWELL_MS);
    expect(openAt - lastNot).toBeLessThan(OPEN_DWELL_MS + DT);
    expect(OPEN_DWELL_MS).toBe(150);
  });

  it("a held, still lantern that is not settled but meets the rule opens 150 ms after it is at rest", async () => {
    const h = harness();
    await h.session.start(BOX(1));
    const box = h.session.box!, lock = box.locks[0]!, rule = ruleAt(box, lock);
    // A feel with no spots: nothing settles; the lantern is at rest by the speed gate alone.
    const lan = heldLantern(h, { spots: false });
    lan.moveTo([lock.L[0] + 6 / 24, lock.L[1] + 1 / 24, lock.L[2] + 2 / 24], 10);
    lan.hold(300);
    let lastNot = Number.NaN, openAt = Number.NaN, mode = "", metMoving = 0;
    lan.watch = () => {
      const met = rule(h.pos);
      if (met && !h.holder.rest) metMoving += DT;
      if (!h.session.isOpen(0) && !(h.holder.rest && met)) lastNot = h.now();
      if (h.session.isOpen(0) && Number.isNaN(openAt)) {
        openAt = h.now();
        mode = lan.ctl.mode;
      }
    };
    lan.moveTo(lock.L, 8);
    lan.hold(1500);
    expect([mode, lan.ctl.held]).toEqual(["free", true]);
    expect(openAt - lastNot).toBeGreaterThanOrEqual(OPEN_DWELL_MS);
    expect(openAt - lastNot).toBeLessThan(OPEN_DWELL_MS + DT);
    // It met the rule for longer than the dwell before it was at rest (the gate catching up), and did not open then.
    expect(metMoving).toBeGreaterThan(OPEN_DWELL_MS);
  });

  it("opening locks persists through snapshot() round trips", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    const box = h.session.box!;
    h.place(box.locks[0]!.L);
    h.until(() => h.session.isOpen(0), 1000);
    expect(h.session.isOpen(1)).toBe(false);
    h.place([0.1, -0.3, 1.3]);
    h.frames(3);
    const s1 = h.session.snapshot();
    expect(s1).toMatchObject({ key: box.key, gen: GENERATOR_VERSION, open: [0], crystal: [], lantern: [0.1, -0.3, 1.3], hints: 0 });
    expect(s1.elapsedMs).toBeGreaterThan(0);

    // As stored (JSON), into a new session: the same open lock, lantern and time.
    const h2 = harness();
    await h2.session.start(BOX(2), JSON.parse(JSON.stringify(s1)) as BoxSnapshot);
    expect(h2.pos).toEqual([0.1, -0.3, 1.3]);
    expect(h2.session.isOpen(0)).toBe(true);
    expect(h2.session.isOpen(1)).toBe(false);
    expect(h2.panelOpen.has(0)).toBe(true);
    h2.frames(1);
    expect(h2.feelOpen.has(0)).toBe(true);
    // A restored lock opens quietly: no event, no sound, no celebration.
    expect(h2.types("lock-open")).toEqual([]);
    expect(h2.calls.filter((c) => c.startsWith("lockOpened"))).toEqual([]);
    expect(h2.view.calls).toContain("lockOpened 0 1 true");
    // The same save back (the first frame of a box counts no time).
    expect(h2.session.snapshot()).toEqual(s1);
    // And round again, the second lock opened too.
    h2.place(box.locks[1]!.L);
    h2.until(() => h2.session.isOpen(1), 1000);
    const h3 = harness();
    await h3.session.start(BOX(2), h2.session.snapshot());
    expect([h3.session.isOpen(0), h3.session.isOpen(1)]).toEqual([true, true]);
  });

  it("a damaged save's lantern comes back in sight and reach (the comfort envelope and a margin), and one where a spot can be stays put", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    const box = h.session.box!;
    h.place(box.locks[0]!.L);
    h.until(() => h.session.isOpen(0), 1000);
    const save = h.session.snapshot();
    const restored = async (lantern: V3) => {
      const h2 = harness();
      await h2.session.start(BOX(2), { ...save, lantern });
      expect(h2.session.isOpen(0)).toBe(true);
      return h2.pos;
    };
    // Far out: behind the eyes, beside the waist, above the box. Each comes back to the envelope's edge, at most
    // 0.05 past it.
    const E = ENVELOPE, M = 0.05;
    for (const [far, back] of [
      [[0, 0, 30], [0, E.LY[1] + M, E.LZ[1] + M]],
      [[40, -9, 30], [E.LX_MAX + M, E.LY[0] - M, E.LZ[1] + M]],
      [[-3, 2, 0.2], [-E.LX_MAX - M, E.LY[1] + M, LANTERN_MIN_Z]],
    ] as const) {
      const got = await restored([far[0], far[1], far[2]]);
      got.forEach((v, k) => expect(v, `${far} -> ${back}`).toBeCloseTo(back[k]!, 9));
    }
    // Anywhere a spot or the start can be (the envelope's corners, either hand), and this box's own: not moved.
    const inside: V3[] = [box.start, ...box.locks.map((l) => l.L)];
    for (const x of [-E.LX_MAX, E.LX_MAX]) for (const y of E.LY) for (const z of E.LZ) inside.push([x, y, z]);
    for (const at of inside) expect(await restored([at[0], at[1], at[2]])).toEqual(at);
  });

  it("a save from a generator version it can no longer build (or none) starts its box afresh", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    h.place(h.session.box!.locks[0]!.L);
    h.until(() => h.session.isOpen(0), 1000);
    const { gen: _gen, ...unversioned } = h.session.snapshot();
    for (const old of [{ ...h.session.snapshot(), gen: 2 }, unversioned]) {
      const h2 = harness();
      await h2.session.start(BOX(2), old);
      expect(h2.session.isOpen(0)).toBe(false);
      expect(h2.pos).toEqual(h2.session.box!.start);
      expect(h2.session.elapsedMs).toBe(0);
      expect(h2.session.snapshot().gen).toBe(GENERATOR_VERSION);
    }
  });

  it("a box saved mid-play under generator version 3 resumes as that same box, saved under 3 until it opens", async () => {
    // Box 12 changed with version 4 (it became an expert box): the save must not land in today's box 12.
    const then = generateBox({ kind: "box", n: 12, gen: 3 }), now = generateBox(BOX(12));
    expect(then.locks.map((l) => l.shape)).not.toEqual(now.locks.map((l) => l.shape));
    const plain = then.locks.find((l) => !l.finger)!;
    const save: BoxSnapshot = { key: then.key, gen: 3, lantern: [0.12, -0.31, 1.3], open: [plain.i], crystal: [], elapsedMs: 41_000, hints: 1, hintLevel: { [plain.i]: 1 } };
    // Through the profile's loader too, as a reload brings it back.
    const profile = migrate({ ...newProfile(0, "test"), nextBox: 12, current: save }, 1, "test");
    expect(profile.current).toEqual(save);
    const h = harness({ profile });
    await h.session.start(BOX(12), profile.current);
    expect(h.session.box!.locks.map((l) => [l.shape, l.L])).toEqual(then.locks.map((l) => [l.shape, l.L]));
    expect(h.session.box!.elements).toEqual(then.elements);
    expect(h.session.spec).toEqual({ kind: "box", n: 12, gen: 3 });
    expect(h.session.isOpen(plain.i)).toBe(true);
    expect(h.pos).toEqual(save.lantern);
    expect(h.session.elapsedMs).toBe(41_000);
    expect(h.session.hints.count).toBe(1);
    // Saved again, it is still version 3's box 12, and resumes so once more.
    const again = h.session.snapshot();
    expect(again).toMatchObject({ key: then.key, gen: 3, open: [plain.i] });
    const h2 = harness();
    await h2.session.start(BOX(12), again);
    expect(h2.session.box!.elements).toEqual(then.elements);
    expect(h2.session.isOpen(plain.i)).toBe(true);
    // Finished: it moves the player on to box 13, built by today's generator.
    openPlainLocks(h2);
    for (const l of h2.session.box!.locks) if (l.finger && !h2.session.isOpen(l.i)) openFingerLock(h2, l);
    h2.until(() => h2.session.stage === "reward", LOCK_TO_BOX_MS + REWARD_UP_MS + 100);
    expect(h2.profile.nextBox).toBe(13);
    expect(h2.profile.current).toBeNull();
    await h2.session.start(BOX(13));
    expect(h2.session.box!).toEqual(generateBox(BOX(13)));
    expect(h2.session.snapshot().gen).toBe(GENERATOR_VERSION);
  });

  it("a finger lock opens once its piece has formed, and the piece is restored with it", async () => {
    const h = harness();
    await h.session.start(BOX(3));
    const box = h.session.box!;
    const fl = box.locks.find((l) => l.finger)!;
    h.place(fl.L);
    h.frames(3);
    // The scraps in place, the gap empty: one piece short.
    expect(h.types("short")).toEqual([{ type: "short", lock: fl.i }]);
    setFinger(h, fl.target[fl.missing]!);
    h.until(() => h.types("crystallise").length > 0, 2000);
    expect(h.calls.filter((c) => c.startsWith("crystals.crystallise"))).toHaveLength(1);
    expect(h.calls).toContain(`crystallise ${fl.i}`);
    expect(h.session.isOpen(fl.i)).toBe(false);
    // The fingertip hum plays at the fingertip.
    expect(h.fingerCalls.at(-1)).toEqual({ progress: expect.any(Number), at: [0.1, 1.0, -0.5] });
    const t0 = h.now();
    setFinger(h, null);
    h.until(() => h.session.isOpen(fl.i), 2000);
    expect(h.now() - t0).toBeGreaterThanOrEqual(CRYSTAL_MS - DT);
    expect(h.types("finger").length).toBeGreaterThan(0);
    const snap = h.session.snapshot();
    expect(snap.crystal).toEqual([{ lock: fl.i, z: 0.45 }]);
    expect(snap.open).toEqual([fl.i]);
    const h2 = harness();
    await h2.session.start(BOX(3), snap);
    expect(h2.session.isOpen(fl.i)).toBe(true);
    expect(h2.calls.filter((c) => c.startsWith("crystals.place"))).toHaveLength(1);
  });

  it("hints recorded per lock", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    expect(h.session.nextHint(0)).toBe(1);
    expect(h.session.nextHint(0)).toBe(2);
    expect(h.session.nextHint(1)).toBe(1);
    expect(h.types("hint")).toEqual([
      { type: "hint", lock: 0, level: 1 },
      { type: "hint", lock: 0, level: 2 },
      { type: "hint", lock: 1, level: 1 },
    ]);
    expect(h.calls.filter((c) => c.startsWith("hint"))).toEqual(["hint 0", "hint 0", "hint 1"]);
    const snap = h.session.snapshot();
    expect(snap.hints).toBe(3);
    expect(snap.hintLevel).toEqual({ 0: 2, 1: 1 });
    // Up to the ghost lantern at the spot, and it stays there.
    expect(h.session.nextHint(0)).toBe(3);
    expect(h.session.nextHint(0)).toBe(4);
    expect(h.session.nextHint(0)).toBe(4);
    expect(h.session.snapshot().hintLevel).toEqual({ 0: 4, 1: 1 });
    // A resumed box carries on from the level reached, and shows the marks again.
    const h2 = harness();
    await h2.session.start(BOX(2), snap);
    expect(h2.view.calls).toEqual(expect.arrayContaining(["hint 0 2", "hint 1 1"]));
    expect(h2.session.nextHint(0)).toBe(3);
    expect(h2.session.snapshot().hints).toBe(4);
    // The hint lantern's "Hint" targets the lock in focus.
    h2.head.hit = [...h2.session.box!.locks[1]!.center, 0] as V3;
    h2.frames(Math.ceil(GAZE_DWELL_MS / DT) + 1);
    expect(h2.session.focus).toBe(1);
    h2.view.acts = ACT_HINT;
    h2.frames(1);
    expect(h2.session.snapshot().hintLevel).toEqual({ 0: 3, 1: 2 });
  });

  it("hidden time excluded from elapsedMs", async () => {
    const h = harness();
    await h.session.start(BOX(1));
    h.frames(72);
    const before = h.session.elapsedMs;
    expect(before).toBeCloseTo(71 * DT, 6);
    h.session.pause(h.now());
    h.frames(72 * 5);
    expect(h.session.elapsedMs).toBe(before);
    h.session.resume(h.now());
    h.frames(72);
    // The first frame back counts nothing (its gap is hidden time).
    expect(h.session.elapsedMs).toBeCloseTo(before + 71 * DT, 6);
  });

  it("warmth off sends 0 and no ticks", async () => {
    const near = (h: Harness) => {
      const l = h.session.box!.locks[0]!;
      h.place([l.L[0] + 0.06, l.L[1], l.L[2]]);
      h.frames(5);
      h.feel({ type: "tick", lock: 0, cm: 2 });
    };
    // Warmth on: the panel glows, the lock hums, the dial ticks.
    const on = harness();
    await on.session.start(BOX(1));
    near(on);
    expect(on.session.isOpen(0)).toBe(false);
    expect(Math.max(...on.panelWarmth.get(0)!)).toBeGreaterThan(0.2);
    expect(on.calls).toContain("warmth 0");
    expect(on.calls).toContain("dialTick 2");
    expect(on.types("feel").map((e) => (e as { e: FeelEvent }).e.type)).toContain("tick");
    expect(on.types("warmth").some((e) => (e as { w: number }).w > 0.2)).toBe(true);
    // Warmth off: the same moves send the panel 0, no hum, no tick.
    const off = harness({ warmth: false });
    await off.session.start(BOX(1));
    near(off);
    expect(off.panelWarmth.get(0)!.length).toBeGreaterThan(0);
    expect(off.panelWarmth.get(0)!.every((w) => w === 0)).toBe(true);
    expect(off.calls.filter((c) => c.startsWith("warmth") || c.startsWith("dialTick"))).toEqual([]);
    expect(off.types("feel")).toEqual([]);
    expect(off.types("warmth").every((e) => (e as { w: number }).w === 0)).toBe(true);
  });

  it("an opened box adds one collection item, before the reward is taken", async () => {
    const h = harness();
    await h.session.start(BOX(1));
    const box = h.session.box!;
    h.session.nextHint(0);
    openPlainLocks(h);
    const elapsed = h.session.elapsedMs;
    expect(h.session.stage).toBe("opening");
    expect(h.profile.collection).toEqual([]);
    const saves = h.saves();
    h.until(() => h.types("box-open").length > 0, LOCK_TO_BOX_MS + 100);
    expect(h.types("box-open")).toEqual([{ type: "box-open", key: box.key }]);
    expect(h.calls).toContain(`boxOpened ${JSON.stringify(box.key)}`);
    // Solved and saved: the next box is box 2, nothing is in progress, and the reward is in the collection with the
    // time and hints final (a reload before the take loses nothing). It cannot be taken until it is up.
    expect(h.profile.nextBox).toBe(2);
    expect(h.profile.current).toBeNull();
    expect(h.saves()).toBe(saves + 1);
    expect(h.profile.collection).toHaveLength(1);
    expect(h.profile.collection[0]).toMatchObject({ key: box.key, owner: box.owner, loot: box.loot, shapes: [box.locks[0]!.shape], hints: 1 });
    expect(h.profile.collection[0]!.timeMs).toBeCloseTo(elapsed, 6);
    expect(h.session.takeReward()).toBe(false);
    h.until(() => h.session.stage === "reward", REWARD_UP_MS + 100);
    // Dropped toward the player: the moment the player sees, nothing more to record.
    h.view.acts = ACT_TAKE;
    h.frames(1);
    expect(h.session.stage).toBe("offered");
    expect(h.profile.collection).toHaveLength(1);
    expect(h.saves()).toBe(saves + 1);
    expect(h.types("reward-taken")).toEqual([{ type: "reward-taken", key: box.key }]);
    expect(h.view.calls).toContain("offerNext true");
    expect(h.session.takeReward()).toBe(false);
    h.frames(10);
    expect(h.profile.collection).toHaveLength(1);
    // The plate's Next starts box 2.
    h.view.acts = ACT_NEXT;
    h.frames(1);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.session.box?.key).toBe(generateBox(BOX(2)).key);
    expect(h.session.stage).toBe("playing");
  });

  it("a reward nobody takes is taken by itself after 8 s", async () => {
    const h = harness();
    await h.session.start(BOX(1));
    openPlainLocks(h);
    h.until(() => h.session.stage === "reward", LOCK_TO_BOX_MS + REWARD_UP_MS + 100);
    const t0 = h.now();
    h.until(() => h.session.stage === "offered", REWARD_AUTO_MS + 100);
    expect(h.now() - t0).toBeGreaterThanOrEqual(REWARD_AUTO_MS - DT);
    expect(h.profile.collection).toHaveLength(1);
  });

  it("a solved daily records the streak once", async () => {
    const profile = newProfile(0, "test");
    profile.nextBox = 4;
    const day = "2026-11-06";
    const solve = async (h: Harness) => {
      await h.session.start({ kind: "daily", day });
      openPlainLocks(h);
      for (const l of h.session.box!.locks) if (l.finger) openFingerLock(h, l);
      h.until(() => h.types("box-open").length > 0, LOCK_TO_BOX_MS + 100);
    };
    const h = harness({ profile });
    profile.daily.current = { key: "shadow-locks/daily/2026-11-06", lantern: [0, -0.3, 1.3], open: [], crystal: [], elapsedMs: 5, hints: 0, hintLevel: {} };
    await solve(h);
    expect(profile.daily).toEqual({ streak: 1, best: 1, lastDay: day, current: null });
    expect(profile.nextBox).toBe(4);
    // The same day again: solved again, counted once.
    const again = harness({ profile });
    await solve(again);
    expect(profile.daily).toEqual({ streak: 1, best: 1, lastDay: day, current: null });
  });

  it("reports each box's result as it opens: time, hints, each lock's hint level; recorded only on a first real solve", async () => {
    const profile = newProfile(0, "test");
    profile.nextBox = 4;
    const day = "2026-11-06";
    const play = async (h: Harness, spec: BoxSpec, practice = false) => {
      await h.session.start(spec, null, { practice });
      h.frames(Math.ceil(3000 / DT));
      if (practice === false && spec.kind === "daily") h.session.nextHint(0);
      openPlainLocks(h);
      for (const l of h.session.box!.locks) if (l.finger) openFingerLock(h, l);
      h.until(() => h.results.length > 0, LOCK_TO_BOX_MS + 100);
      return h.results;
    };
    const first = await play(harness({ profile }), { kind: "daily", day });
    expect(first).toHaveLength(1);
    const r = first[0]!;
    expect([r.key, r.practice, r.recorded, r.hints]).toEqual([`shadow-locks/daily/${day}`, false, true, 1]);
    expect(r.levels).toHaveLength(generateBox({ kind: "daily", day }).locks.length);
    expect(r.levels[0]).toBe(1);
    expect(r.levels.slice(1).every((l) => l === 0)).toBe(true);
    // Its time is the play time the collection records.
    expect(r.timeMs).toBe(profile.collection[0]!.timeMs);
    // The collection keeps each lock's level too, so the result can be shared again on a later visit.
    expect(profile.collection[0]!.levels).toEqual(r.levels);
    expect(r.timeMs).toBeGreaterThan(3000);
    // The same day again: reported, not recorded (the first solve stands). A practice box: never recorded.
    const again = await play(harness({ profile }), { kind: "daily", day });
    expect([again[0]!.recorded, again[0]!.practice, profile.collection.length]).toEqual([false, false, 1]);
    const practice = await play(harness({ profile }), BOX(2), true);
    expect([practice[0]!.recorded, practice[0]!.practice, profile.collection.length]).toEqual([false, true, 1]);
  });

  it("gaze picks the lock looked at after the dwell; hints and hums follow it", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    h.frames(1);
    const [a, b] = h.session.box!.locks as [Lock, Lock];
    h.head.hit = [a.center[0], a.center[1], 0];
    const t0 = h.now();
    h.until(() => h.session.focus === 0, 1000);
    expect(h.now() - t0).toBeGreaterThanOrEqual(GAZE_DWELL_MS - 1e-6);
    expect(h.now() - t0).toBeLessThan(GAZE_DWELL_MS + DT);
    h.head.hit = [b.center[0], b.center[1], 0];
    h.until(() => h.session.focus === 1, 1000);
    // Looking off the panel keeps the focus.
    h.head.hit = [3, 3, 0];
    h.frames(60);
    expect(h.session.focus).toBe(1);
    expect(h.types("focus")).toEqual([
      { type: "focus", lock: 0 },
      { type: "focus", lock: 1 },
    ]);
    expect(h.calls.filter((c) => c.startsWith("focus"))).toEqual(["focus 0", "focus 1"]);
    // Only the lock in focus brightens on the panel.
    h.place([a.L[0] + 0.05, a.L[1], a.L[2]]);
    h.frames(3);
    expect(h.panelWarmth.get(0)!.at(-1)).toBe(0);
    expect(h.session.warmth(0)).toBeGreaterThan(0);
  });

  it("rings say only when they line up or part, and ringless locks say nothing", async () => {
    const h = harness();
    await h.session.start(BOX(4));
    const ringless = h.session.box!.locks.find((l) => !l.rings)!;
    const ringed = h.session.box!.locks.find((l) => l.rings)!;
    h.aligned.add(ringed.i);
    h.aligned.add(ringless.i);
    h.frames(5);
    h.aligned.delete(ringed.i);
    h.frames(5);
    expect(h.types("ring")).toEqual([
      { type: "ring", lock: ringed.i, on: true },
      { type: "ring", lock: ringed.i, on: false },
    ]);
    expect(h.calls.filter((c) => c.startsWith("ring"))).toEqual([`ring ${ringed.i} true`, `ring ${ringed.i} false`]);
  });

  it("the stuck watch lights the hint lantern after 90 s without progress, and a hint puts it out", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    h.frames(Math.ceil((STUCK_MS - 1000) / DT));
    expect(h.session.stuck).toBe(false);
    h.frames(Math.ceil(2000 / DT));
    expect(h.session.stuck).toBe(true);
    expect(h.types("stuck")).toEqual([{ type: "stuck", on: true }]);
    expect(h.view.calls).toContain("stuck true");
    expect(h.calls.some((c) => c.startsWith("hint"))).toBe(true);
    h.session.useHint();
    expect(h.session.stuck).toBe(false);
    expect(h.types("stuck")).toEqual([
      { type: "stuck", on: true },
      { type: "stuck", on: false },
    ]);
  });

  it("lights the hint lantern after 40 s in a lesson's box, and starts its watch over when the lesson asks", async () => {
    const h = harness();
    await h.session.start({ kind: "lesson", id: "l1" });
    h.frames(Math.ceil((LESSON_STUCK_MS - 1000) / DT));
    expect(h.session.stuck).toBe(false);
    h.frames(Math.ceil(2000 / DT));
    expect(h.session.stuck).toBe(true);
    // A lesson step starting over (a new step, or a help example over): the glow goes out, and 40 s more to the next.
    h.session.restartStuck();
    expect(h.session.stuck).toBe(false);
    expect(h.types("stuck")).toEqual([
      { type: "stuck", on: true },
      { type: "stuck", on: false },
    ]);
    h.frames(Math.ceil((LESSON_STUCK_MS - 1000) / DT));
    expect(h.session.stuck).toBe(false);
    h.frames(Math.ceil(2000 / DT));
    expect(h.session.stuck).toBe(true);
    // A numbered box afterwards keeps the 90 s (the existing case above), whatever came before.
    await h.session.start(BOX(2));
    h.frames(Math.ceil((LESSON_STUCK_MS + 5000) / DT));
    expect(h.session.stuck).toBe(false);
    h.session.restartStuck();
    h.frames(Math.ceil((STUCK_MS - 1000) / DT));
    expect(h.session.stuck).toBe(false);
    h.frames(Math.ceil(2000 / DT));
    expect(h.session.stuck).toBe(true);
  });

  it("forwards feel events as copies, and a new box mutes the release of the lantern it drops", async () => {
    const h = harness();
    await h.session.start(BOX(1));
    const slot: FeelEvent = { type: "settle", lock: 0 };
    h.feel(slot);
    (slot as { lock: number }).lock = 2;
    expect(h.types("feel")).toEqual([{ type: "feel", e: { type: "settle", lock: 0 } }]);
    expect(h.calls).toContain("settle");
    h.holder.side = "right";
    await h.session.start(BOX(2));
    const start = h.calls.lastIndexOf(`boxStart ${JSON.stringify(BOX(2))}`);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(h.calls.indexOf("muteRelease", start)).toBeGreaterThan(start);
    expect(h.types("box-start").map((e) => (e as { key: string }).key)).toEqual([generateBox(BOX(1)).key, generateBox(BOX(2)).key]);
  });

  it("plays a left-handed player's box mirrored", async () => {
    const h = harness({ handed: "left" });
    await h.session.start(BOX(1));
    expect(h.session.box!.mirrored).toBe(true);
    expect(h.pos[0]).toBeLessThan(0);
    openPlainLocks(h);
    expect(h.session.isOpen(0)).toBe(true);
  });

  it("a save keeps which way its box was mirrored; resumed for the other hand, the lantern crosses to the same side of its box", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    h.place(h.session.box!.locks[0]!.L);
    h.until(() => h.session.isOpen(0), 1000);
    h.place([0.2, -0.3, 1.3]);
    h.frames(2);
    const s1 = h.session.snapshot();
    expect(s1.mirrored).toBe(false);
    const left = harness({ handed: "left" });
    await left.session.start(BOX(2), JSON.parse(JSON.stringify(s1)) as BoxSnapshot);
    expect(left.session.box!.mirrored).toBe(true);
    expect(left.pos).toEqual([-0.2, -0.3, 1.3]);
    expect(left.session.isOpen(0)).toBe(true);
    expect(left.session.snapshot().mirrored).toBe(true);
    // A save from before saves said (no `mirrored`) is taken as it is.
    const old: BoxSnapshot = { ...s1 };
    delete old.mirrored;
    const l2 = harness({ handed: "left" });
    await l2.session.start(BOX(2), old);
    expect(l2.pos).toEqual([0.2, -0.3, 1.3]);
  });

  it("the Left hand setting mirrors the box in play from its own save: the same open locks, time and hints", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    h.place(h.session.box!.locks[0]!.L);
    h.until(() => h.session.isOpen(0), 1000);
    h.place([0.15, -0.25, 1.3]);
    h.frames(30);
    const before = h.session.snapshot();
    h.settings.handed = "left";
    await h.session.rehand();
    expect(h.session.box!.mirrored).toBe(true);
    expect(h.pos).toEqual([-0.15, -0.25, 1.3]);
    expect(h.session.isOpen(0)).toBe(true);
    expect(h.session.isOpen(1)).toBe(false);
    expect(h.session.snapshot()).toMatchObject({ key: before.key, open: [0], elapsedMs: before.elapsedMs, mirrored: true });
    // Nothing to do when the box already matches the hand, or none plays.
    const box = h.session.box;
    await h.session.rehand();
    expect(h.session.box).toBe(box);
    await harness().session.rehand();
  });

  it("a version 3 box in play switched to the left hand is version 3's box mirrored, still saved under 3", async () => {
    const then = generateBox({ kind: "box", n: 12, gen: 3 }), plain = then.locks.find((l) => !l.finger)!;
    const save: BoxSnapshot = { key: then.key, gen: 3, mirrored: false, lantern: [0.15, -0.3, 1.3], open: [plain.i], crystal: [], elapsedMs: 9_000, hints: 0, hintLevel: {} };
    const h = harness();
    await h.session.start(BOX(12), save);
    expect(h.session.box!.elements).toEqual(then.elements);
    h.settings.handed = "left";
    await h.session.rehand();
    expect(h.session.box).toEqual(mirrorBox(then));
    expect(h.session.spec).toEqual({ kind: "box", n: 12, gen: 3 });
    expect(h.session.isOpen(plain.i)).toBe(true);
    expect(h.pos).toEqual([-0.15, -0.3, 1.3]);
    expect(h.session.snapshot()).toMatchObject({ key: then.key, gen: 3, mirrored: true, open: [plain.i], elapsedMs: 9_000 });
  });

  it("a version 3 save made left-handed resumes as version 3's box, mirrored, for either hand", async () => {
    const then = generateBox({ kind: "box", n: 12, gen: 3 }), plain = then.locks.find((l) => !l.finger)!;
    const save: BoxSnapshot = { key: then.key, gen: 3, mirrored: true, lantern: [-0.15, -0.3, 1.3], open: [plain.i], crystal: [], elapsedMs: 9_000, hints: 0, hintLevel: {} };
    const left = harness({ handed: "left" });
    await left.session.start(BOX(12), save);
    expect(left.session.box).toEqual(mirrorBox(then));
    expect(left.pos).toEqual([-0.15, -0.3, 1.3]);
    expect(left.session.isOpen(plain.i)).toBe(true);
    // Resumed right-handed: the box the other way round, the lantern crossing to the same side of it.
    const right = harness();
    await right.session.start(BOX(12), save);
    expect(right.session.box).toEqual(then);
    expect(right.pos).toEqual([0.15, -0.3, 1.3]);
    expect(right.session.isOpen(plain.i)).toBe(true);
    expect(right.session.snapshot()).toMatchObject({ gen: 3, mirrored: false });
  });

  it("Next asks the entitlement: when endless boxes are not allowed (a trial over) it starts none and says so", async () => {
    const profile = newProfile(0, "test");
    let allowed = true;
    const h = harness({ profile, canPlayBox: () => allowed });
    await h.session.start({ kind: "daily", day: "2026-11-06" });
    openPlainLocks(h);
    for (const l of h.session.box!.locks) if (l.finger) openFingerLock(h, l);
    h.until(() => h.session.stage === "reward", LOCK_TO_BOX_MS + REWARD_UP_MS + 100);
    h.view.acts = ACT_TAKE;
    h.frames(1);
    allowed = false;
    const daily = h.session.box;
    h.view.acts = ACT_NEXT;
    h.frames(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.refused()).toBe(1);
    expect(h.session.box).toBe(daily);
    expect(h.session.stage).toBe("offered");
    allowed = true;
    h.view.acts = ACT_NEXT;
    h.frames(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.session.box?.key).toBe(generateBox(BOX(1)).key);
  });

  it("a practice box never touches the player's progress, and its Next is the next practice box", async () => {
    const profile = newProfile(0, "test");
    profile.nextBox = 7;
    const box7: BoxSnapshot = { key: generateBox(BOX(7)).key, gen: GENERATOR_VERSION, lantern: [0, -0.3, 1.3], open: [0], crystal: [], elapsedMs: 4000, hints: 1, hintLevel: { 0: 1 } };
    profile.current = box7;
    const before = JSON.stringify(profile);
    const h = harness({ profile });
    await h.session.start(BOX(3), null, { practice: true });
    expect(h.session.practice).toBe(true);
    expect(h.session.saving).toBeNull();
    openPlainLocks(h);
    for (const l of h.session.box!.locks) if (l.finger) openFingerLock(h, l);
    h.until(() => h.session.stage === "reward", LOCK_TO_BOX_MS + REWARD_UP_MS + 100);
    expect(h.types("box-open")).toHaveLength(1);
    h.view.acts = ACT_TAKE;
    h.frames(1);
    expect(h.session.stage).toBe("offered");
    // Solved, taken: the box in progress, the next box and the collection are as they were, and nothing was saved.
    expect(JSON.stringify(profile)).toBe(before);
    expect(h.saves()).toBe(0);
    h.view.acts = ACT_NEXT;
    h.frames(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.session.box?.key).toBe(generateBox(BOX(4)).key);
    expect(h.session.practice).toBe(true);
    expect(h.session.saving).toBeNull();
    // A real box after it saves again.
    await h.session.start(BOX(7), profile.current);
    expect(h.session.practice).toBe(false);
    expect(h.session.saving).toEqual(BOX(7));
    expect(h.session.isOpen(0)).toBe(true);
  });

  it("a Next hook can take the plate's Next (a friend's box goes on to lesson 2 or Home), before the entitlement", async () => {
    let refuse = true;
    const h = harness({ canPlayBox: () => !refuse });
    let asked = 0;
    h.session.nextHook = () => {
      asked++;
      return h.session.practice;
    };
    await h.session.start(BOX(3), null, { practice: true });
    openPlainLocks(h);
    for (const l of h.session.box!.locks) if (l.finger) openFingerLock(h, l);
    h.until(() => h.session.stage === "reward", LOCK_TO_BOX_MS + REWARD_UP_MS + 100);
    h.view.acts = ACT_TAKE;
    h.frames(1);
    h.view.acts = ACT_NEXT;
    h.frames(1);
    await new Promise((r) => setTimeout(r, 0));
    // Taken by the hook: no next box, no trial screen, the box stays where it was.
    expect([asked, h.refused(), h.session.box?.key, h.session.stage]).toEqual([1, 0, generateBox(BOX(3)).key, "offered"]);
    // A box the hook leaves alone goes on as before.
    refuse = false;
    await h.session.start(BOX(3));
    openPlainLocks(h);
    for (const l of h.session.box!.locks) if (l.finger) openFingerLock(h, l);
    h.until(() => h.session.stage === "reward", LOCK_TO_BOX_MS + REWARD_UP_MS + 100);
    h.view.acts = ACT_TAKE;
    h.frames(1);
    h.view.acts = ACT_NEXT;
    h.frames(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toBe(2);
    expect(h.session.box?.key).toBe(generateBox(BOX(4)).key);
  });

  it("Next after a Daily Box resumes the box in progress, as Continue does, even one that is not the next box", async () => {
    const profile = newProfile(0, "test");
    // Box 2 in progress while the next box is 5 (a box in progress is never dropped for another).
    profile.nextBox = 5;
    const a = harness({ profile });
    await a.session.start(BOX(2));
    a.place(a.session.box!.locks[0]!.L);
    a.until(() => a.session.isOpen(0), 1000);
    profile.current = a.session.snapshot();
    const h = harness({ profile });
    await h.session.start({ kind: "daily", day: "2026-11-06" });
    openPlainLocks(h);
    for (const l of h.session.box!.locks) if (l.finger) openFingerLock(h, l);
    h.until(() => h.session.stage === "reward", LOCK_TO_BOX_MS + REWARD_UP_MS + 100);
    h.view.acts = ACT_TAKE;
    h.frames(1);
    h.view.acts = ACT_NEXT;
    h.frames(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.session.box?.key).toBe(generateBox(BOX(2)).key);
    expect(h.session.isOpen(0)).toBe(true);
    expect(h.session.snapshot().elapsedMs).toBe(profile.current!.elapsedMs);
    // Box 2 solved: none in progress, so Next is the next box (still 5), afresh.
    openPlainLocks(h);
    for (const l of h.session.box!.locks) if (l.finger && !h.session.isOpen(l.i)) openFingerLock(h, l);
    h.until(() => h.session.stage === "reward", LOCK_TO_BOX_MS + REWARD_UP_MS + 100);
    expect([profile.current, profile.nextBox]).toEqual([null, 5]);
    h.view.acts = ACT_TAKE;
    h.frames(1);
    h.view.acts = ACT_NEXT;
    h.frames(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.session.box?.key).toBe(generateBox(BOX(5)).key);
    expect(h.session.isOpen(0)).toBe(false);
  });

  it("the fingertip hum stops whenever play does: the last lock, a new box, out of view", async () => {
    const h = harness();
    await h.session.start(BOX(3));
    const box = h.session.box!;
    const fl = box.locks.find((l) => l.finger)!;
    const plain = box.locks.find((l) => !l.finger)!;
    openFingerLock(h, fl);
    h.frames(1);
    expect(h.fingerCalls.at(-1)!.progress).toBeNull();
    // A finger back in the beam hums; the last lock opening ends play, and the hum, for good.
    setFinger(h, fl.target[fl.missing]!);
    h.frames(2);
    expect(h.fingerCalls.at(-1)!.progress).not.toBeNull();
    h.place(plain.L);
    h.until(() => h.session.stage === "opening", 1000);
    expect(h.fingerCalls.at(-1)!.progress).toBeNull();
    const n = h.fingerCalls.length;
    h.frames(30);
    expect(h.fingerCalls.length).toBe(n);
    // Out of view, and a new box.
    const g = harness();
    await g.session.start(BOX(3));
    setFinger(g, [
      [0, 0],
      [0.05, 0],
      [0.05, 0.05],
    ]);
    g.frames(2);
    expect(g.fingerCalls.at(-1)!.progress).not.toBeNull();
    g.session.pause(g.now());
    expect(g.fingerCalls.at(-1)!.progress).toBeNull();
    g.session.resume(g.now());
    g.frames(2);
    expect(g.fingerCalls.at(-1)!.progress).not.toBeNull();
    await g.session.start(BOX(4));
    expect(g.fingerCalls.at(-1)!.progress).toBeNull();
  });

  it("the focus clears when the lock in focus opens, and an open lock is never focused", async () => {
    const h = harness();
    await h.session.start(BOX(2));
    const a = h.session.box!.locks[0]!;
    h.head.hit = [a.center[0], a.center[1], 0];
    h.until(() => h.session.focus === 0, 1000);
    h.place(a.L);
    h.until(() => h.session.isOpen(0), 1000);
    expect(h.session.focus).toBeNull();
    expect(h.types("focus")).toEqual([
      { type: "focus", lock: 0 },
      { type: "focus", lock: null },
    ]);
    expect(h.calls.filter((c) => c.startsWith("focus"))).toEqual(["focus 0", "focus null"]);
    // Still looking at it: no focus comes back.
    h.frames(Math.ceil((2 * GAZE_DWELL_MS) / DT));
    expect(h.session.focus).toBeNull();
    expect(h.types("focus")).toHaveLength(2);
  });

  it("a still finger measures nothing: the locks are measured again only when its shadow changes", async () => {
    const h = harness();
    await h.session.start(BOX(3));
    const fl = h.session.box!.locks.find((l) => l.finger)!;
    const cov = h.session.fingerLock(fl.i)!.coverage;
    h.place(fl.L);
    h.frames(2);
    const empty = cov.gap;
    setFinger(h, fl.target[fl.missing]!);
    h.frames(1);
    const filled = cov.gap;
    expect(filled).toBeGreaterThan(empty);
    // The shadow changes without the counter moving: nothing is measured (the lantern is still too).
    h.finger.finger = [];
    h.finger.nFinger = 0;
    h.frames(2);
    expect(cov.gap).toBe(filled);
    // The counter moves: measured again.
    h.finger.version++;
    h.frames(1);
    expect(cov.gap).toBe(empty);
  });

  it("with controllers in use, a finger lock one piece short shows the coach line until its gap is filled", async () => {
    const h = harness();
    h.finger.controllers = true;
    await h.session.start(BOX(3));
    const fl = h.session.box!.locks.find((l) => l.finger)!;
    h.frames(3);
    expect(h.types("coach")).toEqual([]);
    // It comes once the lock has been one piece short for COACH_HOLD_MS.
    h.place(fl.L);
    const t0 = h.now();
    h.until(() => h.types("coach").length > 0, 1000);
    expect(h.now() - t0).toBeGreaterThanOrEqual(COACH_HOLD_MS);
    expect(h.now() - t0).toBeLessThan(COACH_HOLD_MS + 2 * DT);
    expect(h.types("coach")).toEqual([{ type: "coach", line: "controllerFinger" }]);
    expect(h.view.calls).toContain("coach controllerFinger");
    openFingerLock(h, fl);
    expect(h.types("coach")).toEqual([
      { type: "coach", line: "controllerFinger" },
      { type: "coach", line: null },
    ]);
    // Without controllers, no line.
    const g = harness();
    await g.session.start(BOX(3));
    g.place(fl.L);
    g.frames(Math.ceil((2 * COACH_HOLD_MS) / DT));
    expect(g.types("short")).toHaveLength(1);
    expect(g.types("coach")).toEqual([]);
  });

  it("the coach line does not flicker: on and off the spot faster than its hold changes nothing", async () => {
    const h = harness();
    h.finger.controllers = true;
    await h.session.start(BOX(3));
    const fl = h.session.box!.locks.find((l) => l.finger)!;
    const away = [fl.L[0], fl.L[1], fl.L[2] + 1];
    // On the spot and off it every 200 ms (under the 300 ms hold), for 3 s: never shown.
    for (let i = 0; i < 15; i++) {
      h.place(i % 2 ? away : fl.L);
      h.frames(Math.round(200 / DT));
    }
    expect(h.types("short").length).toBeGreaterThan(5);
    expect(h.types("coach")).toEqual([]);
    // Held on the spot: shown; leaving it for 200 ms and coming back keeps it; leaving for good puts it out.
    h.place(fl.L);
    h.until(() => h.types("coach").length === 1, 1000);
    h.place(away);
    h.frames(Math.round(200 / DT));
    h.place(fl.L);
    h.frames(Math.round(600 / DT));
    expect(h.types("coach")).toHaveLength(1);
    h.place(away);
    h.until(() => h.types("coach").length === 2, 1000);
    expect(h.types("coach")[1]).toEqual({ type: "coach", line: null });
  });
});
