// Holding the lantern: pinch it, carry it, let go, ride a ring line onto a spot, sweep past one, lose the hand, and
// hold it by a controller's trigger. IWER's emulated hands and controllers on the virtual clock; the game is read
// through window.__sl (the lantern, the ring lines, the shadows it casts, the feel events). What holding it costs
// once the engine has optimised it is in lantern-cost.spec.ts (it needs its own browser flags).
import type { V2, Vec3 } from "../../src/core/types";
import { Hands } from "./helpers/hands";
import {
  add,
  carry,
  cross,
  dist,
  feelEvents,
  firstLine,
  grab,
  LOOSE_MS,
  lantern,
  measureCost,
  offLine,
  type P3,
  play,
  posAt,
  shadows,
  startTrail,
  sub,
  takeTrail,
  toWorld,
  unit,
} from "./helpers/lantern";
import { expect, test } from "./helpers/test";
import { DT } from "./helpers/xr-app";

/**
 * The shadows on the panel moved the way a lantern move dL (box units) moves them: S = L + (P - L) Lz / (Lz - Pz),
 * so every vertex slides against the lantern's sideways move, here by more than `minMm` on average. Read from the
 * shadow polygons the game computes for the lantern where it is (the drawn shadow mesh comes with the panel work;
 * this check can then compare the panel's pixels instead, with the same before/after shape).
 */
function expectShadowsFollow(before: V2[][], after: V2[][], dL: P3, sizeM: number, minMm = 2): void {
  expect(before.length).toBeGreaterThan(0);
  expect(after.length).toBe(before.length);
  let sx = 0, sy = 0, n = 0, against = 0;
  for (let k = 0; k < before.length; k++) {
    for (let j = 0; j < before[k]!.length; j++) {
      const dx = after[k]![j]![0] - before[k]![j]![0];
      const dy = after[k]![j]![1] - before[k]![j]![1];
      sx += dx;
      sy += dy;
      n++;
      if (dx * dL[0] + dy * dL[1] < 0) against++;
    }
  }
  expect((Math.hypot(sx / n, sy / n) * sizeM * 1000)).toBeGreaterThan(minMm);
  expect(against / n).toBeGreaterThan(0.95);
}

test("grab and move moves the shadows", async ({ page, boot }) => {
  const app = await play(boot, page);
  const sizeM = (await app.state()).box.sizeM;
  const hand = new Hands(app, "right");
  const start = await lantern(page);
  expect(start.held).toBe(false);
  const w0 = await toWorld(page, start.pos);

  // It brightens as the open hand comes near: dark at 40 cm, about half at 18 cm, nearly full beside it, full held.
  // (The glow reads the pinch point, halfway between the thumb and index tips: an open hand's is about 4 cm from
  // IWER's grasp anchor, so these distances are the anchor's, give or take that.)
  await hand.pinchAt(add(w0, [0.4, 0, 0]), { pinch: false });
  await app.step(30);
  expect((await lantern(page)).glow).toBeLessThan(0.01);
  await hand.moveTo(add(w0, [0.18, 0, 0]), 300);
  await app.step(30);
  const half = (await lantern(page)).glow;
  expect(half).toBeGreaterThan(0.3);
  expect(half).toBeLessThan(0.7);
  await hand.moveTo(add(w0, [0.03, 0, 0]), 300);
  await app.step(30);
  expect((await lantern(page)).glow).toBeGreaterThan(0.9);

  const before = await shadows(page);
  await page.evaluate(() => window.__ns!.clearEvents());
  const off = await grab(app, page, hand);
  const held = await lantern(page);
  expect(held.holder).toBe("right");
  expect(held.glow).toBe(1);
  expect(await app.events("grab")).toEqual([{ type: "grab", hand: "right" }]);
  // No jump to the fingers: it is held where it stood.
  expect(dist(held.pos, start.pos) * sizeM * 1000).toBeLessThan(10);

  // Carry it 5 cm to the left and 2 cm down: it follows, and every shadow on the panel slides the other way.
  const w1 = await toWorld(page, held.pos);
  const want = add(w1, [-0.05, -0.02, 0]);
  await carry(hand, off, want, 400);
  await app.step(30);
  const moved = await lantern(page);
  expect(moved.held).toBe(true);
  expect(dist(await toWorld(page, moved.pos), want)).toBeLessThan(0.005);
  expectShadowsFollow(before, await shadows(page), sub(moved.pos, start.pos), sizeM);
});

test("release keeps the lantern where the hand was", async ({ page, boot }, testInfo) => {
  const app = await play(boot, page);
  const sizeM = (await app.state()).box.sizeM;
  const hand = new Hands(app, "right");
  const off = await grab(app, page, hand);
  const w1 = await toWorld(page, (await lantern(page)).pos);
  await page.evaluate(() => window.__ns!.clearEvents());
  await startTrail(page);
  await carry(hand, off, add(w1, [-0.04, 0.01, 0.02]), 300);
  // The fingers open over 200 ms (opening a pinch drags its point about): the lantern goes back to where it was
  // 150 ms before the pinch let go.
  await app.queue("set_select_value", { device: hand.device, value: 0, duration: 0.2 });
  await app.stepUntil((_ns, w) => !w.__sl.lantern().held, { maxMs: 2_000, batch: 1, label: "let go" });
  await app.step(10);
  const s = await takeTrail(page);
  const r = s.findIndex((x) => !x.held);
  expect(r).toBeGreaterThan(0);
  const before = posAt(s.slice(0, r), s[r]!.t - 150);
  const rest = await lantern(page);
  const mm = dist(rest.pos, before) * sizeM * 1000;
  const drift = dist(s[r - 1]!.pos, rest.pos) * sizeM * 1000;
  const note = `release: ${mm.toFixed(3)} mm from where the lantern was 150 ms before; the opening pinch had dragged it ${drift.toFixed(2)} mm`;
  testInfo.annotations.push({ type: "release", description: note });
  console.log(note);
  expect(mm).toBeLessThan(3);
  expect(await app.events("release")).toEqual([{ type: "release", hand: "right" }]);

  // It floats there: a second later, the hand gone elsewhere, it has not moved at all.
  await hand.moveTo(add(w1, [0.1, 0.08, 0.08]), 300);
  await app.step(72);
  expect((await lantern(page)).pos).toEqual(rest.pos);
});

test("slow approach settles on the spot", async ({ page, boot }) => {
  const app = await play(boot, page, { rings: true });
  const sizeM = (await app.state()).box.sizeM;
  const hand = new Hands(app, "right");
  const { lock, mark, spot, out } = await firstLine(page);
  const off = await grab(app, page, hand);
  // Onto the ring line 6 cm out from the spot, then slowly along it onto the spot (6 cm in 4 s: under 3 cm/s).
  await page.evaluate(() => window.__sl!.clearFeelEvents());
  await carry(hand, off, await toWorld(page, add(spot, out, 0.06 / sizeM)), 500);
  await startTrail(page);
  await carry(hand, off, await toWorld(page, spot), 4000);
  await app.stepUntil((_ns, w) => w.__sl.lantern().mode === "settled", { maxMs: 2_000, label: "settled" });
  await app.step(30);
  const s = await takeTrail(page);

  // The line lock caught it first and the beam showed while it rode the line (and only then); then the settle,
  // with its ripple.
  const assists = (await feelEvents(page)).filter((e) => e.type !== "tick");
  expect(assists.map((e) => [e.type, e.lock, e.on])).toEqual([
    ["line", lock, true],
    ["settle", lock, undefined],
  ]);
  const riding = s.filter((x) => x.mode === "line");
  expect(riding.length).toBeGreaterThan(0);
  expect(s.every((x) => x.beam === (x.mode === "line"))).toBe(true);
  for (const x of riding) expect(offLine(x.pos, mark, out) * sizeM * 1000).toBeLessThan(8);
  expect(s.some((x) => x.ripple)).toBe(true);
  const ticks = (await feelEvents(page)).filter((e) => e.type === "tick").map((e) => e.cm);
  expect(ticks).toEqual(expect.arrayContaining([2, 1]));

  // Settled exactly on the spot; letting go there keeps it exactly there.
  expect((await lantern(page)).pos).toEqual(spot);
  await hand.release();
  const l = await lantern(page);
  expect(l.held).toBe(false);
  expect(l.pos).toEqual(spot);
});

test("fast sweep does not settle", async ({ page, boot }) => {
  const app = await play(boot, page, { rings: true });
  const sizeM = (await app.state()).box.sizeM;
  const hand = new Hands(app, "right");
  const { spot, out } = await firstLine(page);
  // 8 cm to either side of the spot, square to its ring line.
  const side = unit(cross(out, [0, 1, 0]));
  const a = add(spot, side, 0.08 / sizeM), b = add(spot, side, -0.08 / sizeM);
  expect(Math.min(a[2], b[2])).toBeGreaterThan(1.05);
  const off = await grab(app, page, hand);
  await carry(hand, off, await toWorld(page, a), 600);
  await app.step(30);
  await page.evaluate(() => window.__sl!.clearFeelEvents());
  await startTrail(page);
  // Through the spot to the other side: 16 cm in 450 ms (36 cm/s on average, about 67 cm/s at the spot).
  await carry(hand, off, await toWorld(page, b), 450);
  await app.step(40);
  const s = await takeTrail(page);

  const closestCm = Math.min(...s.map((x) => dist(x.pos, spot))) * sizeM * 100;
  expect(closestCm, "the sweep passes inside the settle radius").toBeLessThan(2.4);
  expect((await feelEvents(page)).filter((e) => e.type !== "tick")).toEqual([]);
  expect(s.every((x) => x.mode === "free")).toBe(true);
  const l = await lantern(page);
  expect(l.held).toBe(true);
  expect(dist(l.pos, b) * sizeM * 1000).toBeLessThan(10);
});

test("tracking lost keeps the lantern", async ({ page, boot }) => {
  const app = await play(boot, page);
  const sizeM = (await app.state()).box.sizeM;
  const hand = new Hands(app, "right");
  const off = await grab(app, page, hand);
  const w1 = await toWorld(page, (await lantern(page)).pos);
  await carry(hand, off, add(w1, [-0.03, 0.02, 0]), 300);
  await app.step(30);
  const p0 = (await lantern(page)).pos;
  await page.evaluate(() => window.__ns!.clearEvents());

  // Out of tracking for a second: the lantern stays exactly where it was, still held, and nothing lets it go.
  await startTrail(page);
  const lostAt = await hand.disconnect();
  await app.step(72);
  const s = (await takeTrail(page)).filter((x) => x.t >= lostAt + DT);
  expect(s.length).toBeGreaterThan(70);
  expect(dist(s[0]!.pos, p0) * sizeM * 1000).toBeLessThan(0.1);
  for (const x of s) {
    expect(x.pos).toEqual(s[0]!.pos);
    expect(x.held).toBe(true);
  }
  expect(await app.events("release")).toEqual([]);
  expect(await app.events("tracking-lost")).toEqual([{ type: "tracking-lost", hand: "right" }]);

  // Back with the fingers still pinched: still in the hand, and it follows the hand again.
  await hand.reconnect({ select: 1 });
  await app.step(10);
  expect((await lantern(page)).held).toBe(true);
  const w2 = await toWorld(page, (await lantern(page)).pos);
  await hand.moveTo(add(sub(w2, off), [0, 0.03, 0]), 300);
  await app.step(30);
  expect(dist(await toWorld(page, (await lantern(page)).pos), add(w2, [0, 0.03, 0]))).toBeLessThan(0.006);
  expect(await app.events("release")).toEqual([]);

  // Lost again, and back with the hand open: let go where it stood, once.
  await hand.disconnect();
  await app.step(30);
  const p1 = (await lantern(page)).pos;
  await hand.reconnect();
  await app.step(5);
  const l = await lantern(page);
  expect(l.held).toBe(false);
  expect(l.pos).toEqual(p1);
  expect(await app.events("release")).toEqual([{ type: "release", hand: "right" }]);
});

test("controller trigger grabs the lantern", async ({ page, boot }) => {
  const app = await play(boot, page);
  const w0 = await toWorld(page, (await lantern(page)).pos);
  await app.queue("set_input_mode", { mode: "controller" });
  await app.settle();
  const grip = () =>
    page.evaluate(() => {
      const g = (window.__ns!.world as any).player.gripSpaces.right;
      const v = g.getWorldPosition(new g.position.constructor());
      return [v.x, v.y, v.z] as Vec3;
    });
  // Put the controller's grip on the lantern (the grip sits off the controller's origin: correct for it).
  let pos: Vec3 = [...w0];
  for (let i = 0; i < 4; i++) {
    await app.queue("set_transform", { device: "controller-right", position: { x: pos[0], y: pos[1], z: pos[2] } });
    await app.settle(10_000, 3);
    pos = add(pos, sub(w0, await grip()));
  }
  expect(dist(await grip(), w0)).toBeLessThan(0.003);
  await app.step(40);
  expect((await lantern(page)).glow).toBeGreaterThan(0.99);

  await page.evaluate(() => window.__ns!.clearEvents());
  await app.queue("set_gamepad_state", { device: "controller-right", buttons: [{ index: 0, value: 1 }] });
  await app.settle();
  const l = await lantern(page);
  expect(l.held).toBe(true);
  expect(l.holder).toBe("right");
  expect(await app.events("grab")).toEqual([{ type: "grab", hand: "right" }]);

  const lw = await toWorld(page, l.pos);
  const to = add(pos, [0, 0.03, 0.03]);
  await app.queue("animate_to", { device: "controller-right", position: { x: to[0], y: to[1], z: to[2] }, duration: 0.3 });
  await app.settle(10_000, 30);
  expect(dist(await toWorld(page, (await lantern(page)).pos), add(lw, [0, 0.03, 0.03]))).toBeLessThan(0.005);

  await app.queue("set_gamepad_state", { device: "controller-right", buttons: [{ index: 0, value: 0 }] });
  await app.settle();
  expect((await lantern(page)).held).toBe(false);
  expect(await app.events("release")).toEqual([{ type: "release", hand: "right" }]);
});

// --- Cost -------------------------------------------------------------------------------------------------------

test("holding the lantern: cost in the first seconds, before the engine has optimised it", async ({ page, boot }, testInfo) => {
  // Code V8 has not optimised yet boxes its floating point numbers (a few bytes a frame in every hot function, ours
  // or not) and runs slower: measured and reported, loosely bounded. The strict check is in lantern-cost.spec.ts.
  const c = await measureCost(boot, page, testInfo, "before optimisation");
  expect(c.pinch.p95Ms + c.lan.p95Ms).toBeLessThanOrEqual(LOOSE_MS);
});

// --- Shots ------------------------------------------------------------------------------------------------------

test("lantern shots: reaching, held by its ring, riding the ring line with the beam, settled with the ripple", async ({ page, boot }) => {
  const app = await play(boot, page, { rings: true, mode: "visual" });
  const sizeM = (await app.state()).box.sizeM;
  const hand = new Hands(app, "right");
  const { spot, out } = await firstLine(page);
  const panel = (await app.state()).box.world!;
  const start = await toWorld(page, (await lantern(page)).pos);
  // Look between the lantern and the panel, nearer the lantern (it hangs low in the view).
  const look = (p: P3) => ({ x: 0.65 * p[0] + 0.35 * panel[0], y: 0.65 * p[1] + 0.35 * panel[1], z: 0.65 * p[2] + 0.35 * panel[2] });

  // The open hand 4 cm above the lantern: lit up.
  await hand.pinchAt(add(start, [0, 0.07, 0]), { pinch: false });
  await app.step(20);
  await app.captureHeadset("lantern-reach-headset", look(start));
  // Held by its ring (3.7 cm above the light).
  const off = await grab(app, page, hand, 0.037);
  await app.captureHeadset("lantern-held-headset", look(start));
  // On the ring line: the beam runs from the lock's mark through the rings toward the lantern.
  const q1 = await toWorld(page, add(spot, out, 0.07 / sizeM));
  await carry(hand, off, q1, 500);
  await app.stepUntil((_ns, w) => w.__sl.lantern().mode === "line", { maxMs: 2_000, label: "riding the line" });
  await app.step(6);
  await app.captureHeadset("lantern-line-beam-headset", look(q1));
  // Slid onto the spot: settled, the ripple spreading.
  await carry(hand, off, await toWorld(page, spot), 2500);
  await app.stepUntil((_ns, w) => w.__sl.lantern().mode === "settled", { maxMs: 2_000, label: "settled" });
  await app.step(4);
  await app.captureHeadset("lantern-settled-ripple-headset", look(await toWorld(page, spot)));
  await app.capture("lantern-settled-wide");
});
