import { describe, expect, it } from "vitest";
import { startAudio } from "../../src/app/audio-unlock";
import { makeRig } from "./helpers/audio-fixture";

const settle = () => new Promise((res) => setTimeout(res, 0));

describe("starting audio on gestures", () => {
  it("a context that autoplays (already running) still gets the engine started on the first gesture", async () => {
    const r = await makeRig({ unlock: false });
    // An installed app, high media engagement, or a browser told to autoplay: running from the start.
    r.ctx.state = "running";
    expect(r.engine.running).toBe(false);
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(0);
    startAudio(r.engine);
    await settle();
    expect(r.engine.running).toBe(true);
    r.engine.play("ui_press");
    expect(r.ctx.sources.filter((s) => s.startedAt !== null)).toHaveLength(1);
  });

  it("a first try whose resume never settles does not stop the next gesture from starting sound", async () => {
    const r = await makeRig({ unlock: false });
    // Entering XR with no gesture behind it (an installed app): resume() stays pending for good.
    r.ctx.resumeMode = "pending";
    startAudio(r.engine);
    expect(r.ctx.resumeCalls).toBe(1);
    await Promise.resolve();
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(0);
    // The player's first pinch: a real gesture, so this resume goes through.
    r.ctx.resumeMode = "ok";
    startAudio(r.engine);
    expect(r.ctx.resumeCalls).toBe(2);
    await settle();
    expect(r.engine.running).toBe(true);
    r.engine.play("ui_press");
    expect(r.ctx.sources).toHaveLength(1);
    // Running now: later gestures leave the context alone.
    startAudio(r.engine);
    startAudio(r.engine);
    expect(r.ctx.resumeCalls).toBe(2);
  });

  it("a refused try is tried again on the next gesture", async () => {
    const r = await makeRig({ unlock: false });
    r.ctx.resumeMode = "reject";
    startAudio(r.engine);
    await settle();
    expect(r.engine.running).toBe(false);
    r.ctx.resumeMode = "ok";
    startAudio(r.engine);
    await settle();
    expect(r.ctx.resumeCalls).toBe(2);
    expect(r.engine.running).toBe(true);
  });
});
