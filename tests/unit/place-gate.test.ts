// The steady pose a placement waits for: a phone (or a headset's head) held still for 0.4 s in a looking pose before
// the box is first placed, 2.5 s at most; a phone's re-place only ever on a truly steady pose. The forward fed each
// frame is the head's (a phone's camera's) -z axis in the world.
import { Euler, Quaternion, Vector3 } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import { PlaceGate, STEADY } from "../../src/render/placement";

const DEG = Math.PI / 180;
const FRAME_MS = 1000 / 72;

/** The forward of a head turned `yawDeg` (to the left) and pitched `pitchDeg` (up). */
function forward(yawDeg: number, pitchDeg: number): [number, number, number] {
  const q = new Quaternion().setFromEuler(new Euler(pitchDeg * DEG, yawDeg * DEG, 0, "YXZ"));
  const f = new Vector3(0, 0, -1).applyQuaternion(q);
  return [f.x, f.y, f.z];
}

/** Feed `ms` of frames from `t0`, the pose from `pose(t)`; returns the time after the last frame. */
function feed(g: PlaceGate, t0: number, ms: number, pose: (t: number) => [number, number]): number {
  let t = t0;
  for (; t < t0 + ms; t += FRAME_MS) g.update(t, ...forward(...pose(t)));
  return t;
}

/** When the gate first says ready (ms after `t0`), feeding `pose` frame by frame; NaN if not within `maxMs`. */
function readyAfter(g: PlaceGate, pose: (t: number) => [number, number], maxMs = 5000): number {
  for (let t = 0; t <= maxMs; t += FRAME_MS) {
    g.update(t, ...forward(...pose(t)));
    if (g.ready) return t;
  }
  return Number.NaN;
}

describe("the steady gate", () => {
  it("waits for a phone held still in a looking pose before placing", () => {
    expect(STEADY).toMatchObject({ turnDegPerS: 30, stillMs: 400, capMs: 2500, pitchDeg: { down: 60, up: 20 } });
    // Held still from the start, level: ready once it has been still 0.4 s.
    const still = new PlaceGate();
    const t = readyAfter(still, () => [0, 0]);
    expect(t).toBeGreaterThanOrEqual(STEADY.stillMs);
    expect(t).toBeLessThan(STEADY.stillMs + 2 * FRAME_MS);
    expect(still.steady).toBe(true);
    // Turning at 90 degrees a second for the first second (the phone swung round as AR starts), then held: not
    // before it has been still 0.4 s after the turn.
    const turning = new PlaceGate();
    const swing = (ms: number): [number, number] => [Math.min(ms, 1000) * 0.09, -20];
    const after = readyAfter(turning, swing);
    expect(after).toBeGreaterThanOrEqual(1000 + STEADY.stillMs);
    expect(after).toBeLessThan(STEADY.capMs);
    // A slow drift under 30 degrees a second still counts as held.
    const drift = new PlaceGate();
    expect(readyAfter(drift, (ms) => [ms * 0.015, -30])).toBeLessThan(STEADY.stillMs + 2 * FRAME_MS);
  });

  it("one jittery frame does not restart the wait; a real turn does", () => {
    const g = new PlaceGate();
    let t = feed(g, 0, 300, () => [0, -25]);
    // A 1 degree jump in one frame (72 degrees a second for that frame): the smoothed rate stays under the limit.
    g.update(t, ...forward(1, -25));
    t += FRAME_MS;
    t = feed(g, t, 120, () => [1, -25]);
    expect(g.steady).toBe(true);
    // A 20 degree turn over 0.1 s (200 a second): still again only 0.4 s after it.
    const turnAt = t;
    t = feed(g, t, 100, (ms) => [1 + ((ms - turnAt) / 100) * 20, -25]);
    t = feed(g, t, 300, () => [21, -25]);
    expect(g.steady).toBe(false);
    feed(g, t, 300, () => [21, -25]);
    expect(g.steady).toBe(true);
  });

  it("places anyway after the cap", () => {
    // Turning the whole time (sweeping the room at 60 degrees a second): ready at the cap, never steady.
    const sweep = new PlaceGate();
    const t = readyAfter(sweep, (ms) => [ms * 0.06, -10]);
    expect(t).toBeGreaterThanOrEqual(STEADY.capMs);
    expect(t).toBeLessThan(STEADY.capMs + 2 * FRAME_MS);
    expect(sweep.steady).toBe(false);
    // Pointed at the floor the whole time: also at the cap.
    expect(readyAfter(new PlaceGate(), () => [0, -85])).toBeGreaterThanOrEqual(STEADY.capMs);
    // A reset (a new session) starts the cap again.
    sweep.reset();
    expect(sweep.ready).toBe(false);
    sweep.update(10_000, ...forward(0, 0));
    expect(sweep.ready).toBe(false);
  });

  it("a phone lying flat or pointed at the ceiling is never steady enough for a re-place", () => {
    for (const pitch of [-90, -75, -61, 21, 45, 89]) {
      const g = new PlaceGate();
      feed(g, 0, 5000, () => [30, pitch]);
      expect(g.steady, `pitch ${pitch}`).toBe(false);
      // The cap still lets a first placement go ahead.
      expect(g.ready, `pitch ${pitch}`).toBe(true);
    }
    for (const pitch of [-59, -30, 0, 19]) {
      const g = new PlaceGate();
      feed(g, 0, 1000, () => [30, pitch]);
      expect(g.steady, `pitch ${pitch}`).toBe(true);
    }
  });

  it("a headset's first placement waits for a steady head too: a seated player looking round as the session starts", () => {
    // The seated head looks down at the lap (about 27 degrees down), first turned 70 degrees to the left at the
    // launch panel, then turning to face forward over 0.6 s and holding there.
    const g = new PlaceGate();
    const head = (ms: number): [number, number] => [ms < 300 ? 70 : Math.max(0, 70 - ((ms - 300) / 600) * 70), -27];
    const t = readyAfter(g, head);
    expect(t).toBeGreaterThanOrEqual(900 + STEADY.stillMs);
    expect(t).toBeLessThan(STEADY.capMs);
    // Placed then, the head faces forward: the box goes in front, not where the head was at the start.
    const f = forward(...head(t));
    expect(Math.abs(Math.atan2(-f[0], -f[2]))).toBeLessThan(1e-9);
  });
});
