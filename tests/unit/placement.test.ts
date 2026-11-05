import { describe, expect, it } from "vitest";
import { BOX_BELOW_HEAD_M, BOX_FORWARD_M, headBoxPose, Placement, yawFromQuaternion } from "../../src/app/placement";
import type { Vec3 } from "../../src/core/types";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);
const yawQuat = (t: number): [number, number, number, number] => [0, Math.sin(t / 2), 0, Math.cos(t / 2)];
const head = (y = 1.2, yaw = 0) => ({ position: [0, y, 0] as Vec3, yaw });

describe("box pose from the head", () => {
  it("puts the panel 0.55 m ahead of the eyes and 0.28 m below them (in the lap)", () => {
    expect(BOX_FORWARD_M).toBe(0.55);
    expect(BOX_BELOW_HEAD_M).toBe(0.28);
    const p = headBoxPose(head(1.2, 0));
    close(p.position[0], 0);
    close(p.position[1], 0.92);
    close(p.position[2], -0.55);
    expect(p.yaw).toBe(0);
  });

  it("follows the head's yaw and position", () => {
    const p = headBoxPose({ position: [1, 1.1, 2], yaw: Math.PI / 2 });
    close(p.position[0], 1 - 0.55);
    close(p.position[1], 0.82);
    close(p.position[2], 2);
    close(p.yaw, Math.PI / 2);
  });

  it("adds the height offset in centimetres", () => {
    close(headBoxPose(head(1.2), 5).position[1], 0.97);
    close(headBoxPose(head(1.2), -10).position[1], 0.82);
  });

  it("reads yaw from a quaternion and ignores pitch", () => {
    close(yawFromQuaternion(0, 0, 0, 1), 0);
    close(yawFromQuaternion(...yawQuat(0.7)), 0.7);
    close(yawFromQuaternion(...yawQuat(-2.5)), -2.5);
    const s = Math.sin(-0.5 / 2);
    const c = Math.cos(-0.5 / 2);
    close(yawFromQuaternion(s, 0, 0, c), 0); // looking down 0.5 rad
    // yaw 0.7 then pitch down 0.5: q = qYaw * qPitch
    const [, ys, , yc] = yawQuat(0.7);
    close(yawFromQuaternion(yc * s, ys * c, -ys * s, yc * c), 0.7);
  });
});

describe("Placement", () => {
  it("is the default until placed from the head", () => {
    const pl = new Placement();
    expect(pl.source).toBe("default");
    const v = pl.version;
    pl.start(head(1.25, 0.3));
    expect(pl.source).toBe("head");
    expect(pl.version).toBeGreaterThan(v);
    close(pl.pose().position[1], 0.97);
    close(pl.pose().yaw, 0.3);
  });

  it("places again on recenter from the new head pose", () => {
    const pl = new Placement();
    pl.start(head(1.2, 0));
    pl.start({ position: [0.4, 1.1, -0.2], yaw: Math.PI });
    close(pl.pose().position[0], 0.4);
    close(pl.pose().position[2], -0.2 + 0.55);
    close(pl.pose().position[1], 0.82);
  });

  it("applies offset changes on top of the head-based height, and only real changes count", () => {
    const pl = new Placement();
    pl.start(head(1.2));
    pl.setOffset(5);
    close(pl.pose().position[1], 0.97);
    const v = pl.version;
    pl.setOffset(5);
    expect(pl.version).toBe(v);
    pl.setOffset(-5);
    close(pl.pose().position[1], 0.87);
    pl.start(head(1.2), -5);
    close(pl.pose().position[1], 0.87);
  });

  it("returns the same pose object every call", () => {
    const pl = new Placement();
    pl.start(head());
    expect(pl.pose()).toBe(pl.pose());
  });
});
