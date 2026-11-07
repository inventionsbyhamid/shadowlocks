// The lantern's two ways of going dim. Quiet while it waits in a lesson's cradle (no glow or ripple, its cage drawn).
// Put away while a menu is up: it disappears without changing the scene's lights. three builds each lit shader for the
// number of visible lights, so hiding the lantern's light made every lit material compile again the first time the box
// showed lit after a menu, and the shaders compiled ahead (on the session's first frame, home menu up) were not the
// ones play used. The two are independent.
import { describe, expect, it } from "vitest";
import { Group, type Light, MeshBasicMaterial, MeshStandardMaterial, type Object3D } from "@iwsdk/core";
import { LanternView } from "../../src/render/lantern-view";

const named = (v: LanternView, name: string): Object3D => v.group.getObjectByName(name)!;

/** The lights three would gather here (only those whose whole chain up is visible). */
function visibleLights(root: Object3D): Light[] {
  const out: Light[] = [];
  root.traverseVisible((o) => {
    if ((o as Light).isLight) out.push(o as Light);
  });
  return out;
}

/** The names of what would be drawn under `root`. */
function drawn(root: Object3D): string[] {
  const out: string[] = [];
  root.traverseVisible((o) => {
    if ((o as { isMesh?: boolean }).isMesh || (o as { isSprite?: boolean }).isSprite) out.push(o.name);
  });
  return out.sort();
}

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

  it("put away: hides its body, glow and ripple but keeps its light in the scene, dark; shown again it lights as before", () => {
    const root = new Group();
    const lantern = new LanternView({ lacquer: new MeshStandardMaterial(), gold: new MeshStandardMaterial() });
    root.add(lantern.group);
    lantern.setBoxSize(0.24);
    const lit = visibleLights(root);
    expect(lit).toHaveLength(1);
    const intensity = lit[0]!.intensity;
    expect(intensity).toBeGreaterThan(0);

    lantern.setShown(false);
    expect(drawn(root)).toEqual([]);
    // The scene has the same lights (so the same shaders), the lantern's giving no light.
    const away = visibleLights(root);
    expect(away).toHaveLength(1);
    expect(away[0]!.intensity).toBe(0);
    // A flare or the brightness changing while away keeps it dark.
    lantern.setBrightness(1);
    lantern.flare();
    lantern.update(0.05);
    expect(away[0]!.intensity).toBe(0);

    lantern.setShown(true);
    lantern.setBrightness(0);
    lantern.update(10);
    expect(visibleLights(root)[0]!.intensity).toBeCloseTo(intensity, 9);
    expect(named(lantern, "Lantern Foot").visible).toBe(true);
    expect(named(lantern, "Lantern Glow").visible).toBe(true);
  });

  it("put away and quiet are independent: either hides the glow, only put away hides the cage, the light stays", () => {
    const root = new Group();
    const v = new LanternView({ lacquer: new MeshStandardMaterial(), gold: new MeshStandardMaterial() });
    root.add(v.group);
    const cage = ["Lantern Core", "Lantern Foot", "Lantern Gold"];
    v.setQuiet(true);
    expect(drawn(root)).toEqual(cage);
    // A menu over a lesson: put away, then back; still quiet in its cradle.
    v.setShown(false);
    expect(drawn(root)).toEqual([]);
    v.setShown(true);
    expect(drawn(root)).toEqual(cage);
    v.setQuiet(false);
    expect(drawn(root)).toEqual([...cage, "Lantern Glow"].sort());
    // Quiet or put away, the light is always in the scene.
    for (const [shown, quiet] of [[false, false], [false, true], [true, true]] as const) {
      v.setShown(shown);
      v.setQuiet(quiet);
      expect(visibleLights(root)).toHaveLength(1);
    }
  });
});
