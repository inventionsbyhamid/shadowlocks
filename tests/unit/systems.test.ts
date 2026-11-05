import { describe, expect, it } from "vitest";
import type { World } from "@iwsdk/core";
import { appSystems, onAppSystem, registerAppSystem } from "../../src/app/systems";

class FakeSystem {
  update(): void {}
}
class OtherSystem {
  update(): void {}
}

function fakeWorld() {
  const systems = new Map<unknown, unknown>();
  const opts: unknown[] = [];
  const world = {
    registerSystem(cls: new () => unknown, o?: unknown) {
      systems.set(cls, new cls());
      opts.push(o);
      return world;
    },
    getSystem: (cls: unknown) => systems.get(cls),
  };
  return { world: world as unknown as World, opts };
}

describe("app systems registry", () => {
  it("registers with the world, passes options and returns the instance", () => {
    const { world, opts } = fakeWorld();
    const sys = registerAppSystem(world, FakeSystem, { priority: 5 });
    expect(sys).toBeInstanceOf(FakeSystem);
    expect(opts).toEqual([{ priority: 5 }]);
    expect(appSystems()).toContain(sys);
  });

  it("tells watchers about systems registered before and after they subscribe", () => {
    const { world } = fakeWorld();
    const first = registerAppSystem(world, FakeSystem);
    const seen: unknown[] = [];
    const off = onAppSystem((s) => seen.push(s));
    expect(seen).toContain(first);
    const second = registerAppSystem(world, OtherSystem);
    expect(seen.at(-1)).toBe(second);
    off();
    registerAppSystem(world, FakeSystem);
    expect(seen.at(-1)).toBe(second);
  });
});
