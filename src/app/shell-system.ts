// Per-frame shell work: place the box in the lap once per XR session (and again on Recenter), lay
// out what follows the placement, step the box's own motion and the theatre lights, and run debounced
// saves. Allocation-free per frame.
import { createSystem, Quaternion, Vector3 } from "@iwsdk/core";
import { placement, yawFromQuaternion } from "../render/placement";
import type { Shell } from "./shell";

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
  private placedFor: XRSession | null = null;
  private laidOut = -1;

  /**
   * Place the box from the current head pose (Recenter, and the test hooks); the box size stays. False
   * while the head is not tracked.
   */
  recenter(): boolean {
    if (!shell) return false;
    const head = this.world.player.head;
    head.getWorldPosition(this.headPos);
    head.getWorldQuaternion(this.headQuat);
    if (this.headPos.y < MIN_HEAD_Y_M) return false;
    const q = this.headQuat;
    this.headPose.position[0] = this.headPos.x;
    this.headPose.position[1] = this.headPos.y;
    this.headPose.position[2] = this.headPos.z;
    this.headPose.yaw = yawFromQuaternion(q.x, q.y, q.z, q.w);
    placement.start(this.headPose);
    return true;
  }

  update(delta: number): void {
    const s = shell;
    if (!s) return;
    const now = performance.now();
    const xrSession = this.world.session ?? null;
    // Once per XR session, on its first frame with a tracked head: place the box, and compile every shader for the
    // session's render target (set only inside its frames) so nothing compiles the first time it shows.
    if (xrSession && this.placedFor !== xrSession && this.world.xrFrame && this.recenter()) {
      this.placedFor = xrSession;
      s.recenterAsked = false;
      void s.prewarm();
    }
    // A Recenter waits for a frame with a tracked head.
    if (s.recenterAsked && this.recenter()) s.recenterAsked = false;
    if (placement.version !== this.laidOut) {
      this.laidOut = placement.version;
      s.layout();
    }
    const dt = Math.min(Math.max(delta, 0), 0.1);
    s.box.update(dt);
    // The theatre's veil stays round the head wherever it goes.
    s.theatre.update(dt, this.world.player.head.getWorldPosition(this.headPos));
    s.lifecycle.tick(now);
  }
}
