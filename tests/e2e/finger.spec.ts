/* eslint-disable @typescript-eslint/no-explicit-any */
// Your finger is the missing piece: box 3's finger lock with the lantern on its spot (by test hook), an IWER hand in
// its `point` pose laid with its index finger across the beam at depth 0.5, along the missing piece. The game is read
// through window.__sl: the hands' shadow outlines this frame, the finger lock's coverage and hold, the crystallised
// piece. (The shadows drawn on the panel come with the panel's shadow mesh; this checks what it is given.)
import type { V2, V3, Vec3 } from "../../src/core/types";
import {
  atFingerLock,
  fingerLocks,
  hands,
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
  const off = await grab(app, page, right);
  // Carry the lantern into the box: it stops at the front (z 1) while the hand holding it goes on into the mouth.
  const l0 = (await lantern(page)).pos;
  await carry(right, off, await toWorld(page, [l0[0], l0[1], 0.85]), 400);
  await app.step(20);
  let h = await hands(page);
  expect((await lantern(page)).held).toBe(true);
  expect(h.right).not.toBeNull();
  expect(h.right!.minZ).toBeLessThanOrEqual(1);
  expect(h.right!.outlines).toBe(0);
  expect(h.outlines.length).toBe(h.left?.outlines ?? 0);

  // The other hand in the beam casts, alone.
  const left = new Pointer(app, "left");
  const [tip] = await worldOf(page, [[0.1, 0.1, 0.6]]);
  await left.point(tip!, [1, 0, 0], [0, 0, -1]);
  await app.step(3);
  h = await hands(page);
  expect((await lantern(page)).held).toBe(true);
  expect(h.left!.minZ).toBeLessThanOrEqual(1);
  expect(h.left!.outlines).toBeGreaterThan(0);
  expect(h.right!.outlines).toBe(0);
  expect(h.outlines.length).toBe(h.left!.outlines);
  expect(h.finger.length).toBe(2);

  // Let go where it is: the right hand, still in the mouth, casts again.
  await right.release();
  await app.step(5);
  expect((await lantern(page)).held).toBe(false);
  h = await hands(page);
  expect(h.right!.minZ).toBeLessThanOrEqual(1);
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

test("finger shots: the finger in the beam, gold filling the gap, the piece left behind", async ({ page, boot }) => {
  const { app, mid, hand, into } = await ready(boot, page, "visual");
  const [gap] = await worldOf(page, [mid]);
  const panel = (await app.state()).box.world!;
  const look = { x: 0.6 * gap![0] + 0.4 * panel[0], y: 0.6 * gap![1] + 0.4 * panel[1], z: 0.6 * gap![2] + 0.4 * panel[2] };
  await hand.shift(into);
  await app.step(10);
  await app.captureHeadset("finger-in-beam-headset", look);
  await app.stepUntil((_ns, w) => w.__sl.fingerLocks()[0].state === "done", { maxMs: 2_000, batch: 1, label: "lock open" });
  await app.step(Math.round(250 / DT));
  await app.captureHeadset("finger-gold-fill-headset", look);
  await app.step(Math.round(250 / DT));
  await app.captureHeadset("finger-piece-forming-headset", look);
  await hand.shift([-into[0], -into[1], -into[2]]);
  await app.step(Math.ceil(400 / DT));
  await app.captureHeadset("finger-piece-left-headset", look);
  await app.capture("finger-piece-wide");
});
