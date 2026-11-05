// Per-instance attributes that are rewritten every frame but uploaded only when something changed,
// and then only for the instances in use.
import { DynamicDrawUsage, InstancedBufferAttribute } from "@iwsdk/core";

/**
 * An instanced attribute with one persistent update range. three.js clears an attribute's update
 * ranges after every upload, so adding a range per frame would allocate a range object each time;
 * this keeps one range and only moves its end. Mark changes with `commit(used)`.
 */
export class LiveAttribute extends InstancedBufferAttribute {
  private readonly range = { start: 0, count: 0 };

  constructor(array: Float32Array, itemSize: number) {
    super(array, itemSize);
    this.setUsage(DynamicDrawUsage);
    this.updateRanges.push(this.range);
  }

  /** Kept on purpose: the single range is reused (see the class comment). */
  override clearUpdateRanges(): void {}

  /** Upload items [0, used) with the next frame. Nothing to do for 0. */
  commit(used: number): void {
    if (used <= 0) return;
    this.range.count = used * this.itemSize;
    this.needsUpdate = true;
  }
}

