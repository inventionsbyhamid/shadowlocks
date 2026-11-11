import { describe, expect, it } from "vitest";
import { Group, Matrix4, Quaternion, Scene, Vector3 } from "@iwsdk/core";
import { HintLantern } from "../../src/ui/hint-lantern";

/** The box root under the scene, placed as BoxScene.setPlacement does it: the pose taken apart, the world matrix made. */
function placed(size: number) {
  const scene = new Scene(), root = new Group();
  scene.add(root);
  const place = (s: number) => {
    const m = new Matrix4().compose(new Vector3(0.1, 0.9, -0.45), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3), new Vector3(s, s, s));
    m.decompose(root.position, root.quaternion, root.scale);
    root.updateMatrixWorld(true);
  };
  place(size);
  return { root, place };
}

describe("the hint lantern's keys", () => {
  it("feel the fingertip where a key's own full world update puts them, after a placement and a box size change", () => {
    const { root, place } = placed(0.24);
    const h = new HintLantern(root);
    h.reset(true, -1);
    const presses: string[] = [];
    const press = (id: string) => (presses.push(id), true);
    const tips = { points: [new Vector3()], count: 1 };
    for (const size of [0.24, 0.3]) {
      place(size);
      // A frame with no finger: the lantern follows the box size.
      h.update(1 / 72, { points: [], count: 0 }, false, press);
      // Where the key is: its face's centre and facing, from its own full world update.
      const at = h.lantern.pose(), n = new Vector3(...at.normal), c = new Vector3(...at.world);
      // A finger in front of the key, then pushed through it, then back out.
      for (const d of [0.03, 0.01, 0, -0.004, -0.008, -0.008, 0.01, 0.03]) {
        tips.points[0]!.copy(c).addScaledVector(n, d);
        h.update(1 / 72, tips, false, press);
        // The shared update made the very matrix the key's own update through the root makes.
        const shared = [...h.lantern.group.matrixWorld.elements];
        h.lantern.group.updateWorldMatrix(true, false);
        expect(shared).toEqual([...h.lantern.group.matrixWorld.elements]);
      }
      expect(presses).toEqual(["hint-lantern"]);
      expect(h.choicesOpen).toBe(true);
      presses.length = 0;
      h.reset(true, -1);
    }
  });
});
