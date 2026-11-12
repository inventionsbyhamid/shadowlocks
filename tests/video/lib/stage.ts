// Shared setup for shots of a box in play (the store listing's inline media): the menus away, a numbered box in
// the lap, and where its locks, spots and missing piece are. The box is the generator's own (the page builds the
// same one from the same number), so the shots know a lock's spot and a finger lock's missing piece in box units.
// Part of every shot's frame version (lib/version.ts FRAME_INPUTS).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from "@playwright/test";
import { generateBox } from "../../../src/core/generator";
import type { V3, Vec3 } from "../../../src/core/types";
import type { XrApp } from "../../e2e/helpers/xr-app";
import type { View } from "./camera";

/** From any screen: the menus away and box `n` shown in the lap, its lantern at the start. */
export async function showBox(app: XrApp, page: Page, n: number): Promise<void> {
  await page.evaluate(() => (window as any).__ns.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate((k) => (window as any).__ns.scene.show({ n: k }), n);
  await app.step(2);
}

/** Box units to world metres for the box in play. */
export async function toWorld(page: Page, p: readonly [number, number, number]): Promise<Vec3> {
  const [w] = (await page.evaluate((q) => (window as any).__ns.scene.toWorld([q]), [p[0], p[1], p[2]] as V3)) as Vec3[];
  return w!;
}

/** The lantern's position now, box units. */
export const lanternPos = async (page: Page): Promise<V3> => (await page.evaluate(() => (window as any).__sl.lantern().pos)) as V3;

/** A lock of box `n` the lantern alone opens: its index and spot. */
export function plainLock(n: number): { lock: number; spot: V3 } {
  const box = generateBox({ kind: "box", n });
  const l = box.locks.find((x) => !x.finger);
  if (!l) throw new Error(`box ${n} has no lock the lantern alone opens`);
  return { lock: l.i, spot: [...l.L] as V3 };
}

/** Box `n`'s finger lock: its spot, and the centre of the piece the box leaves out (where the fingertip goes). */
export function fingerLock(n: number): { lock: number; spot: V3; tip: V3 } {
  const box = generateBox({ kind: "box", n });
  const l = box.locks.find((x) => x.finger);
  if (!l) throw new Error(`box ${n} has no finger lock`);
  const piece = box.elements.find((e) => e.kind === "piece" && e.lock === l.i && e.missing);
  if (!piece || piece.kind !== "piece") throw new Error(`box ${n} lock ${l.i} has no missing piece`);
  const c: V3 = [0, 0, 0];
  const n3 = piece.verts.length;
  for (const v of piece.verts) {
    c[0] += v[0] / n3;
    c[1] += v[1] / n3;
    c[2] += v[2] / n3;
  }
  return { lock: l.i, spot: [...l.L] as V3, tip: c };
}

/** Open lock `k` in gold unless the game already did (a later build opens it by itself; this keeps the shot whole). */
export async function openIfShut(page: Page, k: number): Promise<boolean> {
  return page.evaluate((i) => {
    const sl = (window as any).__sl;
    if ((sl.panelState().open[i] ?? 0) >= 0.5) return false;
    sl.setOpen(i, true);
    return true;
  }, k);
}

export const offset = (p: Vec3, dx: number, dy: number, dz: number): Vec3 => [p[0] + dx, p[1] + dy, p[2] + dz];

/** Where `a` to `b` is at `k` (0: a, 1: b). */
export const lerp3 = (a: readonly number[], b: readonly number[], k: number): Vec3 => [
  (a[0] as number) + ((b[0] as number) - (a[0] as number)) * k,
  (a[1] as number) + ((b[1] as number) - (a[1] as number)) * k,
  (a[2] as number) + ((b[2] as number) - (a[2] as number)) * k,
];

/** A lock's spot (box units) in the box the session plays. */
export const spotOf = async (page: Page, lock: number): Promise<V3> =>
  (await page.evaluate((i) => (window as any).__sl.session.state().locks[i].spot, lock)) as V3;

/** A right hand reaching in to pinch: fingers forward and a little left and down, palm turned left (IWER directions). */
export const PINCH_FROM_RIGHT = { fingers: { x: -0.35, y: -0.25, z: -1 }, palm: { x: -1, y: -0.35, z: 0.1 } };

/** The shot hand, as the stage needs it (lib/shot.ts ShotHand). */
interface Hand {
  shape(value: number, ms?: number): Promise<void>;
  glide(p: Vec3, ms: number, orientation?: unknown): Promise<void>;
  pinch(ms?: number): Promise<void>;
  open(ms?: number): Promise<void>;
}

/**
 * The player's move, recorded: reach for the lantern, pinch it, carry it onto lock `lock`'s spot in `ms`, hold it there
 * until the game opens the lock (as a player waits for it), let go and take the hand to `rest`. Nothing is opened for
 * the game: a lock still shut after the hold is left shut, with a warning, and the shot goes on as the game does.
 * Returns whether the lock opened.
 */
export async function carryOpen(
  app: XrApp,
  page: Page,
  hand: Hand,
  lock: number,
  ms: number,
  rest: Vec3,
  o: { holdMs?: number; label?: string; pause?: { at: number; ms: number } } = {},
): Promise<boolean> {
  const to = await spotOf(page, lock);
  const from = await toWorld(page, await lanternPos(page));
  await hand.shape(0.5, 200);
  // In from the right, fingers into the box and the palm turned in: the hand stays beside the lantern, not over the box.
  await hand.glide(offset(from, 0.03, 0.03, 0.04), 700, PINCH_FROM_RIGHT);
  await hand.glide(from, 300);
  await hand.pinch(140);
  await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 1_000, batch: 1, label: "the lantern held" });
  // The grasp point stays where it closed on the lantern: carry the lantern itself onto the spot.
  const held = await toWorld(page, await lanternPos(page));
  const spotW = await toWorld(page, to);
  const onSpot: Vec3 = [spotW[0] + from[0] - held[0], spotW[1] + from[1] - held[1], spotW[2] + from[2] - held[2]];
  if (o.pause) {
    // Part of the way, then a still moment (as a player stops to look) before the rest.
    await hand.glide(lerp3(from, onSpot, o.pause.at), ms * o.pause.at);
    const now = (await page.evaluate(() => (window as any).__vt.now)) as number;
    await app.stepUntil((_ns, w, end) => w.__vt.now >= end, { arg: now + o.pause.ms, maxMs: o.pause.ms + 1000, label: "a still moment" });
    await hand.glide(onSpot, ms * (1 - o.pause.at));
  } else await hand.glide(onSpot, ms);
  let opened = true;
  try {
    await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: o.holdMs ?? 2_500, label: `lock ${lock} open` });
  } catch {
    opened = false;
  }
  await hand.open(160);
  await hand.glide(rest, 700);
  if (!opened) {
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 1_500, label: `lock ${lock} open` });
      opened = true;
    } catch {
      console.warn(`${o.label ?? "shot"}: lock ${lock} stayed shut with the lantern carried onto its spot (left as the game has it)`);
    }
  }
  return opened;
}

/**
 * Before recording, play time passing as a player works at the box: `ms` of virtual time in 100 ms steps (undrawn), so
 * the result card's time is a player's, not the few seconds a setup takes. Keep each wait under the session's stuck
 * time (90 s), or the hint lantern starts to glow.
 */
export async function playFor(app: XrApp, ms: number): Promise<void> {
  if (ms > 0) await app.step(Math.round(ms / 100), 100);
}

/**
 * Before recording: numbered box `n` in play through the box session, as the menus start it, with its plain locks
 * opened the way a player does (the lantern on each spot, `paceMs` of play time before each; `keepShut` stays shut),
 * then the lantern on the finger lock's spot. Returns the finger lock.
 */
export async function playBoxReady(app: XrApp, page: Page, n: number, keepShut: number[] = [], paceMs = 0): Promise<ReturnType<typeof fingerLock>> {
  await page.evaluate(() => (window as any).__ns.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate((k) => (window as any).__sl.session.play({ kind: "box", n: k }), n);
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 15_000, label: `box ${n} in play` },
  );
  const locks = (await page.evaluate(() => (window as any).__sl.session.state().locks)) as Array<{ i: number; spot: V3; finger: boolean }>;
  for (const l of locks) {
    if (l.finger || keepShut.includes(l.i)) continue;
    await playFor(app, paceMs);
    await page.evaluate((p) => (window as any).__sl.placeLantern(p), l.spot);
    await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: l.i, maxMs: 3_000, label: `lock ${l.i} open` });
  }
  const f = fingerLock(n);
  await playFor(app, paceMs);
  await page.evaluate((p) => (window as any).__sl.placeLantern(p), f.spot);
  // The locks' openings and the lantern's settle play out before the first frame.
  await app.step(150);
  return f;
}

/**
 * Before recording: numbered box `n` in play through the box session, as the menus start it, every lock shut and the
 * lantern where the box starts it.
 */
export async function startBox(app: XrApp, page: Page, n: number): Promise<void> {
  await page.evaluate(() => (window as any).__ns.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate((k) => (window as any).__sl.session.play({ kind: "box", n: k }), n);
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 15_000, label: `box ${n} in play` },
  );
  // The box's forming, the etching and the lantern's settle play out before the first frame.
  await app.step(150);
}

/**
 * A camera on the box in box units (x right, y up the panel, z out toward the player; 1 unit = the box size), as the
 * store art's views: the eye, the point it looks at and the lens (horizontal field of view), turned into a world view
 * for the box in play. Views a player never has (beside the box, close to the panel) are fine: the box is the game's.
 */
export async function boxView(page: Page, eye: readonly [number, number, number], at: readonly [number, number, number], hfovDeg?: number): Promise<View> {
  const [from, to] = await Promise.all([toWorld(page, eye), toWorld(page, at)]);
  return hfovDeg === undefined ? { from, at: to } : { from, at: to, hfovDeg };
}

/** A cubic Bezier through box-unit control points, in world metres (the box is rigid, so the curve maps over). */
export async function boxCurve(page: Page, pts: ReadonlyArray<readonly [number, number, number]>): Promise<(k: number) => Vec3> {
  if (pts.length !== 4) throw new Error("a cubic curve takes four control points");
  const [a, b, c, d] = (await Promise.all(pts.map((p) => toWorld(page, p)))) as [Vec3, Vec3, Vec3, Vec3];
  return (k) => {
    const u = 1 - k;
    const w0 = u * u * u, w1 = 3 * u * u * k, w2 = 3 * u * k * k, w3 = k * k * k;
    return [0, 1, 2].map((i) => w0 * a[i]! + w1 * b[i]! + w2 * c[i]! + w3 * d[i]!) as Vec3;
  };
}

/**
 * The player's reach and pinch, recorded: the open hand in from the right beside the lantern over `ms`, closing on it.
 * Returns the grasp point's offset from the lantern once held (world metres): carry the lantern to p by taking the
 * grasp point to p plus that offset.
 */
export async function takeLantern(app: XrApp, page: Page, hand: Hand, ms = 1000): Promise<Vec3> {
  const from = await toWorld(page, await lanternPos(page));
  await hand.shape(0.5, 200);
  await hand.glide(offset(from, 0.03, 0.03, 0.04), ms * 0.7, PINCH_FROM_RIGHT);
  await hand.glide(from, ms * 0.3);
  await hand.pinch(140);
  await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 1_000, batch: 1, label: "the lantern held" });
  const held = await toWorld(page, await lanternPos(page));
  return [from[0] - held[0], from[1] - held[1], from[2] - held[2]];
}

/** A day in ms. */
const DAY_MS = 86_400_000;

/**
 * A stored profile (a shot's `profile`; the game starts afresh from anything that is not a version 1 profile) of a player who has played on: both lessons and every tip done, boxes 1 to
 * `nextBox - 1` opened on earlier days (their rewards in the collection, as the game records them) and a Daily Box
 * streak of `streak` up to yesterday. `now` is the shot's date.
 */
export function playedProfile(nextBox: number, streak: number, now: string): Record<string, unknown> {
  const at = new Date(now).getTime();
  const collection = [];
  for (let n = 1; n < nextBox; n++) {
    const box = generateBox({ kind: "box", n });
    collection.push({ key: box.key, owner: box.owner, loot: box.loot, shapes: box.locks.map((l) => l.shape), atMs: at - (nextBox + 2 - n) * DAY_MS, timeMs: 150_000 + n * 41_000, hints: 0 });
  }
  const yesterday = new Date(at - DAY_MS).toISOString().slice(0, 10);
  return {
    version: 1,
    nextBox,
    lessons: { l1: true, l2: true, step: null },
    tipsSeen: ["decoys", "ringless", "hidden", "drawer"],
    collection,
    daily: { streak, best: streak, lastDay: streak > 0 ? yesterday : null, current: null },
  };
}
