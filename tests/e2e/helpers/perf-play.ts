// The play case the performance budgets time (perf-budget.spec.ts on the project's Quest 3 profile, and
// perf-budget-quest2.spec.ts on Quest 2's): box 15 played through the box session, the lantern carried back and forth
// in the right hand and the left hand's fingers in the beam, casting; then windows of frames timed with the CPU
// throttled.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { hands, Pointer, worldOf } from "./finger";
import { Hands } from "./hands";
import { carry, grab, lantern, loadAverage, TIMED_FRAMES, toWorld, WINDOWS } from "./lantern";
import { expect } from "./test";
import type { XrApp } from "./xr-app";

/** Every app system the perf hook times: hands, lantern, the game, shell with the box and the theatre, menus, sound. */
export const PLAY_SYSTEMS = ["hand-pinch", "hands", "lantern", "game", "menus", "shell", "sound"];

/** One timed window: our systems' time a frame, the whole frame's, and the most draw calls and triangles in a frame. */
export interface PlayWindow {
  /** Our systems' update time a frame (real ms), the window's frames in order. */
  frames: number[];
  /** Each of PLAY_SYSTEMS' own time, the same frames. */
  bySystem: Record<string, number[]>;
  /** The periods the kernel paused the test container meanwhile (containerThrottles), or null when unknown. */
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
 * Box 15 in play with the lantern held and a hand in the beam. Returns the sweep that carries the lantern to one end
 * or the other of its path in 600 ms (even `i` one way, odd the other), after eight sweeps to warm the engine up.
 */
export async function box15InPlay(app: XrApp, page: Page): Promise<(i: number) => Promise<void>> {
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 15 }));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "box 15 in play" },
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
 * How many 100 ms periods the kernel has paused this test container for using more CPU than its quota (the cgroup's
 * `nr_throttled`; helpers/stall-rule.ts, judgeSystemWindowsP95), or null where the counter cannot be read.
 */
export function containerThrottles(): number | null {
  for (const f of ["/sys/fs/cgroup/cpu.stat", "/sys/fs/cgroup/cpu/cpu.stat"]) {
    try {
      const m = /^nr_throttled (\d+)$/m.exec(fs.readFileSync(f, "utf8"));
      if (m) return Number(m[1]);
    } catch {
      // the next place
    }
  }
  return null;
}

/** `count` windows (WINDOWS by default) of TIMED_FRAMES frames one after the other, sweeping, the CPU throttled `rate` times. */
export async function timedWindows(
  app: XrApp,
  page: Page,
  sweep: (i: number) => Promise<void>,
  rate: number,
  count = WINDOWS,
): Promise<PlayWindow[]> {
  const cdp = await page.context().newCDPSession(page);
  const windows: PlayWindow[] = [];
  try {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    for (let w = 0; w < count; w++) {
      const load0 = loadAverage();
      await page.evaluate(() => window.__ns!.resetPerf());
      const throttled0 = containerThrottles();
      for (let i = 0; (await app.perf()).frames < TIMED_FRAMES; i++) await sweep(i);
      const throttled1 = containerThrottles();
      const frames = (await page.evaluate((s) => window.__ns!.perfFrames(s), PLAY_SYSTEMS)).slice(-TIMED_FRAMES);
      // Each of our systems' own time, the same frames (where a stall fell).
      const bySystem = await page.evaluate(
        ({ names, n }) => Object.fromEntries(names.map((k) => [k, window.__ns!.perfFrames([k]).slice(-n)])),
        { names: PLAY_SYSTEMS, n: TIMED_FRAMES },
      );
      const whole = await page.evaluate(() => window.__ns!.perfWhole());
      const from = Math.max(0, whole.update.length - TIMED_FRAMES);
      // Draw calls and triangles: the most in any one frame of the window, every frame counted.
      const perf = await app.perf();
      const loads = [load0, loadAverage()].filter((l): l is number => l !== undefined);
      windows.push({
        frames,
        bySystem,
        throttled: throttled0 !== null && throttled1 !== null ? throttled1 - throttled0 : null,
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
