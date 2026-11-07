// The playable slice for the owner (Nov 10): the first minute and lesson 1, then box 3's finger lock. The box forms
// out of light, "Pick up the lantern.", the ghost hand shows how; the right hand picks the lantern up and fills lock
// I's Moon; Example 1 (the lantern parks in its cradle, a pale-blue ghost solves the arrow's twin, the scraps swing
// home, "Your turn."), the player's arrow; Example 2 (the rings), the player's Key; the box opens. Then box 3: the
// lantern on the finger lock's spot and the fingertip casting the missing piece.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { V3, Vec3 } from "../../../src/core/types";
import { SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot, type ShotHand } from "../lib/shot";
import { fingerLock, offset, toWorld } from "../lib/stage";
import type { Page } from "@playwright/test";
import type { XrApp } from "../../e2e/helpers/xr-app";

interface Data {
  box: Vec3;
}

const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_LEFT: Vec3 = [-0.45, 0.7, -1.3];
const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];

/** The lesson's step now. */
const lessonStep = (page: Page): Promise<number> => page.evaluate(() => (window as any).__sl.lessons.state().step as number);
/** A lock's spot (box units) in the box in play. */
const spotOf = async (page: Page, lock: number): Promise<V3> =>
  (await page.evaluate((i) => (window as any).__sl.session.state().locks[i].spot, lock)) as V3;
const lanternAt = async (page: Page): Promise<V3> => (await page.evaluate(() => (window as any).__sl.lantern().pos)) as V3;

/**
 * Reach for the lantern, pinch it, carry it to lock `lock`'s spot in `ms`, let go, and take the hand away. Should the
 * lock still be shut a moment later (a release a little off the spot), the lantern is put on it, so the shot goes on.
 */
async function carry(app: XrApp, page: Page, right: ShotHand, lock: number, ms: number): Promise<void> {
  const to = await spotOf(page, lock);
  const from = await toWorld(page, await lanternAt(page));
  await right.shape(0.5, 200);
  await right.glide(offset(from, 0.01, 0.03, 0.03), 700);
  await right.glide(from, 300);
  await right.pinch(140);
  await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 1_000, batch: 1, label: "the lantern held" });
  await right.glide(await toWorld(page, to), ms);
  await right.open(160);
  await right.glide(REST_RIGHT, 700);
  try {
    await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 1_500, label: `lock ${lock} open` });
  } catch {
    console.warn(`slice: lock ${lock} was not open after the release; the lantern is put on its spot`);
    await page.evaluate((p) => (window as any).__sl.placeLantern(p), to);
    await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, label: `lock ${lock} open` });
  }
}

export default defineShot<Data>({
  name: "slice",
  description: "The first minute, lesson 1 with its two staged examples, then box 3's finger lock.",
  seconds: 80,
  async setup({ app, page, hand }) {
    await hand("left").park(REST_LEFT);
    await hand("right").park(REST_RIGHT);
    await page.evaluate(() => (window as any).__sl.lessons.start("l1"));
    await app.stepUntil((_ns, w) => w.__sl.session.state()?.key === "shadow-locks/lesson/l1", { maxMs: 3_000, label: "lesson 1's box" });
    return { box: (await app.state()).boxPose.position as Vec3 };
  },
  // From the seated eye, the whole box, the lantern beside it and the coach line above it.
  firstView: ({ box }): View => ({ from: offset(EYE, 0.02, 0, 0.02), at: offset(box, 0.02, 0.03, 0.1) }),
  async play({ app, page, hand, until, time, wait }) {
    const right = hand("right");
    // The box forms; the line; after 4 s without input the ghost hand shows the pinch.
    await until(7.5);
    // Lock I: pick the lantern up and fill the Moon.
    await carry(app, page, right, 0, 2600);
    // Example 1, then the player's arrow.
    await app.stepUntil((_ns, w) => w.__sl.lessons.state().step === 3, { maxMs: 20_000, label: "example 1 done" });
    await wait(1200);
    await carry(app, page, right, 1, 2400);
    // Example 2, then the player's Key.
    await app.stepUntil((_ns, w) => w.__sl.lessons.state().step === 5, { maxMs: 20_000, label: "example 2 done" });
    await wait(1000);
    await carry(app, page, right, 2, 2800);
    // The box opens.
    await wait(4500);
    if ((await lessonStep(page)) !== 6) console.warn("slice: lesson 1 is not at its reward step");
    // Box 3's finger lock: the lantern on its spot, the fingertip into the gap.
    await page.evaluate(() => (window as any).__sl.session.play({ kind: "box", n: 3 }));
    await app.stepUntil((_ns, w) => w.__sl.session.state()?.key === "shadow-locks/3" && w.__sl.session.state().revealed, { maxMs: 5_000, label: "box 3" });
    const f = fingerLock(3);
    await page.evaluate((p) => (window as any).__sl.placeLantern(p), f.spot);
    const tip = await toWorld(page, f.tip);
    await right.point();
    await right.glideTip(offset(tip, 0.07, -0.09, 0.06), 600);
    await right.glideTip(tip, 1600);
    await wait(2500);
    await until(Math.max(time() + 1.5, 80));
  },
});
