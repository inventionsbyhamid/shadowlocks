// The lantern feel's view of a box (LanternCtx): its spots, and its ring lines with each lock's rings lined up or
// not, worked out every frame from where the lantern is (ringOffset, with one RingAlign per lock so the line lock
// and the ring chime share one hysteresis). The lantern is kept in front of the box (LANTERN_MIN_Z). Arrays are
// made once per box; update allocates nothing.
import { RingAlign, ringOffset } from "../core/rings";
import type { Box, Lock, Ring, V3 } from "../core/types";
import { LANTERN_MIN_Z } from "./constants";
import type { LanternCtx, RingLine } from "./lantern-controller";

export class LanternCtxBuilder {
  /** The same object every frame; its arrays change only with the box. */
  readonly ctx: LanternCtx = { spots: [], lines: [], cmPerUnit: 24, minZ: LANTERN_MIN_Z };
  private rings: Ring[] = [];
  /** The locks with sight rings, in the order of `ctx.lines`. */
  private lineLocks: Lock[] = [];
  private aligns: RingAlign[] = [];

  /** The box played (none: no spots, no lines). Every lock starts closed. */
  setBox(box: Box | null): void {
    this.rings = box ? box.elements.filter((e): e is Ring => e.kind === "ring") : [];
    this.lineLocks = box ? box.locks.filter((l) => l.rings && l.mark !== null) : [];
    this.aligns = this.lineLocks.map(() => new RingAlign());
    this.ctx.spots = box ? box.locks.map((l) => ({ lock: l.i, L: [l.L[0], l.L[1], l.L[2]] as V3, open: false })) : [];
    this.ctx.lines = this.lineLocks.map(
      (l): RingLine => ({
        lock: l.i,
        // From the etched mark on the panel through the rings to the spot.
        mark: [l.mark![0], l.mark![1], 0],
        dir: [l.L[0] - l.mark![0], l.L[1] - l.mark![1], l.L[2]],
        aligned: false,
      }),
    );
  }

  /** A lock opened (or, restoring a box, was open): its spot and line no longer pull the lantern. */
  setOpen(lock: number, open: boolean): void {
    const spots = this.ctx.spots;
    for (let i = 0; i < spots.length; i++) if (spots[i]!.lock === lock) spots[i]!.open = open;
  }

  /** This frame's ctx with the lantern at `L` and `cmPerUnit` centimetres to a box unit. */
  update(L: V3, cmPerUnit: number): LanternCtx {
    this.ctx.cmPerUnit = cmPerUnit;
    const lines = this.ctx.lines;
    for (let i = 0; i < lines.length; i++) {
      lines[i]!.aligned = this.aligns[i]!.update(ringOffset(this.lineLocks[i]!, this.rings, L));
    }
    return this.ctx;
  }

  /** Whether a lock's rings are lined up this frame (false for a lock without rings). */
  aligned(lock: number): boolean {
    const lines = this.ctx.lines;
    for (let i = 0; i < lines.length; i++) if (lines[i]!.lock === lock) return lines[i]!.aligned;
    return false;
  }
}
