// A box lost from view: the box's bounding sphere against the camera's view, how long no part of it has shown, and
// what then. A phone places it in front again by itself after 2 s (held still, no touch down, the lantern not held); a
// headset never moves it by itself, and shows an arrow toward it instead (the lantern not held, no pinch down), gone
// once the box is in view again.
import { Euler, Matrix4, Quaternion, Vector3 } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { BOX_SPHERE, boxInView, type LostInput, LOST_MS, LostBox, sphereInView } from "../../src/render/lost-box";
import { BOX_EXTENT, boxToWorld, Placement, PHONE_VIEW, type ViewTangents } from "../../src/render/placement";

const DEG = Math.PI / 180;
const FRAME_MS = 1000 / 72;
const HEAD = new Vector3(0.1, 1.25, -0.3);
/** IWER's emulated headset: a 90 degree view up and down, a little narrower across. */
const WIDE: ViewTangents = { tanH: 0.89, tanV: 1 };

const turned = (yawDeg: number, pitchDeg: number) => new Quaternion().setFromEuler(new Euler(pitchDeg * DEG, yawDeg * DEG, 0, "YXZ"));
const input = (o: Partial<LostInput> = {}): LostInput => ({ phone: true, steady: true, touchDown: false, held: false, pinchDown: false, ...o });

/** A box placed in a phone's view from HEAD, looking 25 degrees down. */
function phoneBox(): Matrix4 {
  const p = new Placement();
  p.startInView({ position: [HEAD.x, HEAD.y, HEAD.z], yaw: 0 }, -25 * DEG);
  return (p.matrix() as Matrix4).clone();
}

/** Step `lost` frame by frame for `ms` from `t0` with the box out of view; returns the first time it asked, or NaN. */
function asks(lost: LostBox, t0: number, ms: number, s: LostInput, inView = false): number {
  for (let t = t0; t <= t0 + ms; t += FRAME_MS) if (lost.update(t, inView, s)) return t;
  return Number.NaN;
}

describe("a box lost from view", () => {
  it("its sphere holds the whole box: frame, plinth and drawer handle", () => {
    const E = BOX_EXTENT, c = BOX_SPHERE.center;
    for (const x of [-E.x, E.x]) for (const y of [-E.down, E.up]) for (const z of [-E.back, E.front]) {
      expect(Math.hypot(x - c[0], y - c[1], 0.5 + z - c[2])).toBeLessThanOrEqual(BOX_SPHERE.radius + 1e-9);
    }
  });

  it("tells a sphere in view, at its edge and out of it, ahead, aside and behind", () => {
    const v: ViewTangents = { tanH: 0.5, tanV: 0.5 };
    expect(sphereInView(0, 0, -1, 0.1, v)).toBe(true);
    // Just past the right edge: in while the edge of the sphere still crosses it, out once it is wholly past.
    const edge = 0.5 * 1;
    expect(sphereInView(edge + 0.1, 0, -1, 0.1, v)).toBe(true);
    expect(sphereInView(edge + 0.2, 0, -1, 0.1, v)).toBe(false);
    expect(sphereInView(0, -(edge + 0.2), -1, 0.1, v)).toBe(false);
    // Behind the camera.
    expect(sphereInView(0, 0, 0.5, 0.1, v)).toBe(false);
    // Round the camera itself (closer than its radius): in view.
    expect(sphereInView(0, 0, 0.05, 0.1, v)).toBe(true);
  });

  it("a phone's box out of view for 2 s asks to be placed again", () => {
    const box = phoneBox();
    expect(boxInView(box, HEAD, turned(0, -25), PHONE_VIEW)).toBe(true);
    // The phone turned a quarter to the left: no part of the box is in view.
    const away = turned(90, -10);
    expect(boxInView(box, HEAD, away, PHONE_VIEW)).toBe(false);
    expect(boxInView(box, HEAD, away, WIDE)).toBe(false);
    const lost = new LostBox();
    const t = asks(lost, 0, 3000, input());
    expect(t).toBeGreaterThanOrEqual(LOST_MS);
    expect(t).toBeLessThan(LOST_MS + FRAME_MS);
    // Once: the timer starts over.
    expect(lost.lostMs).toBe(0);
    expect(asks(lost, t + FRAME_MS, LOST_MS - 2 * FRAME_MS, input())).toBeNaN();
    // Not while the phone is still turning (or lying flat): it waits for a steady pose.
    const moving = new LostBox();
    expect(asks(moving, 0, 5000, input({ steady: false }))).toBeNaN();
    expect(asks(moving, 5000, 0, input())).toBe(5000);
  });

  it("a box partly in view is not lost", () => {
    const box = phoneBox(), mid = boxToWorld(box, [BOX_SPHERE.center[0], BOX_SPHERE.center[1], BOX_SPHERE.center[2]], new Vector3());
    const d = mid.distanceTo(HEAD), r = BOX_SPHERE.radius * 0.24;
    // Looking straight at the sphere's middle, then turned left about the camera's own up until the sphere's near edge
    // is just inside the view's right edge, then just past it.
    const half = Math.atan(PHONE_VIEW.tanH) / DEG, reach = Math.asin(r / d) / DEG;
    const ahead = Math.atan2(-(mid.x - HEAD.x), -(mid.z - HEAD.z)) / DEG;
    const pitch = Math.atan2(mid.y - HEAD.y, Math.hypot(mid.x - HEAD.x, mid.z - HEAD.z)) / DEG;
    const aside = (deg: number) => turned(ahead, pitch).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg * DEG));
    expect(boxInView(box, HEAD, aside(0), PHONE_VIEW)).toBe(true);
    expect(boxInView(box, HEAD, aside(half + reach - 2), PHONE_VIEW)).toBe(true);
    expect(boxInView(box, HEAD, aside(half + reach + 2), PHONE_VIEW)).toBe(false);
    const lost = new LostBox();
    // In view at the edge for 5 s: never asks; out for under 2 s at a time: never asks either.
    expect(asks(lost, 0, 5000, input(), true)).toBeNaN();
    for (let k = 0; k < 4; k++) {
      expect(asks(lost, 5000 + k * 3000, 1900, input())).toBeNaN();
      lost.update(5000 + k * 3000 + 1950, true, input());
    }
  });

  it("never while a touch is down or the lantern is held", () => {
    for (const busy of [{ touchDown: true }, { held: true }, { touchDown: true, held: true }]) {
      const lost = new LostBox();
      expect(asks(lost, 0, 4000, input(busy)), JSON.stringify(busy)).toBeNaN();
      // The finger lifts (the lantern let go), the box still out of view: placed again then.
      expect(asks(lost, 4000, 100, input())).toBe(4000);
    }
  });

  it("never on a headset: an arrow instead, after 2 s fully out of view, with the lantern not held and no pinch down", () => {
    const head = input({ phone: false });
    const lost = new LostBox();
    expect(asks(lost, 0, 10_000, head)).toBeNaN();
    expect(lost.arrow).toBe(true);
    // Not before 2 s.
    const early = new LostBox();
    for (let t = 0; t < LOST_MS - FRAME_MS; t += FRAME_MS) early.update(t, false, head);
    expect(early.arrow).toBe(false);
    early.update(LOST_MS, false, head);
    expect(early.arrow).toBe(true);
  });

  it("the arrow's rule: not while the lantern is held or a pinch is down; once up it stays for the pinch on it; gone once the box is in view", () => {
    const head = input({ phone: false });
    for (const busy of [{ held: true }, { pinchDown: true }]) {
      const lost = new LostBox();
      for (let t = 0; t < 4000; t += FRAME_MS) lost.update(t, false, input({ ...head, ...busy }));
      expect(lost.arrow, JSON.stringify(busy)).toBe(false);
      lost.update(4000, false, head);
      expect(lost.arrow).toBe(true);
      // The pinch that takes it does not hide it.
      lost.update(4010, false, input({ ...head, pinchDown: true }));
      expect(lost.arrow).toBe(true);
      // The box in view again (the player turned back): gone, and the timer starts over.
      lost.update(4020, true, head);
      expect(lost.arrow).toBe(false);
      lost.update(4030, false, head);
      expect(lost.arrow).toBe(false);
    }
    // Taken (a summon starts): it goes at once.
    const lost = new LostBox();
    lost.update(0, false, head);
    lost.update(LOST_MS, false, head);
    expect(lost.arrow).toBe(true);
    lost.reset();
    expect(lost.arrow).toBe(false);
    expect(lost.lostMs).toBe(0);
  });
});
