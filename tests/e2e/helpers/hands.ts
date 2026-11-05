/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NsButton } from "../../../src/app/test-api";
import type { Vec3 } from "../../../src/core/types";
import type { XYZ } from "./page-scripts";
import { POKE_DEPTH_M, type XrApp } from "./xr-app";

export type Side = "left" | "right";
type Point = Vec3 | XYZ;

const xyz = (p: Point): XYZ => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p);
const along = (b: NsButton, k: number): XYZ => ({
  x: b.world[0] + b.normal[0] * k,
  y: b.world[1] + b.normal[1] * k,
  z: b.world[2] + b.normal[2] * k,
});

/**
 * One scripted hand on IWER's remote API (`IWER_DEVICE.remote.dispatch`). Each gesture queues its
 * commands, then steps the virtual clock until IWER's queue is empty. Positions are world metres.
 *
 * ```ts
 * const hand = new Hands(app, "left");
 * await hand.pinchAt(lantern);        // open hand comes down on it and pinches
 * await hand.moveTo(spot, 500);       // carry it there in 500 ms
 * await hand.release();
 * await hand.lose(400);                // out of tracking for 400 ms
 * ```
 */
export class Hands {
  /** The pose last set through usePose (null: unknown, set again on the next use). */
  protected pose: string | null = null;
  /** The pinch value this helper last set. */
  private select = 0;
  /** Where this helper last put the grasp point. */
  private at: XYZ | null = null;

  constructor(
    readonly app: XrApp,
    readonly side: Side = "right",
  ) {}

  get device(): string {
    return `hand-${this.side}`;
  }

  /**
   * Bring the open hand down onto `p` from 8 cm above and pinch there: the grasp point (between the
   * thumb and index tips) ends at `p`. `orientation` is IWER's (default "auto"), e.g.
   * `{ fingers: { x: 0, y: 0, z: -1 }, palm: { x: 0, y: -1, z: 0 } }` for fingers forward, palm down.
   */
  async pinchAt(p: Point, o: { ms?: number; orientation?: unknown; pinch?: boolean } = {}): Promise<void> {
    const at = xyz(p);
    this.at = at;
    await this.usePose("default");
    await this.app.queue("set_select_value", { device: this.device, value: 0 });
    await this.app.queue("set_transform", {
      device: this.device,
      anchor: "grasp",
      position: { x: at.x, y: at.y + 0.08, z: at.z + 0.02 },
      orientation: o.orientation ?? "auto",
    });
    await this.app.queue("animate_to", {
      device: this.device,
      anchor: "grasp",
      position: at,
      duration: (o.ms ?? 250) / 1000,
      easing: "minimum-jerk",
    });
    if (o.pinch !== false) {
      await this.app.queue("set_select_value", { device: this.device, value: 1, duration: 0.12 });
      this.select = 1;
    }
    await this.app.settle();
  }

  /**
   * Turn the hand to `orientation` (IWER's: quaternion, euler or `{ fingers, palm }`) in `ms`, the
   * grasp point staying where it is: the fingertips stay, the wrist swings round them.
   */
  async turn(orientation: unknown, ms: number): Promise<void> {
    if (!this.at) throw new Error("turn() needs pinchAt() or moveTo() first");
    await this.app.queue("animate_to", {
      device: this.device,
      anchor: "grasp",
      position: this.at,
      orientation,
      duration: ms / 1000,
      easing: "minimum-jerk",
    });
    await this.app.settle();
  }

  /** A quick pinch and let go (a tap), `ms` apart. */
  async tap(ms = 60): Promise<void> {
    await this.app.queue("set_select_value", { device: this.device, value: 1 });
    await this.app.settle(10_000, 0);
    await this.app.stepUntil((_ns, w, end) => w.__vt.now >= end, { arg: (await this.app.now()) + ms, batch: 1, label: "tap" });
    await this.app.queue("set_select_value", { device: this.device, value: 0 });
    await this.app.settle();
    this.select = 0;
  }

  /** Move the grasp point (and whatever the hand holds) to `p` in `ms`. */
  async moveTo(p: Point, ms: number): Promise<void> {
    this.at = xyz(p);
    await this.app.queue("animate_to", {
      device: this.device,
      anchor: "grasp",
      position: this.at,
      duration: ms / 1000,
      easing: "minimum-jerk",
    });
    await this.app.settle();
  }

  /** Open the hand. With `settle: false` the command is only queued; the test steps the frames. */
  async release(o: { settle?: boolean } = {}): Promise<void> {
    await this.app.queue("set_select_value", { device: this.device, value: 0 });
    this.select = 0;
    if (o.settle !== false) await this.app.settle();
  }

  /**
   * Poke a button of the current screen with the index fingertip. With `times > 1` the fingertip goes
   * in and out `times` times, entries `gapMs` apart, all stepped in one go (nothing else, such as the
   * box worker, runs in between).
   */
  async poke(buttonId: string, o: { times?: number; gapMs?: number } = {}): Promise<NsButton> {
    const times = o.times ?? 1;
    await this.usePose("point");
    if (times === 1) return this.app.poke(buttonId, { hand: this.side });
    // Like app.poke: panels spring in, so aim only once they are at rest.
    await this.app.stepUntil((ns) => !ns.ui.busy(), { maxMs: 5_000, label: "menus at rest" });
    const s = await this.app.state();
    const b = s.buttons.find((x) => x.id === buttonId);
    if (!b) throw new Error(`no button "${buttonId}" on screen "${s.screen}"`);
    const half = (o.gapMs ?? 80) / 2000;
    await this.app.queue("set_transform", { device: this.device, anchor: "index-tip", position: along(b, 0.05), orientation: "auto" });
    await this.app.settle(10_000, 2);
    for (let i = 0; i < times; i++) {
      await this.app.queue("animate_to", { device: this.device, anchor: "index-tip", position: along(b, POKE_DEPTH_M), duration: half });
      await this.app.queue("animate_to", { device: this.device, anchor: "index-tip", position: along(b, 0.05), duration: half });
    }
    await this.app.queue("animate_to", { device: this.device, anchor: "index-tip", position: along(b, 0.08), duration: 0.1 });
    await this.app.page.evaluate(() => {
      const w = window as any;
      for (let n = 0; w.IWER_DEVICE.remote.queueLength > 0 && n < 1000; n++) w.__vt.step(5);
    });
    await this.app.settle();
    return b;
  }

  /**
   * Take the hand out of tracking (as when it leaves the cameras' view); returns the virtual time of
   * the frame that did it. Steps one frame at a time, so the time is exact to a frame.
   */
  async disconnect(): Promise<number> {
    await this.setConnected(false);
    return this.app.now();
  }

  /** Back in tracking; `select` restores the pinch in the same frame (default: as IWER left it, open). */
  async reconnect(o: { select?: number } = {}): Promise<void> {
    if (o.select !== undefined) await this.app.queue("set_select_value", { device: this.device, value: o.select });
    await this.setConnected(true);
    await this.app.step(2);
  }

  private async setConnected(connected: boolean): Promise<void> {
    await this.app.queue("set_connected", { device: this.device, connected });
    await this.app.stepUntil((_ns, w) => w.IWER_DEVICE.remote.queueLength === 0, {
      batch: 1,
      maxMs: 1_000,
      label: `hand ${connected ? "back in" : "out of"} tracking`,
    });
  }

  /**
   * Out of tracking for `ms` of virtual time, then back with the same pinch (IWER zeroes a hand's
   * pinch when it disconnects; a real hand keeps its shape while the cameras miss it).
   */
  async lose(ms: number): Promise<void> {
    const t0 = await this.disconnect();
    await this.app.stepUntil((_ns, w, end) => w.__vt.now >= end, { arg: t0 + ms, maxMs: ms + 1000, batch: 1, label: "hand out of tracking" });
    await this.reconnect({ select: this.select });
  }

  /** Hand tracking on, this hand connected and in pose `poseId` (kept, so repeats are free). */
  protected async usePose(poseId: string): Promise<void> {
    if (this.pose === poseId) return;
    await this.app.queue("set_input_mode", { mode: "hand" });
    await this.app.queue("set_connected", { device: this.device, connected: true });
    await this.app.queue("set_hand_pose", { device: this.device, poseId });
    this.pose = poseId;
  }
}
