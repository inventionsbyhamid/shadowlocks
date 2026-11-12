// The film's part D, Daily Box: Home over the lap for a player on a 4-day streak, its Daily Box key saying "Streak 4";
// the right index finger comes in and presses it.
import type { NsButton } from "../../../src/app/test-api";
import type { Vec3 } from "../../../src/core/types";
import { POKE_DEPTH_M } from "../../e2e/helpers/xr-app";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { lerp3, offset } from "../lib/stage";
import { DAILY_PLAYER, EYE } from "./demo2-d-kit";

interface Data {
  daily: NsButton;
  first: View;
  last: View;
}

const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];
const along = (b: NsButton, d: number): Vec3 => [b.world[0] + b.normal[0] * d, b.world[1] + b.normal[1] * d, b.world[2] + b.normal[2] * d];

export default defineShot<Data>({
  name: "demo2-d-daily-home",
  description: "Daily Box: Home, the Daily Box key at Streak 4, pressed by a fingertip.",
  seconds: 2.2,
  profile: DAILY_PLAYER,
  darkStage: true,
  async setup({ app, hand }) {
    await hand("left").park([-0.45, 0.7, -1.3]);
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "Home at rest" });
    const s = await app.state();
    const daily = s.buttons.find((b) => b.id === "home-daily");
    const cont = s.buttons.find((b) => b.id === "home-continue");
    if (!daily || !cont) throw new Error(`no Daily Box key on "${s.screen}" (have: ${s.buttons.map((b) => b.id).join(", ")})`);
    const right = hand("right");
    await right.park(REST_RIGHT);
    await right.point();
    // The fingertip waits below and to the right of the key, just out of the frame.
    await right.glideTip([daily.world[0] + 0.1, daily.world[1] - 0.1, daily.world[2] + 0.1], 300);
    // Close on the title, the Continue key and the Daily Box key.
    const at = lerp3(cont.world, daily.world, 0.45);
    return {
      daily,
      first: { from: offset(EYE, -0.03, 0.0, -0.02), at: offset(at, 0, 0.03, 0), hfovDeg: 54 },
      last: { from: offset(EYE, -0.02, -0.01, -0.07), at: offset(at, 0.01, 0.02, 0), hfovDeg: 50 },
    };
  },
  firstView: ({ first }) => first,
  async play({ hand, camera, until }, { daily, last }) {
    const right = hand("right");
    // The press lands about 0.33 s before the cut: the panel starts to leave on the last two frames (30 fps).
    camera.move(last, 2200);
    await until(0.87);
    await right.glideTip(along(daily, 0.05), 900);
    await right.glideTip(along(daily, POKE_DEPTH_M), 200);
    await right.glideTip(along(daily, 0.06), 200);
    await until(2.2);
  },
});
