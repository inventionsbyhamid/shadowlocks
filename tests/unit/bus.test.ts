import { afterEach, describe, expect, it, vi } from "vitest";
import { createBus, type FeedbackEvent } from "../../src/app/bus";

afterEach(() => vi.restoreAllMocks());

describe("bus", () => {
  it("delivers events only to listeners of that type", () => {
    const bus = createBus();
    const screens: string[] = [];
    const notices: string[] = [];
    bus.on("screen", (e) => screens.push(`${e.from}>${e.to}`));
    bus.on("notice", (e) => notices.push(e.text));
    bus.emit({ type: "screen", from: "boot", to: "home" });
    bus.emit({ type: "notice", text: "hi" });
    bus.emit({ type: "tracking-lost", hand: "left" });
    expect(screens).toEqual(["boot>home"]);
    expect(notices).toEqual(["hi"]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = createBus();
    const fn = vi.fn();
    const off = bus.on("tracking-lost", fn);
    bus.emit({ type: "tracking-lost", hand: "left" });
    off();
    off();
    bus.emit({ type: "tracking-lost", hand: "left" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("finishes the current emit when a listener unsubscribes another, and new listeners wait for the next emit", () => {
    const bus = createBus();
    const calls: string[] = [];
    let offB = () => {};
    bus.on("tracking-lost", () => {
      calls.push("a");
      offB();
      bus.on("tracking-lost", () => calls.push("late"));
    });
    offB = bus.on("tracking-lost", () => calls.push("b"));
    bus.emit({ type: "tracking-lost", hand: "left" });
    expect(calls).toEqual(["a", "b"]);
    calls.length = 0;
    bus.emit({ type: "tracking-lost", hand: "left" });
    expect(calls).toEqual(["a", "late"]);
  });

  it("keeps going when a listener throws", () => {
    const bus = createBus();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fn = vi.fn();
    bus.on("tracking-lost", () => {
      throw new Error("boom");
    });
    bus.on("tracking-lost", fn);
    bus.emit({ type: "tracking-lost", hand: "left" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
  });

  it("lets onAny watch every event in order", () => {
    const bus = createBus();
    const seen: FeedbackEvent[] = [];
    const off = bus.onAny((e) => seen.push(e));
    bus.emit({ type: "press", id: "home-settings" });
    bus.emit({ type: "notice", text: "x" });
    off();
    bus.emit({ type: "tracking-lost", hand: "left" });
    expect(seen.map((e) => e.type)).toEqual(["press", "notice"]);
  });
});
