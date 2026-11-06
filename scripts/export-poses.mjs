#!/usr/bin/env node
// Prints the ghost hand's poses (src/lessons/poses.json) from IWER's hand pose library, the emulator the e2e tests
// drive (MIT licence): for each pose, its 25 joints (WebXR order) as positions in the wrist's own frame (metres, a
// left hand: fingers toward -z, palm toward -y, thumb toward +x), and the joint radii of the relaxed hand. A right
// hand is the same with x negated. Dev time only: run it on the build server and save what it prints.
//   scripts/remote.sh lessons -- node scripts/export-poses.mjs
import { libraryHandPoses } from "iwer/lib/device/configs/hand/library.js";
import { pinchHandPose } from "iwer/lib/device/configs/hand/pinch.js";
import { pointHandPose } from "iwer/lib/device/configs/hand/point.js";
import { relaxedHandPose } from "iwer/lib/device/configs/hand/relaxed.js";

const JOINTS = [
  "wrist",
  "thumb-metacarpal",
  "thumb-phalanx-proximal",
  "thumb-phalanx-distal",
  "thumb-tip",
  "index-finger-metacarpal",
  "index-finger-phalanx-proximal",
  "index-finger-phalanx-intermediate",
  "index-finger-phalanx-distal",
  "index-finger-tip",
  "middle-finger-metacarpal",
  "middle-finger-phalanx-proximal",
  "middle-finger-phalanx-intermediate",
  "middle-finger-phalanx-distal",
  "middle-finger-tip",
  "ring-finger-metacarpal",
  "ring-finger-phalanx-proximal",
  "ring-finger-phalanx-intermediate",
  "ring-finger-phalanx-distal",
  "ring-finger-tip",
  "pinky-finger-metacarpal",
  "pinky-finger-phalanx-proximal",
  "pinky-finger-phalanx-intermediate",
  "pinky-finger-phalanx-distal",
  "pinky-finger-tip",
];

const POSES = { open: libraryHandPoses.open, pinch: pinchHandPose, point: pointHandPose, relaxed: relaxedHandPose };
const round = (v) => Math.round(v * 1e5) / 1e5;

/** Joint positions in the wrist's frame: R^T (p - t), the wrist's offset being a rigid transform. */
function wristLocal(pose) {
  const w = pose.jointTransforms.wrist.offsetMatrix;
  const cols = [0, 4, 8].map((o) => [w[o], w[o + 1], w[o + 2]]);
  for (const [i, c] of cols.entries()) {
    const len = Math.hypot(...c);
    if (Math.abs(len - 1) > 1e-4) throw new Error(`wrist axis ${i} has length ${len}: not a rigid transform`);
  }
  const t = [w[12], w[13], w[14]];
  return JOINTS.flatMap((j) => {
    const m = pose.jointTransforms[j].offsetMatrix, d = [m[12] - t[0], m[13] - t[1], m[14] - t[2]];
    return cols.map((c) => round(c[0] * d[0] + c[1] * d[1] + c[2] * d[2]));
  });
}

const out = {
  source: "iwer 2.7.0 hand pose library (MIT): wrist-local joint positions, metres, left hand",
  joints: JOINTS,
  radius: JOINTS.map((j) => round(relaxedHandPose.jointTransforms[j].radius)),
  poses: Object.fromEntries(Object.entries(POSES).map(([k, p]) => [k, wristLocal(p)])),
};
// Sanity: the index finger points down -z (but in the pinch, where it curls to the thumb).
for (const [k, p] of Object.entries(out.poses)) {
  const tip = JOINTS.indexOf("index-finger-tip") * 3;
  if (k !== "pinch" && !(p[tip + 2] < -0.1)) throw new Error(`${k}: the index fingertip is not along -z (${p.slice(tip, tip + 3)})`);
}
process.stdout.write(JSON.stringify(out) + "\n");
