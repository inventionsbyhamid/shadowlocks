// The seated comfort envelope, in box units (the back panel is z = 0, x and y in [-0.5, 0.5], the open front z = 1).
// Every number that decides where a player's hand has to go lives here and nowhere else: the comfort spike tunes this
// file, then the generator tests re-run against it.

export const ENVELOPE = {
  /** Lantern spots' distance from the panel: in front of the box mouth, and no closer to the eyes than this. */
  LZ: [1.15, 1.6],
  /** The furthest a spot goes left or right of the box centre (each box uses `amp` of it). */
  LX_MAX: 0.45,
  /**
   * Spots' height: below the box centre, so the hand stays at sternum height or lower (25 cm under the eyes). The
   * box leans back 10 degrees (render/placement.ts), which lifts a spot Lz * sin(10 deg) above this, so the top
   * stays 0.19 under the centre; the comfort spike checks it at box sizes 18-30 cm (tests/e2e/comfort.spec.ts).
   */
  LY: [-0.45, -0.19],
  /** Where the lantern starts, right of centre for a right-handed player (mirrored boxes negate x). */
  START: [0.35, -0.3, 1.35],
  /** How deep scraps and rings hang: off the panel and back from the box mouth. */
  PIECE_Z: [0.15, 0.75],
  /** The least distance between two spots, and between a spot and the start. */
  SPOT_MIN_SEP: 0.32,
  /** Scraps and rings stay this far from the box's centre line in x and y (clear of the walls). */
  IN_BOX_XY: 0.47,
} as const;
