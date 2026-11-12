// The demo film, shot 11 (plan/submission/demo-video-script.md): hands first, Touch controllers too. IWER's emulated
// Quest 3 Touch Plus controller (the game's own model, from its own origin) reaches for the lantern, the trigger takes
// it, it carries the light across the box so the shadows move, the trigger lets go and the lantern floats where it
// was left; the controller drops away to rest.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { DEFAULT_DATE, SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { lanternPos, offset, playedProfile, toWorld } from "../lib/stage";

interface Data {
  /** Controller origin minus its grip point (constant: the controller is not turned). */
  gripOff: Vec3;
  lantern: Vec3;
  box: Vec3;
}

const BOX = 6;
const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST: Vec3 = [0.3, 0.78, -1.45];
const xyz = (p: Vec3) => ({ x: p[0], y: p[1], z: p[2] });

export default defineShot<Data>({
  name: "demo-controller",
  description: "A Touch controller's trigger picks the lantern up and carries it; let go, the lantern stays where it was left.",
  seconds: 9,
  profile: playedProfile(BOX, 0, DEFAULT_DATE),
  async setup({ app, page }) {
    await page.evaluate(() => (window as any).__ns.ui.go("play"));
    await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 3_000, label: "menus away" });
    await page.evaluate((k) => (window as any).__sl.session.play({ kind: "box", n: k }), BOX);
    await app.stepUntil((_ns, w) => !!w.__sl.session.state()?.revealed, { maxMs: 15_000, label: `box ${BOX} in play` });
    await app.queue("set_input_mode", { mode: "controller" });
    await app.queue("set_transform", { device: "controller-left", position: { x: -0.35, y: 0.6, z: -1.3 } });
    await app.queue("set_transform", { device: "controller-right", position: xyz(REST) });
    await app.settle(10_000, 4);
    // Where the grip sits off the controller's origin.
    const grip = (await page.evaluate(() => {
      const g = (window as any).__ns.world.player.gripSpaces.right;
      const v = g.getWorldPosition(new g.position.constructor());
      return [v.x, v.y, v.z];
    })) as Vec3;
    // Both controllers' models load before the first frame.
    await app.stepUntil(
      (ns) => {
        const c = (ns.world as any).input.visualAdapters.controller;
        return !!c.left?.visual && !!c.right?.visual;
      },
      { maxMs: 20_000, label: "both controllers' models loaded" },
    );
    await app.step(60);
    return {
      gripOff: [REST[0] - grip[0], REST[1] - grip[1], REST[2] - grip[2]],
      lantern: await toWorld(page, await lanternPos(page)),
      box: (await app.state()).boxPose.position as Vec3,
    };
  },
  firstView: ({ box }): View => ({ from: offset(EYE, -0.04, 0, 0.0), at: offset(box, 0.03, 0.02, 0.1) }),
  async play({ app, until, wait }, { gripOff, lantern }) {
    const to = (p: Vec3, ms: number) =>
      app.queue("animate_to", { device: "controller-right", position: xyz(offset(p, gripOff[0], gripOff[1], gripOff[2])), duration: ms / 1000 });
    const trigger = (v: number) => app.queue("set_gamepad_state", { device: "controller-right", buttons: [{ index: 0, value: v }] });
    await until(0.4);
    await to(offset(lantern, 0.03, 0.04, 0.05), 900);
    await wait(900);
    await to(lantern, 350);
    await wait(600);
    await trigger(1);
    try {
      await app.stepUntil((_ns, w) => w.__sl.lantern().held, { maxMs: 1_000, batch: 1, label: "the lantern held" });
    } catch {
      console.warn("demo-controller: the trigger did not take the lantern");
    }
    // Across the box and nearer the panel (the grip moves as the lantern does): the shadows slide and grow.
    await to(offset(lantern, -0.07, 0.02, -0.03), 2200);
    await wait(2300);
    await trigger(0);
    await wait(700);
    await to(offset(REST, 0.04, -0.12, 0.06), 1400);
    await until(9);
  },
});
