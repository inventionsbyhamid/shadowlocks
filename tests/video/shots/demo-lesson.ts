// The demo film, shots 3 to 6 (plan/submission/demo-video-script.md), one take: lesson 1 as a new player meets it,
// paced by the voice guide. From a little behind the chair the room is in view as the box forms out of light in the
// lap and the room dims; the camera settles at the seated eye as "Pick up the lantern." is said and the ghost hand
// shows how; the right hand picks the lantern up and fills lock I's Moon; Example 1 (the ghost solves the arrow's twin,
// near scraps swing wide), the player's arrow; Example 2 (the sight rings), the player's Key; the box opens. The beats
// follow each other in the game itself, so the film needs no cut inside the lesson: its narration lines go where the
// beats fall (read from this shot's events).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Vec3 } from "../../../src/core/types";
import { SEATED } from "../../e2e/helpers/boot";
import type { View } from "../lib/camera";
import { defineShot } from "../lib/shot";
import { carryOpen, offset } from "../lib/stage";

interface Data {
  box: Vec3;
}

const EYE: Vec3 = [SEATED.position.x, SEATED.position.y, SEATED.position.z];
const REST_LEFT: Vec3 = [-0.45, 0.7, -1.3];
const REST_RIGHT: Vec3 = [0.42, 0.72, -1.28];
/** Out of the wide opening view: low, beside and behind its eye. */
const AWAY_LEFT: Vec3 = [-0.4, 0.55, -0.55];
const AWAY_RIGHT: Vec3 = [0.55, 0.55, -0.55];

/** The seated eye on the whole box, the lantern beside it and the coach line above it. */
const seated = (box: Vec3): View => ({ from: offset(EYE, -0.04, 0.02, 0.07), at: offset(box, 0.01, -0.04, 0.12) });

export default defineShot<Data>({
  name: "demo-lesson",
  description: "Lesson 1 in one take: the box forms in the lap, the room dims, the voice and the ghost hand teach, three locks open.",
  seconds: 78,
  async setup({ app, hand }) {
    await hand("left").park(AWAY_LEFT);
    await hand("right").park(AWAY_RIGHT);
    // The box is placed in the lap at boot (Home stands over it); the lesson's box forms there.
    return { box: (await app.state()).boxPose.position as Vec3 };
  },
  // Behind the chair's right shoulder and higher: the room and the lap in view.
  firstView: ({ box }): View => ({ from: offset(EYE, 0.32, 0.22, 0.62), at: offset(box, 0, 0.05, 0) }),
  async play({ app, page, hand, camera, until, time, wait }) {
    const right = hand("right");
    await until(0.6);
    await page.evaluate(() => (window as any).__sl.lessons.start("l1"));
    await app.stepUntil((_ns, w) => w.__sl.session.state()?.key === "shadow-locks/lesson/l1", { maxMs: 3_000, label: "lesson 1's box" });
    const box = (await app.state()).boxPose.position as Vec3;
    // Hold wide while the box forms and the room dims, then sit down to it.
    await until(3.2);
    camera.move(seated(box), 3800);
    // The hands come to rest beside the lap, out of the seated view, as the camera sits down.
    await hand("left").glide(REST_LEFT, 1800);
    await hand("right").glide(REST_RIGHT, 1800);
    // "Pick up the lantern."; after 4 s without input the ghost hand shows the pinch.
    const t0 = time();
    await until(Math.max(t0 + 5, 9));
    // Lock I: the Moon.
    // Slow enough for the goal line to be said whole before the Moon fills.
    await carryOpen(app, page, right, 0, 4200, REST_RIGHT, { label: "demo-lesson" });
    // Example 1, then the player's arrow.
    await app.stepUntil((_ns, w) => w.__sl.lessons.state().step === 3, { maxMs: 30_000, label: "example 1 done" });
    await wait(1000);
    await carryOpen(app, page, right, 1, 2400, REST_RIGHT, { label: "demo-lesson" });
    // Example 2, then the player's Key.
    await app.stepUntil((_ns, w) => w.__sl.lessons.state().step === 5, { maxMs: 30_000, label: "example 2 done" });
    await wait(800);
    // The rings lined up partway, a moment for the coach's lines, then the slide in.
    await carryOpen(app, page, right, 2, 3200, REST_RIGHT, { label: "demo-lesson", pause: { at: 0.6, ms: 3800 } });
    // The box opens.
    await app.stepUntil((_ns, w) => w.__sl.lessons.state().step === 6, { maxMs: 8_000, label: "lesson 1's reward step" });
    await wait(4000);
  },
});
