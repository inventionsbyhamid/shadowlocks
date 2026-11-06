/* eslint-disable @typescript-eslint/no-explicit-any */
// The box session end to end: boxes played through the test hooks (the lantern put on each spot), the box opening,
// the reward taken by hand and the next box offered on the plate; a reload resuming the box; a hidden page stopping
// the clock; and the head's gaze choosing the lock in focus. IWER's emulated headset and hands on the virtual clock.
import type { Page } from "@playwright/test";
import type { SlKey, SlSessionState } from "../../src/app/test-api";
import type { BoxSpec, V3, Vec3 } from "../../src/core/types";
import { SEATED } from "./helpers/boot";
import { Hands } from "./helpers/hands";
import { add, dist, sub, toWorld, unit } from "./helpers/lantern";
import { setHeadset, storedInProgress } from "./helpers/page-scripts";
import { expect, test } from "./helpers/test";
import { DT, POKE_DEPTH_M, type XrApp } from "./helpers/xr-app";

/** Play time from the last lock opening until the reward can be taken (box-session.ts), with a margin. */
const REWARD_UP_WITHIN_MS = 4_000;
/** A reward nobody takes is collected after 8 s. */
const AUTO_TAKE_MS = 8_000;

const session = (page: Page): Promise<SlSessionState | null> => page.evaluate(() => window.__sl!.session.state());

async function play(app: XrApp, page: Page, spec: BoxSpec): Promise<SlSessionState> {
  await page.evaluate((s) => window.__sl!.session.play(s), spec);
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "the box in play" },
  );
  return (await session(page))!;
}

/** Put the lantern on a spot and step until the session has opened that lock. */
async function openWithLantern(app: XrApp, page: Page, lock: number, spot: V3): Promise<void> {
  await page.evaluate((L) => window.__sl!.placeLantern(L), spot);
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 2_000, batch: 1, label: `lock ${lock} open` });
}

/**
 * A finger lock opened by a pointing index finger laid in its gap (the hand system casts the finger's shadow, the
 * session holds it for 0.6 s and forms the piece). The hand system comes with the hand shadows work.
 */
async function openWithFinger(_app: XrApp, _page: Page, lock: number): Promise<void> {
  throw new Error(`finger lock ${lock}: the hand system is not on this branch yet`);
}

/** The plate's and the hint lantern's keys. */
const keys = (page: Page): Promise<SlKey[]> => page.evaluate(() => window.__sl!.session.keys());

/** Poke a key of the box (the plate, the hint lantern) with the right index fingertip along its normal, and back out. */
async function pokeKey(app: XrApp, id: string): Promise<SlKey> {
  const k = (await keys(app.page)).find((x) => x.id === id);
  if (!k || !k.live) throw new Error(`no live key "${id}" (have: ${(await keys(app.page)).map((x) => `${x.id}${x.live ? "" : " (off)"}`).join(", ")})`);
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

/** Pinch the reward where it floats, carry it 12 cm toward the head and open the hand. */
async function dropRewardTowardMe(app: XrApp, page: Page): Promise<void> {
  const r = (await page.evaluate(() => window.__sl!.session.reward()))!;
  expect(r.up).toBe(true);
  const head = (await app.state()).head!;
  const hand = new Hands(app, "left");
  await hand.pinchAt(r.world);
  await app.step(6);
  expect((await page.evaluate(() => window.__sl!.session.reward()))!.held).toBe(true);
  await hand.moveTo(add(r.world, unit(sub(head, r.world)), 0.12), 400);
  await hand.release();
  // The hand leaves.
  await hand.moveTo(add(r.world, [0.2, 0.25, 0.2]), 200);
}

test("test hooks solve boxes 1 to 3", async ({ page, boot }) => {
  const app = await boot();
  let s = await play(app, page, { kind: "box", n: 1 });
  for (let n = 1; n <= 3; n++) {
    expect(s.key).toBe(`shadow-locks/${n}`);
    expect(s.open).toEqual([]);
    const frame = await page.evaluate(() => window.__sl!.frameState());
    expect(frame).toMatchObject({ boxKey: s.key, openLocks: [], screen: "play" });
    await page.evaluate(() => window.__ns!.clearEvents());
    // Every plain lock with the lantern on its spot, then the finger lock with a finger in its gap.
    const plain = s.locks.filter((l) => !l.finger);
    const finger = s.locks.filter((l) => l.finger);
    expect(finger).toHaveLength(n === 3 ? 1 : 0);
    for (const l of plain) await openWithLantern(app, page, l.i, l.spot);
    for (const l of finger) {
      await page.evaluate((L) => window.__sl!.placeLantern(L), l.spot);
      await openWithFinger(app, page, l.i);
    }
    const opened = (await app.events("lock-open")) as unknown as { lock: number; order: number }[];
    expect(opened.map((e) => e.order)).toEqual(s.locks.map((_, i) => i + 1));
    expect(opened.map((e) => e.lock).sort()).toEqual(s.locks.map((l) => l.i));
    expect((await page.evaluate(() => window.__sl!.frameState()))!.openLocks).toEqual(s.locks.map((l) => l.i));
    // The box opens, the reward rises and is taken (by hand on box 1, by itself after 8 s on the others).
    await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "reward", { maxMs: REWARD_UP_WITHIN_MS, label: "the reward up" });
    expect(await app.events("box-open")).toEqual([{ type: "box-open", key: s.key }]);
    const before = await session(page);
    if (n === 1) await dropRewardTowardMe(app, page);
    await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "offered", { maxMs: AUTO_TAKE_MS + 1_000, label: "the reward taken" });
    expect(await app.events("reward-taken")).toEqual([{ type: "reward-taken", key: s.key }]);
    const after = (await session(page))!;
    expect(after.collected).toBe(before!.collected + 1);
    expect(after.nextBox).toBe(n + 1);
    // The plate offers the next box: poke it.
    expect((await keys(page)).find((k) => k.id === "plate-next")?.live).toBe(true);
    await pokeKey(app, "plate-next");
    await app.stepUntil(
      (_ns, w, key) => {
        const st = w.__sl.session.state();
        return st.key === key && st.stage === "playing" && st.revealed;
      },
      { arg: `shadow-locks/${n + 1}`, maxMs: 10_000, label: `box ${n + 1} in play` },
    );
    s = (await session(page))!;
    expect(await app.events("box-start")).toEqual([{ type: "box-start", key: `shadow-locks/${n + 1}` }]);
  }
  expect(s.collected).toBe(3);
  expect(app.consoleLines.filter((l) => l.startsWith("error:") || l.startsWith("PAGEERROR"))).toEqual([]);
});

test("reload resumes the box", async ({ page, boot }) => {
  let app = await boot();
  const s = await play(app, page, { kind: "box", n: 3 });
  const plain = s.locks.find((l) => !l.finger)!;
  const finger = s.locks.find((l) => l.finger)!;
  await openWithLantern(app, page, plain.i, plain.spot);
  await page.evaluate((L) => window.__sl!.placeLantern(L), finger.spot);
  await openWithFinger(app, page, finger.i);
  const P: V3 = [0.08, -0.33, 1.29];
  await page.evaluate((L) => window.__sl!.placeLantern(L), P);
  await app.step(10);
  const before = (await session(page))!;
  expect(before.open).toEqual([plain.i, finger.i].sort());
  expect(before.crystals).toHaveLength(1);
  // Saved as the lifecycle saves it (forced, as on hide), then the page is loaded again.
  await page.evaluate(() => window.__sl!.session.save());
  await app.step(2);
  const stored = (await page.evaluate(storedInProgress)) as { key: string; lantern: V3; open: number[]; crystal: unknown[] } | null;
  expect(stored).toMatchObject({ key: s.key, lantern: P, open: before.open, crystal: before.crystals });

  app = await boot();
  expect((await session(page))?.stage ?? "idle").toBe("idle");
  expect(await page.evaluate(() => window.__sl!.session.continue())).toBe(true);
  await app.stepUntil(
    (_ns, w) => {
      const st = w.__sl.session.state();
      return st?.stage === "playing" && st.revealed;
    },
    { maxMs: 10_000, label: "the saved box in play" },
  );
  const after = (await session(page))!;
  expect(after.key).toBe(s.key);
  expect(after.open).toEqual(before.open);
  expect(after.crystals).toEqual(before.crystals);
  expect(after.elapsedMs).toBeGreaterThanOrEqual(before.elapsedMs);
  const frame = (await page.evaluate(() => window.__sl!.frameState()))!;
  expect(dist(frame.lantern, P)).toBeLessThan(1e-9);
  expect(frame.openLocks).toEqual(before.open);
  expect((await page.evaluate(() => window.__sl!.lantern())).pos).toEqual(P);
  // The panel shows the open locks filled again, and the crystallised piece hangs in the box.
  await app.step(40);
  const panel = await page.evaluate(() => window.__sl!.panelState());
  for (const i of before.open) expect(panel.open[i]).toBeCloseTo(1, 3);
  expect((await page.evaluate(() => window.__ns!.scene.draws())).parts).toContain("Crystal Piece");
});

test("hidden page pauses time", async ({ page, boot }) => {
  const app = await boot();
  await play(app, page, { kind: "box", n: 1 });
  await app.step(72);
  const shown = async (visible: boolean) => {
    await page.evaluate((v) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => !v });
      document.dispatchEvent(new Event("visibilitychange"));
    }, visible);
  };
  const elapsed = async () => (await session(page))!.elapsedMs;
  const a = await elapsed();
  expect(a).toBeGreaterThan(900);
  await shown(false);
  const atHide = await elapsed();
  // Hiding saves the box at once, with the time played so far.
  await app.step(2);
  const stored = (await page.evaluate(storedInProgress)) as { key: string; elapsedMs: number } | null;
  expect(stored?.key).toBe("shadow-locks/1");
  expect(stored!.elapsedMs).toBeCloseTo(atHide, 6);
  // Five seconds hidden count nothing.
  await app.step(72 * 5);
  expect(await elapsed()).toBe(atHide);
  await shown(true);
  await app.step(72);
  const back = await elapsed();
  expect(back - atHide).toBeGreaterThan(1000 - 2 * DT);
  expect(back - atHide).toBeLessThan(1000 + DT);
});

test("session shots: a lock opening, the box opening, the reward and the plate's next box", async ({ page, boot }) => {
  const app = await boot({ mode: "visual" });
  const s = await play(app, page, { kind: "box", n: 1 });
  const panel = (await app.state()).boxPose.position;
  const at = { x: panel[0], y: panel[1], z: panel[2] };
  await app.captureHeadset("session-box1-start-headset", at);
  // A frame is up to 100 ms of play here (the session's longest step), so the sequence takes few rendered frames.
  const playFor = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) await app.step(1, 100);
  };
  await openWithLantern(app, page, 0, s.locks[0]!.spot);
  await playFor(200);
  await app.captureHeadset("session-lock-open-headset", at);
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "opening" && w.__ns.events("box-open").length > 0, { maxMs: 2_000, dt: 100, label: "the box opens" });
  await playFor(300);
  await app.captureHeadset("session-box-open-sweep-headset", at);
  await playFor(1200);
  await app.captureHeadset("session-box-open-walls-headset", at);
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "reward", { maxMs: REWARD_UP_WITHIN_MS, dt: 100, label: "the reward up" });
  await app.capture("session-reward-up");
  const r = (await page.evaluate(() => window.__sl!.session.reward()))!;
  await app.captureHeadset("session-reward-up-headset", { x: r.world[0], y: r.world[1], z: r.world[2] });
  await app.stepUntil((_ns, w) => w.__sl.session.state().stage === "offered", { maxMs: AUTO_TAKE_MS + 1_000, dt: 100, label: "the reward taken" });
  await playFor(500);
  const next = (await keys(page)).find((k) => k.id === "plate-next")!;
  expect(next.live).toBe(true);
  await app.captureHeadset("session-next-offered-headset", { x: next.world[0], y: next.world[1], z: next.world[2] });
});

test("gaze focus picks the lock you look at", async ({ page, boot }) => {
  const app = await boot();
  const s = await play(app, page, { kind: "box", n: 5 });
  expect(s.locks).toHaveLength(3);
  const centres: Vec3[] = [];
  for (const l of s.locks) centres.push(await toWorld(page, [l.center[0], l.center[1], 0]));
  const look = (target: Vec3) =>
    page.evaluate(setHeadset, { position: SEATED.position, lookAt: { x: target[0], y: target[1], z: target[2] } });
  /** Turn the head to lock `i` and step frame by frame until its focus event; returns the virtual ms it took. */
  const focusOn = async (i: number): Promise<number> => {
    await page.evaluate(() => window.__ns!.clearEvents());
    await look(centres[i]!);
    const t0 = await app.now();
    await app.stepUntil((ns, _w, lock) => ns.events("focus").some((e: any) => e.lock === lock), { arg: i, batch: 1, maxMs: 1_000, label: `focus on lock ${i}` });
    const took = (await app.now()) - t0;
    expect(await app.events("focus")).toEqual([{ type: "focus", lock: i }]);
    expect((await session(page))!.focus).toBe(i);
    return took;
  };
  // From each lock to the next: the focus moves 400 ms after the head turns (to the frame).
  const order = [0, 1, 2, 0];
  for (let k = 0; k < order.length; k++) {
    const took = await focusOn(order[k]!);
    if (k === 0) continue;
    expect(took).toBeGreaterThanOrEqual(400);
    expect(took).toBeLessThan(400 + 2 * DT);
  }
  // A glance at another lock shorter than the dwell moves nothing; looking off the panel keeps the focus.
  await page.evaluate(() => window.__ns!.clearEvents());
  await look(centres[1]!);
  await app.step(Math.floor(400 / DT) - 3);
  await look([SEATED.lookAt.x + 0.6, SEATED.lookAt.y, SEATED.lookAt.z]);
  await app.step(72);
  expect(await app.events("focus")).toEqual([]);
  expect((await session(page))!.focus).toBe(0);
});
