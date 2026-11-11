// The demo film, shot 9b (plan/submission/demo-video-script.md): the day's Daily Box with one lock left, a player on a
// 4-day streak. The right hand carries the lantern onto the last lock's spot, the box opens, and the result card under
// the reward reads "Streak 5". Its other locks were opened before the first frame, the way a player does (the lantern
// on each spot, a fingertip in each finger lock's gap); nothing is opened for the game on camera.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import { openWithFinger, openWithLantern } from "../../e2e/helpers/solve";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { carryOpen, lerp3, offset, playedProfile, playFor } from "../lib/stage";

interface Data {
  last: number;
  box: Vec3;
}

const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];
const TODAY = DEFAULT_DATE.slice(0, 10);

export default defineShot<Data>({
  name: "demo-daily-open",
  description: "The Daily Box's last lock carried open; the box opens and its result card reads Streak 5.",
  seconds: 14,
  profile: playedProfile(4, 4, DEFAULT_DATE),
  async setup({ app, page, hand }) {
    await hand("left").park([-0.45, 0.7, -1.3]);
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
    const locks = (await page.evaluate(() => (window as any).__sl.session.state().locks)) as Array<{ i: number; spot: [number, number, number]; finger: boolean }>;
    const plain = locks.filter((l) => !l.finger);
    const last = plain[plain.length - 1];
    if (!last) throw new Error("the Daily Box has no lock the lantern alone opens");
    // At a player's pace (the result card shows the play time): under a minute a lock.
    for (const l of plain) {
      if (l === last) continue;
      await playFor(app, 50_000);
      await openWithLantern(app, l.i, l.spot);
    }
    for (const l of locks.filter((x) => x.finger)) {
      await playFor(app, 50_000);
      await openWithFinger(app, l.i);
    }
    await playFor(app, 30_000);
    // The lantern left a little way from where the last lock opened it, off the last spot.
    const at = (await page.evaluate(() => (window as any).__sl.lantern().pos)) as [number, number, number];
    await page.evaluate((p) => (window as any).__sl.placeLantern(p), lerp3(at, last.spot, 0.35));
    await hand("right").park(REST_RIGHT);
    await app.step(150);
    return { last: last.i, box: (await app.state()).boxPose.position as Vec3 };
  },
  firstView: ({ box }): View => ({ from: offset(EYE, -0.03, 0, 0.0), at: offset(box, 0.02, 0.03, 0.1) }),
  async play({ app, page, hand, camera, until, wait }, { last, box }) {
    const right = hand("right");
    await until(0.4);
    await carryOpen(app, page, right, last, 2200, REST_RIGHT, { label: "demo-daily-open" });
    try {
      await app.stepUntil((_ns, w) => !!w.__sl.session.card()?.shown, { maxMs: 10_000, label: "the result card in view" });
    } catch {
      console.warn("demo-daily-open: no result card in view");
    }
    const card = (await page.evaluate(() => (window as any).__sl.session.card())) as { world: Vec3 } | null;
    // In on the plaque and the card under it: the streak line.
    if (card) camera.move({ from: offset(EYE, 0, -0.02, -0.1), at: lerp3(card.world, box, 0.3) }, 2400);
    await wait(5500);
  },
});
