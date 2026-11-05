// Both fingertips once per XR frame, shared by every fingertip key. The source is the render module's
// `xrFingertips` (src/render/fingertips.ts): only really tracked fingertips count, so a key pressed
// when tracking was lost is let go.
import { Vector3, type World } from "@iwsdk/core";
import { type FingertipSource, xrFingertips } from "../render/fingertips";
import type { Tips } from "./key-view";

export type { FingertipSource } from "../render/fingertips";

interface XrLike {
  getFrame?(): XRFrame | null;
}

/** Both fingertips, read once per XR frame from a FingertipSource and shared. Allocation free. */
export class FrameTips implements Tips {
  readonly points = [new Vector3(), new Vector3()];
  count = 0;
  private lastFrame: unknown = null;
  private readonly xr: XrLike | undefined;

  constructor(
    world: World,
    private readonly source: FingertipSource = xrFingertips(world),
  ) {
    this.xr = (world as unknown as { renderer?: { xr?: XrLike } }).renderer?.xr;
  }

  read(): this {
    const frame = this.xr?.getFrame?.() ?? null;
    if (frame !== null && frame === this.lastFrame) return this;
    this.lastFrame = frame;
    this.count = 0;
    for (let h = 0; h < 2; h++) {
      if (this.source.read(h, this.points[this.count] as Vector3)) this.count++;
    }
    return this;
  }
}

let shared: FrameTips | null = null;

/** The app's fingertips for this frame (one reader for every key). */
export function frameTips(world: World): FrameTips {
  shared ??= new FrameTips(world);
  return shared;
}
