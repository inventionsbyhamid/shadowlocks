import { describe, expect, it } from "vitest";
import { CueMapper, applyCues, attachCues, type Cue, type CueEvent } from "../../src/audio/cues";
import type { PlayHandle } from "../../src/audio/engine";
import { makeRig } from "./helpers/audio-fixture";

const sfxIds = (cues: readonly Cue[]) => cues.flatMap((c) => (c.kind === "sfx" ? [c.id] : []));
const music = (cues: readonly Cue[]) => cues.flatMap((c) => (c.kind === "music" ? [c.state] : []));

describe("input and menu sounds", () => {
  it("maps each input event to the sound design id, at its position", () => {
    const at: [number, number, number] = [0.1, 0.9, -0.4];
    const m = new CueMapper();
    const one = (e: CueEvent) => m.map([e])[0] as Extract<Cue, { kind: "sfx" }>;
    expect(one({ type: "hover", id: "home-settings", at })).toEqual({ kind: "sfx", id: "ui_hover", position: at });
    expect(one({ type: "press", id: "home-settings", at })).toEqual({ kind: "sfx", id: "ui_press", position: at });
    expect(one({ type: "grab", hand: "right", at })).toEqual({ kind: "sfx", id: "lantern_pick", position: at });
    expect(one({ type: "release", hand: "right", at })).toEqual({ kind: "sfx", id: "lantern_set", position: at });
  });

  it("a key that steps back out of a screen clicks softer", () => {
    expect(sfxIds(new CueMapper().map([{ type: "press", id: "settings-done" }]))).toEqual(["ui_back"]);
    expect(sfxIds(new CueMapper().map([{ type: "press", id: "toggle-motion" }]))).toEqual(["ui_press"]);
  });

  it("ignores unknown events, notices and bad positions", () => {
    const m = new CueMapper();
    expect(m.map([{ type: "notice", text: "x" }, { type: "mystery" }])).toHaveLength(0);
    const c = m.map([{ type: "hover", id: "b", at: [1, Number.NaN, 0] }])[0] as Extract<Cue, { kind: "sfx" }>;
    expect(c.position).toBeUndefined();
  });
});

describe("music state", () => {
  it("menus play the bed through the menu low-pass, play opens it up", () => {
    const m = new CueMapper();
    expect(music(m.map([{ type: "screen", from: "boot", to: "home" }]))).toEqual(["menu"]);
    expect(music(m.map([{ type: "screen", from: "home", to: "settings" }]))).toEqual(["menu"]);
    expect(music(m.map([{ type: "screen", from: "settings", to: "play" }]))).toEqual(["calm"]);
    expect(music(m.map([{ type: "screen", from: "play", to: "home" }]))).toEqual(["menu"]);
  });
});

describe("count-ups and sliders", () => {
  const cuesOf = (e: CueEvent, m = new CueMapper()) => m.map([e]).filter((c) => c.kind === "sfx");

  it("a counting number ticks higher as it goes, up to 5 semitones, and lands quietly", () => {
    const low = cuesOf({ type: "count", id: "n", k: 0, done: false });
    const high = cuesOf({ type: "count", id: "n", k: 1, done: false });
    expect(low).toEqual([{ kind: "sfx", id: "dial_tick", pitch: 0 }]);
    expect(high).toEqual([{ kind: "sfx", id: "dial_tick", pitch: 5 }]);
    expect(cuesOf({ type: "count", id: "n", k: 9, done: false })).toEqual(high);
    expect(cuesOf({ type: "count", id: "n", k: 1, done: true })).toEqual([]);
  });

  it("a slider step ticks from -3 to +9 semitones across its range, at its key", () => {
    const at: [number, number, number] = [0.1, 0.9, -0.3];
    const m = new CueMapper({ locate: (e) => ((e as { id?: unknown }).id === "music-up" ? at : undefined) });
    expect(cuesOf({ type: "slider", id: "music-up", k: 1 }, m)).toEqual([{ kind: "sfx", id: "dial_tick", pitch: 9, position: at }]);
    expect(cuesOf({ type: "slider", id: "box-down", k: 0 }, m)).toEqual([{ kind: "sfx", id: "dial_tick", pitch: -3 }]);
  });
});

describe("positions", () => {
  it("uses the locate resolver when an event has no position", () => {
    const m = new CueMapper({ locate: (e) => (e.type === "grab" ? [1, 2, 3] : undefined) });
    const grab = m.map([{ type: "grab", hand: "left" }])[0] as Extract<Cue, { kind: "sfx" }>;
    expect(grab.position).toEqual([1, 2, 3]);
    const hover = m.map([{ type: "hover", id: "b" }])[0] as Extract<Cue, { kind: "sfx" }>;
    expect(hover.position).toBeUndefined();
  });

  it("an event position wins over the resolver", () => {
    const m = new CueMapper({ locate: () => [9, 9, 9] });
    const c = m.map([{ type: "press", id: "x", at: [1, 1, 1] }])[0] as Extract<Cue, { kind: "sfx" }>;
    expect(c.position).toEqual([1, 1, 1]);
  });
});

describe("allocation", () => {
  it("returns one shared frozen empty array for empty batches", () => {
    const m = new CueMapper();
    const a = m.map([]);
    expect(a).toBe(m.map([]));
    expect(Object.isFrozen(a)).toBe(true);
    expect(m.map([{ type: "mystery" }])).toBe(a);
  });
});

describe("applyCues", () => {
  it("forwards each cue to the engine", () => {
    const calls: string[] = [];
    const engine = {
      play: (id: string, o: { position?: number[]; pitch?: number }) => calls.push(`play:${id}:${JSON.stringify([o.position, o.pitch])}`),
      sting: (id: string) => calls.push(`sting:${id}`),
      setMusic: (s: string) => calls.push(`music:${s}`),
    };
    applyCues(engine as never, [
      { kind: "sfx", id: "ui_press", position: [1, 2, 3] },
      { kind: "sting", id: "solve" },
      { kind: "music", state: "menu" },
    ]);
    expect(calls).toEqual(["play:ui_press:[[1,2,3],null]", "sting:solve", "music:menu"]);
  });
});

describe("play handles", () => {
  it("passes each played sound's handle out, so the app can cut a sound short", async () => {
    const r = await makeRig();
    const handles = new Map<string, PlayHandle>();
    const onEvents = attachCues(r.engine, new CueMapper(), (id, h) => handles.set(id, h));
    r.ctx.currentTime = 2;
    onEvents([{ type: "grab", hand: "right" }]);
    const pick = r.ctx.sources.find((s) => s.buffer === (r.buf("grab_a") as unknown))!;
    expect(pick.stoppedAt).toBeNull();
    r.ctx.currentTime = 2.05;
    handles.get("lantern_pick")!.stop();
    expect(pick.stoppedAt).toBeCloseTo(2.05 + 0.04 + 0.005, 6);
  });

  it("applyCues hands out a handle per sfx cue, including no-op ones", () => {
    const seen: string[] = [];
    const noop: PlayHandle = { stop() {} };
    const engine = { play: () => noop, sting: () => {}, setMusic: () => {} };
    applyCues(engine as never, [{ kind: "sfx", id: "crystallise" }, { kind: "sting", id: "solve" }, { kind: "sfx", id: "lock_hum" }], (id, h) => {
      expect(h).toBe(noop);
      seen.push(id);
    });
    expect(seen).toEqual(["crystallise", "lock_hum"]);
  });
});
