// Motion constants for the menus, in one place: crisp key travel with hard stops for presses, and
// springy overshoot and squash for releases and panels popping in. Pure: no Three, no DOM.

export interface SpringCfg {
  /** Pull toward the target per unit of distance (1/s^2). */
  stiffness: number;
  /** Velocity decay rate (1/s). Low values wobble, high values stop dead. */
  damping: number;
}

export interface SpringState {
  x: number;
  v: number;
}

export const MOTION = {
  key: {
    /** The keycap's top sits this far proud of the panel plate (mm) at rest. */
    restMm: 8,
    /** Press travel (mm): a pressed cap still stands 2 mm proud. */
    travelMm: 6,
    // The fingertip rules (press at 80%, re-arm 3 mm out, 8 mm finger radius) live in src/render/finger-key.ts.
    /** A key's action runs this long after its click (s), so the springy pop is seen before the screen changes. */
    actionDelayS: 0.12,
    /** Hover lifts the cap a little toward the finger (mm). */
    hoverLiftMm: 1,
    /** How far a cap slides over a drawn skirt (mm); none. */
    skirtMm: 0,
    /** Down: fast and almost no overshoot. */
    down: { stiffness: 2600, damping: 100 } as SpringCfg,
    /** Up: pops back about 20% past rest and settles in a third of a second. */
    up: { stiffness: 900, damping: 26 } as SpringCfg,
    /** Squash wobble after a release (scale x up, y down, then back). */
    squash: { stiffness: 900, damping: 15 } as SpringCfg,
    /** Velocity kick given to the squash on release; peaks at about 6% wider. */
    squashKick: 2.4,
    /** Glow follows hover at this rate (1/s). */
    glowRate: 14,
    /** Glow while the cap is held down (hover is 1). */
    glowPressed: 0.7,
  },
  panel: {
    /** Panels pop up with a little overshoot. */
    enter: { stiffness: 360, damping: 21 } as SpringCfg,
    /** And leave quickly without a bounce. */
    exit: { stiffness: 900, damping: 60 } as SpringCfg,
    /** A new panel waits this long (s) so the old one is mostly gone; both are moving, no dead frames. */
    enterDelayS: 0.09,
    /** Hidden panels sit this far lower (mm), rising into place. */
    slideMm: 26,
    /** Hidden panels are this much smaller (scale at presence 0). */
    scaleFrom: 0.88,
  },
  /** Every animation with reduced motion: a straight 40 ms move, no overshoot, no squash. */
  reducedMs: 40,
  countUp: {
    /** Results numbers roll for this long (ms), ticking like a mechanical counter. */
    ms: 900,
    /** Number of distinct values shown while rolling. */
    steps: 24,
    /** Each further number on a results screen starts this much later (s). */
    staggerS: 0.25,
  },
} as const;

/** Spring substep (s): small fixed steps keep stiff springs stable on long frames. */
const SUBSTEP = 0.004;
/** Frames longer than this are clamped (a hitch or a hidden tab must not fling things). */
const MAX_DT = 0.1;

/** Advance a spring toward `target` by `dt` seconds (semi-implicit Euler in fixed substeps). */
export function stepSpring(s: SpringState, target: number, cfg: SpringCfg, dt: number): void {
  const d = Math.min(Math.max(dt, 0), MAX_DT);
  const n = Math.max(1, Math.ceil(d / SUBSTEP));
  const h = d / n;
  const decay = Math.exp(-cfg.damping * h);
  let x = s.x;
  let v = s.v;
  for (let i = 0; i < n; i++) {
    v += (target - x) * cfg.stiffness * h;
    v *= decay;
    x += v * h;
  }
  s.x = x;
  s.v = v;
}

/**
 * Advance toward `target`: a spring normally; with reduced motion a straight move that covers
 * `span` (the value's full range) in 40 ms.
 */
export function stepToward(s: SpringState, target: number, cfg: SpringCfg, dt: number, reduced: boolean, span: number): void {
  if (!reduced) {
    stepSpring(s, target, cfg, dt);
    return;
  }
  const max = (Math.abs(span) / (MOTION.reducedMs / 1000)) * Math.min(Math.max(dt, 0), MAX_DT);
  const d = target - s.x;
  s.x = Math.abs(d) <= max ? target : s.x + Math.sign(d) * max;
  s.v = 0;
}

/** True when the spring is at rest on `target` (close enough to snap). */
export function settledAt(s: SpringState, target: number, eps = 0.002): boolean {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 10;
}

/** Ease out cubic: fast first, gentle landing. */
export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}
