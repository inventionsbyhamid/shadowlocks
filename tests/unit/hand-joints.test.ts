import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "@iwsdk/core";
import { HAND_JOINTS, HandJoints, JOINT_COUNT } from "../../src/input/hand-joints";

/** Joint j of a hand sits at (j cm, 1 m (+0.1 for the left hand), -0.5 m) in the reference space. */
const jointAt = (j: number, left: boolean): [number, number, number] => [j / 100, left ? 1.1 : 1, -0.5];

interface FakeSpace {
  joint: XRHandJoint;
  left: boolean;
}

function fakeHand(left: boolean, missing?: XRHandJoint) {
  const hand = new Map<XRHandJoint, FakeSpace>();
  for (const j of HAND_JOINTS) if (j !== missing) hand.set(j, { joint: j, left });
  let gets = 0;
  return {
    source: {
      handedness: left ? "left" : "right",
      hand: {
        get: (j: XRHandJoint) => {
          gets++;
          return hand.get(j);
        },
      },
    },
    gets: () => gets,
  };
}

/** A frame whose fillPoses writes a translation per joint (a NaN for `nan`), and remembers what it was given. */
function fakeFrame(sources: unknown[], o: { ok?: boolean; nan?: XRHandJoint } = {}) {
  const seen: { spaces: unknown; out: Float32Array }[] = [];
  const frame = {
    session: { inputSources: sources },
    fillPoses(spaces: FakeSpace[], _base: unknown, out: Float32Array) {
      seen.push({ spaces, out });
      spaces.forEach((s, j) => {
        const m = new Matrix4().makeTranslation(...jointAt(j, s.left));
        if (s.joint === o.nan) m.elements[12] = Number.NaN;
        out.set(m.elements, j * 16);
      });
      return o.ok ?? true;
    },
  };
  return { frame: frame as unknown as XRFrame, seen };
}

const ref = {} as XRReferenceSpace;
const v = () => new Vector3();

describe("HandJoints", () => {
  it("lists the 25 WebXR joints in spec order", () => {
    expect(JOINT_COUNT).toBe(25);
    expect(HAND_JOINTS[0]).toBe("wrist");
    expect(HAND_JOINTS[4]).toBe("thumb-tip");
    expect(HAND_JOINTS[9]).toBe("index-finger-tip");
    expect(HAND_JOINTS[24]).toBe("pinky-finger-tip");
  });

  it("reads every joint of each tracked hand into world space through the origin", () => {
    const right = fakeHand(false), left = fakeHand(true);
    const { frame } = fakeFrame([right.source, left.source]);
    const origin = new Matrix4().compose(new Vector3(1, 0, 2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(1, 1, 1));
    const hj = new HandJoints();
    hj.update(frame, ref, origin);
    expect(hj.tracked("right")).toBe(true);
    expect(hj.tracked("left")).toBe(true);
    const out = v();
    for (const [j, name] of HAND_JOINTS.entries()) {
      expect(hj.joint("right", name, out)).toBe(true);
      const want = new Vector3(...jointAt(j, false)).applyMatrix4(origin);
      expect(out.distanceTo(want)).toBeLessThan(1e-6);
    }
    expect(hj.joint("left", "wrist", out)).toBe(true);
    expect(out.distanceTo(new Vector3(...jointAt(0, true)).applyMatrix4(origin))).toBeLessThan(1e-6);
    // The pinch point is halfway between the thumb and index tips; their distance is the pinch distance.
    expect(hj.pinchPoint("right", out)).toBe(true);
    const mid = new Vector3(...jointAt(4, false)).add(new Vector3(...jointAt(9, false))).multiplyScalar(0.5).applyMatrix4(origin);
    expect(out.distanceTo(mid)).toBeLessThan(1e-6);
    expect(hj.pinchDistance("right")).toBeCloseTo(0.05, 6);
    // A joint's pose turns with the origin.
    const m = new Matrix4();
    expect(hj.pose("right", "wrist", m)).toBe(true);
    const q = new Quaternion(), p = new Vector3(), s = new Vector3();
    m.decompose(p, q, s);
    expect(q.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))).toBeLessThan(1e-6);
  });

  it("without an origin the reference space is the world", () => {
    const { frame } = fakeFrame([fakeHand(false).source]);
    const hj = new HandJoints();
    hj.update(frame, ref);
    const out = v();
    hj.joint("right", "index-finger-tip", out);
    expect(out.toArray()).toEqual(jointAt(9, false).map((x) => Math.fround(x)));
  });

  it("is not tracked without every pose, with a NaN pose, without a joint space, or without the hand", () => {
    const out = new Vector3(7, 7, 7);
    const hj = new HandJoints();
    hj.update(fakeFrame([fakeHand(false).source], { ok: false }).frame, ref);
    expect(hj.tracked("right")).toBe(false);
    expect(hj.joint("right", "wrist", out)).toBe(false);
    expect(hj.pinchPoint("right", out)).toBe(false);
    expect(out.toArray()).toEqual([7, 7, 7]);
    expect(hj.pinchDistance("right")).toBeNaN();

    hj.update(fakeFrame([fakeHand(false).source], { nan: "middle-finger-tip" }).frame, ref);
    expect(hj.tracked("right")).toBe(false);

    hj.update(fakeFrame([fakeHand(false, "ring-finger-tip").source]).frame, ref);
    expect(hj.tracked("right")).toBe(false);

    hj.update(fakeFrame([fakeHand(false).source]).frame, ref);
    expect(hj.tracked("right")).toBe(true);
    hj.update(fakeFrame([]).frame, ref);
    expect(hj.tracked("right")).toBe(false);
    hj.update(fakeFrame([fakeHand(false).source]).frame, ref);
    hj.clear();
    expect(hj.tracked("right")).toBe(false);
  });

  it("looks a hand's joint spaces up once per input source and reuses its arrays every frame", () => {
    const right = fakeHand(false);
    const { frame, seen } = fakeFrame([right.source]);
    const hj = new HandJoints();
    for (let i = 0; i < 5; i++) hj.update(frame, ref);
    expect(right.gets()).toBe(25);
    expect(seen).toHaveLength(5);
    for (const s of seen) {
      expect(s.spaces).toBe(seen[0]!.spaces);
      expect(s.out).toBe(seen[0]!.out);
    }
    // A hand coming back as a new input source is looked up again.
    const again = fakeHand(false);
    hj.update(fakeFrame([again.source]).frame, ref);
    expect(again.gets()).toBe(25);
    expect(hj.tracked("right")).toBe(true);
  });

  it("ignores controllers and a second source for the same hand", () => {
    const controller = { handedness: "right", hand: undefined };
    const first = fakeHand(false), second = fakeHand(false);
    const hj = new HandJoints();
    hj.update(fakeFrame([controller, first.source, second.source]).frame, ref);
    expect(hj.tracked("right")).toBe(true);
    expect(hj.tracked("left")).toBe(false);
    expect(second.gets()).toBe(0);
  });
});
