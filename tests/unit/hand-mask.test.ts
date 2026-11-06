import { describe, expect, it } from "vitest";
import {
  FrontSide,
  type InstancedBufferAttribute,
  type InstancedBufferGeometry,
  type Material,
  Scene,
  ShaderLib,
  Vector3,
} from "@iwsdk/core";
import type { V3 } from "../../src/core/types";
import { HAND_MASK_ORDER, HandMask, maskVertex } from "../../src/render/hand-mask";
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

  it("turns every capsule face outward for any bone, so its near half is the half drawn", () => {
    const { mask } = setup();
    const mat = mask.mesh.material as Material;
    // Back faces are culled: what survives must be the outward (near) faces.
    expect(mat.side).toBe(FrontSide);
    const g = mask.mesh.geometry as InstancedBufferGeometry;
    const pos = g.getAttribute("position"), end = g.getAttribute("aEnd"), idx = g.getIndex()!;
    const local = (i: number): V3 => [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // Bones every way, among them straight up and down (the frame's helper axis switches there) and a zero-length one.
    const bones: [V3, V3][] = [
      [[0, 1, -0.4], [0.05, 1.01, -0.42]],
      [[0, 1, -0.4], [0, 1.05, -0.4]],
      [[0, 1, -0.4], [0.001, 0.96, -0.4]],
      [[0.2, 1.1, -0.3], [0.17, 1.13, -0.27]],
      [[0, 1, -0.4], [-0.02, 0.99, -0.36]],
      [[0.1, 1, -0.5], [0.1, 1, -0.5]],
    ];
    let faces = 0;
    for (const [A, B] of bones) {
      const ab = sub(B, A), ab2 = dot(ab, ab);
      for (let t = 0; t < idx.count; t += 3) {
        const [i0, i1, i2] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        const [p0, p1, p2] = [i0, i1, i2].map((i) => maskVertex(local(i), end.getX(i), A, B, 0.009)) as [V3, V3, V3];
        const n = cross(sub(p1, p0), sub(p2, p0));
        if (Math.hypot(n[0], n[1], n[2]) < 1e-12) continue; // a pole's degenerate sliver
        const c: V3 = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
        const k = ab2 > 0 ? Math.max(0, Math.min(1, dot(sub(c, A), ab) / ab2)) : 0;
        const onAxis: V3 = [A[0] + ab[0] * k, A[1] + ab[1] * k, A[2] + ab[2] * k];
        expect(dot(n, sub(c, onAxis)), `bone ${A} to ${B}, triangle ${t / 3}`).toBeGreaterThan(0);
        faces++;
      }
    }
    expect(faces).toBeGreaterThan(6 * 100);
    // The shader places vertices in that same frame (maskVertex is its twin) and pulls their depth back to the bone.
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    } as unknown as Parameters<Material["onBeforeCompile"]>[0];
    mat.onBeforeCompile(shader, undefined as never);
    expect(shader.vertexShader).toContain("vec3 slE2 = cross(slE1, slU);");
    expect(shader.vertexShader).toContain("mvPosition.z = min(mvPosition.z, (modelViewMatrix * vec4(slEnd, 1.0)).z);");
  });
});
