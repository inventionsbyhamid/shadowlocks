// The lantern put away while a menu is up: it must disappear without changing the scene's lights. three builds each lit
// shader for the number of visible lights, so hiding the lantern's light made every lit material compile again the
// first time the box showed lit after a menu, and the shaders compiled ahead (on the session's first frame, with the
// home menu up) were not the ones play used.
import { describe, expect, it } from "vitest";
import { Group, type Light, MeshStandardMaterial, type Object3D } from "@iwsdk/core";
import { LanternView } from "../../src/render/lantern-view";

/** The lights three would gather here (only those whose whole chain up is visible). */
function visibleLights(root: Object3D): Light[] {
  const out: Light[] = [];
  root.traverseVisible((o) => {
    if ((o as Light).isLight) out.push(o as Light);
  });
  return out;
}

describe("the lantern put away", () => {
  it("hides its body, glow and ripple but keeps its light in the scene, dark; shown again it lights as before", () => {
    const root = new Group();
    const lantern = new LanternView({ lacquer: new MeshStandardMaterial(), gold: new MeshStandardMaterial() });
    root.add(lantern.group);
    lantern.setBoxSize(0.24);
    const lit = visibleLights(root);
    expect(lit).toHaveLength(1);
    const intensity = lit[0]!.intensity;
    expect(intensity).toBeGreaterThan(0);

    lantern.setShown(false);
    // Nothing of it is drawn...
    const drawn: string[] = [];
    root.traverseVisible((o) => {
      if ((o as { isMesh?: boolean; isSprite?: boolean }).isMesh || (o as { isSprite?: boolean }).isSprite) drawn.push(o.name);
    });
    expect(drawn).toEqual([]);
    // ...yet the scene has the same lights (so the same shaders), the lantern's giving no light.
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
    expect(root.getObjectByName("Lantern Foot")!.visible).toBe(true);
    expect(root.getObjectByName("Lantern Glow")!.visible).toBe(true);
  });
});
