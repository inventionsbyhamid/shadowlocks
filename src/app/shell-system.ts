// Per-frame shell work: place the box in the lap (on a phone, in the camera's view) once per XR session
// (and again on Recenter), lay out what follows the placement, step the box's own motion and the theatre
// lights, and run debounced saves. Allocation-free per frame.
//
// The first placement of a session waits for a steady head (a phone's camera): held still 0.4 s in a looking pose, 2.5 s
// at most (PlaceGate). Until then the box and its panels are hidden and nothing in the box runs or can be taken
// (Shell.hideUntilPlaced), so nothing stands where the head or phone happened to point as the session started, and
// nothing moves in front of the player. A headset's first placement is from where the eyes will be while the player
// looks at the box (Placement.start with the head's pitch), so it lands in the same place whatever the head did then.
//
// Once placed, a box out of view (lost-box.ts): a phone's comes back in front by itself after 2 s, held still, with no
// touch down and the lantern not held, on the frame that is decided ("box out of view: placed again" in the console); a
// headset's never moves by itself, an arrow at the edge of the view points to it instead (not while the lantern is
// held), and a pinch or poke on the arrow brings it in front with a short fade (summon.ts), which always ends: the head
// tracked or not, and called off if the lantern is taken meanwhile. Quest's own recenter (the reference space's reset)
// and the Settings key place it at once.
import { createSystem, Quaternion, Vector3 } from "@iwsdk/core";
import { hands } from "../input/grab-system";
import { BOX_SPHERE, boxInView, type LostInput, LostBox } from "../render/lost-box";
import {
  PHONE_VIEW,
  PlaceGate,
  pitchFromQuaternion,
  placement,
  type ViewTangents,
  viewOf,
  wideViewOf,
  yawFromQuaternion,
} from "../render/placement";
import type { Shell } from "./shell";
import { onPhone, touchBusy } from "./touch-system";

let shell: Shell | null = null;

/** Hand the shell to the system (systems cannot take constructor arguments). */
export function useShell(s: Shell): void {
  shell = s;
}

/** Below this the head is not tracked yet (it sits at the origin): never place from it. */
const MIN_HEAD_Y_M = 0.2;

export class ShellSystem extends createSystem({}) {
  private readonly headPos = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly headPose = { position: [0, 0, 0] as [number, number, number], yaw: 0 };
  private readonly view: ViewTangents = { tanH: PHONE_VIEW.tanH, tanV: PHONE_VIEW.tanV };
  private readonly wide: ViewTangents = { tanH: PHONE_VIEW.tanH, tanV: PHONE_VIEW.tanV };
  private readonly forward = new Vector3();
  private readonly boxMid = new Vector3();
  /** The last tracked head (the fade stays round it while the head is not tracked). */
  private readonly lastEye = new Vector3();
  private readonly lastTurn = new Quaternion();
  /** The steady pose the first placement waits for, and a phone's re-place. */
  readonly gate = new PlaceGate();
  /** How long the box has been out of view, and what then. */
  readonly lost = new LostBox();
  private readonly lostIn: LostInput = { phone: false, steady: false, touchDown: false, held: false, pinchDown: false };
  private placedFor: XRSession | null = null;
  /** The session the gate and the lost box were last started for. */
  private watchedFor: XRSession | null = null;
  /** The box and its panels are hidden, waiting for the first placement. */
  private hidden = false;
  private laidOut = -1;

  /**
   * The head's (a phone camera's) world pose into headPos and headQuat; false while it is not tracked. A phone held low
   * (sitting at a table) can be lower than a seated head: only a head at the origin is untracked.
   */
  private readHead(phone: boolean): boolean {
    const head = this.world.player.head;
    head.getWorldPosition(this.headPos);
    head.getWorldQuaternion(this.headQuat);
    return phone ? this.headPos.lengthSq() !== 0 : this.headPos.y >= MIN_HEAD_Y_M;
  }

  /**
   * Place the box from the current head pose (Recenter, and the test hooks); the box size stays. False
   * while the head is not tracked. A phone's session (the touch system tells, earlier in the frame) places it
   * in the camera's view instead of the lap, as far as the camera's own projection needs to show it whole. A headset's
   * `first` placement of a session is from where the eyes will be while the player looks at the box (Placement.start's
   * pitch): placed while looking steeply down, the box still lands within the comfort envelope.
   */
  recenter(first = false): boolean {
    if (!shell) return false;
    const phone = onPhone();
    if (!this.readHead(phone)) return false;
    const q = this.headQuat;
    this.headPose.position[0] = this.headPos.x;
    this.headPose.position[1] = this.headPos.y;
    this.headPose.position[2] = this.headPos.z;
    this.headPose.yaw = yawFromQuaternion(q.x, q.y, q.z, q.w);
    if (phone) placement.startInView(this.headPose, pitchFromQuaternion(q.x, q.y, q.z, q.w), this.cameraView());
    else if (first) placement.start(this.headPose, pitchFromQuaternion(q.x, q.y, q.z, q.w));
    else placement.start(this.headPose);
    return true;
  }

  /**
   * The XR camera's view as half-angle tangents, from this frame's projection (three sets it from the session's view
   * before our systems run), the narrower side each way (viewOf). A phone's default where the projection is not there
   * yet.
   */
  private cameraView(): ViewTangents {
    return viewOf(this.projection(), this.view);
  }

  /** The same, the wider side each way (wideViewOf): about both eyes' view together, for whether the box can be seen. */
  private seenView(): ViewTangents {
    return wideViewOf(this.projection(), this.wide);
  }

  private projection(): ArrayLike<number> | undefined {
    const xr = this.renderer.xr.getCamera() as { cameras?: { projectionMatrix: { elements: ArrayLike<number> } }[] };
    return xr.cameras?.[0]?.projectionMatrix.elements;
  }

  /** Hide or show the box and its panels (only on a change: the test hooks may hide the box themselves). */
  private hide(on: boolean): void {
    if (on === this.hidden || !shell) return;
    this.hidden = on;
    shell.hideUntilPlaced(on);
  }

  update(delta: number): void {
    const s = shell;
    if (!s) return;
    const now = performance.now();
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const xrSession = this.world.session ?? null;
    const phone = onPhone();
    // A new session (or none): the steady gate, the lost box and the summon start afresh.
    if (xrSession !== this.watchedFor) {
      this.watchedFor = xrSession;
      this.gate.reset();
      this.lost.reset();
      s.summon.reset(this.headPos);
    }
    const tracked = !!xrSession && !!this.world.xrFrame && this.readHead(phone);
    if (tracked) this.gate.update(now, this.forward.set(0, 0, -1).applyQuaternion(this.headQuat));
    // Once per XR session, once the head (a phone's camera) has held still in a looking pose (or the gate's cap has
    // passed): place the box, show it, and compile every shader for the session's render target (set only inside its
    // frames) so nothing compiles the first time it shows. Until then the box and its panels are hidden.
    const waiting = !!xrSession && this.placedFor !== xrSession;
    this.hide(waiting);
    if (waiting && tracked && this.gate.ready && this.recenter(true)) {
      this.placedFor = xrSession;
      s.recenterAsked = false;
      this.hide(false);
      void s.prewarm();
    }
    // Until then, a Recenter (or Quest's own) waits for that first placement, which is one.
    if (!waiting) {
      // Placed for the other kind of session: a phone whose browser does not say it is one, known by its first touch
      // (the box in the lap is below its view), or a session that turned out not to be a phone's after all (a hand or
      // a controller appeared). Placed again the right way.
      if (xrSession && placement.source !== "default" && (placement.source === "view") !== phone) s.recenterAsked = true;
      // A Recenter waits for a frame with a tracked head.
      if (s.recenterAsked && this.recenter()) s.recenterAsked = false;
      if (xrSession) this.watchLost(s, now, phone, tracked);
    }
    if (placement.version !== this.laidOut) {
      this.laidOut = placement.version;
      s.layout();
    }
    s.box.update(dt);
    // The theatre's veil stays round the head wherever it goes.
    s.theatre.update(dt, this.world.player.head.getWorldPosition(this.headPos));
    s.lifecycle.tick(now);
  }

  /**
   * The placed box out of view, every frame of a placed session (`tracked`: the head is, and headPos and headQuat hold
   * it): a phone's placed again in front, on the frame that is decided (held still, no touch down, the lantern not
   * held); a headset's arrow toward it and the summon it starts (lost-box.ts, summon.ts). The summon steps on every
   * frame, so its fade always ends, and it never moves the box under a held lantern.
   */
  private watchLost(s: Shell, now: number, phone: boolean, tracked: boolean): void {
    const held = s.lanternHeld();
    if (tracked) {
      this.lastEye.copy(this.headPos);
      this.lastTurn.copy(this.headQuat);
      const inView = boxInView(placement.matrix(), this.headPos, this.headQuat, this.seenView());
      const L = this.lostIn;
      L.phone = phone;
      L.steady = this.gate.steady;
      L.touchDown = touchBusy();
      L.held = held;
      L.pinchDown = hands[0].pinching || hands[1].pinching;
      // Asked only with no touch down and the lantern not held this frame (the touch and lantern systems ran first):
      // placed now, on this frame, so nothing starts under it before it moves.
      if (this.lost.update(now, inView, L) && this.recenter()) console.info("box out of view: placed again");
    }
    if (phone) {
      s.summon.reset(this.lastEye);
      return;
    }
    const c = BOX_SPHERE.center;
    this.boxMid.set(c[0], c[1], c[2]).applyMatrix4(placement.matrix());
    // The arrow is offered only while the head is tracked and the lantern is not held (a pinch on it while the other
    // hand holds the lantern would move the box under it).
    const step = s.summon.update(now, tracked && this.lost.arrow && !held, this.lastEye, this.lastTurn, this.boxMid);
    if (step === "taken") this.lost.reset();
    else if (step === "place") {
      // The lantern taken while the view faded: called off, the box stays. Not tracked: it waits, dark, at most
      // SUMMON.holdMaxMs, then the view comes back anyway.
      if (held) s.summon.cancel();
      else {
        const ok = tracked && this.recenter();
        if (ok) {
          s.recenterAsked = false;
          console.info("box out of view: brought back by the arrow");
        }
        s.summon.placed(ok, now);
      }
    }
  }
}
