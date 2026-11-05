import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "@iwsdk/core";
import type { V3, Vec3 } from "../../src/core/types";
import {
  BOX_BELOW_HEAD_M,
  BOX_FORWARD_M,
  boxToWorld,
  DEFAULT_BOX_CM,
  Placement,
  placeBox,
  TILT_DEG,
  worldToBox,
  yawFromQuaternion,
} from "../../src/render/placement";

const close = (a: number, b: number, digits = 9) => expect(a).toBeCloseTo(b, digits);
const yawQuat = (t: number): [number, number, number, number] => [0, Math.sin(t / 2), 0, Math.cos(t / 2)];
const eye = (x = 0, y = 1.2, z = 0, yaw = 0) => ({ pos: new Vector3(x, y, z), yaw });
const world = (m: Matrix4, v: V3) => boxToWorld(m, v, new Vector3());
const DEG = Math.PI / 180;

describe("placeBox", () => {
  it("puts the panel centre 0.55 m in front of the eye horizontally and 0.28 m below it", () => {
    expect(BOX_FORWARD_M).toBe(0.55);
    expect(BOX_BELOW_HEAD_M).toBe(0.28);
    for (const e of [eye(), eye(0.4, 1.1, -2, Math.PI / 2), eye(-1, 1.3, 0.5, -2.4)]) {
      const p = world(placeBox(e, 24), [0, 0, 0]);
      close(Math.hypot(p.x - e.pos.x, p.z - e.pos.z), 0.55);
      close(e.pos.y - p.y, 0.28);
      // Straight ahead along the head's heading (yaw 0 looks down -Z).
      close(p.x, e.pos.x - Math.sin(e.yaw) * 0.55);
      close(p.z, e.pos.z - Math.cos(e.yaw) * 0.55);
    }
  });

  it("round-trips worldToBox(boxToWorld(v)) within 1e-9", () => {
    const pts: V3[] = [[0, 0, 0], [0.5, -0.5, 1], [-0.45, -0.3, 1.35], [0.12, 0.33, 0.7], [-3, 2, -1]];
    for (const [e, cm, tilt] of [[eye(), 24, TILT_DEG], [eye(0.3, 1.05, -1.4, 0.8), 18, 20], [eye(-2, 1.4, 3, -2.9), 30, 0]] as const) {
      const m = placeBox(e, cm, tilt);
      for (const v of pts) {
        const back = worldToBox(m, world(m, v), [0, 0, 0]);
        for (let i = 0; i < 3; i++) expect(Math.abs(back[i]! - v[i]!)).toBeLessThan(1e-9);
      }
    }
  });

  it("scales distances by 30/24 around the panel at 30 cm", () => {
    const e = eye(0.2, 1.15, -0.4, 0.6);
    const m24 = placeBox(e, 24), m30 = placeBox(e, 30);
    const panel = world(m24, [0, 0, 0]);
    close(world(m30, [0, 0, 0]).distanceTo(panel), 0);
    for (const v of [[0.5, 0.5, 1], [-0.45, -0.19, 1.6], [0.1, -0.2, 0.3]] as V3[]) {
      const a = world(m24, v).sub(panel), b = world(m30, v).sub(panel);
      close(b.x, (a.x * 30) / 24);
      close(b.y, (a.y * 30) / 24);
      close(b.z, (a.z * 30) / 24);
    }
    // One box unit is the box size in metres.
    close(world(m24, [1, 0, 0]).distanceTo(panel), 0.24);
    close(world(m30, [1, 0, 0]).distanceTo(panel), 0.3);
  });

  it("tilts the panel back so it faces the eyes: the open front points at the player and up by the tilt", () => {
    for (const tilt of [TILT_DEG, 20]) {
      const e = eye(0, 1.2, 0, 0);
      const m = placeBox(e, 24, tilt);
      const panel = world(m, [0, 0, 0]);
      const front = world(m, [0, 0, 1]).sub(panel).normalize();
      close(front.x, 0);
      close(front.z, Math.cos(tilt * DEG)); // toward the player (+Z at yaw 0)
      close(front.y, Math.sin(tilt * DEG)); // and up
      const up = world(m, [0, 1, 0]).sub(panel).normalize();
      close(up.y, Math.cos(tilt * DEG));
      close(up.z, -Math.sin(tilt * DEG)); // the top leans away from the player
      const right = world(m, [1, 0, 0]).sub(panel).normalize();
      close(right.x, 1); // box +x is the player's right
    }
  });

  it("defaults to the tuned tilt and writes into a given matrix", () => {
    const out = new Matrix4();
    expect(placeBox(eye(), 24, undefined, out)).toBe(out);
    expect(out.equals(placeBox(eye(), 24, TILT_DEG))).toBe(true);
  });
});

describe("yawFromQuaternion", () => {
  it("reads yaw from a quaternion and ignores pitch", () => {
    close(yawFromQuaternion(0, 0, 0, 1), 0, 6);
    close(yawFromQuaternion(...yawQuat(0.7)), 0.7, 6);
    close(yawFromQuaternion(...yawQuat(-2.5)), -2.5, 6);
    const s = Math.sin(-0.5 / 2);
    const c = Math.cos(-0.5 / 2);
    close(yawFromQuaternion(s, 0, 0, c), 0, 6); // looking down 0.5 rad
    const [, ys, , yc] = yawQuat(0.7);
    close(yawFromQuaternion(yc * s, ys * c, -ys * s, yc * c), 0.7, 6);
  });
});

describe("Placement", () => {
  const head = (y = 1.2, yaw = 0, x = 0, z = 0) => ({ position: [x, y, z] as Vec3, yaw });

  it("is the default seated pose until placed from the head", () => {
    const pl = new Placement();
    expect(pl.source).toBe("default");
    close(pl.pose().position[1], 1.2 - 0.28);
    close(pl.pose().position[2], -0.55);
    close(pl.sizeM, DEFAULT_BOX_CM / 100);
    const v = pl.version;
    pl.start(head(1.25, 0.3));
    expect(pl.source).toBe("head");
    expect(pl.version).toBeGreaterThan(v);
    close(pl.pose().position[1], 0.97);
    close(pl.pose().yaw, 0.3);
  });

  it("matches placeBox for the head it was placed from", () => {
    const pl = new Placement();
    pl.start(head(1.1, -1.2, 0.4, -0.3));
    pl.setSize(27);
    const want = placeBox(eye(0.4, 1.1, -0.3, -1.2), 27);
    for (let i = 0; i < 16; i++) close(pl.matrix().elements[i]!, want.elements[i]!);
    const p = world(pl.matrix(), [0, 0, 0]);
    close(pl.pose().position[0], p.x);
    close(pl.pose().position[1], p.y);
    close(pl.pose().position[2], p.z);
  });

  it("keeps the box size when placed again (Recenter)", () => {
    const pl = new Placement();
    pl.start(head());
    pl.setSize(30);
    pl.start(head(1.1, Math.PI, 0.4, -0.2));
    close(pl.sizeM, 0.3);
    close(world(pl.matrix(), [1, 0, 0]).distanceTo(world(pl.matrix(), [0, 0, 0])), 0.3);
    close(pl.pose().position[0], 0.4);
    close(pl.pose().position[2], -0.2 + 0.55);
    close(pl.pose().position[1], 0.82);
  });

  it("counts only real size changes, and a size change keeps the panel where it is", () => {
    const pl = new Placement();
    pl.start(head(1.2, 0.5));
    const before = [...pl.pose().position];
    const v = pl.version;
    pl.setSize(24);
    expect(pl.version).toBe(v);
    pl.setSize(18);
    expect(pl.version).toBe(v + 1);
    for (let i = 0; i < 3; i++) close(pl.pose().position[i]!, before[i]!);
    close(pl.sizeM, 0.18);
  });

  it("returns the same pose and matrix objects every call", () => {
    const pl = new Placement();
    pl.start(head());
    expect(pl.pose()).toBe(pl.pose());
    expect(pl.matrix()).toBe(pl.matrix());
  });
});
