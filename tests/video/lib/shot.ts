// What a shot script is: an unrecorded setup that gets the game where the shot starts, then a
// recorded play() that moves the camera, the hands and the game on a 60 fps virtual clock.
import type { Page } from "@playwright/test";
import type { MusicState } from "../../../src/audio/manifest";
import type { NsButton, NsState } from "../../../src/app/test-api";
import type { Vec3 } from "../../../src/core/types";
import type { Room } from "../../e2e/helpers/boot";
import { Hands, type Side } from "../../e2e/helpers/hands";
import type { XYZ } from "../../e2e/helpers/page-scripts";
import { POKE_DEPTH_M } from "../../e2e/helpers/xr-app";
import { type Ease, minimumJerk, type Sway, type View } from "./camera";
import type { VideoApp } from "./recorder";

type Point = Vec3 | XYZ;
const xyz = (p: Point): XYZ => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : (p as XYZ));

/** IWER hand orientation: a quaternion, euler, `{ fingers, palm }` directions or "auto". */
export type HandOrientation = unknown;

/**
 * The e2e `Hands` plus the smooth moves a shot needs: no jumps on camera. `moveTo` and `release`
 * from `Hands` work as they are (while recording, gestures chain without extra frames).
 */
export class ShotHand extends Hands {
  /** Before recording: put the open hand at `p` (grasp point), off camera. */
  async park(p: Point, orientation: HandOrientation = "auto"): Promise<void> {
    const device = this.device;
    await this.usePose("default");
    await this.app.queue("set_select_value", { device, value: 0 });
    await this.app.queue("set_transform", { device, anchor: "grasp", position: xyz(p), orientation });
    await this.app.settle();
  }

  /** Glide the grasp point to `p` in `ms`, turning to `orientation` on the way (minimum jerk). */
  async glide(p: Point, ms: number, orientation?: HandOrientation): Promise<void> {
    await this.app.queue("animate_to", {
      device: this.device,
      anchor: "grasp",
      position: xyz(p),
      ...(orientation === undefined ? {} : { orientation }),
      duration: ms / 1000,
      easing: "minimum-jerk",
    });
    await this.app.settle();
  }

  /** Close thumb and index over `ms` where the hand is (a grab when the grasp point is on the lantern). */
  async pinch(ms = 140): Promise<void> {
    await this.app.queue("set_select_value", { device: this.device, value: 1, duration: ms / 1000 });
    await this.app.settle();
  }

  /** Turn to the pointing pose (index out) over `ms`, for pokes. */
  async point(ms = 220): Promise<void> {
    await this.app.queue("set_hand_pose", { device: this.device, poseId: "point", duration: ms / 1000 });
    await this.app.settle();
    await this.usePose("point");
  }

  /**
   * A hand ready to pick up something small, over `ms`: the middle, ring and little fingers curled in
   * (as in the point pose), the thumb and index free for the pinch (which closes only those two).
   */
  async gripPose(ms = 160): Promise<void> {
    await this.usePose("default");
    await this.app.queue("set_hand_pose", {
      device: this.device,
      poseId: "default",
      fingers: { middle: "point", ring: "point", pinky: "point" },
      duration: ms / 1000,
    });
    await this.app.settle();
    // Not a named pose: the next usePose sets its pose again.
    this.pose = null;
  }

  /** Back to the relaxed open hand over `ms`. */
  async relax(ms = 220): Promise<void> {
    await this.app.queue("set_hand_pose", { device: this.device, poseId: "default", duration: ms / 1000 });
    await this.app.settle();
    await this.usePose("default");
  }

  /** Glide the index fingertip to `p` in `ms` (minimum jerk), turning to `orientation` (default: kept). */
  async glideTip(p: Point, ms: number, orientation?: HandOrientation): Promise<void> {
    await this.app.queue("animate_to", {
      device: this.device,
      anchor: "index-tip",
      position: xyz(p),
      ...(orientation === undefined ? {} : { orientation }),
      duration: ms / 1000,
      easing: "minimum-jerk",
    });
    await this.app.settle();
  }

  /**
   * Set the pinch to `value` over `ms` without closing it: 0.5 opens the thumb and index to about a
   * 5 cm grip (IWER's own preshape for a reach), far from the game's 1.5 cm pinch and under the 0.9
   * select press.
   */
  async shape(value: number, ms = 160): Promise<void> {
    await this.app.queue("set_select_value", { device: this.device, value, duration: ms / 1000 });
    await this.app.settle();
  }

  /**
   * Carry the grasp point along a path: `at(k)` for k from 0 to 1, eased (minimum jerk) over `ms`, set frame by frame
   * at the shot's rate, so a curve (an arc) is followed smoothly instead of as straight glides that stop at each
   * corner. `orientation` (default kept) is held throughout. Grip and pinch are left as they are.
   */
  async follow(at: (k: number) => Point, ms: number, orientation?: HandOrientation, anchor: "grasp" | "index-tip" = "grasp"): Promise<void> {
    const app = this.app as unknown as VideoApp;
    const fps = app.fps();
    const n = Math.max(1, Math.round((ms / 1000) * fps));
    for (let i = 1; i <= n; i++) {
      const k = minimumJerk(i / n);
      await app.queue("set_transform", {
        device: this.device,
        anchor,
        position: xyz(at(k)),
        ...(orientation === undefined ? {} : { orientation }),
      });
      await app.step(1);
    }
    await this.app.settle();
  }

  /** Open the hand over `ms`. */
  async open(ms = 160): Promise<void> {
    await this.app.queue("set_select_value", { device: this.device, value: 0, duration: ms / 1000 });
    await this.app.settle();
  }

  /**
   * The e2e multi-tap poke steps the clock in the page, which a video render forbids (it would skip
   * the wait for async work): here the taps are stepped through the app, 5 ms a frame in setup and
   * at the video rate while recording. One tap is the e2e poke as it is.
   */
  override async poke(buttonId: string, o: { times?: number; gapMs?: number } = {}): Promise<NsButton> {
    const times = o.times ?? 1;
    if (times === 1) return super.poke(buttonId, o);
    const device = this.device;
    await this.usePose("point");
    await this.app.stepUntil((ns) => !ns.ui?.busy?.(), { maxMs: 5_000, label: "menus at rest" });
    const s = await this.app.state();
    const b = s.buttons.find((x) => x.id === buttonId);
    if (!b) throw new Error(`no button "${buttonId}" on screen "${s.screen}"`);
    const along = (k: number): XYZ => ({ x: b.world[0] + b.normal[0] * k, y: b.world[1] + b.normal[1] * k, z: b.world[2] + b.normal[2] * k });
    const half = (o.gapMs ?? 80) / 2000;
    await this.app.queue("set_transform", { device, anchor: "index-tip", position: along(0.05), orientation: "auto" });
    await this.app.settle(10_000, 2);
    for (let i = 0; i < times; i++) {
      await this.app.queue("animate_to", { device, anchor: "index-tip", position: along(POKE_DEPTH_M), duration: half });
      await this.app.queue("animate_to", { device, anchor: "index-tip", position: along(0.05), duration: half });
    }
    await this.app.queue("animate_to", { device, anchor: "index-tip", position: along(0.08), duration: 0.1 });
    await this.app.stepUntil((_ns, w) => w.IWER_DEVICE.remote.queueLength === 0, { dt: 5, maxMs: 10_000, label: "taps done" });
    await this.app.settle();
    return b;
  }
}

export interface SetupContext {
  app: VideoApp;
  page: Page;
  /** Hands to park before recording (the same objects play() gets). */
  hand(side: Side): ShotHand;
}

export interface PlayContext {
  app: VideoApp;
  page: Page;
  /** Shot time of the next frame, seconds. */
  time(): number;
  camera: {
    /** Jump to a view now. */
    cut(view: View): void;
    /** Ease to a view, starting now (does not wait: frames record while it runs). */
    move(view: View, ms: number, ease?: Ease): void;
    /** The view now. */
    view(): View;
  };
  hand(side: Side): ShotHand;
  /** Record frames for `ms` of shot time. */
  wait(ms: number): Promise<void>;
  /** Record frames until shot time `seconds`. */
  until(seconds: number): Promise<void>;
  state(): Promise<NsState>;
}

export interface Shot<S = unknown> {
  name: string;
  /** One line on what the viewer sees. */
  description: string;
  /** About how long the shot runs (progress and ETA lines). */
  seconds?: number;
  /**
   * Virtual time (ms) the clock is lined up on after boot, before setup (default 30 000): the same
   * in every run whatever boot took. Raise it if boot ever runs past it.
   */
  startMs?: number;
  /** Date and time in the page (default the e2e DEFAULT_DATE); `Date` then follows the frame clock. */
  date?: string;
  /**
   * The player's history when the shot starts (boxes opened, a streak, the collection), as a stored
   * profile (it goes through the app's migration, so missing fields take their defaults). Video
   * builds only.
   */
  profile?: Record<string, unknown>;
  room?: Room;
  /** Head pose at boot (the box is placed from it). Default: seated in the home office chair (e2e SEATED). */
  head?: { position: XYZ; lookAt: XYZ };
  /** Unrecorded: boot is done; get the game, hands and box where the shot starts. */
  setup(ctx: SetupContext): Promise<S>;
  /** The camera's view on the first frame. */
  firstView(data: S): View;
  /** Slow natural head drift (default 1.5 mm, 0.12 degrees). */
  sway?: Sway;
  /** Recorded. */
  play(ctx: PlayContext, data: S): Promise<void>;
  audio?: {
    /** Music already playing on the first frame (default: from the screen then). */
    music?: MusicState;
    /** Seconds into the loop on the first frame. */
    musicOffsetSec?: number;
    /** The virtual room's room tone (VR shots). */
    ambience?: boolean;
  };
  /** Keep IWSDK's outline hands instead of the see-through system hands. */
  outlineHands?: boolean;
  /**
   * The dark stage (page-video.ts darkStage): no room drawn, the Dim room setting off, a flat warm near-black
   * (DARK_BACKDROP) or the given colour where the room would be. The box lit by its own lantern, as the store art.
   */
  darkStage?: boolean | { backdrop: string };
  /** Leave the hint lantern (the brass key beside the frame) out of the picture: the film's explainer only. */
  hideHint?: boolean;
}

/** The dark stage's backdrop: a deep warm near-black, so the brass and the lantern's light carry the frame. */
export const DARK_BACKDROP = "#120d0a";

export const defineShot = <S>(shot: Shot<S>): Shot<S> => shot;
