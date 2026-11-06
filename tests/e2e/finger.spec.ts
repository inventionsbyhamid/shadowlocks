/* eslint-disable @typescript-eslint/no-explicit-any */
// Your finger is the missing piece: box 3's finger lock with the lantern on its spot (by test hook), an IWER hand in
// its `point` pose laid with its index finger across the beam at depth 0.5, along the missing piece. The game is read
// through window.__sl: the hands' shadow outlines this frame, the finger lock's coverage and hold, the crystallised
// piece. (The shadows drawn on the panel come with the panel's shadow mesh; this checks what it is given.)
import type { V2, V3, Vec3 } from "../../src/core/types";
import {
  atFingerLock,
  ControllerFinger,
  fingerLocks,
  hands,
  indexInMouth,
  inside,
  median,
  panelLuma,
  Pointer,
  startFingerTrail,
  takeFingerTrail,
  worldOf,
} from "./helpers/finger";
import { Hands } from "./helpers/hands";
import { add, carry, grab, lantern, play, toWorld } from "./helpers/lantern";
import { expect, test } from "./helpers/test";
import { DT } from "./helpers/xr-app";

/** The finger's depth in the beam (box units), and where it waits first: out of the box, 0.7 nearer the player. */
const Z = 0.5;
const PARK: V3 = [0, 0, 0.7];

const proj = (P: V3, L: V3): V2 => {
  const k = L[2] / (L[2] - P[2]);
  return [L[0] + (P[0] - L[0]) * k, L[1] + (P[1] - L[1]) * k];
};

/**
 * Box 3, the lantern on the finger lock's spot, and the right hand's finger laid along the gap's line out of the box
 * (parked); returns the hand and how to move it in. Nothing fills the gap yet.
 */
async function ready(boot: Parameters<typeof play>[0], page: Parameters<typeof play>[1], mode?: "logic" | "visual") {
  const app = await play(boot, page, { mode });
  const { lock, mid, dir } = await atFingerLock(app, page, Z);
  const hand = new Pointer(app, "right");
  const laid = await hand.lay(add(mid, PARK), dir);
  expect(laid.off).toBeLessThan(0.01);
  expect(laid.angle).toBeLessThan(0.05);
  await app.step(5);
  const [l] = await fingerLocks(page);
  expect(l!.state).toBe("idle");
  // The scraps fill the outline from the spot; the gap is empty.
  expect(l!.coverage.cover).toBeGreaterThanOrEqual(0.92);
  expect(l!.coverage.gap).toBeLessThan(0.78);
  const [a, b] = await worldOf(page, [mid, add(mid, PARK)]);
  const into: Vec3 = [a![0] - b![0], a![1] - b![1], a![2] - b![2]];
  return { app, lock, mid, dir, hand, into };
}

test("finger lock opens after the hold", async ({ page, boot }) => {
  const { app, lock, hand, into } = await ready(boot, page);
  await startFingerTrail(page);
  await hand.shift(into);
  await app.stepUntil((_ns, w) => w.__sl.fingerLocks()[0].state === "done", { maxMs: 2_000, batch: 1, label: "lock open" });
  const trail = await takeFingerTrail(page);
  const first = trail.findIndex((f) => f.meets);
  const done = trail.findIndex((f) => f.state === "done");
  expect(first).toBeGreaterThanOrEqual(0);
  // The finger filled the gap from that frame on, and the lock opened 600 ms later (the 44th frame of the hold).
  for (const f of trail.slice(first, done + 1)) expect(f.meets).toBe(true);
  const held = trail[done]!.t - trail[first]!.t;
  expect(held).toBeGreaterThan(600 - 2 * DT);
  expect(held).toBeLessThan(600 + DT);
  expect(trail[done]!.nFinger).toBe(2);
  const fingerZ = trail[done]!.fingerZ!;
  expect(Math.abs(fingerZ - Z)).toBeLessThan(0.03);

  // The hand leaves; the piece stays where the finger was, on the rays from the spot through the gap.
  await hand.shift([-into[0], -into[1], -into[2]]);
  await app.step(Math.ceil(700 / DT));
  const [l] = await fingerLocks(page);
  expect(l!.state).toBe("done");
  expect(l!.crystal).not.toBeNull();
  expect(l!.crystal!.formed).toBe(true);
  expect(l!.crystal!.z).toBe(fingerZ);
  expect(l!.crystal!.verts.length).toBe(lock.piece.length);
  for (const v of l!.crystal!.verts) {
    const s = proj(v, lock.spot);
    expect(lock.piece.some((o) => Math.hypot(s[0] - o[0], s[1] - o[1]) < 1e-6)).toBe(true);
  }
  expect((await hands(page)).finger.length).toBe(0);
  expect((await page.evaluate(() => window.__ns!.scene.draws())).parts).toContain("Crystal Piece");
  // And it stays open.
  await app.step(30);
  expect((await fingerLocks(page))[0]!.state).toBe("done");
});

test("tracking lost resets the finger hold", async ({ page, boot }) => {
  const { app, hand, into } = await ready(boot, page);
  await hand.shift(into);
  await app.stepUntil((_ns, w) => w.__sl.fingerLocks()[0].progress >= 0.5, { maxMs: 1_000, batch: 1, label: "half held" });
  expect((await fingerLocks(page))[0]!.state).toBe("holding");

  // Out of tracking for 400 ms: no shadow from a pose the headset no longer sees, and the hold starts over.
  await startFingerTrail(page);
  const lostAt = await hand.disconnect();
  await app.step(29);
  const lost = (await takeFingerTrail(page)).filter((f) => f.t >= lostAt + DT);
  expect(lost.length).toBeGreaterThan(25);
  for (const f of lost) {
    expect(f.nFinger).toBe(0);
    expect(f.nRight).toBe(0);
    expect(f.state).not.toBe("done");
  }
  expect(lost.at(-1)!.state).toBe("idle");
  expect(lost.at(-1)!.progress).toBe(0);

  // Back in the same place: the full 600 ms again.
  await startFingerTrail(page);
  await hand.reconnect();
  await hand.point(hand.tip);
  await app.stepUntil((_ns, w) => w.__sl.fingerLocks()[0].state === "done", { maxMs: 2_000, batch: 1, label: "lock open" });
  const back = await takeFingerTrail(page);
  const first = back.findIndex((f) => f.meets), done = back.findIndex((f) => f.state === "done");
  expect(first).toBeGreaterThanOrEqual(0);
  expect(back[done]!.t - back[first]!.t).toBeGreaterThan(600 - 2 * DT);
});

test("the holding hand casts no shadow", async ({ page, boot }) => {
  const app = await play(boot, page);
  const right = new Hands(app, "right");
  // The lantern in front of the box's middle, picked up and carried into the box: it stops at the front (z 1) while
  // the hand holding it goes on into the mouth.
  const l0: V3 = [0.05, -0.05, 1.1];
  await page.evaluate((p) => window.__sl!.placeLantern(p), l0);
  await app.step(2);
  const off = await grab(app, page, right);
  await carry(right, off, await toWorld(page, [l0[0], l0[1], 0.85]), 400);
  await app.step(20);
  let h = await hands(page);
  expect((await lantern(page)).held).toBe(true);
  expect(h.right).not.toBeNull();
  expect(indexInMouth(h.right!)).toBe(true);
  expect(h.right!.outlines).toBe(0);
  expect(h.outlines.length).toBe(h.left?.outlines ?? 0);

  // The other hand in the beam casts, alone.
  const left = new Pointer(app, "left");
  const [tip] = await worldOf(page, [[0.1, 0.1, 0.6]]);
  await left.point(tip!, [1, 0, 0], [0, 0, -1]);
  await app.step(3);
  h = await hands(page);
  expect((await lantern(page)).held).toBe(true);
  expect(indexInMouth(h.left!)).toBe(true);
  expect(h.left!.outlines).toBeGreaterThan(0);
  expect(h.right!.outlines).toBe(0);
  expect(h.outlines.length).toBe(h.left!.outlines);
  expect(h.finger.length).toBe(2);

  // Let go where it is: the right hand, still in the mouth, casts again.
  await right.release();
  await app.step(5);
  expect((await lantern(page)).held).toBe(false);
  h = await hands(page);
  expect(indexInMouth(h.right!)).toBe(true);
  expect(h.right!.outlines).toBeGreaterThan(0);
  expect(h.outlines.length).toBe(h.left!.outlines + h.right!.outlines);
});

test("hand mask renders before the box", async ({ page, boot }) => {
  const app = await play(boot, page);
  const hand = new Pointer(app, "right");
  const [tip] = await worldOf(page, [[0, 0, 0.6]]);
  await hand.point(tip!, [-1, 0, 0], [0, 0, -1]);
  await app.step(3);
  const h = await hands(page);
  const tracked = (h.left ? 1 : 0) + (h.right ? 1 : 0);
  expect(h.mask).toBe(18 * tracked);

  // Within one frame the mask is drawn before every part of the box, colour off and depth on.
  const r = await page.evaluate(() => {
    const w = window as any;
    const scene = w.__ns.world.scene;
    const mask = scene.getObjectByName("Hand Mask");
    const box = scene.getObjectByName("Box");
    const order: string[] = [];
    const wrapped: any[] = [];
    const watch = (o: any, name: string) => {
      const was = o.onBeforeRender;
      o.onBeforeRender = (...a: unknown[]) => {
        order.push(name);
        return was.apply(o, a);
      };
      wrapped.push([o, was]);
    };
    watch(mask, "mask");
    box.traverse((o: any) => {
      if (o.isMesh || o.isLine || o.isPoints || o.isSprite) watch(o, `box:${o.name}`);
    });
    w.__vt.step(1000 / 72);
    for (const [o, was] of wrapped) o.onBeforeRender = was;
    const m = mask.material;
    return { order, colorWrite: m.colorWrite, depthWrite: m.depthWrite, depthTest: m.depthTest, renderOrder: mask.renderOrder };
  });
  expect(r).toMatchObject({ colorWrite: false, depthWrite: true, depthTest: true, renderOrder: -10 });
  const firstMask = r.order.indexOf("mask");
  const firstBox = r.order.findIndex((n) => n.startsWith("box:"));
  expect(firstMask).toBeGreaterThanOrEqual(0);
  expect(firstBox).toBeGreaterThan(firstMask);
  expect(r.order).toContain("box:Box Panel");
  // No hand, no mask.
  await hand.disconnect();
  await app.step(2);
  const gone = await hands(page);
  expect(gone.mask).toBe(18 * ((gone.left ? 1 : 0) + (gone.right ? 1 : 0)));
});

test("on the panel: the finger's shadow darkens the gap, and the hand holding the lantern casts none", async ({ page, boot }) => {
  // The finger: the gap's middle and points out toward its corners, lit while the hand waits outside the box, dark
  // with the finger in the beam (read within a few frames, long before the hold could complete), lit once it leaves.
  const { app, lock, hand, into } = await ready(boot, page);
  const gap = inside(lock.piece);
  const before = await panelLuma(page, gap);
  await hand.shift(into);
  expect((await hands(page)).finger.length).toBe(2);
  const during = await panelLuma(page, gap);
  await hand.shift([-into[0], -into[1], -into[2]]);
  await app.step(3);
  const after = await panelLuma(page, gap);
  expect((await fingerLocks(page))[0]!.state).not.toBe("done");
  expect(median(before)).toBeGreaterThan(40);
  expect(median(during)).toBeLessThan(0.6 * median(before));
  expect(median(after)).toBeGreaterThan(0.85 * median(before));

  // The lantern at the middle of the box front, held by the right hand reaching on into the mouth (the lantern stays
  // at the front, still held, the hand 11 cm deeper, so its shadow would land on the panel). Read a grid over the
  // panel held, let go (the same hand, the same place), and with the hand gone.
  const at: V3 = [0, -0.05, 1];
  await page.evaluate((p) => window.__sl!.placeLantern(p), at);
  const off = await grab(app, page, hand);
  await carry(hand, off, await toWorld(page, [at[0], at[1], 0.55]), 400);
  await app.step(20);
  let h = await hands(page);
  expect((await lantern(page)).held).toBe(true);
  expect(indexInMouth(h.right!)).toBe(true);
  expect(h.right!.outlines).toBe(0);
  const grid: V3[] = [];
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) grid.push([i * 0.1, j * 0.1, 0]);
  const held = await panelLuma(page, grid);
  await hand.release();
  await app.step(5);
  h = await hands(page);
  expect((await lantern(page)).held).toBe(false);
  expect(h.right!.outlines).toBeGreaterThan(0);
  const released = await panelLuma(page, grid);
  const outlines = h.outlines;
  await hand.disconnect();
  await app.step(3);
  const none = await panelLuma(page, grid);
  // The points the let-go hand darkens (under 60% of the same point with no hand; points in a scrap's shadow left
  // out): there are some, they lie in its computed outlines, and every one was lit while it held the lantern.
  const inPoly = (p: V3, poly: V2[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  const shaded = grid.map((_, i) => i).filter((i) => none[i]! > 30 && released[i]! < 0.6 * none[i]!);
  const mean = (xs: number[], at: number[]) => at.reduce((s, i) => s + xs[i]!, 0) / Math.max(1, at.length);
  console.log(
    `panel: the gap's median luma ${median(before).toFixed(0)} lit, ${median(during).toFixed(0)} with the finger, ` +
      `${median(after).toFixed(0)} after; the let-go hand darkens ${shaded.length} of ${grid.length} grid points ` +
      `(mean luma there ${mean(none, shaded).toFixed(0)} with no hand, ${mean(held, shaded).toFixed(0)} held, ${mean(released, shaded).toFixed(0)} let go)`,
  );
  expect(shaded.length).toBeGreaterThanOrEqual(5);
  expect(shaded.filter((i) => outlines.some((o) => inPoly(grid[i]!, o))).length).toBeGreaterThanOrEqual(0.8 * shaded.length);
  expect(shaded.filter((i) => held[i]! < 0.8 * none[i]!)).toEqual([]);
});

test("the crystallise hook forms the piece with no hand", async ({ page, boot }) => {
  const app = await play(boot, page);
  const { lock } = await atFingerLock(app, page, Z);
  await page.evaluate((i) => window.__sl!.crystallise(i, 0.4), lock.lock);
  await app.step(Math.round(300 / DT));
  let [l] = await fingerLocks(page);
  expect(l!.crystal).toMatchObject({ z: 0.4, formed: false });
  await app.step(Math.ceil(400 / DT) + 1);
  [l] = await fingerLocks(page);
  expect(l!.crystal!.formed).toBe(true);
  for (const v of l!.crystal!.verts) {
    const s = proj(v, lock.spot);
    expect(lock.piece.some((o) => Math.hypot(s[0] - o[0], s[1] - o[1]) < 1e-6)).toBe(true);
  }
  // It draws the piece only; opening the lock is the game's.
  expect(l!.state).toBe("idle");
});

test("with controllers only, the deeper controller's stand-in finger opens box 3's finger lock, and the coach line says so", async ({ page, boot }) => {
  const app = await boot();
  await app.queue("set_input_mode", { mode: "controller" });
  await app.settle();
  // Both controllers out of the box first (beside and below it, nearer the player).
  const right = new ControllerFinger(app, "right"), left = new ControllerFinger(app, "left");
  const [farR, farL] = await worldOf(page, [[2.5, -2, 3], [-2.5, -2, 3]]);
  await right.place(farR!);
  await left.place(farL!);
  await page.evaluate(() => window.__ns!.clearEvents());
  const { lock, mid, dir } = await atFingerLock(app, page, Z);
  // One piece short, with controllers in hand: after its 300 ms hold, the coach line suggests a finger.
  expect((await page.evaluate(() => window.__sl!.session.state()))!.coach).toBeNull();
  await app.step(Math.ceil(300 / DT) + 2);
  expect((await page.evaluate(() => window.__sl!.session.state()))!.coach).toBe("controllerFinger");
  expect(await app.events("coach")).toEqual([{ type: "coach", line: "controllerFinger" }]);
  expect((await hands(page)).standIn).toBeNull();

  // The left controller just inside the mouth, away from the gap: its stand-in is the finger.
  await left.lay([-0.35, 0.4, 0.85], [1, 0, 0]);
  expect((await hands(page)).standIn?.by).toBe("left");
  // The right controller held deeper into the beam: its stand-in (the deeper tip) is the finger now, along the gap at
  // depth Z; it fills it, held, and the lock opens.
  const laid = await right.lay(mid, dir);
  expect(laid.off).toBeLessThan(0.01);
  expect(laid.angle).toBeLessThan(0.05);
  const h = await hands(page);
  expect(h.standIn?.by).toBe("right");
  expect(h.left).toBeNull();
  expect(h.right).toBeNull();
  expect(h.finger).toHaveLength(1);
  expect(Math.abs(h.fingerZ! - Z)).toBeLessThan(0.01);
  await app.stepUntil((_ns, w) => w.__sl.fingerLocks()[0].state === "done", { maxMs: 2_000, batch: 1, label: "lock done" });
  await app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock.lock, maxMs: 1_500, batch: 1, label: "lock open" });
  const [l] = await fingerLocks(page);
  expect(Math.abs(l!.crystal!.z - Z)).toBeLessThan(0.01);
  // The line goes once the gap is filled.
  expect(await app.events("coach")).toEqual([
    { type: "coach", line: "controllerFinger" },
    { type: "coach", line: null },
  ]);
  expect((await page.evaluate(() => window.__sl!.session.state()))!.coach).toBeNull();
  expect(app.consoleLines.filter((x) => x.startsWith("error:") || x.startsWith("PAGEERROR"))).toEqual([]);
});

test("finger shots: the finger in the beam, gold filling the gap, the piece left behind", async ({ page, boot }) => {
  const { app, mid, hand, into } = await ready(boot, page, "visual");
  const [gap] = await worldOf(page, [mid]);
  const panel = (await app.state()).box.world!;
  const look = { x: 0.6 * gap![0] + 0.4 * panel[0], y: 0.6 * gap![1] + 0.4 * panel[1], z: 0.6 * gap![2] + 0.4 * panel[2] };
  await hand.shift(into);
  await app.step(10);
  await app.captureHeadset("finger-in-beam-headset", look);
  await app.stepUntil((_ns, w) => w.__sl.fingerLocks()[0].state === "done", { maxMs: 2_000, batch: 1, label: "lock open" });
  // The crystallise's own clock (frame ms since it started) times the shots. A headset capture steps three frames
  // (about 42 ms) and the last one, after the shot, restores the view: the shot is one frame before what reads after.
  const crystal = async () => (await fingerLocks(page))[0]!.crystal!;
  const shot = async (name: string, atMs: number) => {
    await app.stepUntil((_ns, w, ms) => w.__sl.fingerLocks()[0].crystal.ms >= ms, { arg: atMs - 3 * DT, maxMs: 2_000, batch: 1, label: name });
    const before = await crystal();
    await app.captureHeadset(name, look);
    const after = await crystal();
    const at = after.formed ? "formed" : `${(after.ms - DT).toFixed(0)} ms in`;
    console.log(`${name}: crystallise ${before.ms.toFixed(0)} ms in before the capture; shot ${at}, piece ${after.shown ? "shown" : "not yet shown"}`);
    return after;
  };
  // The gold fill, 200 ms in: no piece yet (it forms from 300 ms).
  const fill = await shot("finger-gold-fill-headset", 200);
  expect(fill.ms - DT).toBeLessThan(250);
  expect(fill.shown).toBe(false);
  // The piece forming, 500 ms in, the fill handing its gold over.
  const forming = await shot("finger-piece-forming-headset", 500);
  expect(forming.shown).toBe(true);
  expect(forming.formed).toBe(false);
  await hand.shift([-into[0], -into[1], -into[2]]);
  await app.stepUntil((_ns, w) => w.__sl.fingerLocks()[0].crystal.formed, { maxMs: 2_000, batch: 1, label: "formed" });
  await app.step(10);
  await app.captureHeadset("finger-piece-left-headset", look);
  expect((await crystal()).formed).toBe(true);
  await app.capture("finger-piece-wide");
});
