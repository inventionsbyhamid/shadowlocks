/** A point or direction: world metres, or box units where a name says so. */
export type Vec3 = [number, number, number];

/** A point on the back panel (z = 0), in box units. */
export type V2 = [number, number];
/** A point in the box, in box units: the panel is z = 0, the open front z = 1. */
export type V3 = [number, number, number];

/** The shapes etched as outlines: icons a player matches by eye. */
export type ClassicShape = "Key" | "Star" | "Moon" | "Diamond" | "Crown" | "Arrow" | "Hourglass";
/** The first silhouettes (generator version 3 and before). */
export type FirstSilhouette = "Cat" | "Bird" | "Teapot";
/** The silhouettes added in generator version 4 (src/core/silhouettes.ts). */
export type AddedSilhouette =
  | "Anchor"
  | "Sailboat"
  | "Mushroom"
  | "House"
  | "Fish"
  | "Whale"
  | "Snail"
  | "Owl"
  | "Fox"
  | "Rabbit"
  | "Mouse"
  | "Candle"
  | "Teacup"
  | "Violin"
  | "Knight"
  | "Cactus"
  | "Tree"
  | "Turtle";
export type ShapeName = ClassicShape | FirstSilhouette | AddedSilhouette;

/** A brass scrap: one convex piece of a lock's shape, placed on rays from that lock's lantern spot. */
export interface Piece {
  kind: "piece";
  lock: number;
  piece: number;
  verts: V3[];
  /** The piece the box leaves out of a finger lock: the player's finger fills its shadow. */
  missing: boolean;
}

/** A sight ring: its shadow nests on the lock's mark only when the lantern is on the ring line. */
export interface Ring {
  kind: "ring";
  lock: number;
  c: V3;
  nrm: V3;
  rOut: number;
  rIn: number;
}

/** A scrap that belongs to no lock. */
export interface Decoy {
  kind: "decoy";
  verts: V3[];
}

export type Element = Piece | Ring | Decoy;

export interface Lock {
  i: number;
  shape: ShapeName;
  center: V2;
  size: number;
  rot: number;
  /** The outline on the panel: the shape's pieces placed at `center`, turned by `rot` and scaled by `size`. */
  target: V2[][];
  /** The secret lantern spot. */
  L: V3;
  finger: boolean;
  /** Index of the missing piece in `target`, or -1. */
  missing: number;
  /** Which way the missing piece runs on the panel, in radians from horizontal. */
  fingerAngle: number;
  /** The etched mark the sight rings line up on, or null when the lock has no rings. */
  mark: V2 | null;
  rings: boolean;
  /** The outline is not etched: the player finds the shape from the shadows alone. */
  hidden: boolean;
}

export interface BoxParams {
  locks: 1 | 2 | 3;
  fingerLocks: number;
  decoys: number;
  ringless: number;
  hidden: number;
  tilt: number;
  amp: number;
}

/**
 * Which box: numbered, a day's Daily Box, or a lesson's. `gen` names an older generator version for a box saved under
 * it (generator.ts specForSave); absent, the box is built by the current one.
 */
export type BoxSpec = { kind: "box"; n: number; gen?: number } | { kind: "daily"; day: string; gen?: number } | { kind: "lesson"; id: "l1" | "l2" };

export interface Box {
  key: string;
  spec: BoxSpec;
  params: BoxParams;
  /** Where the lantern starts. */
  start: V3;
  elements: Element[];
  locks: Lock[];
  owner: string;
  loot: string;
  /** Built for a left-handed player: every x negated. */
  mirrored: boolean;
}
