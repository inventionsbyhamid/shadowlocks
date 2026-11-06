// Hints: which one a lock gets next (HintBook, recorded per box and saved with it), and what each shows in the box
// (HintMarks): 1 the lock's own scraps glow, 2 its sight rings glow and its line shows as a faint beam from the panel
// out to the spot (a lock without rings: from its outline), 3 a small gold ring on that line at the spot's distance,
// 4 a pale-blue ghost lantern on the spot. Each level keeps the ones below it. The marks stay until the lock opens or
// the box changes. HintMarks also draws the small gold focus mark above the lock the head's gaze rests on.
import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from "@iwsdk/core";
import type { Box, Lock, V3 } from "../core/types";
import { radialTexture } from "../render/lantern-view";
import { BEAM, RingBeam } from "../render/ring-beam";
import { COLORS } from "../render/theme";
import { type HintLevel, MAX_LOCKS } from "./events";

/** The highest hint: the ghost lantern on the spot. Asking again shows it again. */
export const MAX_HINT: HintLevel = 4;

/** How many hints were taken on a box, and the level each lock reached. */
export class HintBook {
  /** Hints taken on this box (every ask counts, the repeats of level 4 too). */
  count = 0;
  private readonly level: number[];

  constructor(locks: number) {
    this.level = Array.from({ length: locks }, () => 0);
  }

  levelOf(lock: number): number {
    return this.level[lock] ?? 0;
  }

  /** The next hint for `lock`: one level up, up to MAX_HINT. */
  next(lock: number): HintLevel {
    const l = Math.min(MAX_HINT, (this.level[lock] ?? 0) + 1) as HintLevel;
    this.level[lock] = l;
    this.count++;
    return l;
  }

  /** The levels reached, by lock (locks with none left out), as a save keeps them. */
  levels(): Record<number, number> {
    const out: Record<number, number> = {};
    for (let i = 0; i < this.level.length; i++) if (this.level[i]! > 0) out[i] = this.level[i]!;
    return out;
  }

  /** Back to a saved box's hints (levels outside 0..MAX_HINT or for locks it does not have are dropped). */
  restore(count: number, levels: Record<number, number>): void {
    this.count = Number.isSafeInteger(count) && count > 0 ? count : 0;
    for (const [k, v] of Object.entries(levels)) {
      const i = Number(k);
      if (i >= 0 && i < this.level.length && Number.isFinite(v)) this.level[i] = Math.max(0, Math.min(MAX_HINT, Math.floor(v)));
    }
  }
}

/** What the marks need of the box scene (BoxScene has it all): its root (box units) and the scraps' glow. */
export interface HintScene {
  readonly root: Object3D;
  scrapMesh(lock: number, piece: number): { setGlow(v: number): void };
  readonly scraps: { setRingGlow(lock: number, v: number): void };
}

export const HINT_LOOK = {
  /** Level 1: the lock's scraps glow this much (an open lock's celebration glows brighter). */
  scrapGlow: 0.5,
  /** Level 2: its rings glow this much. */
  ringGlow: 0.9,
  /** The beam runs this far past the spot (box units). */
  beamPast: 0.06,
  /** Level 3: the marker ring's radius and wire (box units). */
  marker: { r: 0.035, tube: 0.004 },
  /** Level 4: the ghost lantern's glow size and core (box units). */
  ghost: { glow: 0.32, core: [0.035, 0.1] as const, opacity: 0.45 },
  /** The focus mark: a small diamond this far above the lock's outline (shares of its size), this big (box units). */
  focus: { above: 0.6, half: 0.016 },
} as const;

const Z = new Vector3(0, 0, 1);

/** The hint marks and the focus mark in the box: drawn only while shown (a beam, a ring, a ghost each). */
export class HintMarks {
  readonly group = new Group();
  private readonly beams: RingBeam[] = [];
  private readonly markers: Mesh[] = [];
  private readonly ghosts: Group[] = [];
  private readonly focusMark: Mesh;
  private box: Box | null = null;
  private readonly tmpDir = new Vector3();
  private readonly tmpQ = new Quaternion();

  constructor(private readonly scene: HintScene) {
    this.group.name = "Hint Marks";
    const gold = new MeshBasicMaterial({ color: COLORS.gold, toneMapped: false });
    const ghostGlow = new SpriteMaterial({
      map: radialTexture(64, false),
      color: COLORS.ghost,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    const ghostCore = new MeshBasicMaterial({ color: COLORS.ghost, transparent: true, opacity: HINT_LOOK.ghost.opacity, depthWrite: false, toneMapped: false });
    const ring = new TorusGeometry(HINT_LOOK.marker.r, HINT_LOOK.marker.tube, 6, 28);
    const core = new CylinderGeometry(HINT_LOOK.ghost.core[0], HINT_LOOK.ghost.core[0], HINT_LOOK.ghost.core[1], 8);
    for (let i = 0; i < MAX_LOCKS; i++) {
      const beam = new RingBeam();
      beam.mesh.name = "Hint Beam";
      this.beams.push(beam);
      const marker = new Mesh(ring, gold);
      marker.name = "Hint Marker";
      marker.visible = false;
      this.markers.push(marker);
      const ghost = new Group();
      ghost.name = "Ghost Lantern";
      const glow = new Sprite(ghostGlow);
      glow.scale.set(HINT_LOOK.ghost.glow, HINT_LOOK.ghost.glow, 1);
      const body = new Mesh(core, ghostCore);
      body.name = "Ghost Lantern Core";
      ghost.add(glow, body);
      ghost.visible = false;
      this.ghosts.push(ghost);
      this.group.add(beam.mesh, marker, ghost);
    }
    const h = HINT_LOOK.focus.half, s = new Shape();
    s.moveTo(0, -h * 1.4);
    s.lineTo(h, 0);
    s.lineTo(0, h * 1.4);
    s.lineTo(-h, 0);
    s.closePath();
    this.focusMark = new Mesh(new ShapeGeometry(s), gold);
    this.focusMark.name = "Focus Mark";
    // On the panel, after it and its shadows.
    this.focusMark.renderOrder = 3;
    this.focusMark.visible = false;
    this.group.add(this.focusMark);
    scene.root.add(this.group);
  }

  /** A new box (or none): every mark put away. */
  setBox(box: Box | null): void {
    if (this.box) for (let i = 0; i < this.box.locks.length; i++) this.clear(i);
    this.box = box;
    this.focusMark.visible = false;
  }

  /** Show lock `lock`'s hints up to `level`. */
  show(lock: number, level: HintLevel): void {
    const l = this.box?.locks[lock];
    if (!l) return;
    this.glowScraps(l, HINT_LOOK.scrapGlow);
    if (level < 2) return;
    this.scene.scraps.setRingGlow(lock, HINT_LOOK.ringGlow);
    // The line: from the rings' mark (or the outline's centre) out through the spot.
    const from: V3 = l.mark ? [l.mark[0], l.mark[1], 0] : [l.center[0], l.center[1], 0];
    const dir: V3 = [l.L[0] - from[0], l.L[1] - from[1], l.L[2] - from[2]];
    const d = this.tmpDir.set(dir[0], dir[1], dir[2]).normalize();
    const past = BEAM.gap + HINT_LOOK.beamPast;
    this.beams[lock]!.show(from, dir, [l.L[0] + d.x * past, l.L[1] + d.y * past, l.L[2] + d.z * past]);
    if (level < 3) return;
    const m = this.markers[lock]!;
    m.position.set(l.L[0], l.L[1], l.L[2]);
    m.quaternion.copy(this.tmpQ.setFromUnitVectors(Z, d));
    m.visible = true;
    if (level < 4) return;
    const g = this.ghosts[lock]!;
    g.position.set(l.L[0], l.L[1], l.L[2]);
    g.visible = true;
  }

  /** Lock `lock`'s hint marks away (it opened, or the box changes). */
  clear(lock: number): void {
    const l = this.box?.locks[lock];
    if (l) this.glowScraps(l, 0);
    this.scene.scraps.setRingGlow(lock, 0);
    this.beams[lock]?.hide();
    if (this.markers[lock]) this.markers[lock]!.visible = false;
    if (this.ghosts[lock]) this.ghosts[lock]!.visible = false;
  }

  /** The focus mark above lock `lock`'s outline (null: none). */
  focus(lock: number | null): void {
    const l = lock === null ? null : this.box?.locks[lock];
    const m = this.focusMark;
    if (!l) {
      m.visible = false;
      return;
    }
    m.position.set(l.center[0], l.center[1] + l.size * HINT_LOOK.focus.above, 0.004);
    m.visible = true;
  }

  private glowScraps(l: Lock, v: number): void {
    for (let p = 0; p < l.target.length; p++) if (p !== l.missing) this.scene.scrapMesh(l.i, p).setGlow(v);
  }
}
