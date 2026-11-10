import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "@iwsdk/core";
import type { V3, Vec3 } from "../../src/core/types";
import {
  BOX_BELOW_HEAD_M,
  BOX_FORWARD_M,
  boxToWorld,
  DEFAULT_BOX_CM,
  NECK_M,
  Placement,
  placeFromHead,
  PLAY_PITCH,
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

  it("placed again in view, the box keeps its size, and a lantern in box units stays in the box", () => {
    const pl = new Placement();
    pl.setSize(27);
    pl.startInView(head(1.3, 0.4, 0.1, -0.2), -30 * DEG);
    const first = pl.matrix().clone();
    // The lantern, an open lock's spot and a crystallised piece: all box units.
    const pts: V3[] = [[0.2, -0.3, 1.35], [-0.12, -0.32, 1.32], [0.1, 0.05, 0.45]];
    // The phone turned half round and held level: placed again in its new view, and back in the lap (a headset's Recenter).
    for (const place of [() => pl.startInView(head(1.25, 2.6, 0.3, 0.1), 0), () => pl.start(head(1.2, -1, 0.3, 0.1))]) {
      place();
      close(pl.sizeM, 0.27);
      const m = pl.matrix(), panel = world(m, [0, 0, 0]), was = world(first, [0, 0, 0]);
      expect(panel.distanceTo(was)).toBeGreaterThan(0.2);
      for (const p of pts) {
        const w = world(m, p);
        // The same numbers put it in the same place in the box, wherever the box is now, at the same size.
        close(w.distanceTo(panel), world(first, p).distanceTo(was));
        const back = worldToBox(m, w, [0, 0, 0]);
        for (let i = 0; i < 3; i++) close(back[i]!, p[i]!);
      }
    }
  });

  it("a headset's first placement lands the box in the same place whether the head looked level, 30 or 60 degrees down", () => {
    // A seated player's eyes swing round the neck as the head pitches (NECK_M): looking 60 degrees down they are about
    // 11 cm lower than looking level. The box is placed from where the eyes are while looking at it (PLAY_PITCH, the
    // pitch the lap's 55 cm and 28 cm give), so it lands in the same place whatever the head did as it was placed.
    expect(NECK_M).toEqual({ up: 0.075, forward: 0.0805 });
    expect(PLAY_PITCH / DEG).toBeCloseTo(-Math.atan2(0.28, 0.55) / DEG, 9);
    const yaw = 0.8, upright = new Vector3(0.2, 1.22, -0.4);
    const pivot = upright.clone().add(new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(-NECK_M.forward)).add(new Vector3(0, -NECK_M.up, 0));
    /** The eyes with the head pitched `deg`, turned `yaw`: round the neck's pivot. */
    const eyes = (deg: number) => {
      const p = deg * DEG, back = NECK_M.up * Math.sin(p) - NECK_M.forward * Math.cos(p);
      return pivot.clone().add(new Vector3(Math.sin(yaw) * back, NECK_M.up * Math.cos(p) + NECK_M.forward * Math.sin(p), Math.cos(yaw) * back));
    };
    expect(eyes(0).distanceTo(upright)).toBeLessThan(1e-12);
    expect(upright.y - eyes(-60).y).toBeCloseTo(0.107, 3);
    const playing = eyes(PLAY_PITCH / DEG);
    /** How far the box's middle stands below the eyes `e` (m). */
    const below = (m: Readonly<Matrix4>, e: Vector3) => e.y - world(m as Matrix4, [0, 0, 0.5]).y;
    let first: Matrix4 | null = null;
    for (const deg of [0, -30, -60]) {
      const pl = new Placement();
      const e = eyes(deg);
      pl.start({ position: [e.x, e.y, e.z], yaw }, deg * DEG);
      const m = (pl.matrix() as Matrix4).clone();
      if (!first) first = m;
      for (let i = 0; i < 16; i++) close(m.elements[i]!, first.elements[i]!, 9);
      // Inside the comfort envelope (box centre 20 to 35 cm below the eyes), sitting up and looking at it.
      for (const [name, from] of [["upright", upright], ["looking at it", playing]] as const) {
        const d = below(m, from);
        expect(d, `${deg} degrees, ${name}`).toBeGreaterThanOrEqual(0.2);
        expect(d, `${deg} degrees, ${name}`).toBeLessThanOrEqual(0.35);
      }
      // 28 cm below the eyes that look at it, as placed.
      close(playing.y - pl.pose().position[1], BOX_BELOW_HEAD_M, 9);
    }
    // Placed straight from the pitched eyes, as before, the 60 degree look put it below the envelope.
    const raw = new Placement(), e60 = eyes(-60);
    raw.start({ position: [e60.x, e60.y, e60.z], yaw });
    expect(below(raw.matrix(), upright)).toBeGreaterThan(0.35);
    // Recenter and every other placement without a pitch are as they were: from the eyes as they are.
    const pl = new Placement(), e = eyes(-60);
    pl.start({ position: [e.x, e.y, e.z], yaw });
    const want = placeBox({ pos: e.clone(), yaw }, DEFAULT_BOX_CM);
    for (let i = 0; i < 16; i++) close(pl.matrix().elements[i]!, want.elements[i]!);
  });

  it("every headset placement (first, Recenter, Quest's recenter, the arrow's summon) lands where the first did, the head 20 degrees up, level or 40 down", () => {
    // placeFromHead is what the shell places with, every time: here a seated player's eyes round the neck (NECK_M),
    // turned 0.8 rad, the head's turn as the headset reports it.
    const yaw = 0.8, upright = new Vector3(0.2, 1.22, -0.4);
    const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const pivot = upright.clone().addScaledVector(fwd, -NECK_M.forward).add(new Vector3(0, -NECK_M.up, 0));
    const headAt = (deg: number) => {
      const p = deg * DEG, back = NECK_M.up * Math.sin(p) - NECK_M.forward * Math.cos(p);
      return {
        pos: pivot.clone().add(new Vector3(Math.sin(yaw) * back, NECK_M.up * Math.cos(p) + NECK_M.forward * Math.sin(p), Math.cos(yaw) * back)),
        turn: new Quaternion().setFromEuler(new Euler(p, yaw, 0, "YXZ")),
      };
    };
    const view = { tanH: 0.3, tanV: 0.3 };
    const pl = new Placement();
    // The first placement, the player looking at the lap; the lantern on a lock's spot and a crystallised piece.
    const first = headAt(-27);
    placeFromHead(pl, first.pos, first.turn, false, view);
    const want = pl.matrix().clone();
    const pts: V3[] = [[0.2, -0.3, 1.35], [0.1, 0.05, 0.45]];
    const at = pts.map((p) => world(want, p));
    for (const [name, deg] of [["Recenter, the head 20 degrees up", 20], ["Quest's recenter, level", 0], ["the arrow's summon, 40 degrees down", -40]] as const) {
      const h = headAt(deg);
      placeFromHead(pl, h.pos, h.turn, false, view);
      expect(pl.source, name).toBe("head");
      // The same box to 1e-9 m and rad: the eyes are put back where they are while looking at it.
      for (let i = 0; i < 16; i++) expect(Math.abs(pl.matrix().elements[i]! - want.elements[i]!), `${name}, element ${i}`).toBeLessThan(1e-9);
      // Box units unchanged, so the lantern and the solve state are where they were, in the box and in the room.
      pts.forEach((p, k) => expect(world(pl.matrix(), p).distanceTo(at[k]!), name).toBeLessThan(1e-9));
    }
    // A phone is placed in its camera's view, as before: the pitch leans the box, the eyes are not moved.
    const phone = new Placement(), ref = new Placement(), cam = headAt(-35);
    placeFromHead(phone, cam.pos, cam.turn, true, view);
    ref.startInView({ position: [cam.pos.x, cam.pos.y, cam.pos.z], yaw }, -35 * DEG, view);
    expect(phone.source).toBe("view");
    for (let i = 0; i < 16; i++) expect(Math.abs(phone.matrix().elements[i]! - ref.matrix().elements[i]!)).toBeLessThan(1e-9);
  });

  it("returns the same pose and matrix objects every call", () => {
    const pl = new Placement();
    pl.start(head());
    expect(pl.pose()).toBe(pl.pose());
    expect(pl.matrix()).toBe(pl.matrix());
  });
});
