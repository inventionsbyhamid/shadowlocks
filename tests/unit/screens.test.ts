import { afterEach, describe, expect, it, vi } from "vitest";
import { createBus, type UiEvent } from "../../src/app/bus";
import { createScreens, SCREENS } from "../../src/app/screens";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const bus = createBus();
  const events: UiEvent[] = [];
  bus.on("screen", (e) => events.push(e));
  return { bus, events, screens: createScreens(bus.emit) };
}

describe("screens", () => {
  it("lists every screen", () => {
    expect([...SCREENS].sort()).toEqual(
      ["boot", "home", "play", "settings"],
    );
  });

  it("starts at boot and emits one screen event per move", () => {
    const { screens, events } = setup();
    expect(screens.current()).toBe("boot");
    expect(screens.go("home")).toBe(true);
    expect(screens.current()).toBe("home");
    expect(events).toEqual([{ type: "screen", from: "boot", to: "home" }]);
  });

  it("ignores a move to the current screen", () => {
    const { screens, events } = setup();
    screens.go("home");
    expect(screens.go("home")).toBe(false);
    expect(events).toHaveLength(1);
  });

  it("never goes back to boot", () => {
    const { screens, events } = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    screens.go("home");
    expect(screens.go("boot")).toBe(false);
    expect(screens.current()).toBe("home");
    expect(events).toHaveLength(1);
  });

  it("applies a move requested by a screen listener after the current move finishes", () => {
    const { bus, screens, events } = setup();
    const seenByLate: string[] = [];
    bus.on("screen", (e) => {
      if (e.to === "settings") screens.go("home");
    });
    bus.on("screen", (e) => seenByLate.push(`${e.from}>${e.to}:${screens.current()}`));
    screens.go("settings");
    expect(events.map((e) => (e.type === "screen" ? `${e.from}>${e.to}` : ""))).toEqual(["boot>settings", "settings>home"]);
    expect(seenByLate).toEqual(["boot>settings:settings", "settings>home:home"]);
    expect(screens.current()).toBe("home");
  });
});
