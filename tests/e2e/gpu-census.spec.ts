// What every moment of the game asks of a Quest 2's GPU, on IWER's Quest 2 profile (helpers/headset.ts): one eye's
// frame drawn again at half Quest 2's eye buffer each way, every draw counted in the renderer's own order
// (src/app/gpu-census.ts): its program, triangles, the pixels it covers and the fragments it writes, so the overdraw
// of the transparent layers (glass, glows, the ghost hand, the coach chip, the shadows) shows; and the textures held.
// Each new draw's program is also timed per fragment in software rendering (relative cost: which shaders do the most
// work a fragment). The emulator cannot time a headset's GPU: these are the inputs to an estimate, not a measurement.
// Moments: entering (Home), the menus, a box in play with the settle ripple and the coach chip, a lock opening, the box
// opening, a lesson's idle ghost hand and its example, a tip's demo, the Daily Box.
//
// Each moment's census goes to test-results/census/<moment>.json and its frame to test-results/shots/census-<moment>.png;
// a line per moment to the run's notes. The checks: the Quest 2 profile is the one running, its session asked for 72 Hz,
// and no moment writes more than OVERDRAW_MAX fragments per eye pixel or covers more than TRANSPARENT_MAX of the eye
// with transparent layers on average, the ceilings a new full-view layer or a stack of large glows would break.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { Census } from "../../src/app/gpu-census";
import { axisOf, fingerLocks, onRay, Pointer, worldOf } from "./helpers/finger";
import { Hands } from "./helpers/hands";
import { emulateHeadset, QUEST2_EYE } from "./helpers/headset";
import { grab, toWorld } from "./helpers/lantern";
import { expect, test } from "./helpers/test";
import { addRunNote, SHOTS_DIR, type XrApp } from "./helpers/xr-app";

/** The census target: half the eye buffer each way (its counts times 4 are the eye's). */
const SCALE = 2;
const W = QUEST2_EYE.width / SCALE, H = QUEST2_EYE.height / SCALE;
const EYE_PIXELS = QUEST2_EYE.width * QUEST2_EYE.height;
/** Fragments per eye pixel any moment may write (the veil alone is 1; the most measured: 1.47, the decoys tip). */
const OVERDRAW_MAX = 1.8;
/**
 * Transparent layers' fragments per eye pixel, the veil left out (it is drawn in the opaque pass). The most measured:
 * 0.36, the decoys tip's ghost hand pointing close in front of the box (a cheap shader).
 */
const TRANSPARENT_MAX = 0.5;
const CENSUS_DIR = path.join("test-results", "census");
/** A finger laid this deep in the beam (box units). */
const FINGER_Z = 0.5;

test.describe.configure({ timeout: 30 * 60_000 });

// The run's censuses only (the server keeps test-results between runs).
test.beforeAll(() => fs.rmSync(CENSUS_DIR, { recursive: true, force: true }));

/** Software ns per fragment by draw name, measured the first time a draw is seen (median of three probes). */
const probed = new Map<string, { ns: number; material: string }>();
/** Draws seen but too small to time. */
const untimed = new Set<string>();

async function probeNew(page: Page, c: Census): Promise<void> {
  const fresh = [...new Set(c.draws.filter((d) => d.fragments > 0 && !probed.has(d.name) && !untimed.has(d.name)).map((d) => d.name))];
  if (!fresh.length) return;
  const runs: Map<string, number[]> = new Map();
  for (let k = 0; k < 3; k++) {
    const res = await page.evaluate((o) => window.__ns!.gpu.probe(o), { names: fresh, fov: QUEST2_EYE.fov, size: 512, repeats: 4 });
    for (const r of res) runs.set(r.name, [...(runs.get(r.name) ?? []), r.nsPerFragment]);
  }
  for (const name of fresh) {
    const xs = runs.get(name);
    const ns = xs ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0;
    // Too few fragments to time, or a draw whose vertex work drowns its fragments' (the ghost hand's capsules).
    if (!(ns > 0)) {
      untimed.add(name);
      continue;
    }
    probed.set(name, { ns, material: c.draws.find((d) => d.name === name)!.material });
  }
}

/** A draw's software ns per fragment: its own, else the median of those timed with its material, else of all timed. */
function nsOf(name: string, material: string): number {
  const own = probed.get(name);
  if (own) return own.ns;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const all = [...probed.values()];
  return median(all.filter((p) => p.material === material).map((p) => p.ns)) ?? median(all.map((p) => p.ns)) ?? 1;
}

interface Summary {
  moment: string;
  draws: number;
  fragments: number;
  overdraw: number;
  transparent: number;
  veil: number;
  weightedNs: number;
}

/** The census of the frame now, saved, probed, summed and noted. */
async function take(page: Page, moment: string): Promise<Summary> {
  const c = await page.evaluate((o) => window.__ns!.gpu.census(o), { width: W, height: H, fov: QUEST2_EYE.fov, image: true });
  await probeNew(page, c);
  fs.mkdirSync(CENSUS_DIR, { recursive: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  if (c.image) fs.writeFileSync(path.join(SHOTS_DIR, `census-${moment}.png`), Buffer.from(c.image.split(",")[1] ?? "", "base64"));
  const k = SCALE * SCALE;
  const draws = c.draws.map((d) => ({
    ...d,
    eyeFragments: d.fragments * k,
    eyePixels: d.pixels * k,
    nsPerFragment: nsOf(d.name, d.material),
    timed: probed.has(d.name),
  }));
  fs.writeFileSync(path.join(CENSUS_DIR, `${moment}.json`), JSON.stringify({ ...c, image: undefined, scale: k, draws }, null, 2));
  const fragments = draws.reduce((s, d) => s + d.eyeFragments, 0);
  const veil = draws.filter((d) => d.name === "Theatre Veil").reduce((s, d) => s + d.eyeFragments, 0);
  const transparent = draws.filter((d) => d.list === "transparent").reduce((s, d) => s + d.eyeFragments, 0);
  const weightedNs = draws.reduce((s, d) => s + d.eyeFragments * d.nsPerFragment, 0);
  const top = [...draws]
    .sort((a, b) => b.eyeFragments * b.nsPerFragment - a.eyeFragments * a.nsPerFragment)
    .slice(0, 6)
    .map((d) => `${d.name} ${((100 * d.eyeFragments) / EYE_PIXELS).toFixed(1)}% x ${d.nsPerFragment.toFixed(1)} ns${d.timed ? "" : " (untimed)"}`)
    .join("; ");
  const s: Summary = {
    moment,
    draws: c.draws.length,
    fragments,
    overdraw: fragments / EYE_PIXELS,
    transparent: transparent / EYE_PIXELS,
    veil: veil / EYE_PIXELS,
    weightedNs,
  };
  const line =
    `census ${moment}: ${s.draws} draws, ${(fragments / 1e6).toFixed(2)} M fragments an eye (${s.overdraw.toFixed(2)} per pixel; veil ` +
    `${s.veil.toFixed(2)}, transparent ${s.transparent.toFixed(2)}), software cost ${(weightedNs / 1e6).toFixed(1)} ms an eye; ` +
    `textures ${(c.textureBytes / 2 ** 20).toFixed(1)} MiB in ${c.textures.length}; programs ${c.programs}; heaviest: ${top}`;
  console.log(line);
  addRunNote(line);
  return s;
}

function check(s: Summary): void {
  expect(s.overdraw, `${s.moment}: fragments per eye pixel`).toBeLessThanOrEqual(OVERDRAW_MAX);
  expect(s.transparent, `${s.moment}: transparent fragments per eye pixel`).toBeLessThanOrEqual(TRANSPARENT_MAX);
}

async function quest2(page: Page, app: XrApp): Promise<void> {
  const ua = await page.evaluate(() => navigator.userAgent);
  expect(ua).toContain("Quest 2");
  const h = await page.evaluate(() => window.__ns!.headset());
  expect(h).toMatchObject({ class: "xr2-gen1", frameRate: 72 });
  await app.stepUntil((_ns, w) => (w.__ns.world as { session?: XRSession }).session?.frameRate === 72, { maxMs: 2_000, label: "the session at 72 Hz" });
}

async function atRest(app: XrApp): Promise<void> {
  await app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "menus at rest" });
  await app.step(36);
}

async function inPlay(app: XrApp): Promise<void> {
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "the box in play" },
  );
}

test("Quest 2 GPU census: entering, the menus, box 15 with the ripple and the coach chip, a lock opening, the box opening", async ({
  page,
  boot,
}) => {
  await emulateHeadset(page, "metaQuest2");
  const app = await boot();
  await quest2(page, app);
  const all: Summary[] = [];
  await atRest(app);
  all.push(await take(page, "entering-home"));
  for (const screen of ["settings", "collection", "lessons"] as const) {
    await page.evaluate((s) => window.__ns!.ui.go(s), screen);
    await atRest(app);
    all.push(await take(page, `menus-${screen}`));
  }

  // Box 15: the first tip on the coach line, the lantern carried by the right hand onto the finger lock's spot, where
  // it settles and ripples (the finger lock needs a finger, so nothing opens).
  await page.evaluate(() => window.__sl!.session.play({ kind: "box", n: 15 }));
  await inPlay(app);
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().coach.opacity > 0.9, { maxMs: 10_000, label: "the tip on the coach line" });
  const [f] = await fingerLocks(page);
  expect(f).toBeDefined();
  const right = new Hands(app, "right");
  await page.evaluate((L) => window.__sl!.placeLantern([L[0], L[1] - 0.12, L[2] + 0.1]), f!.spot);
  await app.step(3);
  const off = await grab(app, page, right);
  // The carry queued and stepped a frame at a time, so the census catches the ripple (half a second) as it spreads.
  const spot = await toWorld(page, f!.spot);
  await app.queue("animate_to", {
    device: "hand-right",
    anchor: "grasp",
    position: { x: spot[0] - off[0], y: spot[1] - off[1], z: spot[2] - off[2] },
    duration: 2.5,
    easing: "minimum-jerk",
  });
  await app.stepUntil((_ns, w) => w.__sl.lantern().ripple > 0.2, { maxMs: 5_000, batch: 1, label: "the settle ripple" });
  all.push(await take(page, "box15-ripple-chip"));
  await app.settle();
  await right.release();
  await right.moveTo(await toWorld(page, [0.6, -0.9, 1.6]), 300);

  // The finger locks, each by the right index finger laid in its gap with the lantern on its spot (as perf-budget's
  // opening check), then the plain locks by the lantern: the first plain one's sunburst and glints, the last one's
  // opening into the box's.
  const s = (await page.evaluate(() => window.__sl!.session.state()))!;
  const open = (lock: number, label: string) =>
    app.stepUntil((_ns, w, i) => w.__sl.session.state().open.includes(i), { arg: lock, maxMs: 3_000, batch: 1, label });
  const hand = new Pointer(app, "right");
  for (const fl of await fingerLocks(page)) {
    await page.evaluate((L) => window.__sl!.placeLantern(L), fl.spot);
    await app.step(3);
    const { mid, angle } = axisOf(fl.piece);
    const sign = Math.cos(angle) >= 0 ? -1 : 1;
    await hand.lay(onRay(fl.spot, mid, FINGER_Z), [sign * Math.cos(angle), sign * Math.sin(angle), 0]);
    await open(fl.lock, `finger lock ${fl.lock} open`);
    const [inBox, out] = await worldOf(page, [[0, 0, FINGER_Z], [0, 0, 1.6]]);
    await hand.shift([out![0] - inBox![0], out![1] - inBox![1], out![2] - inBox![2]]);
    await app.step(3);
  }
  const plain = s.locks.filter((x) => !x.finger);
  // Virtual ms since the last lock opened (the first plain lock's moments count when it is the last).
  let t = 0;
  for (const [i, l] of plain.entries()) {
    await page.evaluate((L) => window.__sl!.placeLantern(L), l.spot);
    await open(l.i, `lock ${l.i} open`);
    t = 0;
    if (i === 0) {
      // Its sunburst (200 ms in), then the glints and the glitter rising (500 ms in).
      await app.step(1, 200);
      all.push(await take(page, "lock-opening-burst"));
      await app.step(3, 100);
      all.push(await take(page, "lock-opening-glints"));
      t = 500;
      if (plain.length > 1) await app.step(10, 100);
    }
  }
  // The box opening: the sweep, the walls and lid lifting, the room coming up, the reward's glow at its peak.
  for (const at of [700, 1400, 2100, 2800]) {
    for (; t < at; t += 100) await app.step(1, 100);
    all.push(await take(page, `box-open-${at}ms`));
  }
  expect(await app.events("box-open")).toHaveLength(1);
  for (const x of all) check(x);
});

test("Quest 2 GPU census: lesson 1's idle ghost hand and its first example", async ({ page, boot }) => {
  await emulateHeadset(page, "metaQuest2");
  const app = await boot({ lessons: true, expectScreen: "play" });
  await quest2(page, app);
  const all: Summary[] = [];
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.session.state();
      return s?.key === "shadow-locks/lesson/l1" && s.stage === "playing" && s.revealed;
    },
    { maxMs: 10_000, label: "lesson 1 in play" },
  );
  await app.stepUntil((_ns, w) => w.__sl.lessons.state().hand.opacity > 0.9, { maxMs: 8_000, label: "the idle ghost hand" });
  all.push(await take(page, "lesson1-idle-ghost"));
  await page.evaluate(() => window.__sl!.lessons.start("l1", 2, true));
  await app.stepUntil(
    (_ns, w) => {
      const s = w.__sl.lessons.state();
      return s.park >= 1 && s.lamp.opacity > 0.9 && s.hand.opacity > 0.9;
    },
    { maxMs: 12_000, dt: 50, label: "Example 1 running" },
  );
  all.push(await take(page, "lesson1-example"));
  for (const x of all) check(x);
});

test("Quest 2 GPU census: a tip's ghost demo and the Daily Box with the lantern in hand", async ({ page, boot }) => {
  await emulateHeadset(page, "metaQuest2");
  const app = await boot();
  await quest2(page, app);
  const all: Summary[] = [];
  // Box 2's tip (decoys): the ghost hand points at them. Then box 4's (a lock without rings): the ghost sweeps its
  // lantern near the lock's spot, the shadows cast from it. Each demo is about 6 s: the frame where its ghost is up.
  const demo = async (n: number, moment: string, up: string) => {
    await page.evaluate((k) => window.__sl!.session.play({ kind: "box", n: k }), n);
    await inPlay(app);
    await app.stepUntil((_ns, w) => w.__sl.lessons.state().tipping, { maxMs: 2_000, label: `box ${n}'s tip demo` });
    await app.stepUntil((_ns, w, k) => (k === "lamp" ? w.__sl.lessons.state().lamp.opacity : w.__sl.lessons.state().ghost) > 0.9, {
      arg: up,
      maxMs: 8_000,
      label: `box ${n}'s demo: the ${up} up`,
    });
    all.push(await take(page, moment));
    await app.stepUntil((_ns, w) => !w.__sl.lessons.state().tipping, { maxMs: 10_000, label: `box ${n}'s demo over` });
  };
  await demo(2, "tip-demo-decoys", "ghost");
  await demo(4, "tip-demo-ringless", "lamp");
  // The Daily Box, the lantern picked up by the right hand.
  await page.evaluate(() => window.__sl!.session.play({ kind: "daily", day: "2026-11-02" }));
  await inPlay(app);
  await app.step(72);
  const right = new Hands(app, "right");
  await grab(app, page, right);
  await app.step(12);
  all.push(await take(page, "daily-box-held"));
  for (const x of all) check(x);
});
