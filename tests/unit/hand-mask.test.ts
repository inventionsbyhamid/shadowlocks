import { describe, expect, it } from "vitest";
import { type InstancedBufferAttribute, type InstancedBufferGeometry, type Material, Scene, ShaderLib, Vector3 } from "@iwsdk/core";
import { HAND_MASK_ORDER, HandMask } from "../../src/render/hand-mask";
import { BONES_PER_HAND, FINGER_RADIUS_CM, HAND_BONES, PALM_RADIUS_CM } from "../../src/render/hand-shadow";
import { boxToWorld } from "../../src/render/placement";
import { fakeJoints, moved, pointingHand } from "./helpers/hands";

const hand = () => pointingHand([0, 0, 0.5], [-1, 0, 0]);

function setup() {
  const scene = new Scene();
  const mask = new HandMask({ scene });
  const g = mask.mesh.geometry as InstancedBufferGeometry;
  const attr = (name: string) => g.getAttribute(name) as InstancedBufferAttribute;
  return { scene, mask, g, attr, ...fakeJoints() };
}

describe("HandMask", () => {
  it("is a depth-only capsule hand drawn before everything else, in the scene", () => {
    const { scene, mask } = setup();
    const mat = mask.mesh.material as Material;
    expect(mat.colorWrite).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(mat.depthTest).toBe(true);
    expect(mat.transparent).toBe(false);
    expect(HAND_MASK_ORDER).toBe(-10);
    expect(mask.mesh.renderOrder).toBe(-10);
    expect(mask.mesh.parent).toBe(scene);
    expect(mask.mesh.frustumCulled).toBe(false);
  });

  it("draws one capsule per bone of every tracked hand (the holding hand too), from the joints, in metres", () => {
    const { mask, g, attr, feed, m } = setup();
    const right = hand(), left = moved(pointingHand([0, 0, 0.5], [1, 0, 0]), [0, 0.3, 0]);
    mask.update(feed({ right }));
    expect(mask.count).toBe(BONES_PER_HAND);
    expect(g.instanceCount).toBe(BONES_PER_HAND);
    expect(mask.mesh.visible).toBe(true);
    const A = attr("aA"), B = attr("aB"), R = attr("aR"), w = new Vector3();
    HAND_BONES.forEach((b, i) => {
      boxToWorld(m, right[b.a], w);
      expect(Math.hypot(A.getX(i) - w.x, A.getY(i) - w.y, A.getZ(i) - w.z)).toBeLessThan(1e-6);
      boxToWorld(m, right[b.b], w);
      expect(Math.hypot(B.getX(i) - w.x, B.getY(i) - w.y, B.getZ(i) - w.z)).toBeLessThan(1e-6);
      expect(R.getX(i)).toBeCloseTo((b.palm ? PALM_RADIUS_CM : FINGER_RADIUS_CM) / 100, 6);
    });
    mask.update(feed({ left, right }));
    expect(mask.count).toBe(2 * BONES_PER_HAND);
    // No hand: nothing drawn.
    mask.update(feed({}));
    expect(mask.count).toBe(0);
    expect(mask.mesh.visible).toBe(false);
  });

  it("is off without passthrough", () => {
    const { mask, feed } = setup();
    mask.enabled = false;
    mask.update(feed({ right: hand() }));
    expect(mask.mesh.visible).toBe(false);
    mask.enabled = true;
    mask.update(feed({ right: hand() }));
    expect(mask.mesh.visible).toBe(true);
  });

  it("keeps its buffers from frame to frame", () => {
    const { mask, attr, feed } = setup();
    mask.update(feed({ right: hand() }));
    const arrays = ["aA", "aB", "aR"].map((n) => attr(n).array);
    mask.update(feed({ right: moved(hand(), [0.1, 0, 0]) }));
    expect(["aA", "aB", "aR"].map((n) => attr(n).array)).toEqual(arrays);
    ["aA", "aB", "aR"].forEach((n, i) => expect(attr(n).array).toBe(arrays[i]));
  });

  it("builds each capsule in the vertex shader and writes its depth at the bone's centre line", () => {
    const { mask } = setup();
    const mat = mask.mesh.material as Material;
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    } as unknown as Parameters<Material["onBeforeCompile"]>[0];
    mat.onBeforeCompile(shader, undefined as never);
    const vs = shader.vertexShader;
    for (const s of ["attribute vec3 aA", "attribute vec3 aB", "attribute float aR", "attribute float aEnd"]) expect(vs).toContain(s);
    expect(vs).not.toContain("#include <begin_vertex>");
    expect(vs).not.toContain("#include <project_vertex>");
    expect(vs).toContain("min(mvPosition.z");
    expect(vs).toContain("modelViewMatrix");
  });
});
