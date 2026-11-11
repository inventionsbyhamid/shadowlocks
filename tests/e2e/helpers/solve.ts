// Playing a box through to its opening, as session.spec.ts does: the lantern put on each spot through the test hooks,
// and each finger lock filled by the right index finger laid in its gap.
import type { Page } from "@playwright/test";
import type { SlKey, SlSessionState } from "../../../src/app/test-api";
import type { V3 } from "../../../src/core/types";
import { axisOf, fingerLocks, onRay, Pointer, worldOf } from "./finger";
import { POKE_DEPTH_M, type XrApp } from "./xr-app";

/** Play time from the last lock opening until the reward can be taken (box-session.ts), with a margin. */
export const REWARD_UP_WITHIN_MS = 4_000;

export const sessionState = (page: Page): Promise<SlSessionState | null> => page.evaluate(() => window.__sl!.session.state());

/** Step until the box in play is shown (the stage `playing`, its scraps revealed). */
export async function boxInPlay(app: XrApp, label = "the box in play"): Promise<SlSessionState> {
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 15_000, label },
  );
  return (await sessionState(app.page))!;
}

/** Put the lantern on a spot and step until the session has opened that lock. */
export async function openWithLantern(app: XrApp, lock: number, spot: V3): Promise<void> {
  await app.page.evaluate((L) => window.__sl!.placeLantern(L), spot);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 2_000, batch: 1, label: `lock ${lock} open` });
}

/** A finger lay this deep in the beam (box units). */
const FINGER_Z = 0.5;

/** A finger lock opened by the right index finger laid in its gap, the lantern on its spot; then the hand leaves. */
export async function openWithFinger(app: XrApp, lock: number): Promise<void> {
  const page = app.page;
  const l = (await fingerLocks(page)).find((f) => f.lock === lock)!;
  await page.evaluate((L) => window.__sl!.placeLantern(L), l.spot);
  await app.step(3);
  const { mid, angle } = axisOf(l.piece);
  const sign = Math.cos(angle) >= 0 ? -1 : 1;
  const hand = new Pointer(app, "right");
  await hand.lay(onRay(l.spot, mid, FINGER_Z), [sign * Math.cos(angle), sign * Math.sin(angle), 0]);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, batch: 1, label: `finger lock ${lock} open` });
  const [inBox, out] = await worldOf(page, [[0, 0, FINGER_Z], [0, 0, 1.6]]);
  await hand.shift([out![0] - inBox![0], out![1] - inBox![1], out![2] - inBox![2]]);
  await app.step(3);
}

/**
 * Open every lock of the box in play: the plain ones with the lantern, then the finger locks. A hand that filled a
 * finger lock is then taken out of tracking: in passthrough the real hand hides what is behind it, and it would stand
 * in front of the reward.
 */
export async function solveBox(app: XrApp, s: SlSessionState): Promise<void> {
  for (const l of s.locks.filter((x) => !x.finger)) await openWithLantern(app, l.i, l.spot);
  const fingers = s.locks.filter((x) => x.finger);
  for (const l of fingers) await openWithFinger(app, l.i);
  if (fingers.length) await new Pointer(app, "right").disconnect();
}

/**
 * Step until the reward is up (it can be taken), in frames of `dt` ms (100, the session's longest step, makes few
 * frames to draw in a visual run).
 */
export async function rewardUp(app: XrApp, dt?: number): Promise<void> {
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "reward", { maxMs: REWARD_UP_WITHIN_MS + 2_000, dt, label: "the reward up" });
}

/** Poke a key of the box (the plate's Next, the hint lantern) with the right index fingertip along its normal, and back out. */
export async function pokeBoxKey(app: XrApp, id: string): Promise<SlKey> {
  const keys = () => app.page.evaluate(() => window.__sl!.session.keys());
  const k = (await keys()).find((x) => x.id === id);
  if (!k || !k.live) throw new Error(`no live key "${id}" (have: ${(await keys()).map((x) => `${x.id}${x.live ? "" : " (off)"}`).join(", ")})`);
  const at = (d: number) => ({ x: k.world[0] + k.normal[0] * d, y: k.world[1] + k.normal[1] * d, z: k.world[2] + k.normal[2] * d });
  const device = "hand-right";
  await app.queue("set_input_mode", { mode: "hand" });
  await app.queue("set_connected", { device, connected: true });
  await app.queue("set_hand_pose", { device, poseId: "point" });
  await app.queue("set_transform", { device, anchor: "index-tip", position: at(0.15), orientation: "auto" });
  await app.queue("animate_to", { device, anchor: "index-tip", position: at(0.05), duration: 0.3, easing: "minimum-jerk" });
  await app.queue("animate_to", { device, anchor: "index-tip", position: at(POKE_DEPTH_M), duration: 0.15, easing: "minimum-jerk" });
  await app.queue("animate_to", { device, anchor: "index-tip", position: at(0.12), duration: 0.15, easing: "minimum-jerk" });
  await app.settle();
  return k;
}

/** Step until the reward has been taken (by itself after 8 s) and the plate offers Next. */
export async function rewardTaken(app: XrApp, dt?: number): Promise<void> {
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "offered", { maxMs: REWARD_UP_WITHIN_MS + 10_000, dt, label: "the reward taken" });
}

