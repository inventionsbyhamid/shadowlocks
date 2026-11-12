// The head's world matrix, read as it stands: no world matrix update of its own. It is already what
// head.updateWorldMatrix(true, false) would make it, for every reader after IWSDK's input system (priority -4) in a
// frame, and between frames:
//   - In a session's frame the input system sets the head from the viewer pose (XROrigin.updateHead) and then calls
//     xrOrigin.updateMatrixWorld(true), which brings the player rig (world.player) and the head under it up to date
//     from the scene (xr-input-manager.js). Every app system runs after it (priority -3.3 and later).
//   - Nothing else moves the head, the player rig or the scene: no file in src writes their position, turn, scale or
//     matrix, or reparents them; the scene stays at the origin. IWSDK's only other movers are its locomotion system
//     (priority -5, before the input system, and not enabled here) and level loading (not used here); its transform
//     system (priority 0) only reparents objects whose Transform parent changed.
//   - With no session, or a frame with no reference space, the input system leaves the head where it was; its matrix
//     was last made from that same pose (the input system or the renderer's scene update), so it still holds.
// Readers: the gaze (game), the shell's head read and the theatre's veil, the sound listener.
import type { Matrix4, Object3D } from "@iwsdk/core";

/** The head's world matrix for this frame (see the module comment). Read it; never write it. */
export function headWorld(head: Object3D): Readonly<Matrix4> {
  return head.matrixWorld;
}
