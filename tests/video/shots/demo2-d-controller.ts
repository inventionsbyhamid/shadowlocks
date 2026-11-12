// The film's part D, controllers too: Box No. 9 on the dark stage, IWER's emulated Quest 3 Touch Plus controller (the
// game's own model) already holding the lantern on its trigger; it carries the light across the box, nearer the panel,
// and the shadows slide and grow.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { boxView, lanternPos, offset, playedProfile, toWorld } from "../lib/stage";

interface Data {
  /** Controller origin minus the lantern, once held (constant: the controller is not turned). */
  hold: Vec3;
  to: Vec3;
  first: View;
  last: View;
}

const BOX = 9;
const REST: Vec3 = [0.3, 0.78, -1.45];
const xyz = (p: Vec3) => ({ x: p[0], y: p[1], z: p[2] });

export default defineShot<Data>({
  name: "demo2-d-controller",
  description: "Controllers too: a Touch controller carries the lantern across the box; the shadows slide.",
  seconds: 1.2,
  profile: playedProfile(BOX, 0, DEFAULT_DATE),
  darkStage: true,
  async setup({ app, page }) {
    await page.evaluate(() => (window as any).__ns.ui.go("play"));
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
    await page.evaluate((k) => (window as any).__sl.session.play({ kind: "box", n: k }), BOX);
    await app.stepUntil((_ns, w) => !!w.__sl.session.state()?.revealed, { maxMs: 15_000, label: `box ${BOX} in play` });
    await app.queue("set_input_mode", { mode: "controller" });
    await app.queue("set_transform", { device: "controller-left", position: { x: -0.6, y: 0.4, z: -1.0 } });
    await app.queue("set_transform", { device: "controller-right", position: xyz(REST) });
    await app.settle(10_000, 4);
    await app.stepUntil(
      (ns) => {
        const c = (ns.world as any).input.visualAdapters.controller;
        return !!c.left?.visual && !!c.right?.visual;
      },
      { maxMs: 20_000, label: "both controllers' models loaded" },
    );
    // Where the grip sits off the controller's origin; the grip goes onto the lantern and the trigger takes it.
    const grip = (await page.evaluate(() => {
      const g = (window as any).__ns.world.player.gripSpaces.right;
      const v = g.getWorldPosition(new g.position.constructor());
      return [v.x, v.y, v.z];
    })) as Vec3;
    const off: Vec3 = [REST[0] - grip[0], REST[1] - grip[1], REST[2] - grip[2]];
    const lantern = await toWorld(page, await lanternPos(page));
    await app.queue("animate_to", { device: "controller-right", position: xyz(offset(lantern, off[0], off[1], off[2])), duration: 0.5 });
    await app.step(40);
    await app.queue("set_gamepad_state", { device: "controller-right", buttons: [{ index: 0, value: 1 }] });
    await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 1_000, batch: 1, label: "the lantern held" });
    await app.step(30);
    const start = (await lanternPos(page)) as Vec3;
    const held = await toWorld(page, start);
    const ctrl = offset(lantern, off[0], off[1], off[2]);
    return {
      hold: [ctrl[0] - held[0], ctrl[1] - held[1], ctrl[2] - held[2]],
      to: await toWorld(page, [start[0] - 0.3, start[1] + 0.2, start[2] - 0.12]),
      first: await boxView(page, [0.15, 0.42, 3.0], [0.0, 0.04, 0.5], 51),
      last: await boxView(page, [0.12, 0.4, 2.88], [0.0, 0.05, 0.5], 49),
    };
  },
  firstView: ({ first }) => first,
  async play({ app, camera, until, wait }, { hold, to, last }) {
    camera.move(last, 1200);
    await wait(80);
    await app.queue("animate_to", { device: "controller-right", position: xyz(offset(to, hold[0], hold[1], hold[2])), duration: 1.05 });
    await until(1.2);
  },
});
