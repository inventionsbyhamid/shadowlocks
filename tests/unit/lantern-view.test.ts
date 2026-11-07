import { MeshBasicMaterial, type Object3D } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { LanternView } from "../../src/render/lantern-view";

const named = (v: LanternView, name: string): Object3D => v.group.getObjectByName(name)!;

describe("LanternView", () => {
  it("goes quiet while it waits in a lesson's cradle: no glow or ripple, its cage still drawn", () => {
    const v = new LanternView({ lacquer: new MeshBasicMaterial(), gold: new MeshBasicMaterial() });
    v.setBrightness(1);
    expect(named(v, "Lantern Glow").visible).toBe(true);
    v.setQuiet(true);
    expect(named(v, "Lantern Glow").visible).toBe(false);
    v.ripple();
    v.update(0.05);
    expect(named(v, "Lantern Ripple").visible).toBe(false);
    for (const part of ["Lantern Foot", "Lantern Gold", "Lantern Core"]) expect(named(v, part).visible).toBe(true);
    v.setQuiet(false);
    expect(named(v, "Lantern Glow").visible).toBe(true);
  });
});
