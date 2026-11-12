// The film, version 2, part C (play), its first shot: seated in a sitting room (a photograph standing in for the
// player's room, labelled "Simulated room" in the edit). Home stands over the lap at the menus' light; the right index
// finger presses Continue, Box No. 157 forms in the lap and the room dims like a theatre; the head drops to the box; the
// hand takes the lantern and carries it onto the Snail's spot, and the Snail opens in gold. Nothing is opened for the game.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NsButton } from "../../../src/app/test-api";
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import { POKE_DEPTH_M } from "../../e2e/helpers/xr-app";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { carryOpen, offset, plainLock, playedProfile } from "../lib/stage";

interface Data {
  cont: NsButton;
}

const BOX = 157;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];
/** The photographic room (tests/video/assets/rooms/README.md) and its turn. */
const PLAY_ROOM = { file: "tests/video/assets/rooms/lythwood_lounge-film.jpg", yawDeg: -135 };
/** The seated eye looking down `pitchDeg` (negative: down) through a lens `hfovDeg` across. */
function seatedView(pitchDeg: number, hfovDeg: number, d: Vec3 = [0, 0, 0]): View {
  const from = offset(EYE, d[0], d[1], d[2]);
  const k = Math.tan((pitchDeg * Math.PI) / 180);
  return { from, at: [from[0], from[1] + k * 0.6, from[2] - 0.6], hfovDeg };
}
const along = (b: NsButton, d: number): Vec3 => [b.world[0] + b.normal[0] * d, b.world[1] + b.normal[1] * d, b.world[2] + b.normal[2] * d];

export default defineShot<Data>({
  name: "demo2-play-start",
  description: "Simulated room: Continue pressed, Box No. 157 forms in the lap, the room dims, the lantern opens the Snail.",
  seconds: 9,
  profile: playedProfile(BOX, 3, DEFAULT_DATE),
  photoRoom: PLAY_ROOM,
  async setup({ app, hand }) {
    await hand("left").park([-0.45, 0.7, -1.3]);
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "Home at rest" });
    const s = await app.state();
    const cont = s.buttons.find((b) => b.id === "home-continue");
    if (!cont) throw new Error(`no Continue key on "${s.screen}" (have: ${s.buttons.map((b) => b.id).join(", ")})`);
    const right = hand("right");
    await right.park(REST_RIGHT);
    await right.point();
    // The fingertip waits below and to the right of the key, out of view.
    await right.glideTip([cont.world[0] + 0.16, cont.world[1] - 0.18, cont.world[2] + 0.12], 300);
    return { cont };
  },
  // The seated eye on Home over the lap and the room beyond it.
  firstView: (): View => seatedView(-33, 82),
  async play({ app, page, hand, camera, until, wait }, { cont }) {
    const right = hand("right");
    // Narration line 5 ("The box sits in your lap, and your room dims like a theatre.", 3.58 s) starts with the shot:
    // the press comes about 2.2 s in, so the room dims under "dims like a theatre".
    await until(1.2);
    await right.glideTip(along(cont, 0.06), 900);
    await right.glideTip(along(cont, POKE_DEPTH_M), 200);
    await right.glideTip(along(cont, 0.07), 240);
    // The head drops to the box as it forms.
    camera.move(seatedView(-31, 80, [0, -0.01, -0.03]), 1800);
    await right.relax(200);
    await right.glide(offset(REST_RIGHT, -0.08, 0.1, -0.1), 700);
    await app.stepUntil((_ns, w) => {
      const st = w.__sl.session.state();
      return st?.stage === "playing" && st.revealed;
    }, { maxMs: 6_000, label: `box ${BOX} in play` });
    await wait(500);
    const key = plainLock(BOX);
    await carryOpen(app, page, right, key.lock, 1700, REST_RIGHT, { label: "demo2-play-start" });
    await wait(400);
  },
});
