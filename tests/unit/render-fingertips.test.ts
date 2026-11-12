import { describe, expect, it } from "vitest";
import { Group, Matrix4, Vector3, type World } from "@iwsdk/core";
import { HAND_JOINTS, HandJoints } from "../../src/input/hand-joints";
import { xrFingertips } from "../../src/render/fingertips";

/** A fake XR session with one right hand whose index tip is at `tip` (or untracked when null). */
function fakeXr() {
  const state = { tip: [0.1, 1.0, -0.3] as number[] | null, frame: true };
  const tipSpace = { name: "index-finger-tip" } as unknown as XRSpace;
  const source = {
    handedness: "right",
    hand: { get: (j: string) => (j === "index-finger-tip" ? tipSpace : undefined) },
  } as unknown as XRInputSource;
  const session = {
    inputSources: [source],
    addEventListener: () => undefined,
  } as unknown as XRSession;
  const frame = {
    fillPoses: (spaces: XRSpace[], _ref: XRSpace, out: Float32Array) => {
      if (state.tip === null || spaces[0] !== tipSpace) return false;
      out.set(new Matrix4().makeTranslation(state.tip[0]!, state.tip[1]!, state.tip[2]!).elements);
      return true;
    },
  } as unknown as XRFrame;
  const player = new Group();
  player.position.set(0, 0, 0.5);
  player.updateMatrixWorld(true);
  const world = {
    renderer: {
      xr: {
        getFrame: () => (state.frame ? frame : null),
        getReferenceSpace: () => ({}) as XRReferenceSpace,
        getSession: () => session,
      },
    },
    player,
  } as unknown as World;
  return { state, world };
}

describe("tracked fingertips", () => {
  it("reads the index tip joint in world space (through the player rig)", () => {
    const { world } = fakeXr();
    const tips = xrFingertips(world);
    const p = new Vector3();
    expect(tips.read(1, p)).toBe(true);
    expect(p.toArray()).toEqual([0.1, 1.0, 0.2].map((v) => expect.closeTo(v, 6)));
    // No left hand.
    expect(tips.read(0, p)).toBe(false);
  });

  it("reports no fingertip while the joint has no pose (tracking lost) or there is no frame", () => {
    const { state, world } = fakeXr();
    const tips = xrFingertips(world);
    const p = new Vector3();
    state.tip = null;
    expect(tips.read(1, p)).toBe(false);
    state.tip = [0, 1, -0.3];
    expect(tips.read(1, p)).toBe(true);
    state.frame = false;
    expect(tips.read(1, p)).toBe(false);
  });
});

/** A fake XR session with one right controller whose target ray is tracked while `tracked`. */
function fakeController(fillPoses: "check" | "none" | "throws") {
  const state = { tracked: true, calls: 0 };
  const raySpace = { name: "target-ray" } as unknown as XRSpace;
  const source = { handedness: "right", targetRaySpace: raySpace } as unknown as XRInputSource;
  const session = { inputSources: [source], addEventListener: () => undefined } as unknown as XRSession;
  const frame = {
    ...(fillPoses === "none"
      ? {}
      : {
          fillPoses: (spaces: XRSpace[]) => {
            state.calls++;
            if (fillPoses === "throws") throw new TypeError("joints only");
            return spaces[0] === raySpace && state.tracked;
          },
        }),
  } as unknown as XRFrame;
  const tip = new Group();
  tip.position.set(0.2, 0.9, -0.4);
  const player = Object.assign(new Group(), { indexTipSpaces: { left: new Group(), right: tip } });
  player.add(tip);
  player.updateMatrixWorld(true);
  const world = {
    renderer: {
      xr: { getFrame: () => frame, getReferenceSpace: () => ({}) as XRReferenceSpace, getSession: () => session },
    },
    player,
  } as unknown as World;
  return { state, world };
}

describe("controller fingertips", () => {
  it("follow the target ray while it is tracked, and report none once tracking is lost", () => {
    const { state, world } = fakeController("check");
    const tips = xrFingertips(world);
    const p = new Vector3();
    expect(tips.read(1, p)).toBe(true);
    expect(p.toArray()).toEqual([0.2, 0.9, -0.4].map((v) => expect.closeTo(v, 6)));
    state.tracked = false;
    expect(tips.read(1, p)).toBe(false);
    state.tracked = true;
    expect(tips.read(1, p)).toBe(true);
  });

  it("skip the check where fillPoses is missing or refuses a non-joint space", () => {
    const p = new Vector3();
    expect(xrFingertips(fakeController("none").world).read(1, p)).toBe(true);
    const throwing = fakeController("throws");
    const tips = xrFingertips(throwing.world);
    expect(tips.read(1, p)).toBe(true);
    expect(tips.read(1, p)).toBe(true);
    // Asked once: after it throws, the check is off.
    expect(throwing.state.calls).toBe(1);
  });
});

/**
 * One right hand with all 25 joints, joint j at (j cm, 1 m, -0.5 m) moved by `shift` (m, in x) in the reference space,
 * from a frame whose fillPoses counts its calls; `ok` is what fillPoses says.
 */
function fakeHandFrames() {
  const state = { calls: 0, shift: 0, ok: true };
  const spaces = new Map(HAND_JOINTS.map((j) => [j, { joint: j } as unknown as XRJointSpace]));
  const source = { handedness: "right", hand: { get: (j: XRHandJoint) => spaces.get(j) } } as unknown as XRInputSource;
  const session = { inputSources: [source], addEventListener: () => undefined } as unknown as XRSession;
  const newFrame = () =>
    ({
      session,
      fillPoses: (list: XRSpace[], _ref: XRSpace, out: Float32Array) => {
        state.calls++;
        list.forEach((s, i) => {
          const j = HAND_JOINTS.indexOf((s as unknown as { joint: XRHandJoint }).joint);
          out.set(new Matrix4().makeTranslation(j / 100 + state.shift, 1, -0.5).elements, i * 16);
        });
        return state.ok;
      },
    }) as unknown as XRFrame;
  let frame = newFrame();
  const ref = {} as XRReferenceSpace;
  const player = new Group();
  player.position.set(0.3, 0, 0.5);
  player.rotation.y = 0.4;
  player.updateMatrixWorld(true);
  const world = {
    renderer: { xr: { getFrame: () => frame, getReferenceSpace: () => ref, getSession: () => session } },
    player,
  } as unknown as World;
  return {
    state,
    world,
    ref,
    player,
    get frame() {
      return frame;
    },
    next() {
      frame = newFrame();
    },
  };
}

describe("fingertips from the frame's joint read", () => {
  it("take the index tip the hand joints read this frame: the same point, one fillPoses fewer", () => {
    const x = fakeHandFrames();
    const joints = new HandJoints();
    const alone = xrFingertips(x.world), shared = xrFingertips(x.world, joints);
    const a = new Vector3(), b = new Vector3();
    for (const shift of [0, 0.02, -0.05]) {
      x.next();
      x.state.shift = shift;
      joints.update(x.frame, x.ref, x.player.matrixWorld);
      const before = x.state.calls;
      expect(shared.read(1, b)).toBe(true);
      expect(x.state.calls).toBe(before);
      expect(alone.read(1, a)).toBe(true);
      expect(x.state.calls).toBe(before + 1);
      expect(b.toArray()).toEqual(a.toArray());
    }
  });

  it("read the tip themselves in a frame the joints were not read in, or whose read failed", () => {
    const x = fakeHandFrames();
    const joints = new HandJoints();
    const alone = xrFingertips(x.world), shared = xrFingertips(x.world, joints);
    const a = new Vector3(), b = new Vector3();
    joints.update(x.frame, x.ref, x.player.matrixWorld);
    // A new frame, the joints not read yet: the tip where it is now, not where the last read had it.
    x.next();
    x.state.shift = 0.03;
    let before = x.state.calls;
    expect(shared.read(1, b)).toBe(true);
    expect(x.state.calls).toBe(before + 1);
    expect(alone.read(1, a)).toBe(true);
    expect(b.toArray()).toEqual(a.toArray());
    // Read against another reference space: not the one the tip is asked in.
    x.next();
    joints.update(x.frame, {} as XRReferenceSpace, x.player.matrixWorld);
    before = x.state.calls;
    expect(shared.read(1, b)).toBe(true);
    expect(x.state.calls).toBe(before + 1);
    // The joint read failed (fillPoses said a pose was missing): the tip read alone decides, as before.
    x.next();
    x.state.ok = false;
    joints.update(x.frame, x.ref, x.player.matrixWorld);
    before = x.state.calls;
    expect(shared.read(1, b)).toBe(false);
    expect(x.state.calls).toBe(before + 1);
    expect(alone.read(1, a)).toBe(false);
  });
});
