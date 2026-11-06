import { describe, expect, it } from "vitest";
import {
  type BufferAttribute,
  type InstancedBufferAttribute,
  type InstancedBufferGeometry,
  Matrix4,
  type Mesh,
  type ShaderMaterial,
  Vector3,
} from "@iwsdk/core";
import { HAND_JOINTS, JOINT_COUNT } from "../../src/input/hand-joints";
import POSES from "../../src/lessons/poses.json";
import { capsuleGeometry, GHOST_BONES, GHOST_LANTERN_CAPSULES, GHOST_POSES, GhostHand, GhostLantern } from "../../src/render/ghost-hand";

const J = (name: XRHandJoint) => HAND_JOINTS.indexOf(name);
const at = (a: ArrayLike<number>, j: number): [number, number, number] => [a[j * 3]!, a[j * 3 + 1]!, a[j * 3 + 2]!];
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const poses = POSES.poses as Record<string, number[]>;

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

describe("GhostHand", () => {
  it("draws every bone as one instance of a capsule, in two passes over one geometry", () => {
    const h = new GhostHand("right");
    const [depth, color] = h.object.children as Mesh[];
    expect(depth!.geometry).toBe(color!.geometry);
    expect((depth!.geometry as InstancedBufferGeometry).instanceCount).toBe(GHOST_BONES.length);
    const dm = depth!.material as ShaderMaterial, cm = color!.material as ShaderMaterial;
    expect(dm.colorWrite).toBe(false);
    expect(dm.depthWrite).toBe(true);
    expect(cm.transparent).toBe(true);
    expect(cm.depthWrite).toBe(false);
    expect(depth!.renderOrder).toBeLessThan(color!.renderOrder);
    expect(depth!.frustumCulled || color!.frustumCulled).toBe(false);
    expect(GHOST_BONES.length).toBe(20);
  });

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
    // Each capsule runs between its bone's two joints.
    const geo = (right.object.children[0] as Mesh).geometry;
    const A = geo.getAttribute("iA") as InstancedBufferAttribute, B = geo.getAttribute("iB") as InstancedBufferAttribute;
    const R = geo.getAttribute("iR") as InstancedBufferAttribute;
    GHOST_BONES.forEach(({ a, b }, i) => {
      at(right.local, a).forEach((v, k) => expect(A.array[i * 3 + k]).toBeCloseTo(v, 6));
      at(right.local, b).forEach((v, k) => expect(B.array[i * 3 + k]).toBeCloseTo(v, 6));
      expect(R.array[i]).toBeGreaterThan(0.004);
      expect(R.array[i]).toBeLessThan(0.02);
    });
    expect(() => right.setPose("wave", "open", 0)).toThrow();
    // Switching sides mirrors the pose shown.
    right.side = "left";
    for (let j = 0; j < JOINT_COUNT; j++) expect(at(right.local, j)[0]).toBeCloseTo(at(left.local, j)[0], 6);
  });

  it("puts the wrist where setWorld says and reports each joint in the world", () => {
    const h = new GhostHand("left");
    h.setPose("relaxed", "relaxed", 0);
    const m = new Matrix4().makeRotationY(0.7).setPosition(0.1, 1.1, -0.4);
    h.setWorld(m);
    expect(h.object.matrixAutoUpdate).toBe(false);
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

  it("fades by opacity alone and draws nothing at 0 or when hidden", () => {
    const h = new GhostHand();
    const color = h.object.children[1] as Mesh, u = (color.material as ShaderMaterial).uniforms;
    expect(h.visible).toBe(true);
    h.opacity = 0.4;
    expect(u.uOpacity!.value).toBeCloseTo(0.4, 6);
    expect(h.object.visible).toBe(true);
    h.opacity = 0;
    expect(h.object.visible).toBe(false);
    h.opacity = 1;
    h.visible = false;
    expect(h.object.visible).toBe(false);
    h.visible = true;
    expect(h.object.visible).toBe(true);
  });

  it("writes in place: the same buffers after any number of poses and placements", () => {
    const h = new GhostHand();
    const geo = (h.object.children[0] as Mesh).geometry;
    const A = geo.getAttribute("iA") as InstancedBufferAttribute, arr = A.array, local = h.local, world = h.world;
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
  it("is a pale-blue cage of capsules with a glow, set in box units, faded by opacity", () => {
    const l = new GhostLantern();
    const meshes = l.object.children.filter((o) => (o as Mesh).isMesh) as Mesh[];
    expect(meshes).toHaveLength(2);
    expect((meshes[0]!.geometry as InstancedBufferGeometry).instanceCount).toBe(GHOST_LANTERN_CAPSULES);
    l.setPos([0.1, -0.3, 1.3]);
    expect(l.object.position.toArray()).toEqual([0.1, -0.3, 1.3]);
    l.opacity = 0;
    expect(l.object.visible).toBe(false);
    l.opacity = 0.7;
    expect(l.object.visible).toBe(true);
  });
});
