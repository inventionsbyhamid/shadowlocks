import { describe, expect, it } from "vitest";
import { CameraTrack, fovyFor, minimumJerk, quatFromYawPitch, type View, yawPitch } from "../video/lib/camera";

const A: View = { from: [0, 1.2, -1.3], at: [0.3, 1.1, -2.5] };
const B: View = { from: [0, 1.16, -1.42], at: [0, 0.74, -1.8] };

describe("minimum jerk", () => {
  it("starts and ends at rest and is symmetric", () => {
    expect(minimumJerk(0)).toBe(0);
    expect(minimumJerk(1)).toBe(1);
    expect(minimumJerk(0.5)).toBeCloseTo(0.5, 12);
    expect(minimumJerk(-1)).toBe(0);
    expect(minimumJerk(2)).toBe(1);
    const h = 1e-4;
    expect((minimumJerk(h) - minimumJerk(0)) / h).toBeLessThan(1e-6);
    expect((minimumJerk(1) - minimumJerk(1 - h)) / h).toBeLessThan(1e-6);
    for (const t of [0.1, 0.3, 0.45]) expect(minimumJerk(t) + minimumJerk(1 - t)).toBeCloseTo(1, 12);
  });
});

describe("camera track", () => {
  it("holds the start view, eases to the next and holds it", () => {
    const c = new CameraTrack(A);
    c.move(1, B, 2000);
    expect(c.viewAt(0)).toEqual(A);
    expect(c.viewAt(1)).toEqual(A);
    expect(c.viewAt(3)).toEqual(B);
    expect(c.viewAt(10)).toEqual(B);
    const mid = c.viewAt(2);
    expect(mid.from[1]).toBeCloseTo((A.from[1] + B.from[1]) / 2, 9);
    expect(mid.at[2]).toBeCloseTo((A.at[2] + B.at[2]) / 2, 9);
  });

  it("moves smoothly at 60 fps: no step bigger than the curve's peak speed allows", () => {
    const c = new CameraTrack(A);
    c.move(0, B, 2000);
    const fps = 60;
    let prev = c.viewAt(0).at;
    let biggest = 0;
    for (let i = 1; i <= 120; i++) {
      const at = c.viewAt(i / fps).at;
      biggest = Math.max(biggest, Math.hypot(at[0] - prev[0], at[1] - prev[1], at[2] - prev[2]));
      prev = at;
    }
    const dist = Math.hypot(B.at[0] - A.at[0], B.at[1] - A.at[1], B.at[2] - A.at[2]);
    // Minimum jerk peaks at 1.875 times the average speed.
    expect(biggest).toBeLessThanOrEqual((dist / 120) * 1.876);
    expect(biggest).toBeGreaterThan((dist / 120) * 1.8);
  });

  it("eases a view's lens with the view, from the render's default when a view names none", () => {
    const c = new CameraTrack(A, { mm: 0, deg: 0 }, 90);
    expect(c.hfovAt(0)).toBe(90);
    c.move(1, { ...B, hfovDeg: 50 }, 2000);
    expect(c.hfovAt(2)).toBeCloseTo(70, 9);
    expect(c.hfovAt(3)).toBe(50);
    c.move(4, A, 1000);
    expect(c.hfovAt(4.5)).toBeCloseTo(70, 9);
    expect(c.hfovAt(6)).toBe(90);
  });

  it("a move that starts mid-move takes over from where the camera is", () => {
    const c = new CameraTrack(A);
    c.move(0, B, 2000);
    const here = c.viewAt(1);
    c.move(1, A, 1000);
    expect(c.viewAt(1)).toEqual(here);
    expect(c.viewAt(2)).toEqual(A);
  });

  it("cuts jump, and moves must come in time order", () => {
    const c = new CameraTrack(A);
    c.cut(0.5, B);
    expect(c.viewAt(0.49)).toEqual(A);
    expect(c.viewAt(0.5)).toEqual(B);
    expect(() => c.move(0.2, A, 100)).toThrow(/time order/);
  });

  it("looks where the view points, with a slow sway when asked", () => {
    const still = new CameraTrack(B).poseAt(3);
    const { yaw, pitch } = yawPitch(B);
    const want = quatFromYawPitch(yaw, pitch);
    for (let i = 0; i < 4; i++) expect(still.quaternion[i]).toBeCloseTo(want[i] as number, 12);
    expect(still.position).toEqual(B.from);
    // The quaternion turns -z (ahead) toward the look-at point.
    const [x, y, z, w] = still.quaternion;
    const f = [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
    const d = [B.at[0] - B.from[0], B.at[1] - B.from[1], B.at[2] - B.from[2]];
    const n = Math.hypot(d[0] as number, d[1] as number, d[2] as number);
    for (let i = 0; i < 3; i++) expect(f[i]).toBeCloseTo((d[i] as number) / n, 9);

    const sway = new CameraTrack(B, { mm: 2, deg: 0.2 });
    let maxOff = 0;
    let maxStep = 0;
    let prev = sway.poseAt(0).position;
    for (let i = 1; i <= 600; i++) {
      const p = sway.poseAt(i / 60).position;
      maxOff = Math.max(maxOff, Math.hypot(p[0] - B.from[0], p[1] - B.from[1], p[2] - B.from[2]));
      maxStep = Math.max(maxStep, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
      prev = p;
    }
    expect(maxOff).toBeGreaterThan(0.0005);
    expect(maxOff).toBeLessThan(0.004);
    // A slow drift, never a shake: well under 0.1 mm per frame.
    expect(maxStep).toBeLessThan(0.0001);
  });
});

describe("field of view", () => {
  it("90 degrees across a 16:9 view is about 58.7 degrees tall", () => {
    expect((fovyFor(90, 1920, 1080) * 180) / Math.PI).toBeCloseTo(58.72, 1);
    expect(fovyFor(90, 1280, 720)).toBeCloseTo(fovyFor(90, 1920, 1080), 12);
  });
});
