// Part B, beat 3 (your hand): Box No. 3 on the dark stage, its Diamond still shut and the lantern on the Key's spot, the
// Key one piece short. The whole open hand comes up into the beam and throws its soft shadow across the panel; it turns
// to point, the index finger goes toward the gap and its shadow closes it; the hold, and the game forms the piece in
// brass. Nothing is opened for the game.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxView, lerp3, offset, plainLock, playBoxReady, playedProfile, toWorld } from "../lib/stage";

interface Data {
  lock: number;
  tip: Vec3;
  palm: Vec3;
  view: View;
  end: View;
}

const BOX = 3;
/** The open hand, palm to the panel and fingers up: its whole outline in the light. */
const OPEN = { fingers: { x: -0.15, y: 1, z: -0.25 }, palm: { x: 0.1, y: 0.15, z: -1 } };
/** Pointing at the panel from the right, palm down. */
const POINT = { fingers: { x: -0.45, y: 0.1, z: -1 }, palm: { x: -0.1, y: -1, z: -0.1 } };

export default defineShot<Data>({
  name: "demo2-hand",
  description: "Your hand: the open hand's shadow on the panel, then the index finger closes the Key's gap; brass.",
  seconds: 5,
  profile: playedProfile(4, 0, DEFAULT_DATE),
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.7, 0.3, -0.9]);
    const f = await playBoxReady(app, page, BOX, [plainLock(BOX).lock]);
    const tip = await toWorld(page, f.tip);
    // The palm in the beam, 70% of the way from the lantern toward the panel just below the Key: its shadow about
    // 1.4 times the hand, over the middle of the panel.
    const palm = await toWorld(page, lerp3(f.spot, [0.1, -0.08, 0], 0.7));
    const right = hand("right");
    await right.park(offset(palm, 0.12, -0.3, 0.12), OPEN);
    await app.step(10);
    return {
      lock: f.lock,
      tip,
      palm,
      // From the right: the hand stands left of its shadow, which falls up and right of it from the lantern.
      view: await boxView(page, [0.42, 0.3, 2.45], [0.02, -0.06, 0.2], 44),
      end: await boxView(page, [0.36, 0.24, 2.3], [0.06, -0.08, 0.1], 38),
    };
  },
  firstView: ({ view }) => view,
  async play({ app, camera, hand, until, time }, { lock, tip, palm, end }) {
    const right = hand("right");
    camera.move(end, 4800);
    // Up into the light, open.
    await right.glide(palm, 1300, OPEN);
    await until(1.8);
    // Turn to point and reach the gap with the fingertip.
    await right.point(240);
    await right.glideTip(tip, 900, POINT);
    const t = time();
    try {
      await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 2_000, label: "the Key open" });
    } catch {
      console.warn(`demo2-hand: finger lock ${lock} did not open within 2 s of the fingertip reaching the gap (at ${t.toFixed(2)} s)`);
    }
    await until(Math.max(time() + 1.0, 5));
  },
});
