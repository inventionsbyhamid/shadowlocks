import { describe, expect, it } from "vitest";
import { type BufferAttribute, type InstancedBufferAttribute, type InstancedBufferGeometry, Matrix4, type Mesh, type ShaderMaterial, Vector3 } from "@iwsdk/core";
import { HAND_JOINTS, JOINT_COUNT } from "../../src/input/hand-joints";
import POSES from "../../src/lessons/poses.json";
import {
  capsuleGeometry,
  GHOST_BONES,
  GHOST_LANTERN_CAPSULES,
  GHOST_LANTERN_PARTS,
  GHOST_POSES,
  GhostHand,
  GhostLantern,
  GhostRig,
} from "../../src/render/ghost-hand";

const J = (name: XRHandJoint) => HAND_JOINTS.indexOf(name);
const at = (a: ArrayLike<number>, j: number): [number, number, number] => [a[j * 3]!, a[j * 3 + 1]!, a[j * 3 + 2]!];
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const poses = POSES.poses as Record<string, number[]>;
const attr = (m: Mesh, name: string) => m.geometry.getAttribute(name) as InstancedBufferAttribute;

describe("poses.json", () => {
  it("holds open, pinch, point and relaxed: 25 joints each in WebXR order, in the wrist's frame", () => {
    expect(POSES.joints).toEqual([...HAND_JOINTS]);
    expect(POSES.radius).toHaveLength(JOINT_COUNT);
    expect(Object.keys(poses).sort()).toEqual(["open", "pinch", "point", "relaxed"]);
    expect([...GHOST_POSES].sort()).toEqual(["open", "pinch", "point", "relaxed"]);
    for (const [k, p] of Object.entries(poses)) {
      expect(p, k).toHaveLength(JOINT_COUNT * 3);
      expect(at(p, 0), k).toEqual([0, 0, 0]);
      // The index finger runs down -z from the wrist (but curls to the thumb in the pinch).
      if (k !== "pinch") expect(at(p, J("index-finger-tip"))[2], k).toBeLessThan(-0.15);
    }
    // In the pinch the thumb and index tips meet; open, they are well apart.
    expect(dist(at(poses.pinch!, J("thumb-tip")), at(poses.pinch!, J("index-finger-tip")))).toBeLessThan(0.025);
    expect(dist(at(poses.open!, J("thumb-tip")), at(poses.open!, J("index-finger-tip")))).toBeGreaterThan(0.08);
  });

  it("keeps each bone's length from pose to pose, so blends never stretch a finger", () => {
    for (const { a, b } of GHOST_BONES) {
      const rest = dist(at(poses.relaxed!, a), at(poses.relaxed!, b));
      for (const [k, p] of Object.entries(poses)) expect(Math.abs(dist(at(p, a), at(p, b)) - rest), `${k} ${a}-${b}`).toBeLessThan(0.006);
    }
  });
});

describe("capsuleGeometry", () => {
  it("is a unit sphere cut at its middle, each half tagged for its end, every face wound outward", () => {
    const g = capsuleGeometry();
    const pos = g.getAttribute("position") as BufferAttribute, top = g.getAttribute("aTop") as BufferAttribute, idx = g.getIndex()!;
    for (let i = 0; i < pos.count; i++) {
      expect(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i))).toBeCloseTo(1, 6);
      if (pos.getY(i) > 1e-6) expect(top.getX(i)).toBe(1);
      if (pos.getY(i) < -1e-6) expect(top.getX(i)).toBe(0);
    }
    let faces = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const v = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(pos, idx.getX(t + k)));
      const n = new Vector3().subVectors(v[1]!, v[0]!).cross(new Vector3().subVectors(v[2]!, v[0]!));
      // The equator band has no area on the unit sphere; it becomes the capsule's side once the halves part.
      if (n.length() < 1e-9) {
        expect(top.getX(idx.getX(t)) + top.getX(idx.getX(t + 1)) + top.getX(idx.getX(t + 2))).toBeGreaterThan(0);
        continue;
      }
      const mid = v[0]!.clone().add(v[1]!).add(v[2]!);
      expect(n.dot(mid)).toBeGreaterThan(0);
      faces++;
    }
    expect(faces).toBeGreaterThan(40);
  });
});

describe("GhostRig", () => {
  it("draws the ghost hand and the ghost lantern as instances of one capsule mesh, in one colour pass that writes depth", () => {
    const rig = new GhostRig();
    const m = rig.mesh;
    expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(GHOST_BONES.length + GHOST_LANTERN_CAPSULES);
    const mat = m.material as ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(true);
    expect(mat.colorWrite).toBe(true);
    // A capsule fading out writes no depth: its pixels are discarded.
    expect(mat.fragmentShader).toContain("discard");
    expect(m.frustumCulled).toBe(false);
    // One mesh, nothing else drawn (no depth pass, no glow sprite).
    expect(m.children).toHaveLength(0);
    expect(GHOST_BONES.length).toBe(20);
  });

  it("fades the hand and the lantern each by its own opacity, and draws nothing while both are gone", () => {
    const rig = new GhostRig();
    const O = attr(rig.mesh, "iO"), n = GHOST_BONES.length;
    rig.hand.opacity = 0;
    rig.lamp.opacity = 0;
    expect(rig.mesh.visible).toBe(false);
    rig.hand.opacity = 0.4;
    expect(rig.mesh.visible).toBe(true);
    for (let i = 0; i < n; i++) expect(O.array[i]).toBeCloseTo(0.4, 6);
    for (let i = n; i < n + GHOST_LANTERN_CAPSULES; i++) expect(O.array[i]).toBe(0);
    rig.lamp.opacity = 0.7;
    for (let i = n; i < n + GHOST_LANTERN_CAPSULES; i++) expect(O.array[i]).toBeCloseTo(0.7, 6);
    // Hidden: as if at 0, and back at its opacity when shown.
    rig.hand.visible = false;
    for (let i = 0; i < n; i++) expect(O.array[i]).toBe(0);
    rig.hand.visible = true;
    expect(O.array[0]).toBeCloseTo(0.4, 6);
    rig.hand.opacity = 0;
    rig.lamp.opacity = 0;
    expect(rig.mesh.visible).toBe(false);
  });

  it("puts the lantern's capsules in the world through the box's matrix, at its place in the box", () => {
    const rig = new GhostRig(), n = GHOST_BONES.length;
    rig.lamp.setPos([0.1, -0.3, 1.3]);
    expect(rig.lamp.pos).toEqual([0.1, -0.3, 1.3]);
    const box = new Matrix4().makeRotationY(0.4).scale(new Vector3(0.24, 0.24, 0.24)).setPosition(0.2, 0.8, -0.5);
    rig.lamp.sync(box);
    const A = attr(rig.mesh, "iA"), B = attr(rig.mesh, "iB"), R = attr(rig.mesh, "iR");
    GHOST_LANTERN_PARTS.forEach(([a, b, r], k) => {
      const wa = new Vector3(0.1 + a[0], -0.3 + a[1], 1.3 + a[2]).applyMatrix4(box), wb = new Vector3(0.1 + b[0], -0.3 + b[1], 1.3 + b[2]).applyMatrix4(box);
      wa.toArray().forEach((v, i) => expect(A.array[(n + k) * 3 + i]).toBeCloseTo(v, 5));
      wb.toArray().forEach((v, i) => expect(B.array[(n + k) * 3 + i]).toBeCloseTo(v, 5));
      expect(R.array[n + k]).toBeCloseTo(r * 0.24, 6);
    });
  });
});

describe("GhostHand", () => {
  it("blends two poses joint by joint, a right hand being the left hand's mirror image", () => {
    const right = new GhostHand("right"), left = new GhostHand("left");
    right.setPose("open", "pinch", 0.25);
    left.setPose("open", "pinch", 0.25);
    for (let j = 0; j < JOINT_COUNT; j++) {
      const o = at(poses.open!, j), p = at(poses.pinch!, j);
      const want = [0, 1, 2].map((k) => o[k]! + (p[k]! - o[k]!) * 0.25);
      at(left.local, j).forEach((v, k) => expect(v).toBeCloseTo(want[k]!, 6));
      expect(at(right.local, j)[0]).toBeCloseTo(-want[0]!, 6);
      expect(at(right.local, j)[1]).toBeCloseTo(want[1]!, 6);
    }
    expect(() => right.setPose("wave", "open", 0)).toThrow();
    // Switching sides mirrors the pose shown.
    right.side = "left";
    for (let j = 0; j < JOINT_COUNT; j++) expect(at(right.local, j)[0]).toBeCloseTo(at(left.local, j)[0], 6);
  });

  it("draws each bone as a capsule between its two joints in the world", () => {
    const h = new GhostHand("right");
    h.setPose("relaxed", "pinch", 0.5);
    h.setWorld(new Matrix4().makeRotationY(0.7).setPosition(0.1, 1.1, -0.4));
    const A = attr(h.mesh, "iA"), B = attr(h.mesh, "iB"), R = attr(h.mesh, "iR");
    GHOST_BONES.forEach(({ a, b }, i) => {
      at(h.world, a).forEach((v, k) => expect(A.array[i * 3 + k]).toBeCloseTo(v, 6));
      at(h.world, b).forEach((v, k) => expect(B.array[i * 3 + k]).toBeCloseTo(v, 6));
      expect(R.array[i]).toBeGreaterThan(0.004);
      expect(R.array[i]).toBeLessThan(0.02);
    });
  });

  it("puts the wrist where setWorld says and reports each joint in the world", () => {
    const h = new GhostHand("left");
    h.setPose("relaxed", "relaxed", 0);
    const m = new Matrix4().makeRotationY(0.7).setPosition(0.1, 1.1, -0.4);
    h.setWorld(m);
    expect(h.object.matrix.equals(m)).toBe(true);
    const tip = J("index-finger-tip"), want = new Vector3(...at(h.local, tip)).applyMatrix4(m);
    expect(h.joint(tip, new Vector3()).distanceTo(want)).toBeLessThan(1e-6);
    expect(new Vector3(...at(h.world, tip)).distanceTo(want)).toBeLessThan(1e-6);
    // A new pose moves the world joints too.
    h.setPose("pinch", "pinch", 0);
    const moved = new Vector3(...at(h.local, tip)).applyMatrix4(m);
    expect(new Vector3(...at(h.world, tip)).distanceTo(moved)).toBeLessThan(1e-6);
  });

  it("places the pinch point or the index fingertip at a point, the fingers and palm turned as asked", () => {
    for (const side of ["left", "right"] as const) {
      const h = new GhostHand(side);
      h.setPose("pinch", "pinch", 0);
      const target = new Vector3(0.2, 0.9, -0.5), fingers = new Vector3(1, -0.2, -1).normalize(), palm = new Vector3(0, -1, 0);
      h.place("grasp", target, fingers, palm);
      const grasp = h.joint(J("thumb-tip"), new Vector3()).add(h.joint(J("index-finger-tip"), new Vector3())).multiplyScalar(0.5);
      expect(grasp.distanceTo(target)).toBeLessThan(1e-6);
      const ahead = new Vector3(0, 0, -1).transformDirection(h.object.matrix);
      expect(ahead.distanceTo(fingers)).toBeLessThan(1e-6);
      const down = new Vector3(0, -1, 0).transformDirection(h.object.matrix);
      expect(down.dot(palm)).toBeGreaterThan(0.95);
      // A pointing finger: its tip on the point, its last two bones along the direction given.
      h.setPose("point", "point", 0);
      const dir = new Vector3(-0.94, -0.34, 0).normalize();
      h.place("tip", target, dir, palm);
      const tip = h.joint(J("index-finger-tip"), new Vector3()), mid = h.joint(J("index-finger-phalanx-intermediate"), new Vector3());
      expect(tip.distanceTo(target)).toBeLessThan(1e-6);
      expect(tip.clone().sub(mid).normalize().dot(dir)).toBeGreaterThan(0.99999);
      // The wrist goes on the point.
      h.place("wrist", target, new Vector3(0, 1, 0), new Vector3(0, 0, -1));
      expect(h.joint(0, new Vector3()).distanceTo(target)).toBeLessThan(1e-6);
    }
  });

  it("writes in place: the same buffers after any number of poses and placements", () => {
    const h = new GhostHand();
    const A = attr(h.mesh, "iA"), arr = A.array, local = h.local, world = h.world;
    const v = A.version;
    for (let i = 0; i < 50; i++) {
      h.setPose("open", "pinch", i / 50);
      h.place("grasp", new Vector3(0, 1, -0.4), new Vector3(0, 0, -1), new Vector3(0, -1, 0));
    }
    expect(A.array).toBe(arr);
    expect(h.local).toBe(local);
    expect(h.world).toBe(world);
    expect(A.version).toBeGreaterThan(v);
  });
});

describe("GhostLantern", () => {
  it("is a pale-blue cage of capsules with no glow of its own, set in box units, faded by opacity", () => {
    const l = new GhostLantern();
    expect((l.mesh.geometry as InstancedBufferGeometry).instanceCount).toBe(GHOST_LANTERN_CAPSULES);
    expect(l.mesh.children).toHaveLength(0);
    l.opacity = 0;
    expect(l.mesh.visible).toBe(false);
    l.opacity = 0.7;
    expect(l.mesh.visible).toBe(true);
  });
});
