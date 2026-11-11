// Bringing a headset's lost box back in front, on the player's word: once the box has been out of view a while
// (lost-box.ts says when the arrow is up), the arrow at the edge of the view points to it (render/summon-arrow.ts); a
// pinch or poke on it (a controller's trigger too) takes it, and the view fades out, the box is placed in front of the
// head as Recenter places it, and the view fades back in. No slide, nothing moving by itself. ShellSystem runs it on
// every frame of a headset's session once the box is placed, the head tracked or not, so a fade always ends; if the
// lantern was taken while the view faded out, it calls the summon off at full dark (the view fades back in, the box
// stays). Quest's own recenter and the Settings key place the box at once, as before. Allocation free per frame.
import type { Quaternion, Vector3 } from "@iwsdk/core";
import type { HandPinch } from "../input/grab-system";
import { smoothstep } from "../render/fx/ease";
import { type ArrowRays, type ArrowTips, SummonView } from "../render/summon-arrow";

export const SUMMON = {
  /** The view fades out over this long, the box is placed, and it fades back in over this long (ms). */
  outMs: 150,
  inMs: 150,
  /** At full dark, the box waits at most this long for a tracked head before the view comes back anyway (ms). */
  holdMaxMs: 500,
} as const;

/** idle; the arrow up; the view fading out (the box is placed at its end); fading back in. */
export type SummonPhase = "idle" | "arrow" | "out" | "in";

/** What a frame of the summon says: the arrow was just taken, the box is to be placed now (the view dark), or nothing. */
export type SummonStep = "taken" | "place" | null;

/** What takes the arrow: both hands' pinches, the fingertips and the rays (the app's own). */
export interface SummonInput {
  hands: readonly HandPinch[];
  tips(): ArrowTips;
  rays: ArrowRays | null;
}

export class Summon {
  readonly view = new SummonView();
  phase: SummonPhase = "idle";
  private t0 = 0;
  /** The last frame's time (ms; NaN before the first). */
  private lastMs = Number.NaN;
  /** How dark the view is as it starts fading back in: 1 after a placement, and after the shell's cancel (at full dark). */
  private from = 1;

  constructor(private readonly input: SummonInput) {}

  /**
   * One frame: `arrow` (the lost-box rule: the arrow is up), the head at `eye` turned `head`, the box's middle at `box`
   * (world), at `nowMs`. "place": place the box in front now, then call `placed`.
   */
  update(nowMs: number, arrow: boolean, eye: Readonly<Vector3>, head: Readonly<Quaternion>, box: Readonly<Vector3>): SummonStep {
    const v = this.view;
    const dtS = this.lastMs === this.lastMs ? Math.min(Math.max(nowMs - this.lastMs, 0), 100) / 1000 : 0;
    this.lastMs = nowMs;
    if (this.phase === "out") {
      const k = (nowMs - this.t0) / SUMMON.outMs;
      v.setFade(smoothstep(0, 1, Math.min(1, k)), eye);
      return k >= 1 ? "place" : null;
    }
    if (this.phase === "in") {
      const k = (nowMs - this.t0) / SUMMON.inMs;
      if (k >= 1) {
        this.phase = "idle";
        v.setFade(0, eye);
      } else v.setFade(this.from * (1 - smoothstep(0, 1, k)), eye);
      return null;
    }
    if (!arrow) {
      if (this.phase === "arrow") v.show(false);
      this.phase = "idle";
      return null;
    }
    if (this.phase === "idle") {
      this.phase = "arrow";
      v.show(true);
    }
    v.follow(eye, head, box, dtS);
    if (!v.taken(this.input.hands, this.input.tips(), this.input.rays)) return null;
    // Taken: the arrow goes at once (the fade covers the view), the view fades out.
    v.show(false);
    this.phase = "out";
    this.t0 = nowMs;
    return "taken";
  }

  /**
   * After a "place": whether the box was placed (false while the head is not tracked). Placed, or dark too long, the
   * view fades back in.
   */
  placed(ok: boolean, nowMs: number): void {
    if (this.phase !== "out") return;
    if (!ok && nowMs - this.t0 < SUMMON.outMs + SUMMON.holdMaxMs) return;
    this.phase = "in";
    this.t0 = nowMs;
    this.from = 1;
  }

  /**
   * Call a summon off before the box is placed (the lantern was taken meanwhile: the box must not move under it): the
   * view fades back in, and no placement is asked. The shell calls it on the "place" frame, at full dark; called
   * earlier in the fade-out it would fade back in from however dark the view is. Nothing to do in any other phase.
   */
  cancel(): void {
    if (this.phase !== "out") return;
    this.from = this.view.fadeNow;
    this.phase = "in";
    this.t0 = this.lastMs;
  }

  /** Back to idle at once, nothing shown (a new session, a phone's session). */
  reset(eye: Readonly<Vector3>): void {
    if (this.phase === "idle") return;
    this.phase = "idle";
    this.view.show(false);
    this.view.setFade(0, eye);
  }
}
