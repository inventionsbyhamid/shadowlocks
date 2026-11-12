// The demo film, shot 9a (plan/submission/demo-video-script.md): a player past Box No. 3 with a 4-day streak. Home
// stands over the lap, its Daily Box key saying "Streak 4"; the right index finger comes in and presses it, and the day's
// Daily Box forms out of light in the lap.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NsButton } from "../../../src/app/test-api";
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import { POKE_DEPTH_M } from "../../e2e/helpers/xr-app";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { offset, playedProfile } from "../lib/stage";

interface Data {
  daily: NsButton;
  box: Vec3;
}

const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];
const along = (b: NsButton, d: number): Vec3 => [b.world[0] + b.normal[0] * d, b.world[1] + b.normal[1] * d, b.world[2] + b.normal[2] * d];

export default defineShot<Data>({
  name: "demo-daily-home",
  description: "Home after Box No. 3, the Daily Box key at Streak 4; the finger presses it and the Daily Box forms.",
  seconds: 7,
  profile: playedProfile(4, 4, DEFAULT_DATE),
  async setup({ app, hand }) {
    await hand("left").park([-0.45, 0.7, -1.3]);
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "Home at rest" });
    const s = await app.state();
    const daily = s.buttons.find((b) => b.id === "home-daily");
    if (!daily) throw new Error(`no Daily Box key on "${s.screen}" (have: ${s.buttons.map((b) => b.id).join(", ")})`);
    const right = hand("right");
    await right.park(REST_RIGHT);
    await right.point();
    // The fingertip waits below and to the right of the key, out of view.
    await right.glideTip([daily.world[0] + 0.16, daily.world[1] - 0.16, daily.world[2] + 0.12], 300);
    return { daily, box: s.boxPose.position as Vec3 };
  },
  // The seated eye on Home's keys.
  firstView: ({ daily }): View => ({ from: offset(EYE, -0.03, 0, 0), at: offset(daily.world, -0.04, -0.02, 0) }),
  async play({ hand, camera, until, wait }, { daily, box }) {
    const right = hand("right");
    await until(1.6);
    await right.glideTip(along(daily, 0.06), 1100);
    await right.glideTip(along(daily, POKE_DEPTH_M), 220);
    await right.glideTip(along(daily, 0.07), 260);
    await wait(200);
    await right.glide(REST_RIGHT, 900);
    camera.move({ from: offset(EYE, 0.02, 0, 0.02), at: offset(box, 0.02, 0.03, 0.1) }, 1800);
    await until(7);
  },
});
