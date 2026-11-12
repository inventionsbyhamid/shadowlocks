// A shot's sidecar JSON: what was rendered, from which versions, and everything a re-mix or an edit
// needs. Shared by the frame renderer (shoot.ts) and the sound, delivery and edit code (deliver.ts).
import fs from "node:fs";
import path from "node:path";
import type { Duck, FrameEvents, MixPlan } from "./audio";
import type { Ebur128 } from "./loudness";
import type { VideoOptions } from "./options";

export const shotFile = (name: string): string => path.join("tests/video/shots", `${name}.ts`);

export interface ShotRecord {
  shot: string;
  frameVersion: string;
  mixVersion: string;
  imageId: string;
  width: number;
  height: number;
  fps: number;
  hfovDeg: number;
  /** The delivery size (frames are drawn at width x height); absent in older records: the render size. */
  outWidth?: number;
  outHeight?: number;
  frames: number;
  duration: number;
  /** Delivery encode settings this MP4 was made with. */
  quality: string;
  crf: number;
  preset: string;
  mp4: string;
  contact: string;
  stills: string[];
  /** On the server (cache): the lossless picture and the effects stem. */
  mezz: string;
  fx: string;
  /** Every bus event with its frame time, head pose and buttons: the sound is re-made from these. */
  events: FrameEvents[];
  music: MixPlan["music"];
  ambience: boolean;
  ducks: Duck[];
  cues: MixPlan["log"];
  loudness: Ebur128 | null;
  stats: Record<string, unknown>;
}

export const sidecar = (o: VideoOptions, name: string): string => path.join(o.outDir, `${name}.json`);

export function readRecord(o: VideoOptions, name: string): ShotRecord | null {
  try {
    return JSON.parse(fs.readFileSync(sidecar(o, name), "utf8")) as ShotRecord;
  } catch {
    return null;
  }
}

export function writeRecord(o: VideoOptions, r: ShotRecord): void {
  fs.writeFileSync(sidecar(o, r.shot), JSON.stringify(r, null, 2));
}
