// The film, version 2, part C (play), its second shot, after a cut: Box No. 157 a while later in the same sitting room
// (a photograph standing in for the player's room), its Snail open and the lantern settled on the Arrow's spot, the
// shape one piece short. The right index finger comes into the beam and its shadow fills the gap (nudged along the light
// if it does not fill at once, as a player finds the depth); the Arrow forms in brass. That was the last lock:
// the walls open, the room's light comes back up, the reward rises with its story plaque and the result card. Nothing is opened for the game; the time on the card is the play time before the shot plus it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { lerp3, offset, playBoxReady, playedProfile, toWorld } from "../lib/stage";

interface Data {
  lock: number;
  tip: Vec3;
  inBeam: Vec3;
  /** Along the light from the gap toward the lantern, nearer the lantern step by step (a bigger shadow). */
  nearer: Vec3[];
}

const BOX = 157;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];
/** Pointing into the box from the right, palm down (as demo2-hand, whose fingertip fills Box No. 3's Key). */
const POINT = { fingers: { x: -0.45, y: 0.1, z: -1 }, palm: { x: -0.1, y: -1, z: -0.1 } };
/** The same room and turn as demo2-play-start (kept in each shot file: a shot's frames depend on its own file). */
const PLAY_ROOM = { file: "tests/video/assets/rooms/lythwood_lounge-film.jpg", yawDeg: -135 };
/** The seated eye looking down `pitchDeg` (negative: down) through a lens `hfovDeg` across. */
function seatedView(pitchDeg: number, hfovDeg: number, d: Vec3 = [0, 0, 0]): View {
  const from = offset(EYE, d[0], d[1], d[2]);
  const k = Math.tan((pitchDeg * Math.PI) / 180);
  return { from, at: [from[0], from[1] + k * 0.6, from[2] - 0.6], hfovDeg };
}

export default defineShot<Data>({
  name: "demo2-play-finish",
  description: "Simulated room: the fingertip finishes the Arrow, Box No. 157 opens, the light comes up, reward and card.",
  seconds: 12,
  profile: playedProfile(BOX, 3, DEFAULT_DATE),
  photoRoom: PLAY_ROOM,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.45, 0.7, -1.3]);
    // A player's pace: about a minute to the Snail, another to settle the lantern on the Arrow's spot.
    const f = await playBoxReady(app, page, BOX, [], 60_000);
    const right = hand("right");
    await right.park(REST_RIGHT, POINT);
    await right.point();
    const nearer: Vec3[] = [];
    for (const k of [0.08, 0.16, 0.24, 0.32]) nearer.push(await toWorld(page, lerp3(f.tip, f.spot, k)));
    return { lock: f.lock, tip: await toWorld(page, f.tip), inBeam: await toWorld(page, lerp3(f.tip, f.spot, 0.45)), nearer };
  },
  firstView: (): View => seatedView(-31, 80, [0, -0.01, 0.05]),
  async play({ app, page, hand, camera, until, time, wait }, { lock, tip, inBeam, nearer }) {
    const right = hand("right");
    await until(0.3);
    await right.glideTip(inBeam, 1200, POINT);
    await right.glideTip(tip, 1300, POINT);
    const t = time();
    const open = async (ms: number) => {
      try {
        await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: ms, label: "the finger lock open" });
        return true;
      } catch {
        return false;
      }
    };
    let opened = await open(1_400);
    // Not filled yet: the player eases the finger along the light toward the lantern until its shadow fills the gap.
    for (const p of nearer) {
      if (opened) break;
      await right.glideTip(p, 350, POINT);
      opened = await open(1_100);
    }
    if (!opened) console.warn(`demo2-play-finish: finger lock ${lock} stayed shut (fingertip at the gap from ${t.toFixed(2)} s)`);
    await wait(500);
    await right.relax(250);
    await right.glide(REST_RIGHT, 900);
    // The head comes up a little for the reward and the card.
    camera.move(seatedView(-30, 80, [0, 0, 0.05]), 2600);
    try {
      await app.stepUntil((_ns, w) => !!w.__sl.session.reward()?.up, { maxMs: 8_000, label: "the reward up" });
    } catch {
      console.warn("demo2-play-finish: the reward was not up 8 s after the last lock");
    }
    try {
      await app.stepUntil((_ns, w) => !!w.__sl.session.card()?.shown, { maxMs: 6_000, label: "the result card in view" });
    } catch {
      console.warn("demo2-play-finish: no result card in view");
    }
    const card = (await page.evaluate(() => (window as any).__sl.session.card())) as { world: Vec3 } | null;
    // The player leans in a little to read the plaque and the card (a centimetre or two and a touch of lens: the room
    // is a photograph, so the eye stays near where it was; the lantern and the sofas stay in frame).
    if (card) camera.move(seatedView(-30.5, 79, [0, -0.01, 0.035]), 3000);
    else console.warn("demo2-play-finish: no result card");
    await until(Math.max(time() + 3.2, 11.8));
  },
});
