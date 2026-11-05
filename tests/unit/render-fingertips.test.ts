import { describe, expect, it } from "vitest";
import { Group, Matrix4, Vector3, type World } from "@iwsdk/core";
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
