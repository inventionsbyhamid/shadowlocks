import { describe, expect, it } from "vitest";
import type { FakeFilter, FakeGain, FakeSource } from "./helpers/fake-audio";
import { makeRig } from "./helpers/audio-fixture";
import { LOWPASS_Q_DB, OPEN_LOWPASS_HZ } from "../../src/audio/music";

type Rig = Awaited<ReturnType<typeof makeRig>>;
const srcFor = (r: Rig, file: string) => r.ctx.sources.filter((s) => s.buffer === (r.buf(file) as unknown));
/** The calm voice (source -> low-pass -> gain) and the intense voice (source -> gain) of group n. */
const calmV = (r: Rig, n = 0) => srcFor(r, "m_calm")[n]!;
const intenseV = (r: Rig, n = 0) => srcFor(r, "m_int")[n]!;
const filterOf = (s: FakeSource) => [...s.out][0] as FakeFilter;
const gainNode = (s: FakeSource) => {
  const first = [...s.out][0]!;
  return (first.kind === "filter" ? [...first.out][0] : first) as FakeGain;
};
const lvl = (s: FakeSource) => gainNode(s).gain.value;
const cutoff = (r: Rig, n = 0) => filterOf(calmV(r, n)).frequency.value;
const curves = (s: FakeSource) => gainNode(s).gain.events.filter((e) => e.type === "curve");
const dB = (x: number) => 10 ** (x / 20);
// The fixture's musicStateFx: menu 1500 Hz at -2 dB, results 800 Hz at -6 dB.
const MENU = { hz: 1500, level: dB(-2) };
const RESULTS = { hz: 800, level: dB(-6) };

describe("music start", () => {
  it("starts calm and intense together with manifest loop points", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 10;
    r.engine.setMusic("calm");
    expect(r.ctx.sources).toHaveLength(2);
    const all = [calmV(r), intenseV(r)];
    expect(all[0]!.startedAt).not.toBeNull();
    expect(all[0]!.startedAt).toBe(all[1]!.startedAt);
    for (const s of all) {
      expect(s.loop).toBe(true);
      expect(s.loopStart).toBe(0);
      expect(s.loopEnd).toBe(32);
    }
  });

  it("menu plays the calm loop through the manifest's low-pass and level", async () => {
    const r = await makeRig();
    r.engine.setMusic("menu");
    const lp = filterOf(calmV(r));
    expect(lp.type).toBe("lowpass");
    expect(lp.Q.value).toBe(LOWPASS_Q_DB);
    // a group that opens on menu starts already filtered: nothing sweeps on the first bar
    expect(lp.frequency.value).toBe(MENU.hz);
    r.ctx.currentTime += 2;
    expect(lvl(calmV(r))).toBeCloseTo(MENU.level, 4);
    expect(lvl(intenseV(r))).toBe(0);
  });

  it("menu to results moves to the results values on the next bar, with no crossfade", async () => {
    const r = await makeRig();
    r.engine.setMusic("menu"); // epoch 0.05
    r.ctx.currentTime = 10;
    r.engine.setMusic("results"); // next bar 10.05
    expect(r.ctx.sources).toHaveLength(2);
    r.ctx.currentTime = 10.04;
    expect(cutoff(r)).toBe(MENU.hz);
    r.ctx.currentTime = 12;
    expect(cutoff(r)).toBeCloseTo(RESULTS.hz, 3);
    expect(lvl(calmV(r))).toBeCloseTo(RESULTS.level, 4);
    expect(lvl(intenseV(r))).toBe(0);
  });

  it("calm to menu sweeps the one calm voice: no second copy, so no bass swell", async () => {
    const r = await makeRig();
    r.engine.setMusic("calm");
    r.ctx.currentTime = 4;
    expect(cutoff(r)).toBe(OPEN_LOWPASS_HZ);
    r.engine.setMusic("menu");
    expect(r.ctx.sources).toHaveLength(2);
    const c = curves(calmV(r)).at(-1)!;
    expect(c.time).toBeCloseTo(4.05, 6);
    // a plain level move: half way is half way, not the equal-power +3 dB bump
    const mid = (c.curve![31]! + c.curve![32]!) / 2; // 64 points: the middle falls between 31 and 32
    expect(mid).toBeCloseTo((1 + MENU.level) / 2, 2);
    const sweep = filterOf(calmV(r)).frequency.events.filter((e) => e.type === "curve").at(-1)!;
    expect(sweep.time).toBeCloseTo(4.05, 6);
    expect(sweep.curve![0]).toBeCloseTo(OPEN_LOWPASS_HZ, 0);
    expect(sweep.curve!.at(-1)).toBeCloseTo(MENU.hz, 0);
    r.ctx.currentTime = 6;
    expect(cutoff(r)).toBeCloseTo(MENU.hz, 3);
  });

  it("fades in from silence and keeps intense silent", async () => {
    const r = await makeRig();
    r.engine.setMusic("calm");
    const c = curves(calmV(r));
    expect(c).toHaveLength(1);
    expect(c[0]!.duration).toBe(1.5);
    expect(c[0]!.curve![0]).toBe(0);
    expect(c[0]!.curve!.at(-1)).toBeCloseTo(1, 6);
    expect(curves(intenseV(r))).toHaveLength(0);
    expect(lvl(intenseV(r))).toBe(0);
  });

  it("applies a state set before unlock once unlocked", async () => {
    const r = await makeRig({ unlock: false });
    r.engine.setMusic("menu");
    expect(r.ctx.sources).toHaveLength(0);
    await r.engine.unlock();
    expect(calmV(r)).toBeDefined();
  });

  it("applies a state requested before music is loaded once it loads", async () => {
    const r = await makeRig({ deferMusic: true });
    r.engine.setMusic("calm");
    expect(r.ctx.sources).toHaveLength(0);
    await r.loadMusic();
    expect(calmV(r)).toBeDefined();
    expect(r.engine.musicState).toBe("calm");
  });

  it("applies the per-track trim from the manifest", async () => {
    const r = await makeRig({
      tweak: (m) => {
        m.music.music_bed!.gainDb = -6;
        m.music.music_intense!.gainDb = -3;
      },
    });
    r.engine.setMusic("calm");
    r.ctx.currentTime = 5;
    expect(lvl(calmV(r))).toBeCloseTo(dB(-6), 4);
    r.ctx.currentTime = 10;
    r.engine.setMusic("intense");
    r.ctx.currentTime = 20;
    expect(lvl(intenseV(r))).toBeCloseTo(dB(-3), 4);
    expect(lvl(calmV(r))).toBe(0);
  });

  it("falls back to the writer's colouring when the manifest has none", async () => {
    const r = await makeRig({ tweak: (m) => delete m.musicStateFx });
    r.engine.setMusic("menu");
    expect(cutoff(r)).toBe(1200);
    r.ctx.currentTime = 3;
    expect(lvl(calmV(r))).toBeCloseTo(dB(-3), 4);
  });

  it("warns when menu or results name another track (calm still plays)", async () => {
    const r = await makeRig({ tweak: (m) => (m.musicStates.menu = "music_intense") });
    expect(r.warnings.some((w) => w.includes("menu names music_intense"))).toBe(true);
    r.engine.setMusic("menu");
    expect(cutoff(r)).toBe(MENU.hz);
  });
});

describe("crossfade", () => {
  it("calm to intense lands on the next bar line with out^2 + in^2 = 1", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 10;
    r.engine.setMusic("calm");
    const start = calmV(r).startedAt!;
    r.ctx.currentTime = 15;
    r.engine.setMusic("intense");
    const out = curves(calmV(r)).at(-1)!;
    const inn = curves(intenseV(r)).at(-1)!;
    expect(out.time).toBe(inn.time);
    expect(out.duration).toBe(1.5);
    const barPos = (out.time - start) / 2;
    expect(barPos).toBeCloseTo(Math.round(barPos), 6);
    expect(out.time).toBeGreaterThanOrEqual(15);
    expect(out.time).toBeLessThan(17.1);
    expect(out.curve![0]).toBeCloseTo(1, 5);
    expect(out.curve!.at(-1)).toBe(0);
    expect(inn.curve![0]).toBe(0);
    expect(inn.curve!.at(-1)).toBeCloseTo(1, 6);
    for (let i = 0; i < out.curve!.length; i++) expect(out.curve![i]! ** 2 + inn.curve![i]! ** 2).toBeCloseTo(1, 4);
    expect(r.ctx.sources).toHaveLength(2); // one group
    expect(calmV(r).stoppedAt).toBeNull();
  });

  it("keeps the beat when switching between menu and play at an off-grid time", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 1;
    r.engine.setMusic("menu");
    const epoch = calmV(r).startedAt!;
    for (const [t, state] of [[5.37, "calm"], [11.91, "menu"], [18.23, "intense"], [25.77, "results"]] as const) {
      r.ctx.currentTime = t;
      r.engine.setMusic(state);
      const lastTime = Math.max(...[calmV(r), intenseV(r)].flatMap((s) => curves(s).map((c) => c.time)));
      const bars = (lastTime - epoch) / 2;
      expect(bars).toBeCloseTo(Math.round(bars), 6);
      expect(lastTime).toBeGreaterThanOrEqual(t);
    }
    // one group the whole time
    expect(r.ctx.sources).toHaveLength(2);
  });

  it("rapid calm, intense, calm inside one bar leaves only calm audible", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 10;
    r.engine.setMusic("calm");
    r.ctx.currentTime = 12; // calm fully in
    expect(lvl(calmV(r))).toBeCloseTo(1, 5);
    r.ctx.currentTime = 12.2;
    r.engine.setMusic("intense");
    r.ctx.currentTime = 12.4; // the fade is queued for the bar line and has not started
    r.engine.setMusic("calm");
    for (const t of [13, 14, 16, 20, 40]) {
      r.ctx.currentTime = t;
      expect(lvl(calmV(r))).toBeCloseTo(1, 4);
      expect(lvl(intenseV(r))).toBeCloseTo(0, 4);
      expect(cutoff(r)).toBe(OPEN_LOWPASS_HZ);
    }
  });

  it("toggling back and forth many times ends with exactly the last state audible", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 10;
    r.engine.setMusic("calm");
    const seq = ["intense", "calm", "intense", "menu", "calm", "results", "intense"] as const;
    seq.forEach((s, i) => {
      r.ctx.currentTime = 12 + i * 0.3;
      r.engine.setMusic(s);
    });
    r.ctx.currentTime = 60;
    expect(lvl(intenseV(r))).toBeCloseTo(1, 4);
    expect(lvl(calmV(r))).toBeCloseTo(0, 4);
  });

  it("a second change just before a queued bar line moves every voice together (no silent gap)", async () => {
    const r = await makeRig();
    r.engine.setMusic("calm"); // epoch 0.05, bars at 0.05 + 2k
    r.ctx.currentTime = 4;
    r.engine.setMusic("menu"); // queued for 4.05
    r.ctx.currentTime = 4.02;
    r.engine.setMusic("intense"); // too late for 4.05: next bar is 6.05
    for (const t of [4.5, 5, 6]) {
      r.ctx.currentTime = t;
      expect(lvl(calmV(r)), `calm at ${t}`).toBeCloseTo(1, 4);
      expect(cutoff(r), `cutoff at ${t}`).toBe(OPEN_LOWPASS_HZ);
    }
    r.ctx.currentTime = 6.8;
    expect(lvl(calmV(r)) ** 2 + lvl(intenseV(r)) ** 2).toBeCloseTo(1, 2);
    r.ctx.currentTime = 8;
    expect(lvl(intenseV(r))).toBeCloseTo(1, 4);
    expect(lvl(calmV(r))).toBeCloseTo(0, 4);
  });

  it("going to off fades everything out and stops the sources", async () => {
    const r = await makeRig();
    r.engine.setMusic("calm");
    r.ctx.currentTime = 20;
    r.engine.setMusic("off");
    const c = curves(calmV(r)).at(-1)!;
    expect(c.curve!.at(-1)).toBe(0);
    for (const s of [calmV(r), intenseV(r)]) expect(s.stoppedAt).toBeGreaterThanOrEqual(c.time + 1.5);
    expect(r.engine.musicState).toBe("off");
    r.ctx.currentTime = 25;
    expect(lvl(calmV(r))).toBe(0);
  });

  it("restarting after off creates a fresh synced group", async () => {
    const r = await makeRig();
    r.engine.setMusic("calm");
    r.ctx.currentTime = 20;
    r.engine.setMusic("off");
    r.ctx.currentTime = 30;
    r.engine.setMusic("intense");
    expect(srcFor(r, "m_int")).toHaveLength(2);
    expect(calmV(r, 1).startedAt).toBe(intenseV(r, 1).startedAt);
  });

  it("ignores a repeat of the current state", async () => {
    const r = await makeRig();
    r.engine.setMusic("calm");
    const n = r.ctx.sources.length;
    r.engine.setMusic("calm");
    expect(r.ctx.sources).toHaveLength(n);
  });

  it("disconnects the sources when they end", async () => {
    const r = await makeRig();
    r.engine.setMusic("calm");
    const s = calmV(r);
    const lp = filterOf(s);
    s.end();
    expect(s.out.size).toBe(0);
    expect(lp.out.size).toBe(0);
  });
});

describe("first bar", () => {
  it("a change before anything is heard starts the music on its first line now, not a bar later", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 10;
    r.engine.setMusic("menu"); // fade queued for 10.05
    r.ctx.currentTime = 10.02;
    r.engine.setMusic("calm");
    // the unheard group is retired and a new one starts at once
    expect(calmV(r, 0).stoppedAt).toBeLessThanOrEqual(10.05);
    expect(calmV(r, 1).startedAt).toBeCloseTo(10.07, 6);
    expect(cutoff(r, 1)).toBe(OPEN_LOWPASS_HZ);
    r.ctx.currentTime = 11;
    expect(lvl(calmV(r, 1))).toBeGreaterThan(0.5);
  });

  it("a fade that is already heard keeps the bar grid", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 10;
    r.engine.setMusic("calm"); // fade 10.05 to 11.55
    r.ctx.currentTime = 10.6;
    expect(lvl(calmV(r))).toBeGreaterThan(0.05);
    r.engine.setMusic("intense");
    expect(r.ctx.sources).toHaveLength(2);
    expect(curves(intenseV(r)).at(-1)!.time).toBeCloseTo(12.05, 6);
  });
});

describe("stings", () => {
  it("ducks music 6 dB for the sting and restores it", async () => {
    const r = await makeRig();
    r.ctx.currentTime = 3;
    r.engine.setMusic("calm");
    r.engine.sting("solve");
    const sting = r.ctx.sources.find((s) => s.buffer === (r.buf("m_solve") as unknown))!;
    expect(sting).toBeDefined();
    expect(sting.loop).toBe(false);
    const ev = r.duckEvents();
    const down = ev.find((e) => e.type === "linear" && e.value !== 1)!;
    expect(down.value).toBeCloseTo(dB(-6), 5);
    expect(down.time).toBeCloseTo(3.05, 5);
    const up = ev.filter((e) => e.type === "linear" && e.value === 1).at(-1)!;
    expect(up.time).toBeGreaterThan(3 + 4.8);
  });

  it("applies the sting trim from the manifest", async () => {
    const r = await makeRig({ tweak: (m) => (m.music.sting_solve!.gainDb = -4) });
    r.engine.sting("solve");
    const sting = r.ctx.sources.find((s) => s.buffer === (r.buf("m_solve") as unknown))!;
    expect(([...sting.out][0] as FakeGain).gain.value).toBeCloseTo(dB(-4), 5);
  });

  it("falls back to the streak sound effect for the streak sting", async () => {
    const r = await makeRig();
    r.engine.sting("streak");
    expect(r.ctx.sources.some((s) => s.buffer === (r.buf("streak_a") as unknown))).toBe(true);
  });

  it("is silent before unlock", async () => {
    const r = await makeRig({ unlock: false });
    r.engine.sting("solve");
    expect(r.ctx.sources).toHaveLength(0);
  });
});
