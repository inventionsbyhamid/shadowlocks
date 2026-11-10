// Controller models beyond Quest 3's (src/app/input-profiles.ts). IWSDK draws a controller's model from the first
// profile the controller reports, and does not look further down the list when that model fails to load. IWER's
// Quest 2 profile reports oculus-touch-v3 and its Quest Pro profile meta-quest-touch-pro, as the real controllers do;
// the Quest 3S Xbox Edition's controllers report meta-quest-touch-plus-v2 (the registry's note for that profile), which
// no IWER profile does, so that case rewrites the emulated Quest 3's Touch Plus list. Each model ships in
// public/input-profiles/ and loads from our own origin, as Quest 3's meta-quest-touch-plus does (boot.spec.ts); the
// Xbox Edition's is drawn with that Touch Plus model (input-profiles.ts MODEL_STANDINS: its own is too big to ship).
//
// Draw calls with both controllers held (task-29-review.md, M4): the play cap (50 calls in any frame of box play,
// perf-budget.spec.ts) is measured there with hands. Here the same frame with controllers: the heaviest box from 10 to
// 60 in play, the right controller carrying the lantern back and forth and the left one's stand-in finger in the beam,
// casting (perf-play.ts's hands case, controllers in hand), on Quest 2 and Pro (whose models are new) and on Quest 3
// for comparison. The controllers' own draws in that frame are counted as three draws them, so the frame measured is
// one that draws both models. (The GLBs hold 6 primitives a hand, but each model reaches the scene as one mesh: one
// call a hand and view. Measured on 2026-11-08: 40 calls on all three, of them 4 the models'; hands draw 46.)
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Page } from "@playwright/test";
import type { Vec3 } from "../../src/core/types";
import { ControllerFinger, hands } from "./helpers/finger";
import { emulateHeadset, emulateTouchPlusProfiles, type IwerHeadset } from "./helpers/headset";
import { heaviestBox } from "./helpers/heavy-box";
import { add, lantern, sub, toWorld } from "./helpers/lantern";
import { expect, test } from "./helpers/test";

/** What IWSDK's controller visual adapters hold for each hand: the profile reported, the one resolved, the model. */
interface Held {
  reported: string | null;
  resolved: string | null;
  model: boolean;
  attached: boolean;
  meshes: number;
}

/** The registry's list for the Xbox Edition's controllers: its own id, then what it falls back to. */
const TOUCH_PLUS_V2 = [
  "meta-quest-touch-plus-v2",
  "meta-quest-touch-plus",
  "oculus-touch-v3",
  "oculus-touch",
  "generic-trigger-squeeze-thumbstick",
] as const;

/** Each case's controllers, set up before boot; a rewrite of IWER's code says afterwards whether it applied. */
interface Case {
  name: string;
  /** The profile the controllers report first, and IWSDK resolves. */
  profile: string;
  /** The folder its model loads from. */
  model: string;
  emulate(page: Page): Promise<void | { applied(): boolean }>;
}

const CASES: readonly Case[] = [
  { name: "metaQuest2", profile: "oculus-touch-v3", model: "oculus-touch-v3", emulate: (page) => emulateHeadset(page, "metaQuest2") },
  {
    name: "metaQuestPro",
    profile: "meta-quest-touch-pro",
    model: "meta-quest-touch-pro",
    emulate: (page) => emulateHeadset(page, "metaQuestPro"),
  },
  {
    name: "the Quest 3S Xbox Edition",
    profile: "meta-quest-touch-plus-v2",
    model: "meta-quest-touch-plus",
    emulate: (page) => emulateTouchPlusProfiles(page, TOUCH_PLUS_V2),
  },
];

for (const { name, profile, model, emulate } of CASES) {
  test(`${name}'s controllers (${profile}) draw the ${model} model, loaded from our own origin`, async ({ page, boot }) => {
    const rewrite = await emulate(page);
    const app = await boot();
    if (rewrite) expect(rewrite.applied(), "IWER's Touch Plus config found and rewritten").toBe(true);
    await app.stepUntil(
      (ns) => {
        const c = (ns.world as unknown as { input: { visualAdapters: { controller: Record<string, { visual?: unknown }> } } }).input.visualAdapters
          .controller;
        return !!c.left?.visual && !!c.right?.visual;
      },
      { maxMs: 20_000, label: "both controllers' models loaded" },
    );
    const held = await page.evaluate((): Held[] => {
      interface Adapter {
        inputSource?: { profiles: readonly string[] };
        inputConfig?: { resolvedProfileId: string };
        visual?: { model: { parent: unknown; traverse(fn: (o: { isMesh?: boolean }) => void): void } };
      }
      const c = (window.__ns!.world as unknown as { input: { visualAdapters: { controller: Record<string, Adapter> } } }).input.visualAdapters
        .controller;
      return ["left", "right"].map((h) => {
        const a = c[h]!;
        let meshes = 0;
        a.visual?.model.traverse((o) => {
          if (o.isMesh) meshes++;
        });
        return {
          reported: a.inputSource?.profiles[0] ?? null,
          resolved: a.inputConfig?.resolvedProfileId ?? null,
          model: !!a.visual,
          attached: !!a.visual?.model.parent,
          meshes,
        };
      });
    });
    for (const h of held) {
      expect(h).toMatchObject({ reported: profile, resolved: profile, model: true, attached: true });
      expect(h.meshes).toBeGreaterThan(0);
    }
    for (const hand of ["left", "right"]) expect(app.requested(`/input-profiles/${model}/${hand}.glb`)).toBe(true);
    if (model !== profile) expect(app.requested(`/input-profiles/${profile}/`), "the profile's own folder, which does not ship").toBe(false);
    expect(app.foreignHosts()).toEqual([]);
    expect(app.consoleLines.filter((l) => l.includes("Failed to load visual asset"))).toEqual([]);
  });
}

/** perf-budget.spec.ts's caps for any frame of box play. */
const PLAY_CALLS = 50;
const PLAY_TRIANGLES = 100_000;

/** The headsets measured with controllers: Quest 2 and Pro (new models), and Quest 3 (the project's) to compare. */
const HELD: readonly { name: string; device: IwerHeadset | null; model: string }[] = [
  { name: "Quest 2", device: "metaQuest2", model: "oculus-touch-v3" },
  { name: "Quest Pro", device: "metaQuestPro", model: "meta-quest-touch-pro" },
  { name: "Quest 3", device: null, model: "meta-quest-touch-plus" },
];

for (const { name, device, model } of HELD) {
  test(`${name}: the heaviest box in play with both controllers held, the lantern carried and a stand-in finger casting: within the play's ${PLAY_CALLS} draw calls`, async ({
    page,
    boot,
  }, testInfo) => {
    if (device) await emulateHeadset(page, device);
    const app = await boot();
    await app.stepUntil(
      (ns) => {
        const c = (ns.world as any).input.visualAdapters.controller;
        return !!c.left?.visual && !!c.right?.visual;
      },
      { maxMs: 20_000, label: "both controllers' models loaded" },
    );
    const n = heaviestBox().n;
    await page.evaluate((n) => window.__sl!.session.play({ kind: "box", n }), n);
    await app.stepUntil(
      (_ns, w) => {
        const s = w.__sl.session.state();
        return s?.stage === "playing" && s.revealed;
      },
      { maxMs: 10_000, label: `box ${n} in play` },
    );
    await app.queue("set_input_mode", { mode: "controller" });
    await app.settle();
    // The left controller's stand-in finger in the beam, casting, where the hands case puts the left hand's fingers.
    const left = new ControllerFinger(app, "left");
    await left.lay([0.1, 0.05, 0.6], [1, 0, 0]);
    // The lantern in front of the box's middle (perf-play.ts), the right controller's grip put on it, the trigger down.
    await page.evaluate(() => window.__sl!.placeLantern([0.05, -0.1, 1.25]));
    await app.step(2);
    const grip = () =>
      page.evaluate(() => {
        const g = (window.__ns!.world as any).player.gripSpaces.right;
        const v = g.getWorldPosition(new g.position.constructor());
        return [v.x, v.y, v.z] as Vec3;
      });
    const w0 = await toWorld(page, (await lantern(page)).pos);
    let at: Vec3 = [...w0];
    for (let i = 0; i < 4; i++) {
      await app.queue("set_transform", { device: "controller-right", position: { x: at[0], y: at[1], z: at[2] } });
      await app.settle(10_000, 3);
      at = add(at, sub(w0, await grip()));
    }
    await app.queue("set_gamepad_state", { device: "controller-right", buttons: [{ index: 0, value: 1 }] });
    await app.settle();
    expect(await lantern(page)).toMatchObject({ held: true, holder: "right" });
    expect((await hands(page)).standIn?.by, "the left controller's stand-in finger in the beam").toBe("left");
    // Carried back and forth between perf-play.ts's two points, every frame's draws counted.
    const [a, b] = [await toWorld(page, [-0.12, -0.18, 1.2]), await toWorld(page, [0.18, -0.28, 1.38])];
    const to = (q: Vec3) => add(at, sub(q, w0));
    await page.evaluate(() => window.__ns!.resetPerf());
    for (let i = 0; i < 6; i++) {
      const p = to(i % 2 ? a : b);
      await app.queue("animate_to", { device: "controller-right", position: { x: p[0], y: p[1], z: p[2] }, duration: 0.6 });
      await app.settle(10_000, 2);
    }
    const perf = await app.perf();
    expect((await lantern(page)).held).toBe(true);
    expect((await page.evaluate(() => window.__sl!.session.state()))!.stage).toBe("playing");
    // One more frame, the calls the two models made in it counted as three draws them (a mesh's onBeforeRender runs once
    // a draw).
    const frame = await page.evaluate(() => {
      const w = window as any, c = w.__ns.world.input.visualAdapters.controller;
      const counted = { draws: 0, meshes: 0, attached: 0 };
      for (const h of ["left", "right"]) {
        const model = c[h].visual.model;
        if (model.parent) counted.attached++;
        model.traverse((o: any) => {
          if (!o.isMesh) return;
          let shown = true;
          for (let p = o; p; p = p.parent) shown &&= p.visible;
          if (shown) counted.meshes++;
          const before = o.onBeforeRender;
          o.onBeforeRender = function (this: unknown, ...args: unknown[]) {
            counted.draws++;
            return before.apply(this, args);
          };
        });
      }
      w.__vt.step(1000 / 72);
      return { ...counted, calls: w.__ns.world.renderer.info.render.calls as number };
    });
    const line =
      `${name} with both controllers (${model}), box ${n} in play: at most ${perf.callsMax} draw calls and ${perf.trianglesMax} triangles in a frame ` +
      `(caps ${PLAY_CALLS} and ${PLAY_TRIANGLES}); one frame: ${frame.calls} calls, ${frame.draws} of them the two models' (${frame.meshes} meshes)`;
    testInfo.annotations.push({ type: "perf", description: line });
    console.log(line);
    expect(frame.attached, "both models in the scene").toBe(2);
    expect(frame.meshes).toBeGreaterThan(0);
    expect(frame.draws, "every mesh of both models drawn in the frame measured").toBeGreaterThanOrEqual(frame.meshes);
    expect(frame.calls).toBeLessThanOrEqual(PLAY_CALLS);
    expect(perf.callsMax).toBeLessThanOrEqual(PLAY_CALLS);
    expect(perf.trianglesMax).toBeLessThanOrEqual(PLAY_TRIANGLES);
  });
}
