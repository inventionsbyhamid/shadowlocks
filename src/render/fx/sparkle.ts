// An opened lock's sparkle, from the owner's pick (pick.md, "Lock opens"): four-point gold glints flare at the
// shape's sharpest tips one after another, and fine star glitter rises from inside the shape and twinkles out. It
// plays over the lock's sunburst and the panel's gold foil; the lock opening starts it.
//
// Comfort: every brightening in the box goes through the box's one FlashBudget, glints too. The opening's sunburst
// takes it first; each glint is due a gap after that and one gap after the last, takes the budget when its turn
// comes (the earliest due first, across every lock) and waits while it is refused, so the sunbursts, the glints of
// every lock, the crystallises and the lantern's flares together never brighten more than three times a second. A
// glint more than glintLateS late is let go. The glitter's strength is the opening's (half when its flash was
// refused); each spark twinkles at most twinkleHz, out of phase with the others, so it shimmers without strobing.
// Reduced motion: the glints fade in place at one size, and there is no glitter.
//
// One draw call for every lock: one Points object in the box root (box units), a point per glint and spark, each
// with its own size and brightness (added as light), drawn as a four-point star in the fragment shader. Nothing is
// drawn while no sparkle runs. A new box lays out each lock's tips and sparks once; a frame writes only the buffers.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  PointsMaterial,
  type WebGLProgramParametersWithUniforms,
} from "@iwsdk/core";
import { inPoly, rng32 } from "../../core/geom";
import { lockSamples } from "../../core/solve";
import type { Box, V2 } from "../../core/types";
import { LIGHT_BLEND } from "../light-blend";
import { outlineEdges } from "../outline";
import { COLORS } from "../theme";
import { clamp01, outCubic, smoothstep } from "./ease";
import { FlashBudget, MIN_GAP_S } from "./flash-budget";

export const SPARKLE = {
  /** Glints a lock gets, at its sharpest tips at least tipGap of its size apart. */
  glints: 4,
  tipGap: 0.25,
  /** One glint's flare (s): up over the first quarter, then out. */
  glintS: 0.6,
  /** The first glint is due this long after the opening (its sunburst's flash comes first), the next a gap later. */
  glintDelay: MIN_GAP_S,
  glintGap: MIN_GAP_S,
  /** A glint still waiting for the flash budget this long after it was due is let go (s). */
  glintLateS: 1.5,
  /** A glint's size at its peak, and a spark's (metres, as PointsMaterial sizes points at a distance). */
  glintSize: 0.045,
  sparkSize: 0.011,
  /** Sparks a lock gets; they start over sparkSpread (s), each lives glitterS. */
  sparks: 16,
  sparkSpread: 0.4,
  glitterS: 1.3,
  /** A spark rises this far and drifts sideways at most this far (box units). */
  rise: 0.09,
  drift: 0.03,
  /** A spark twinkles at most this many times a second (comfort: under three). */
  twinkleHz: 2,
  /** Just in front of the panel, its shadows and a lock's sunburst (box units). */
  z: 0.006,
} as const;

/** Points per lock: its glints, then its sparks. */
export const PER_LOCK = SPARKLE.glints + SPARKLE.sparks;
/** A whole sparkle with the budget to itself, from the opening to the last glint or spark gone (s). */
export const SPARKLE_S = Math.max(
  SPARKLE.glintDelay + (SPARKLE.glints - 1) * SPARKLE.glintGap + SPARKLE.glintS,
  SPARKLE.sparkSpread + SPARKLE.glitterS,
);
/** A glint's state: waiting for its turn, flaring (or done), let go. */
const PENDING = 0, STARTED = 1, DROPPED = 2;
const SLOTS = 3;

/**
 * The `n` sharpest convex corners of a lock's outline (the union of its pieces), at least `minGap` apart, sharpest
 * first: where the glints flare. Fewer when the outline has fewer. Run once per box.
 */
export function sharpTips(target: V2[][], n: number, minGap: number): V2[] {
  const key = (p: V2) => `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`;
  const nbrs = new Map<string, { p: V2; to: V2[] }>();
  for (const [a, b] of outlineEdges(target)) {
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const e = nbrs.get(key(p)) ?? { p, to: [] };
      e.to.push(q);
      nbrs.set(key(p), e);
    }
  }
  const tips: { p: V2; angle: number }[] = [];
  for (const { p, to } of nbrs.values()) {
    if (to.length !== 2) continue;
    const a = Math.atan2(to[0]![1] - p[1], to[0]![0] - p[0]), b = Math.atan2(to[1]![1] - p[1], to[1]![0] - p[0]);
    const d = Math.abs(a - b) % (2 * Math.PI), angle = Math.min(d, 2 * Math.PI - d);
    // Convex: a step along the bisector, between its two edges, lands inside the shape.
    const bx = Math.cos(a) + Math.cos(b), by = Math.sin(a) + Math.sin(b), bl = Math.hypot(bx, by) || 1;
    const q: V2 = [p[0] + (bx / bl) * 1e-4, p[1] + (by / bl) * 1e-4];
    if (angle < Math.PI - 1e-3 && target.some((poly) => inPoly(q, poly))) tips.push({ p, angle });
  }
  tips.sort((x, y) => x.angle - y.angle);
  const out: V2[] = [];
  for (const t of tips) {
    if (out.length >= n) break;
    if (out.every((o) => Math.hypot(o[0] - t.p[0], o[1] - t.p[1]) >= minGap)) out.push(t.p);
  }
  return out;
}

const VERTEX_SIZE = /* glsl */ `
attribute float aSize;
`;
const STAR = /* glsl */ `
  // A four-point star: a small round core and two thin rays, fading to nothing at the point's edge.
  vec2 sd = gl_PointCoord - 0.5;
  float sr = length(sd);
  float star = exp(-sr * sr * 70.0) + 0.85 * (exp(-abs(sd.x) * 26.0) * exp(-abs(sd.y) * 4.5) + exp(-abs(sd.y) * 26.0) * exp(-abs(sd.x) * 4.5));
  diffuseColor.a *= clamp(star, 0.0, 1.0) * (1.0 - smoothstep(0.38, 0.5, sr));
`;

function starShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = VERTEX_SIZE + shader.vertexShader.replace("gl_PointSize = size;", "gl_PointSize = size * aSize;");
  shader.fragmentShader = shader.fragmentShader.replace("#include <map_particle_fragment>", STAR);
}

interface Slot {
  /** A lock is laid out in this slot. */
  on: boolean;
  /** When its burst began on the sparkle's clock (s; far back: none), its strength, reduced motion. */
  t0: number;
  strength: number;
  reduced: boolean;
  /** Each glint's state (PENDING, STARTED, DROPPED), when it is due and when it started (the sparkle's clock). */
  readonly glintState: Uint8Array;
  readonly glintDue: Float64Array;
  readonly glintAt: Float64Array;
  /** Tips (x, y) for its glints and how many there are; sparks' starts (x, y), drift, and phase (start, twinkle). */
  readonly tips: Float32Array;
  tipCount: number;
  readonly sparks: Float32Array;
  readonly drift: Float32Array;
  readonly phase: Float32Array;
}

export class Sparkle {
  /** Every lock's glints and sparks: one draw call (add it to the box root). */
  readonly points: Points;
  /** Each point's brightness now (0..1, times the burst's strength): lock l's glints from l * PER_LOCK, then sparks. */
  readonly bright = new Float32Array(SLOTS * PER_LOCK);
  private readonly pos: BufferAttribute;
  private readonly size: BufferAttribute;
  private readonly color: BufferAttribute;
  private readonly slots: Slot[] = [];
  private readonly glintColor = new Color(COLORS.goldHot);
  private readonly sparkColor = new Color(COLORS.gold);
  private readonly budget: FlashBudget;
  /** The budget is this object's own (it steps it), not the box's shared one. */
  private readonly ownBudget: boolean;
  /** The sparkle's clock (s). */
  private now = 0;

  /**
   * `budget`: the box's one flash budget (the box scene steps it), which every glint takes in turn; without one, a
   * budget of its own, stepped by update.
   */
  constructor(budget?: FlashBudget) {
    this.budget = budget ?? new FlashBudget();
    this.ownBudget = !budget;
    const n = SLOTS * PER_LOCK;
    const g = new BufferGeometry();
    this.pos = new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    this.size = new BufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
    this.color = new BufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    g.setAttribute("position", this.pos);
    g.setAttribute("aSize", this.size);
    g.setAttribute("color", this.color);
    const mat = new PointsMaterial({
      size: 1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      ...LIGHT_BLEND,
      toneMapped: false,
    });
    mat.onBeforeCompile = starShader;
    mat.customProgramCacheKey = () => "sl-sparkle";
    this.points = new Points(g, mat);
    this.points.name = "Lock Sparkle";
    this.points.renderOrder = 4;
    // Its points move every frame and stay on the panel, which is always in view.
    this.points.frustumCulled = false;
    this.points.visible = false;
    for (let s = 0; s < SLOTS; s++) {
      this.slots.push({
        on: false,
        t0: -1e9,
        strength: 0,
        reduced: false,
        glintState: new Uint8Array(SPARKLE.glints).fill(DROPPED),
        glintDue: new Float64Array(SPARKLE.glints),
        glintAt: new Float64Array(SPARKLE.glints),
        tips: new Float32Array(SPARKLE.glints * 2),
        tipCount: 0,
        sparks: new Float32Array(SPARKLE.sparks * 2),
        drift: new Float32Array(SPARKLE.sparks),
        phase: new Float32Array(SPARKLE.sparks * 2),
      });
    }
  }

  /** True while any lock's sparkle runs (a glint waiting its turn, flaring, or a spark alive). */
  get running(): boolean {
    for (let i = 0; i < SLOTS; i++) if (this.live(this.slots[i]!)) return true;
    return false;
  }

  /** A new box (or none): each lock's tips and sparks laid out, every sparkle put away. */
  setBox(box: Box | null): void {
    for (const s of this.slots) {
      s.on = false;
      s.t0 = -1e9;
      s.glintState.fill(DROPPED);
    }
    this.bright.fill(0);
    for (const l of box?.locks ?? []) {
      if (l.i >= SLOTS) continue;
      const s = this.slots[l.i]!;
      s.on = true;
      const tips = sharpTips(l.target, SPARKLE.glints, SPARKLE.tipGap * l.size);
      // Glints past the last tip stay dark at the lock's centre.
      for (let k = 0; k < SPARKLE.glints; k++) s.tips.set(tips[k] ?? l.center, k * 2);
      s.tipCount = tips.length;
      // Sparks start at points spread through the shape (its solve samples, every so many), each with its own
      // sideways drift and twinkle phase, the same for the same box.
      const inside = lockSamples(l.target, l.size / 9).inside;
      const r = rng32(1009 + l.i * 31 + Math.round(l.center[0] * 1000));
      for (let k = 0; k < SPARKLE.sparks; k++) {
        const p = inside.length ? inside[Math.floor(((k + 0.5) * inside.length) / SPARKLE.sparks)]! : l.center;
        s.sparks[k * 2] = p[0];
        s.sparks[k * 2 + 1] = p[1];
        s.drift[k] = (r() * 2 - 1) * SPARKLE.drift;
        s.phase[k * 2] = r();
        s.phase[k * 2 + 1] = r() * Math.PI * 2;
      }
    }
    this.write();
  }

  /**
   * The box is opening: every lock's glints still waiting their turn are dropped (not only the last lock's), so the
   * opening's flash and the reward's bloom after it have theirs. Glints already flaring, and all the glitter, play on.
   */
  quiet(): void {
    for (const s of this.slots) for (let k = 0; k < s.glintState.length; k++) if (s.glintState[k] === PENDING) s.glintState[k] = DROPPED;
  }

  /** Lock `lock` opened: its sparkle, at `strength` (1, or less when the flash budget refused the opening). */
  burst(lock: number, strength: number, reduced: boolean): void {
    const s = this.slots[lock];
    if (!s?.on) return;
    s.t0 = this.now;
    s.strength = strength;
    s.reduced = reduced;
    for (let k = 0; k < SPARKLE.glints; k++) {
      s.glintState[k] = k < s.tipCount ? PENDING : DROPPED;
      s.glintDue[k] = this.now + SPARKLE.glintDelay + k * SPARKLE.glintGap;
    }
    this.write();
  }

  /** Advance by `dt` seconds: glints start in turn through the flash budget. Allocation-free. */
  update(dt: number): void {
    if (this.ownBudget) this.budget.step(dt);
    const was = this.running;
    this.now += dt > 0 ? dt : 0;
    if (!was) return;
    // The earliest glint due, across every lock, takes the budget (one a frame at most); one too late is let go.
    let bs = -1, bk = -1, due = Infinity;
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i]!;
      for (let k = 0; k < SPARKLE.glints; k++) {
        if (s.glintState[k] !== PENDING || s.glintDue[k]! > this.now || s.glintDue[k]! >= due) continue;
        due = s.glintDue[k]!;
        bs = i;
        bk = k;
      }
    }
    if (bs >= 0) {
      const s = this.slots[bs]!;
      if (this.now - due > SPARKLE.glintLateS) s.glintState[bk] = DROPPED;
      else if (this.budget.take()) {
        s.glintState[bk] = STARTED;
        s.glintAt[bk] = this.now;
      }
    }
    this.write();
  }

  /** A slot's sparkle runs: a glint waiting or flaring, or a spark still alive. */
  private live(s: Slot): boolean {
    if (!s.on) return false;
    if (this.now - s.t0 < SPARKLE.sparkSpread + SPARKLE.glitterS) return true;
    for (let k = 0; k < SPARKLE.glints; k++) {
      const st = s.glintState[k];
      if (st === PENDING || (st === STARTED && this.now - s.glintAt[k]! < SPARKLE.glintS)) return true;
    }
    return false;
  }

  /**
   * Every point's position, size and brightness from its slot's clock. Written inline, point by point: a helper
   * taking the floats would box them at each call the engine did not inline.
   */
  private write(): void {
    const S = SPARKLE, P = this.pos.array as Float32Array, Z = this.size.array as Float32Array, C = this.color.array as Float32Array;
    const B = this.bright, gc = this.glintColor, sc = this.sparkColor;
    let shown = false;
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i]!, base = i * PER_LOCK, st = this.now - s.t0, live = s.on;
      for (let k = 0; k < S.glints; k++) {
        const j = base + k;
        let b = 0, size = S.glintSize;
        if (live && s.glintState[k] === STARTED) {
          const q = (this.now - s.glintAt[k]!) / S.glintS;
          if (q >= 0 && q < 1) {
            const env = q < 0.25 ? outCubic(q / 0.25) : (1 - (q - 0.25) / 0.75) ** 2;
            b = s.strength * env;
            if (!s.reduced) size = S.glintSize * (0.35 + 0.65 * env);
          }
        }
        P[j * 3] = s.tips[k * 2]!;
        P[j * 3 + 1] = s.tips[k * 2 + 1]!;
        P[j * 3 + 2] = S.z;
        Z[j] = size;
        B[j] = b;
        C[j * 3] = gc.r * b;
        C[j * 3 + 1] = gc.g * b;
        C[j * 3 + 2] = gc.b * b;
        if (b > 0) shown = true;
      }
      for (let k = 0; k < S.sparks; k++) {
        const j = base + S.glints + k;
        let b = 0, x = s.sparks[k * 2]!, y = s.sparks[k * 2 + 1]!, size = S.sparkSize;
        if (live && !s.reduced) {
          const t = st - s.phase[k * 2]! * S.sparkSpread, q = t / S.glitterS;
          if (q >= 0 && q < 1) {
            const rise = outCubic(q);
            x += s.drift[k]! * rise;
            y += S.rise * rise;
            // Fades in over the first tenth, out after; twinkles (cos) at twinkleHz from its own phase.
            const env = smoothstep(0, 0.1, q) * (1 - q) ** 1.5;
            const twinkle = 0.55 + 0.45 * Math.cos(2 * Math.PI * S.twinkleHz * t + s.phase[k * 2 + 1]!);
            b = clamp01(s.strength * env * twinkle);
            size = S.sparkSize * (0.7 + 0.3 * twinkle);
          }
        }
        P[j * 3] = x;
        P[j * 3 + 1] = y;
        P[j * 3 + 2] = S.z;
        Z[j] = size;
        B[j] = b;
        C[j * 3] = sc.r * b;
        C[j * 3 + 1] = sc.g * b;
        C[j * 3 + 2] = sc.b * b;
        if (b > 0) shown = true;
      }
    }
    this.points.visible = shown;
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
    this.color.needsUpdate = true;
  }
}
