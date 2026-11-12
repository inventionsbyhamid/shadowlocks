// Shared by the film's part D and E shots (demo2-d-*.ts, demo2-e-*.ts; plan/submission/demo-video-script-v2.md): a
// numbered box with every lock but one opened before the first frame the way a player does, the hand holding the
// lantern a little way off the last lock's spot; and a player on a Daily Box streak who has opened Daily Boxes before.
// Not a shot itself (not listed in index.ts). NOTE: a shot's frame version covers its own file, not this one: after a
// change here, render the shots that use it with --fresh.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from "@playwright/test";
import { generateBox } from "../../../src/core/generator";
import type { V3, Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import { openWithFinger, openWithLantern } from "../../e2e/helpers/solve";
import type { XrApp } from "../../e2e/helpers/xr-app";
import type { View } from "../lib/camera";
import { defineShot, type Shot } from "../lib/shot";
import { boxView, offset, playedProfile, playFor, spotOf, startBox, takeLantern, toWorld } from "../lib/stage";

export const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
export const TODAY = DEFAULT_DATE.slice(0, 10);
const DAY_MS = 86_400_000;

type Locks = Array<{ i: number; spot: V3; finger: boolean }>;
export const locksOf = async (page: Page): Promise<Locks> => (await page.evaluate(() => (window as any).__sl.session.state().locks)) as Locks;
export const isOpen = (page: Page, i: number): Promise<boolean> => page.evaluate((k) => (window as any).__sl.session.state().open.includes(k), i);

/** Before recording: every lock of the box in play opened as a player does (lantern, fingertip), except `keep`. */
export async function openAllBut(app: XrApp, page: Page, keep: number[], paceMs = 0): Promise<void> {
  const locks = await locksOf(page);
  for (const l of locks.filter((x) => !x.finger && !keep.includes(x.i))) {
    await playFor(app, paceMs);
    await openWithLantern(app, l.i, l.spot);
  }
  for (const l of locks.filter((x) => x.finger && !keep.includes(x.i))) {
    await playFor(app, paceMs);
    await openWithFinger(app, l.i);
  }
}

/**
 * A stored profile: a player past Box No. `nextBox - 1` who has opened the Daily Box on each of the last `streak` days
 * (their rewards in the collection at the times given, slowest first), on a streak up to yesterday.
 */
export function dailyProfile(nextBox: number, dailyTimesMs: number[]): Record<string, unknown> {
  const p = playedProfile(nextBox, dailyTimesMs.length, DEFAULT_DATE) as any;
  const at = new Date(DEFAULT_DATE).getTime();
  dailyTimesMs.forEach((timeMs, k) => {
    const day = new Date(at - (dailyTimesMs.length - k) * DAY_MS).toISOString().slice(0, 10);
    const box = generateBox({ kind: "daily", day });
    p.collection.push({
      key: box.key,
      owner: box.owner,
      loot: box.loot,
      shapes: box.locks.map((l) => l.shape),
      atMs: new Date(`${day}T20:00:00Z`).getTime(),
      timeMs,
      hints: 0,
      levels: box.locks.map(() => 0),
    });
  });
  p.collection.sort((a: any, b: any) => a.atMs - b.atMs);
  return p;
}

/** The player of parts D's records and Daily Box shots: past Box No. 11, four Daily Boxes opened, none under 3:30. */
export const DAILY_PLAYER = dailyProfile(12, [241_000, 213_000, 226_000, 252_000]);

/** Before recording: today's Daily Box in play. */
export async function startDaily(app: XrApp, page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__ns.ui.go("play"));
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
  await page.evaluate((day) => (window as any).__sl.session.play({ kind: "daily", day }), TODAY);
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 15_000, label: "the Daily Box in play" },
  );
}

/** Before recording: today's Daily Box opened at a player's pace (about 2:50 in all), up to its result card shown. */
export async function dailyOpened(app: XrApp, page: Page): Promise<{ card: Vec3; box: Vec3 }> {
  await startDaily(app, page);
  await openAllBut(app, page, [], 50_000);
  await app.stepUntil((_ns, w) => !!w.__sl.session.card()?.shown, { maxMs: 12_000, label: "the result card shown" });
  const card = (await page.evaluate(() => (window as any).__sl.session.card())) as { world: Vec3; card: { lines: string[]; time: string } | null };
  if (!card.card?.lines.includes("New best")) console.warn(`the Daily Box's card says ${JSON.stringify(card.card)}`);
  return { card: card.world, box: (await app.state()).boxPose.position as Vec3 };
}

interface EndlessData {
  carry: Vec3;
  first: View;
  last: View;
}

/**
 * A numbered box's last moment before it opens, for the "endless boxes" run: Box No. `n` on the dark stage with every
 * lock open but `lock`, the right hand holding the lantern `off` (box units) from that lock's spot. Recorded: the hand
 * carries it onto the spot in `carryMs`, the game fills the lock and opens it in gold (and, given time, the box). The
 * camera eases from `first` to `last` (box units: eye, look-at point, lens) over the shot.
 */
export function endlessShot(o: {
  name: string;
  n: number;
  lock: number;
  seconds: number;
  off: V3;
  carryMs: number;
  first: [V3, V3, number];
  last: [V3, V3, number];
}): Shot<EndlessData> {
  return defineShot<EndlessData>({
    name: o.name,
    description: `Endless boxes: Box No. ${o.n}, its last lock carried home and opened in gold.`,
    seconds: o.seconds,
    profile: playedProfile(o.n, 0, DEFAULT_DATE),
    darkStage: true,
    async setup({ app, page, hand }) {
      await hand("left").park([-0.7, 0.3, -0.9]);
      const right = hand("right");
      await right.park([0.55, 0.5, -1.0]);
      await startBox(app, page, o.n);
      await openAllBut(app, page, [o.lock]);
      await right.park([0.55, 0.5, -1.0]);
      const spot = (await spotOf(page, o.lock)) as V3;
      const from: V3 = [spot[0] + o.off[0], spot[1] + o.off[1], spot[2] + o.off[2]];
      await page.evaluate((p) => (window as any).__sl.placeLantern(p), from);
      await app.step(150);
      if (await isOpen(page, o.lock)) throw new Error(`${o.name}: lock ${o.lock} opened with the lantern ${JSON.stringify(o.off)} off its spot`);
      const grip = await takeLantern(app, page, right, 900);
      await app.step(20);
      if (await isOpen(page, o.lock)) throw new Error(`${o.name}: lock ${o.lock} opened as the hand took the lantern`);
      // Where the grasp point goes for the lantern to sit on the spot.
      const spotW = await toWorld(page, spot);
      return {
        carry: offset(spotW, grip[0], grip[1], grip[2]),
        first: await boxView(page, o.first[0], o.first[1], o.first[2]),
        last: await boxView(page, o.last[0], o.last[1], o.last[2]),
      };
    },
    firstView: ({ first }) => first,
    async play({ camera, hand, until, wait }, { carry, last }) {
      camera.move(last, o.seconds * 1000);
      await wait(100);
      await hand("right").glide(carry, o.carryMs);
      await until(o.seconds);
    },
  });
}

/** Where the hand shot's arc leaves the lantern, from where the box starts it (box units): on no lock's spot. */
export const LETGO_AT = (start: readonly number[]): V3 => [(start[0] as number) - 0.32, (start[1] as number) + 0.14, (start[2] as number) - 0.04];
