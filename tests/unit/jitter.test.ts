// The jitter bot's pure parts (tests/e2e/helpers/jitter.ts): the wrapper that puts realistic hand noise, release
// drift and tracking dropouts on IWER remote commands, and the careful player's and the sweeper's paths.
import { describe, expect, it } from "vitest";
import {
  approachPlan,
  type Dispatch,
  type JitterOptions,
  type Leg,
  pathMs,
  sweepPlan,
  withJitter,
} from "../e2e/helpers/jitter";
import type { V3 } from "../../src/core/types";

type Call = { method: string; params: Record<string, any> };

/** A fake IWER dispatch that records every command, and a clock the test moves. */
function rig(o: Partial<JitterOptions> = {}) {
  const calls: Call[] = [];
  const dispatch: Dispatch = (method, params) => {
    calls.push({ method, params });
    return Promise.resolve({ ok: true });
  };
  let t = 1000;
  const opts: JitterOptions = { noiseMm: 3, releaseDriftCm: [1, 1.5], dropoutMs: 200, dropoutEverySec: 10, seed: 7, now: () => t, ...o };
  const j = withJitter(dispatch, opts);
  return {
    j,
    calls,
    advance: (ms: number) => {
      t += ms;
    },
    get t() {
      return t;
    },
  };
}

const at = (x: number, y: number, z: number) => ({ x, y, z });
const set = (device: string, p: { x: number; y: number; z: number }, extra: Record<string, unknown> = {}) => ({
  device,
  anchor: "grasp",
  position: p,
  ...extra,
});
const DT = 1000 / 72;
const mm = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  [(a.x - b.x) * 1000, (a.y - b.y) * 1000, (a.z - b.z) * 1000] as const;

describe("withJitter", () => {
  it("puts every set position within noiseMm of the asked one on each axis, a new draw every time", async () => {
    const r = rig({ dropoutEverySec: 1e9 });
    const p = at(0.1, 1.0, -1.8);
    const offs: number[] = [];
    for (let i = 0; i < 400; i++) {
      await r.j.dispatch("set_transform", set("hand-right", p));
      r.advance(DT);
    }
    expect(r.calls).toHaveLength(400);
    for (const c of r.calls) {
      expect(c.method).toBe("set_transform");
      for (const d of mm(c.params.position, p)) {
        expect(Math.abs(d)).toBeLessThanOrEqual(3 + 1e-9);
        offs.push(d);
      }
    }
    const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
    const rms = Math.sqrt(offs.reduce((a, b) => a + b * b, 0) / offs.length);
    expect(Math.abs(mean)).toBeLessThan(0.3);
    // Uniform on [-3, 3] mm: RMS sqrt(3) mm.
    expect(rms).toBeGreaterThan(1.5);
    expect(rms).toBeLessThan(2);
    // Consecutive draws differ.
    expect(new Set(r.calls.map((c) => c.params.position.x)).size).toBeGreaterThan(390);
  });

  it("noises animate_to's end too, and leaves the device, anchor, orientation and the caller's params alone", async () => {
    const r = rig({ dropoutEverySec: 1e9 });
    const params = set("hand-right", at(0, 1, -1), { orientation: "auto", duration: 0.2 });
    const before = JSON.stringify(params);
    await r.j.dispatch("animate_to", params);
    expect(JSON.stringify(params)).toBe(before);
    const c = r.calls[0]!;
    expect(c.method).toBe("animate_to");
    expect(c.params).toMatchObject({ device: "hand-right", anchor: "grasp", orientation: "auto", duration: 0.2 });
    expect(c.params.position).not.toEqual(params.position);
    // Commands without a position pass as they are.
    await r.j.dispatch("set_hand_pose", { device: "hand-right", poseId: "point" });
    await r.j.dispatch("set_input_mode", { mode: "hand" });
    expect(r.calls.slice(1)).toEqual([
      { method: "set_hand_pose", params: { device: "hand-right", poseId: "point" } },
      { method: "set_input_mode", params: { mode: "hand" } },
    ]);
  });

  it("is reproducible from its seed", async () => {
    const run = async (seed: number) => {
      const r = rig({ seed, dropoutEverySec: 1e9 });
      for (let i = 0; i < 20; i++) await r.j.dispatch("set_transform", set("hand-right", at(0, 1, -1)));
      return r.calls.map((c) => c.params.position);
    };
    expect(await run(3)).toEqual(await run(3));
    expect(await run(3)).not.toEqual(await run(4));
  });

  it("drags the hand 1 to 1.5 cm while a pinch opens, and the next pinch starts clean", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = rig({ seed, noiseMm: 0, dropoutEverySec: 1e9, releaseDriftMs: 150 });
      const p = at(0.2, 0.9, -1.9);
      const pos = async () => {
        await r.j.dispatch("set_transform", set("hand-right", p));
        return r.calls[r.calls.length - 1]!.params.position;
      };
      await r.j.dispatch("set_select_value", { device: "hand-right", value: 1 });
      expect(await pos()).toEqual(p);
      // The fingers start to open: the drift starts now and is all there after releaseDriftMs.
      await r.j.dispatch("set_select_value", { device: "hand-right", value: 0.8 });
      expect(await pos()).toEqual(p);
      r.advance(75);
      const half = Math.hypot(...mm(await pos(), p)) / 10;
      r.advance(75);
      await r.j.dispatch("set_select_value", { device: "hand-right", value: 0 });
      const full = Math.hypot(...mm(await pos(), p)) / 10;
      expect(full).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(full).toBeLessThanOrEqual(1.5 + 1e-9);
      expect(half).toBeCloseTo(full / 2, 6);
      r.advance(500);
      expect(Math.hypot(...mm(await pos(), p)) / 10).toBeCloseTo(full, 9);
      // A new pinch: the hand is where it is asked to be again.
      await r.j.dispatch("set_select_value", { device: "hand-right", value: 0.5 });
      expect(await pos()).toEqual(p);
      expect(r.j.stats.drifts).toHaveLength(1);
      expect(r.j.stats.drifts[0]).toBeCloseTo(full, 9);
    }
  });

  it("ends a release drift when the hand is next sent somewhere else (the next gesture is aimed afresh)", async () => {
    const r = rig({ noiseMm: 0, dropoutEverySec: 1e9 });
    const p = at(0.2, 0.9, -1.9);
    await r.j.dispatch("set_select_value", { device: "hand-right", value: 1 });
    await r.j.dispatch("set_transform", set("hand-right", p));
    await r.j.dispatch("set_select_value", { device: "hand-right", value: 0 });
    r.advance(200);
    await r.j.dispatch("set_transform", set("hand-right", p));
    expect(Math.hypot(...mm(r.calls[r.calls.length - 1]!.params.position, p))).toBeGreaterThanOrEqual(10);
    // Laid elsewhere (a finger in the box, another anchor): exactly where asked, from then on.
    const q = at(0.1, 0.95, -1.95);
    for (let i = 0; i < 3; i++) {
      await r.j.dispatch("set_transform", set("hand-right", q, { anchor: "index-tip" }));
      expect(r.calls[r.calls.length - 1]!.params.position).toEqual(q);
      r.advance(DT);
    }
    // Other devices' drifts are their own.
    await r.j.dispatch("set_select_value", { device: "controller-right", value: 1 });
    await r.j.dispatch("set_select_value", { device: "controller-right", value: 0 });
    r.advance(200);
    await r.j.dispatch("set_transform", { device: "controller-right", position: q });
    expect(r.calls[r.calls.length - 1]!.params.position).not.toEqual(q);
  });

  it("loses tracking for dropoutMs every dropoutEverySec, swallowing commands meanwhile and restoring the pinch", async () => {
    const r = rig({ noiseMm: 0, seed: 11 });
    const p = at(0, 1, -1.5);
    await r.j.dispatch("set_select_value", { device: "hand-right", value: 1 });
    const lostFrames: number[] = [];
    let frame = 0;
    const end = r.t + 35_000;
    while (r.t < end || r.j.lost) {
      r.j.tick();
      if (r.j.lost) lostFrames.push(frame);
      await r.j.dispatch("set_transform", set("hand-right", { x: p.x + frame * 1e-5, y: p.y, z: p.z }));
      r.advance(DT);
      frame++;
    }
    const conn = r.calls.filter((c) => c.method === "set_connected");
    const offs = conn.filter((c) => !c.params.connected);
    const ons = conn.filter((c) => c.params.connected);
    // 35 s at one every 10 s from a random start in the first period: three or four.
    expect(offs.length).toBeGreaterThanOrEqual(3);
    expect(offs.length).toBeLessThanOrEqual(4);
    expect(ons.length).toBe(offs.length);
    expect(r.j.stats.dropouts).toBe(offs.length);
    for (const c of conn) expect(c.params.device).toBe("hand-right");
    // Each loss lasts 200 ms to the frame; consecutive losses start 10 s apart.
    const runs: number[][] = [];
    for (const f of lostFrames) {
      const last = runs[runs.length - 1];
      if (last && f === last[last.length - 1]! + 1) last.push(f);
      else runs.push([f]);
    }
    expect(runs).toHaveLength(offs.length);
    for (const run of runs) expect(run.length).toBe(Math.ceil(200 / DT));
    for (let i = 1; i < runs.length; i++) expect((runs[i]![0]! - runs[i - 1]![0]!) * DT).toBeCloseTo(10_000, -2);
    // Nothing reaches IWER while the hand is lost; coming back puts the pinch back first, then the hand, then the
    // latest pose the bot asked for.
    for (let i = 0; i < r.calls.length; i++) {
      const c = r.calls[i]!;
      if (c.method !== "set_connected") continue;
      if (!c.params.connected) {
        expect(r.calls[i + 1]!.method).toBe("set_select_value");
        expect(r.calls[i + 1]!.params).toEqual({ device: "hand-right", value: 1 });
        expect(r.calls[i + 2]).toMatchObject({ method: "set_connected", params: { connected: true } });
        expect(r.calls[i + 3]!.method).toBe("set_transform");
      }
    }
  });

  it("brings the hand back with the pinch the bot asked for while it was lost", async () => {
    const r = rig({ noiseMm: 0, seed: 5, dropoutEverySec: 1, dropoutMs: 200, releaseDriftCm: [0, 0] });
    await r.j.dispatch("set_transform", set("hand-right", at(0, 1, -1)));
    await r.j.dispatch("set_select_value", { device: "hand-right", value: 1 });
    while (!r.j.lost) {
      r.advance(DT);
      r.j.tick();
    }
    const n = r.calls.length;
    await r.j.dispatch("set_select_value", { device: "hand-right", value: 0 });
    await r.j.dispatch("set_transform", set("hand-right", at(0.05, 1, -1)));
    expect(r.calls).toHaveLength(n);
    while (r.j.lost) {
      r.advance(DT);
      r.j.tick();
    }
    expect(r.calls.slice(n).map((c) => [c.method, c.params.value ?? c.params.connected ?? c.params.position.x])).toEqual([
      ["set_select_value", 0],
      ["set_connected", true],
      ["set_transform", 0.05],
    ]);
  });

  it("works as the source text the page evaluates (it uses nothing outside itself)", async () => {
    const make = (0, eval)(`(${withJitter.toString()})`) as typeof withJitter;
    const calls: Call[] = [];
    const j = make((m, p) => (calls.push({ method: m, params: p }), Promise.resolve(null)), {
      noiseMm: 3,
      releaseDriftCm: [1, 1.5],
      dropoutMs: 200,
      dropoutEverySec: 10,
      seed: 1,
      now: () => 0,
    });
    await j.dispatch("set_transform", set("hand-right", at(0, 1, -1)));
    expect(calls).toHaveLength(1);
    expect(Math.abs(calls[0]!.params.position.x)).toBeLessThanOrEqual(0.003);
  });
});

const CM = 24;
const dist = (a: Readonly<V3>, b: Readonly<V3>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("approachPlan", () => {
  it("comes to 3 cm short at 10 cm/s, then the rest at 2 cm/s", () => {
    const from: V3 = [0.35, -0.3, 1.35];
    const to: V3 = [-0.1, -0.35, 1.25];
    const legs = approachPlan(from, to, CM);
    expect(legs).toHaveLength(2);
    expect(legs[0]!.cmps).toBe(10);
    expect(legs[1]!.cmps).toBe(2);
    expect(dist(legs[0]!.to, to) * CM).toBeCloseTo(3, 9);
    expect(legs[1]!.to).toEqual(to);
    // On the straight line from where it starts.
    const u = (a: V3, b: V3) => {
      const d = dist(a, b);
      return [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d];
    };
    expect(u(from, legs[0]!.to)[0]).toBeCloseTo(u(from, to)[0]!, 9);
    expect(pathMs(from, legs, CM)).toBeCloseTo(((dist(from, to) * CM - 3) / 10 + 3 / 2) * 1000, 6);
  });

  it("goes the whole way slowly from within 3 cm, and takes its speeds from the options", () => {
    const from: V3 = [0, -0.3, 1.3];
    const to: V3 = [0, -0.3, 1.3 + 2 / CM];
    expect(approachPlan(from, to, CM)).toEqual([{ to, cmps: 2 }]);
    const legs = approachPlan([0, -0.3, 1.3], [0.5, -0.3, 1.3], CM, { shortCm: 5, fastCmps: 20, slowCmps: 3 });
    expect(legs.map((l) => l.cmps)).toEqual([20, 3]);
    expect((0.5 - legs[0]!.to[0]) * CM).toBeCloseTo(5, 9);
  });
});

describe("sweepPlan", () => {
  const spots: V3[] = [
    [-0.25, -0.35, 1.3],
    [0.1, -0.25, 1.45],
    [0.3, -0.4, 1.2],
  ];
  const o = { seed: 9, cmPerUnit: CM, totalMs: 60_000 };

  it("waves the lantern through the spots at 15 to 30 cm/s for the time asked", () => {
    const start: V3 = [0.35, -0.3, 1.35];
    const { legs, sweeps } = sweepPlan(start, spots, o);
    // At least the time asked, and at most one sweep more.
    expect(pathMs(start, legs, CM)).toBeGreaterThanOrEqual(60_000);
    expect(pathMs(start, legs, CM)).toBeLessThan(65_000);
    for (const l of legs) {
      expect(l.cmps).toBeGreaterThanOrEqual(15);
      expect(l.cmps).toBeLessThanOrEqual(30);
    }
    // Every spot is swept through, each sweep passing within 1 cm of its spot.
    expect(new Set(sweeps.map((s) => s.spot))).toEqual(new Set([0, 1, 2]));
    let from = start;
    for (const l of legs) {
      // How close the leg's straight line comes to each spot.
      for (const s of sweeps.filter((x) => x.leg === legs.indexOf(l))) {
        expect(closest(from, l.to, spots[s.spot]!) * CM).toBeLessThanOrEqual(1 + 1e-9);
      }
      from = l.to;
    }
    expect(sweeps.length).toBeGreaterThan(30);
  });

  it("turns only well away from every spot, in front of the box and near the spots", () => {
    const { legs } = sweepPlan([0.35, -0.3, 1.35], spots, o);
    for (const l of legs) {
      for (const s of spots) expect(dist(l.to, s) * CM).toBeGreaterThanOrEqual(4 - 1e-9);
      expect(l.to[2]).toBeGreaterThanOrEqual(1.02 - 1e-12);
      expect(l.to[0]).toBeGreaterThanOrEqual(-0.25 - 8 / CM - 1e-9);
      expect(l.to[0]).toBeLessThanOrEqual(0.3 + 8 / CM + 1e-9);
    }
  });

  it("is reproducible from its seed", () => {
    const a = sweepPlan([0.35, -0.3, 1.35], spots, o);
    expect(sweepPlan([0.35, -0.3, 1.35], spots, o)).toEqual(a);
    expect(sweepPlan([0.35, -0.3, 1.35], spots, { ...o, seed: 10 }).legs).not.toEqual(a.legs);
  });
});

/** Distance from point p to the segment a-b. */
function closest(a: V3, b: V3, p: V3): number {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / L2));
  return dist([a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], p);
}

// Keep Leg in use for the type import.
export type { Leg };
