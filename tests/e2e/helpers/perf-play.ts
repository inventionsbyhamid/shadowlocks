// The play case the performance budgets time (perf-budget.spec.ts on the project's Quest 3 profile, and
// perf-budget-quest2.spec.ts on Quest 2's): box 15 (and the heaviest box from 10 to 60) played through the box session,
// the lantern carried back and forth in the right hand and the left hand's fingers in the beam, casting; then windows
// of frames timed with the CPU throttled.
//
// The emulator's joint poses (Ruling 180a): IWER makes up each hand's joint poses in JavaScript (XRFrame.fillPoses),
// where a headset's runtime hands them over natively. Our hand pinch system (all 25 joints of each hand) and the
// game's fingertip keys call it, so that JavaScript runs inside two of our timed systems. timedWindows times it there
// (timeEmulatorPoses: the harness wraps IWER's fillPoses and our systems' update from the page; no game code changes)
// and gives each window's frames both raw and judged: judged = raw less that time, frame by frame and system by
// system, the same way the specs already leave IWER's work in IWSDK's input update out of our JS. The wrapper's own
// work outside the span it times is a flag read and a store per call (well under a microsecond a frame), far below
// the page clock's 0.1 ms grain; the system wrapper sets its flag outside the span the perf hook times.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { hands, Pointer, worldOf } from "./finger";
import { Hands } from "./hands";
import { carry, grab, lantern, loadAverage, TIMED_FRAMES, toWorld, WINDOWS } from "./lantern";
import { type ContainerCpu, pausesBetween } from "./stall-rule";
import { expect } from "./test";
import type { XrApp } from "./xr-app";

/** Every app system the perf hook times: hands, lantern, the game, shell with the box and the theatre, menus, sound. */
export const PLAY_SYSTEMS = ["hand-pinch", "hands", "lantern", "game", "menus", "shell", "sound"];

/** PLAY_SYSTEMS' classes (the dev server keeps class names), and the name the perf hook times each under. */
const PLAY_CLASSES: Record<string, string> = {
  HandPinchSystem: "hand-pinch",
  HandSystem: "hands",
  LanternSystem: "lantern",
  GameSystem: "game",
  MenuSystem: "menus",
  ShellSystem: "shell",
  SoundSystem: "sound",
};
/** Frames of emulator pose time kept (the perf hook keeps 240). */
const POSE_RING = 240;

/** One timed window: our systems' time a frame, the whole frame's, and the most draw calls and triangles in a frame. */
export interface PlayWindow {
  /** Our systems' update time a frame (real ms), the window's frames in order: raw, IWER's joint poses in them too. */
  frames: number[];
  /** Each of PLAY_SYSTEMS' own time, the same frames (raw). */
  bySystem: Record<string, number[]>;
  /** IWER's joint-pose JavaScript run inside PLAY_SYSTEMS (real ms), the same frames: emulator work, excused. */
  poses: number[];
  /** Our JS a frame as judged: `frames` less `poses`. */
  judged: number[];
  /** Each system's own time as judged: `bySystem` less its share of `poses`. */
  judgedBySystem: Record<string, number[]>;
  /**
   * The periods the kernel paused the test container meanwhile (pausesBetween), or null when unknown: no counter, or no
   * quota period counted (the spec then excuses MAX_STALLS, the 4x rule's allowance).
   */
  throttled: number | null;
  /** Every system's update a frame, IWSDK's (input, UI) and ours (real ms). */
  update: number[];
  /**
   * The render after it (real ms): three's JavaScript and the commands it sends. Reported only: the emulator renders in
   * software, and its frames wait on that work in ways a headset's do not.
   */
  render: number[];
  calls: number;
  triangles: number;
  load: number | undefined;
  /** p95 ms by system. */
  systems: Record<string, number>;
}

/**
 * Box n in play with the lantern held and a hand in the beam: box 15, and the heaviest box from 10 to 60
 * (helpers/heavy-box.ts). Returns the sweep that carries the lantern to one end or the other of its path in 600 ms
 * (even `i` one way, odd the other), after eight sweeps to warm the engine up.
 */
export async function boxInPlay(app: XrApp, page: Page, n: number): Promise<(i: number) => Promise<void>> {
  await page.evaluate((n) => window.__sl!.session.play({ kind: "box", n }), n);
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: `box ${n} in play` },
  );
  // The lantern in front of the box's middle, picked up by the right hand and carried between two points in front of
  // the mouth (inside the comfort envelope).
  const right = new Hands(app, "right");
  await page.evaluate(() => window.__sl!.placeLantern([0.05, -0.1, 1.25]));
  await app.step(2);
  const off = await grab(app, page, right);
  const a = await toWorld(page, [-0.12, -0.18, 1.2]);
  const b = await toWorld(page, [0.18, -0.28, 1.38]);
  // The left hand's fingers in the beam, casting.
  const left = new Pointer(app, "left");
  const [tip] = await worldOf(page, [[0.1, 0.05, 0.6]]);
  await left.point(tip!, [1, 0, 0], [0, 0, -1]);
  const sweep = async (i: number) => carry(right, off, i % 2 ? a : b, 600);
  for (let i = 0; i < 8; i++) await sweep(i);
  const h = await hands(page);
  expect((await lantern(page)).held).toBe(true);
  expect(h.left!.outlines).toBeGreaterThan(0);
  return sweep;
}

/**
 * The cgroup's `nr_periods` and `nr_throttled` (helpers/stall-rule.ts, judgeSystemWindowsP95): how many 100 ms quota
 * periods have run, and in how many the kernel paused the container for using more CPU than its quota. Null where the
 * counters cannot be read.
 */
export function containerCpu(): ContainerCpu | null {
  for (const f of ["/sys/fs/cgroup/cpu.stat", "/sys/fs/cgroup/cpu/cpu.stat"]) {
    try {
      const s = fs.readFileSync(f, "utf8");
      const p = /^nr_periods (\d+)$/m.exec(s), t = /^nr_throttled (\d+)$/m.exec(s);
      if (p && t) return { periods: Number(p[1]), throttled: Number(t[1]) };
    } catch {
      // the next place
    }
  }
  return null;
}

/**
 * Time IWER's joint poses inside PLAY_SYSTEMS from now on (the module comment; once a page). In the page: IWER's
 * XRFrame.fillPoses (the emulator's global XRFrame) is timed with the perf hook's clock while one of PLAY_SYSTEMS
 * runs, and each frame's time per system is kept in a ring of POSE_RING frames, read by `window.__emuPoses.frames`.
 * Each system's update (the perf hook's timed one) is wrapped to say which system runs; world.update (the perf hook's)
 * to close each frame. Nothing is allocated per frame.
 */
export async function timeEmulatorPoses(page: Page): Promise<void> {
  await page.evaluate(
    ({ classes, ring }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (w.__emuPoses) return;
      const world = w.__ns.world;
      const now: () => number = w.__vt ? w.__vt.realNow : performance.now.bind(performance);
      const names = Object.values(classes);
      const st = { inside: -1, now: new Float64Array(names.length), rings: names.map(() => new Float64Array(ring)), n: 0 };
      const found = names.map(() => 0);
      for (const sys of world.getSystems()) {
        const k = names.indexOf(classes[sys.constructor.name] ?? "");
        // Only the app's own systems: the perf hook has put its timed update on each of them.
        if (k < 0 || !Object.prototype.hasOwnProperty.call(sys, "update")) continue;
        found[k]!++;
        const timed = sys.update as (d: number, t: number) => void;
        sys.update = (d: number, t: number) => {
          st.inside = k;
          try {
            timed(d, t);
          } finally {
            st.inside = -1;
          }
        };
      }
      const missing = names.filter((_, k) => found[k] !== 1);
      if (missing.length) throw new Error(`emulator poses: systems not found once each: ${missing.join(", ")}`);
      const proto = w.XRFrame?.prototype;
      const fill = proto?.fillPoses as ((s: XRSpace[], b: XRSpace, o: Float32Array) => boolean) | undefined;
      if (!fill) throw new Error("emulator poses: no XRFrame.fillPoses to time");
      proto.fillPoses = function (this: XRFrame, spaces: XRSpace[], base: XRSpace, out: Float32Array): boolean {
        const k = st.inside;
        if (k < 0) return fill.call(this, spaces, base, out);
        const a = now();
        const r = fill.call(this, spaces, base, out);
        st.now[k]! += now() - a;
        return r;
      };
      const update = world.update as (d: number, t: number) => void;
      world.update = (d: number, t: number) => {
        st.now.fill(0);
        update(d, t);
        const i = st.n % ring;
        for (let k = 0; k < names.length; k++) st.rings[k]![i] = st.now[k]!;
        st.n++;
      };
      w.__emuPoses = {
        /** The last `n` frames' pose time per system (by perf hook name), oldest first. */
        frames(n: number): Record<string, number[]> {
          const m = Math.min(n, st.n, ring), out: Record<string, number[]> = {};
          names.forEach((name, k) => {
            const xs: number[] = [];
            for (let j = st.n - m; j < st.n; j++) xs.push(st.rings[k]![j % ring]!);
            out[name] = xs;
          });
          return out;
        },
      };
    },
    { classes: PLAY_CLASSES, ring: POSE_RING },
  );
}

/** `count` windows (WINDOWS by default) of TIMED_FRAMES frames one after the other, sweeping, the CPU throttled `rate` times. */
export async function timedWindows(
  app: XrApp,
  page: Page,
  sweep: (i: number) => Promise<void>,
  rate: number,
  count = WINDOWS,
): Promise<PlayWindow[]> {
  await timeEmulatorPoses(page);
  const cdp = await page.context().newCDPSession(page);
  const windows: PlayWindow[] = [];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    for (let w = 0; w < count; w++) {
      const load0 = loadAverage();
      await page.evaluate(() => window.__ns!.resetPerf());
      const cpu0 = containerCpu();
      for (let i = 0; (await app.perf()).frames < TIMED_FRAMES; i++) await sweep(i);
      const cpu1 = containerCpu();
      // Our systems' time a frame, each one's own (where a stall fell) and IWER's joint poses in each, the same frames:
      // read together, so no frame comes between them.
      const read = await page.evaluate(
        ({ names, n }) => ({
          frames: window.__ns!.perfFrames(names).slice(-n),
          bySystem: Object.fromEntries(names.map((k) => [k, window.__ns!.perfFrames([k]).slice(-n)])),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          poses: (window as any).__emuPoses.frames(n) as Record<string, number[]>,
        }),
        { names: PLAY_SYSTEMS, n: TIMED_FRAMES },
      );
      const { frames, bySystem } = read;
      const poses = frames.map((_, i) => PLAY_SYSTEMS.reduce((sum, k) => sum + (read.poses[k]![i] ?? 0), 0));
      const judged = frames.map((f, i) => f - poses[i]!);
      const judgedBySystem = Object.fromEntries(
        PLAY_SYSTEMS.map((k) => [k, bySystem[k]!.map((f, i) => f - (read.poses[k]![i] ?? 0))]),
      );
      const whole = await page.evaluate(() => window.__ns!.perfWhole());
      const from = Math.max(0, whole.update.length - TIMED_FRAMES);
      // Draw calls and triangles: the most in any one frame of the window, every frame counted.
      const perf = await app.perf();
      const loads = [load0, loadAverage()].filter((l): l is number => l !== undefined);
      windows.push({
        frames,
        bySystem,
        poses,
        judged,
        judgedBySystem,
        throttled: pausesBetween(cpu0, cpu1),
        update: whole.update.slice(from),
        render: whole.render.slice(from),
        calls: perf.callsMax,
        triangles: perf.trianglesMax,
        load: loads.length ? Math.max(...loads) : undefined,
        systems: Object.fromEntries(Object.entries(perf.systems).map(([k, v]) => [k, v.p95Ms])),
      });
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.detach();
  }
  return windows;
}
