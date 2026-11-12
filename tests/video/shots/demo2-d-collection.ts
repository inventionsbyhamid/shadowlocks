// The film's part D, records: the Collection over the lap for a player past Box No. 11 with four Daily Boxes opened:
// fifteen rewards, three to a page, each with its box and its story lines. The fingertip pokes Older and the next three
// come up.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NsButton } from "../../../src/app/test-api";
import type { Vec3 } from "../../../src/core/types";
import { POKE_DEPTH_M } from "../../e2e/helpers/xr-app";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { offset } from "../lib/stage";
import { DAILY_PLAYER, EYE } from "./demo2-d-kit";

interface Data {
  older: NsButton;
  first: View;
  last: View;
}

const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];
const along = (b: NsButton, d: number): Vec3 => [b.world[0] + b.normal[0] * d, b.world[1] + b.normal[1] * d, b.world[2] + b.normal[2] * d];

export default defineShot<Data>({
  name: "demo2-d-collection",
  description: "Records: the Collection, rewards and their story lines; Older pages to more.",
  seconds: 2.3,
  profile: DAILY_PLAYER,
  darkStage: true,
  async setup({ app, page, hand }) {
    await hand("left").park([-0.45, 0.7, -1.3]);
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "Home at rest" });
    await page.evaluate(() => (window as any).__ns.ui.go("collection"));
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "the Collection at rest" });
    const s = await app.state();
    const older = s.buttons.find((b) => b.id === "coll-older");
    if (!older) throw new Error(`no Older key on "${s.screen}" (have: ${s.buttons.map((b) => b.id).join(", ")})`);
    const ids = s.buttons.map((b) => b.world);
    const mid: Vec3 = [0, 1, 2].map((k) => ids.reduce((a, w) => a + (w[k] as number), 0) / ids.length) as Vec3;
    const right = hand("right");
    await right.park(REST_RIGHT);
    await right.point();
    await right.glideTip([older.world[0] + 0.1, older.world[1] - 0.1, older.world[2] + 0.1], 300);
    return {
      older,
      first: { from: offset(EYE, 0.0, 0.0, 0.0), at: offset(mid, -0.14, -0.03, 0), hfovDeg: 64 },
      last: { from: offset(EYE, 0.0, -0.01, -0.04), at: offset(mid, -0.13, -0.03, 0), hfovDeg: 60 },
    };
  },
  firstView: ({ first }) => first,
  async play({ hand, camera, until }, { older, last }) {
    const right = hand("right");
    camera.move(last, 2300);
    await until(0.5);
    await right.glideTip(along(older, 0.05), 500);
    await right.glideTip(along(older, POKE_DEPTH_M), 180);
    await right.glideTip(along(older, 0.07), 260);
    await until(2.3);
  },
});
