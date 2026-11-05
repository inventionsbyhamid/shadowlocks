// The box's look: every colour, material and light number of the box scene, in one place, so the
// look can change without touching geometry code. Ebony and Gold (art deco noir), the owner's pick,
// brightened at the owner's word ("slightly dark"): lacquer lifted, a stronger lantern, a warm fill on
// the box front. The black frame must never vanish in a dark room: a gold pinstripe and stepped gold
// corners on its edges, and a clearcoat rim that catches the lantern.
// Colours are sRGB hex. Light intensities and ranges are in box units (the scene converts them to
// metres for the box size), so the box looks the same at every size.

export const COLORS = {
  /** Black lacquer: frame, plinth, back slab, lantern base. */
  frame: "#1c191d",
  /** Lacquer grain (a lighter streak tone). */
  frameGrain: "#2a2529",
  /** Ivory frosted back panel. */
  panel: "#efe8da",
  /** The panel inside a shadow (Task 10's shadows). */
  panelShadow: "#121016",
  /** Polished gold: scraps, rings, pinstripes, stepped corners, lantern fins. */
  metal: "#e2bd62",
  /** Lock warmth glow, scrap glow. */
  gold: "#ffd36a",
  goldHot: "#fffbe6",
  goldDeep: "#9c7424",
  /** Ghost hand and lantern (lessons). */
  ghost: "#7fdcff",
  /** Scrap threads: fine gold. */
  thread: "#e2bd62",
  /** Black velvet box floor. */
  lining: "#0d0b0e",
  /** Smoked side glass. */
  glass: "#a6aebb",
  /** The lantern's light and its ivory glass core. */
  lamp: "#fff0d2",
  lampCore: "#ffe6bd",
} as const;

export const MATERIALS = {
  lacquer: { roughness: 0.22, metalness: 0.05, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 2.2 },
  gold: { roughness: 0.16, metalness: 1.0, envMapIntensity: 1.5 },
  panel: { roughness: 0.9, metalness: 0, envMapIntensity: 0.25 },
  lining: { roughness: 1.0, metalness: 0, envMapIntensity: 0.15 },
  glass: { roughness: 0.04, metalness: 0, opacity: 0.11, envMapIntensity: 1.6 },
  /** Threads drawn at this opacity. */
  threadOpacity: 0.6,
} as const;

export const LIGHTS = {
  /** The lantern: one point light. Intensity in candela at box scale; range in box units. */
  lantern: { intensity: 3.4, range: 4.6, decay: 2.0 },
  /**
   * A soft warm fill on the box front, about 25% of the lantern's light on the panel (the lantern at
   * a typical 1.35 units gives 3.4 / 1.35^2 = 1.9; a quarter of that is 0.47), from above the player.
   */
  fill: { color: "#fff0d2", intensity: 0.47, from: [0, 1.4, 3.2] as const },
  /** A cool studio key from the upper left (the jeweller's spotlight). */
  key: { color: "#dfe6ff", intensity: 0.9, from: [-2.5, 3.2, 2.2] as const },
  /** Sky and ground fill. */
  hemi: { sky: "#8090a8", ground: "#050506", intensity: 0.14 },
} as const;

/** The panel's light pool and the penumbra size, for the panel shader (Task 10). */
export const PANEL_LIGHT = { tightness: 0.58, sigma: 0.5, lanternRadius: 0.016 } as const;

/**
 * Studio reflections for the lacquer and gold (a small environment rendered once, turned with the
 * box): tall soft strips that the frame's clearcoat edges catch, and a warm glow below and in front,
 * the lap the lantern lights. Polished gold shows only what it reflects: a scrap faces its lantern
 * spot (low and in front), so from the eye it mirrors the space below the box; with the lookdev's
 * black studio (#040405) most scraps read black, like their own shadows. The base is a dim warm
 * brown, so a scrap facing nothing bright is dark bronze, never black on the black frame. Directions
 * in box units (+z is the player's side); the first five strips are the lookdev's, the last two the lap.
 */
export const ENV = {
  base: "#3a2e20",
  panels: [
    { color: "#fff1d8", k: 3.2, pos: [-3, 2.5, 3], w: 0.35, h: 5 },
    { color: "#fff1d8", k: 2.4, pos: [4, 1, 2.5], w: 0.3, h: 5 },
    { color: "#ffffff", k: 1.4, pos: [0, 6, 1], w: 5, h: 0.25 },
    { color: "#ffe9c4", k: 1.6, pos: [0.5, 2.2, 5], w: 3.2, h: 0.9 },
    { color: "#fff4e0", k: 0.9, pos: [-1.5, -1.5, 4.5], w: 2.5, h: 0.6 },
    { color: "#ffd9a6", k: 0.9, pos: [0, -2.5, 3], w: 8, h: 5 },
    { color: "#ffd9a6", k: 0.6, pos: [0, -4, 0.5], w: 8, h: 8 },
  ],
} as const;

/** The lantern's glow sprite and how brightness, flare and ripple move it. */
export const LANTERN_GLOW = {
  /** Sprite size in box units at full brightness. */
  size: 0.5,
  /** Glow opacity at brightness 0 and 1. */
  opacity: [0.45, 1.0] as const,
  /** The light's share of full intensity at brightness 0 (it always lights the panel). */
  lightFloor: 0.85,
  /** Flare (on grab): the glow grows by this much and fades back over this many seconds. */
  flareGain: 0.6,
  flareS: 0.35,
  /** Ripple (on settle): a gold ring grows from the lantern to this radius (box units) and fades. */
  rippleRadius: 0.16,
  rippleS: 0.5,
} as const;
