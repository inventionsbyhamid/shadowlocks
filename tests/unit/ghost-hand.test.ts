import { describe, expect, it } from "vitest";
import { type BufferAttribute, type InstancedBufferAttribute, type InstancedBufferGeometry, Matrix4, type Mesh, type ShaderMaterial, Vector3 } from "@iwsdk/core";
import { HAND_JOINTS, JOINT_COUNT } from "../../src/input/hand-joints";
import POSES from "../../src/lessons/poses.json";
import { gripOf, graspFingers, graspPalm, LANTERN_GRIP_Y } from "../../src/app/lesson-scripts";
import {
  capsuleGeometry,
  FOREARM,
  GHOST_BONES,
  GHOST_LANTERN_CAPSULES,
  GHOST_LANTERN_GRIP,
  GHOST_LANTERN_PARTS,
  GHOST_LOOK,
  GHOST_POSE_DATA,
  GHOST_POSES,
  GHOST_SHADOW_BONES,
  ghostRadius,
  GhostHand,
  GhostLantern,
  GhostRig,
} from "../../src/render/ghost-hand";
import { HandShadow, type ShadowBones, TRACKED_BONES } from "../../src/render/hand-shadow";
import { inPoly } from "../../src/core/geom";
import type { V2 } from "../../src/core/types";
import type { HandJoints } from "../../src/input/hand-joints";

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
    expect([...GHOST_POSES].sort()).toEqual(["hold", "open", "pinch", "point", "ready", "relaxed"]);
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

  it("makes the lantern hold and the hand ready to take it from the library: thumb and index of one, the others tucked", () => {
    const hold = GHOST_POSE_DATA.hold as number[], ready = GHOST_POSE_DATA.ready as number[];
    for (let j = 0; j < JOINT_COUNT; j++) {
      const own = j < J("middle-finger-metacarpal");
      expect(at(hold, j), `hold ${j}`).toEqual(at(own ? poses.pinch! : poses.point!, j));
      expect(at(ready, j), `ready ${j}`).toEqual(at(own ? poses.relaxed! : poses.point!, j));
    }
    // Held: the tips meet; ready, they are open. Either way the other fingertips are tucked behind the knuckles.
    expect(dist(at(hold, J("thumb-tip")), at(hold, J("index-finger-tip")))).toBeLessThan(0.025);
    expect(dist(at(ready, J("thumb-tip")), at(ready, J("index-finger-tip")))).toBeGreaterThan(0.06);
    for (const f of ["middle", "ring", "pinky"] as const) {
      for (const p of [hold, ready]) expect(at(p, J(`${f}-finger-tip`))[2]).toBeGreaterThan(at(p, J(`${f}-finger-phalanx-proximal`))[2]);
    }
  });

  it("keeps each bone's length from pose to pose, so blends never stretch a finger", () => {
    for (const { a, b } of GHOST_BONES) {
      if (b === FOREARM) continue;
      const rest = dist(at(poses.relaxed!, a), at(poses.relaxed!, b));
      for (const [k, p] of Object.entries(GHOST_POSE_DATA)) expect(Math.abs(dist(at(p, a), at(p, b)) - rest), `${k} ${a}-${b}`).toBeLessThan(0.006);
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
    expect(GHOST_BONES.length).toBe(21);
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
      expect(R.array[(n + k) * 2]).toBeCloseTo(r * 0.24, 6);
      expect(R.array[(n + k) * 2 + 1]).toBeCloseTo(r * 0.24, 6);
    });
  });

  it("draws the ghost lantern's cage more solid than the hand round a bright core, and holds it by its handle loop", () => {
    const rig = new GhostRig(), n = GHOST_BONES.length, Lk = attr(rig.mesh, "iL");
    const body = (i: number) => Lk.array[i * 4 + 2]!, bright = (i: number) => Lk.array[i * 4 + 3]!;
    const core = n + GHOST_LANTERN_CAPSULES - 1;
    for (let i = 0; i < n; i++) expect(body(i)).toBeCloseTo(GHOST_LOOK.bodyAlpha, 6);
    for (let i = n; i < core; i++) {
      expect(body(i)).toBeGreaterThan(3 * GHOST_LOOK.bodyAlpha);
      expect(bright(i)).toBeGreaterThan(1);
    }
    expect(body(core)).toBeGreaterThan(body(n));
    expect(bright(core)).toBeGreaterThan(bright(n));
    // The body is fainter than the rim, so overlapping capsules read as outlines.
    expect(GHOST_LOOK.bodyAlpha).toBeLessThan(0.1);
    expect(GHOST_LOOK.rimAlpha).toBeGreaterThan(0.9);
    // The grip is the middle of the handle loop: the loop's six capsules sit round it, above the light, and the lesson
    // scripts hold the lantern there.
    const loop = GHOST_LANTERN_PARTS.slice(GHOST_LANTERN_CAPSULES - 7, GHOST_LANTERN_CAPSULES - 1);
    for (const [a] of loop) expect(dist([...a], [...GHOST_LANTERN_GRIP])).toBeCloseTo(0.016, 6);
    expect(GHOST_LANTERN_GRIP).toEqual([0, LANTERN_GRIP_Y, 0]);
    expect(gripOf([0.1, -0.2, 1.3])).toEqual([0.1, -0.2 + LANTERN_GRIP_Y, 1.3]);
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

  it("draws each bone as a capsule between its two joints in the world, the palm flattened square to its normal", () => {
    const h = new GhostHand("right");
    h.setPose("relaxed", "pinch", 0.5);
    const m = new Matrix4().makeRotationY(0.7).setPosition(0.1, 1.1, -0.4);
    h.setWorld(m);
    const A = attr(h.mesh, "iA"), B = attr(h.mesh, "iB"), R = attr(h.mesh, "iR"), F = attr(h.mesh, "iF"), Lk = attr(h.mesh, "iL");
    const normal = new Vector3(0, 1, 0).transformDirection(m);
    GHOST_BONES.forEach(({ a, b, ra, rb, flat, fadeB }, i) => {
      at(h.world, a).forEach((v, k) => expect(A.array[i * 3 + k]).toBeCloseTo(v, 6));
      // The forearm runs up the wrist frame's z, and fades out there.
      const end = b === FOREARM ? new Vector3(...at(h.world, a)).addScaledVector(new Vector3(0, 0, 1).transformDirection(m), GHOST_LOOK.forearm) : new Vector3(...at(h.world, b));
      end.toArray().forEach((v, k) => expect(B.array[i * 3 + k]).toBeCloseTo(v, 6));
      expect([R.array[i * 2], R.array[i * 2 + 1]]).toEqual([Math.fround(ra), Math.fround(rb)]);
      expect(Lk.array[i * 4 + 1]).toBe(fadeB);
      expect(F.array[i * 4 + 3]).toBeCloseTo(flat, 6);
      if (flat < 1) expect(new Vector3(F.array[i * 4], F.array[i * 4 + 1], F.array[i * 4 + 2]).distanceTo(normal)).toBeLessThan(1e-6);
    });
    expect(GHOST_BONES.find((x) => x.b === FOREARM)?.fadeB).toBe(0);
  });

  it("draws the fading forearm last: drawn first, its depth would cut a finger behind its faint tail", () => {
    // Capsules draw in this order (instances of one mesh) and write depth.
    expect(GHOST_BONES.findIndex((x) => x.b === FOREARM)).toBe(GHOST_BONES.length - 1);
    expect(GHOST_BONES.filter((x) => x.b === FOREARM)).toHaveLength(1);
  });

  it("has a hand's proportions: tapered fingers 7 to 10 mm at the knuckles, a thumb, a flat palm wider than thick, a wrist", () => {
    const radius = (j: XRHandJoint) => ghostRadius(J(j));
    for (const f of ["index", "middle", "ring", "pinky"] as const) {
      const chain = (["proximal", "intermediate", "distal"] as const).map((p) => radius(`${f}-finger-phalanx-${p}`)).concat(radius(`${f}-finger-tip`));
      // A pinky is a little slimmer than the rest.
      expect(chain[0], f).toBeGreaterThanOrEqual(f === "pinky" ? 0.0068 : 0.007);
      expect(chain[0], f).toBeLessThanOrEqual(0.01);
      for (let k = 1; k < chain.length; k++) expect(chain[k]!, `${f} ${k}`).toBeLessThanOrEqual(chain[k - 1]!);
      expect(chain[3]!, f).toBeLessThan(chain[0]! * 0.75);
      // Its bones taper the same way, joint to joint.
      for (const bone of GHOST_BONES.filter((x) => HAND_JOINTS[x.a]!.startsWith(`${f}-finger-phalanx`))) {
        expect(bone.rb).toBeLessThanOrEqual(bone.ra);
        expect(bone.flat).toBe(1);
      }
    }
    const thumb = ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"].map((j) => radius(j as XRHandJoint));
    for (let k = 1; k < 4; k++) expect(thumb[k]!).toBeLessThan(thumb[k - 1]!);
    expect(thumb[0]!).toBeLessThan(0.012);
    // The palm: flattened capsules, each wider than thick, side by side from the metacarpals to the knuckles.
    const palm = GHOST_BONES.filter((x) => x.flat < 1);
    expect(palm.length).toBe(6);
    for (const p of palm) {
      expect(p.flat * p.ra).toBeLessThan(p.ra * 0.7);
      expect(p.ra).toBeGreaterThan(radius("middle-finger-phalanx-proximal"));
    }
    for (const f of ["index", "middle", "ring", "pinky"] as const) {
      expect(palm.some((p) => p.a === J(`${f}-finger-metacarpal`) && p.b === J(`${f}-finger-phalanx-proximal`)), f).toBe(true);
    }
    // ...as wide as a palm (7 to 9 cm across the knuckles) and much thinner than that, never a ball.
    const open = poses.open!, ki = at(open, J("index-finger-phalanx-proximal")), kp = at(open, J("pinky-finger-phalanx-proximal"));
    const width = dist(ki, kp) + 2 * GHOST_LOOK.palmWidth, thick = 2 * GHOST_LOOK.palmWidth * GHOST_LOOK.palmFlat;
    expect(width).toBeGreaterThan(0.07);
    expect(width).toBeLessThan(0.09);
    expect(thick).toBeLessThan(width / 4);
    // A wrist: the heel and the forearm, as flat.
    expect(GHOST_BONES.filter((x) => x.a === J("wrist")).length).toBe(2);
  });

  it("casts its shadow from its own bones at their drawn radii: slimmer than a tracked hand's", () => {
    const cast = GHOST_BONES.filter((b) => b.b !== FOREARM);
    expect(GHOST_SHADOW_BONES.a.length).toBe(cast.length);
    cast.forEach((b, i) => {
      expect([GHOST_SHADOW_BONES.a[i], GHOST_SHADOW_BONES.b[i]]).toEqual([b.a, b.b]);
      expect([GHOST_SHADOW_BONES.ra[i], GHOST_SHADOW_BONES.rb[i]]).toEqual([b.ra, b.rb]);
    });
    // The index finger's last two bones are the finger, as a tracked hand's.
    const finger = [...GHOST_SHADOW_BONES.finger].flatMap((f, i) => (f ? [`${HAND_JOINTS[GHOST_SHADOW_BONES.a[i]!]}>${HAND_JOINTS[GHOST_SHADOW_BONES.b[i]!]}`] : []));
    expect(finger).toEqual(["index-finger-phalanx-intermediate>index-finger-phalanx-distal", "index-finger-phalanx-distal>index-finger-tip"]);
    // Slimmer than a tracked hand's: each finger bone thinner on average than its 0.9 cm...
    const trackedFinger = TRACKED_BONES.ra[TRACKED_BONES.finger.indexOf(1)]!;
    const fingerBones = cast.filter((x) => HAND_JOINTS[x.a]!.includes("-finger-phalanx"));
    expect(fingerBones.length).toBe(12);
    for (const b of fingerBones) expect((b.ra + b.rb) / 2).toBeLessThan(trackedFinger);
    // ...and the whole hand's shadow smaller: an open hand in the beam, palm to the light, casts from its own bones
    // less of the panel than the same joints cast as a tracked hand.
    const g = new GhostHand("right");
    g.setPose("open", "open", 0);
    const m = new Matrix4().makeRotationX(-0.17).scale(new Vector3(0.24, 0.24, 0.24)).setPosition(0, 0.92, -1.93);
    g.place("wrist", new Vector3(0.1, -0.42, 0.95).applyMatrix4(m), new Vector3(0, 1, -1).normalize().transformDirection(m), new Vector3(0, -1, -1).normalize().transformDirection(m));
    const joints = { positions: (s: string) => (s === "right" ? g.world : null) } as unknown as HandJoints;
    const L: [number, number, number] = [0.1, -0.2, 1.4];
    const area = (bones?: ShadowBones) => {
      const hs = new HandShadow(bones), out: V2[][] = Array.from({ length: hs.maxOutlines }, () => []);
      const n = hs.update(joints, null, m, L, out, []).n;
      let hits = 0;
      for (let x = -0.6; x <= 0.6; x += 0.01) for (let yy = -0.6; yy <= 0.8; yy += 0.01) if (out.slice(0, n).some((p) => inPoly([x, yy], p))) hits++;
      return hits;
    };
    const ghost = area(GHOST_SHADOW_BONES), tracked = area();
    expect(ghost).toBeGreaterThan(0);
    expect(ghost).toBeLessThan(tracked * 0.9);
  });

  it("pinches the ghost lantern's grip between thumb and index tips", () => {
    for (const side of ["left", "right"] as const) {
      const rig = new GhostRig(), h = rig.hand, s = side === "left" ? -1 : 1;
      h.side = side;
      const box = new Matrix4().makeRotationX(-0.17).scale(new Vector3(0.24, 0.24, 0.24)).setPosition(0, 0.92, -1.93);
      rig.lamp.setPos([-0.15 * s, -0.4, 1.2]);
      rig.lamp.sync(box);
      h.setPose("hold", "hold", 0);
      const grip = new Vector3(...gripOf(rig.lamp.pos)).applyMatrix4(box);
      const fv = new Vector3(...graspFingers(s)).transformDirection(box), pv = new Vector3(...graspPalm(s)).transformDirection(box);
      h.place("grasp", grip, fv, pv);
      // The grip is where the lantern's loop is drawn: both tips on it (within a fingertip's radius and the loop's).
      const loop = new Vector3(...GHOST_LANTERN_GRIP).add(new Vector3(...rig.lamp.pos)).applyMatrix4(box);
      expect(loop.distanceTo(grip)).toBeLessThan(1e-6);
      const reach = ghostRadius(J("index-finger-tip")) + 0.016 * 0.24;
      for (const tip of ["thumb-tip", "index-finger-tip"] as const) expect(h.joint(J(tip), new Vector3()).distanceTo(grip), `${side} ${tip}`).toBeLessThan(reach);
      // The thumb's side up (the palm toward the box's middle): the hand stays about the loop's height and below it
      // (its knuckles a few centimetres over), and the lantern hangs from the pinch in view.
      const up = new Vector3(0, 1, 0).transformDirection(box), y = (j: XRHandJoint) => h.joint(J(j), new Vector3()).dot(up);
      expect(y("thumb-phalanx-proximal") - y("pinky-finger-phalanx-proximal"), side).toBeGreaterThan(0.025);
      for (let j = 0; j < JOINT_COUNT; j++) expect(h.joint(j, new Vector3()).dot(up), `${side} joint ${j}`).toBeLessThan(grip.dot(up) + 0.05);
    }
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
