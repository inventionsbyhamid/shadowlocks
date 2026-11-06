// A lock opening, at the lock: a 24-ray gold sunburst fans out behind its shape and fades, and its scraps flare gold
// and settle to a warm glow that stays (the panel fills the shape with gold foil itself, Panel.setOpen). One flash
// from the shared FlashBudget: an opening that comes within a third of a second of another flash plays at half
// strength, so the box never strobes. Reduced motion: the rays fade in place, no growth. Restored locks (a resumed
// box) just glow. Lives in the box root in box units; one draw call per lock while its burst shows, none after.
// Per frame it allocates nothing. Task 18's look pass adds the glints and glitter.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, type Object3D } from "@iwsdk/core";
import type { Box } from "../../core/types";
import { COLORS } from "../theme";
import { clamp01, outCubic } from "./ease";
import type { FlashBudget } from "./flash-budget";

export const LOCK_OPEN_FX = {
  /** The burst's length (s). */
  burstS: 1.2,
  rays: 24,
  /** Each ray's width, as a share of its slice of the circle. */
  rayShare: 0.34,
  /** Rays start this far out (share of their length) and reach this many lock sizes from the centre. */
  inner: 0.18,
  reach: 0.95,
  /** The burst's peak opacity, and the scale it grows from (normal motion). */
  peak: 0.85,
  growFrom: 0.55,
  /** The scraps' glow: a flare, then where it rests while the box stays. */
  glowPeak: 1,
  glowRest: 0.32,
  /** The flare eases back to rest over this long (s). */
  glowS: 0.9,
  /** Half strength for an opening the flash budget refuses. */
  refused: 0.5,
} as const;

const SLOTS = 3;
/** Just in front of the panel (z 0.002) and its shadows. */
const BURST_Z = 0.004;

/** A unit sunburst: `rays` thin wedges from `inner` to 1, bright at the root and fading out (vertex colours). */
export function sunburstGeometry(rays: number, share: number, inner: number): BufferGeometry {
  const pos = new Float32Array(rays * 9), col = new Float32Array(rays * 9);
  const half = (Math.PI / rays) * share;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const pts = [
      [Math.cos(a) * inner, Math.sin(a) * inner, 1],
      [Math.cos(a - half), Math.sin(a - half), 0],
      [Math.cos(a + half), Math.sin(a + half), 0],
    ];
    for (let k = 0; k < 3; k++) {
      const p = pts[k]!;
      pos[i * 9 + k * 3] = p[0]!;
      pos[i * 9 + k * 3 + 1] = p[1]!;
      pos[i * 9 + k * 3 + 2] = 0;
      col[i * 9 + k * 3] = col[i * 9 + k * 3 + 1] = col[i * 9 + k * 3 + 2] = p[2]!;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("color", new BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** What the effect needs of the box scene: its root and the scraps' glow. */
export interface LockOpenScene {
  readonly root: Object3D;
  scrapMesh(lock: number, piece: number): { setGlow(v: number): void };
}

export class LockOpenFx {
  readonly group = new Group();
  private readonly bursts: Mesh[] = [];
  private readonly mats: MeshBasicMaterial[] = [];
  /** Seconds since each lock's burst began (large: none running). */
  private readonly t = new Float64Array(SLOTS).fill(1e9);
  private readonly strength = new Float64Array(SLOTS);
  private box: Box | null = null;

  constructor(
    private readonly scene: LockOpenScene,
    private readonly budget: FlashBudget,
  ) {
    this.group.name = "Lock Open";
    const g = sunburstGeometry(LOCK_OPEN_FX.rays, LOCK_OPEN_FX.rayShare, LOCK_OPEN_FX.inner);
    for (let i = 0; i < SLOTS; i++) {
      const mat = new MeshBasicMaterial({
        color: COLORS.gold,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const m = new Mesh(g, mat);
      m.name = "Lock Burst";
      m.renderOrder = 3;
      m.visible = false;
      this.mats.push(mat);
      this.bursts.push(m);
      this.group.add(m);
    }
    scene.root.add(this.group);
  }

  /** A new box (or none): bursts put away. */
  setBox(box: Box | null): void {
    this.box = box;
    this.t.fill(1e9);
    for (const b of this.bursts) b.visible = false;
  }

  /** Lock `lock` opened: its burst and flare, or (restored) only its resting glow. */
  open(lock: number, restored: boolean): void {
    const l = this.box?.locks[lock];
    if (!l || lock >= SLOTS) return;
    if (restored) {
      this.glow(lock, LOCK_OPEN_FX.glowRest);
      return;
    }
    this.strength[lock] = this.budget.take() ? 1 : LOCK_OPEN_FX.refused;
    this.t[lock] = 0;
    const b = this.bursts[lock]!;
    b.position.set(l.center[0], l.center[1], BURST_Z);
    b.visible = true;
    this.apply(lock, false);
  }

  /** True while any burst or flare runs. */
  get running(): boolean {
    for (let i = 0; i < SLOTS; i++) if (this.t[i]! < LOCK_OPEN_FX.burstS) return true;
    return false;
  }

  /** Advance by `dt` seconds. */
  update(dt: number, reduced: boolean): void {
    for (let i = 0; i < SLOTS; i++) {
      if (this.t[i]! >= LOCK_OPEN_FX.burstS) continue;
      this.t[i] = this.t[i]! + (dt > 0 ? dt : 0);
      this.apply(i, reduced);
    }
  }

  private apply(i: number, reduced: boolean): void {
    const F = LOCK_OPEN_FX, t = this.t[i]!, s = this.strength[i]!;
    const b = this.bursts[i]!, l = this.box?.locks[i];
    if (!l) return;
    if (t >= F.burstS) {
      b.visible = false;
      this.glow(i, F.glowRest);
      return;
    }
    const k = clamp01(t / F.burstS);
    // Quick in (the first 15%), slow out: one brightening.
    const env = k < 0.15 ? k / 0.15 : 1 - outCubic((k - 0.15) / 0.85);
    this.mats[i]!.opacity = F.peak * s * env;
    const size = l.size * F.reach * (reduced ? 1 : F.growFrom + (1 - F.growFrom) * outCubic(k));
    b.scale.set(size, size, 1);
    const g = clamp01(t / F.glowS);
    this.glow(i, F.glowRest + (F.glowPeak * s - F.glowRest) * (1 - outCubic(g)));
  }

  private glow(lock: number, v: number): void {
    const l = this.box?.locks[lock];
    if (!l) return;
    for (let p = 0; p < l.target.length; p++) if (p !== l.missing) this.scene.scrapMesh(lock, p).setGlow(v);
  }
}
