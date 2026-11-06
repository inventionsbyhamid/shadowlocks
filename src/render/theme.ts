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
  /** The panel's ambient: what is left of it inside a full shadow (inky, lifted from #07070b by the owner). */
  panelShadow: "#121016",
  /** Gold-leaf etching on the panel: outlines, numerals, sight marks, the deco border. */
  etch: "#b08732",
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

/**
 * The panel's light pool, its shadows and the penumbra size (the lookdev's Ebony panel, numbers from
 * its `DIRS` table unless the owner changed them). Worked out in display (sRGB) values, as the
 * lookdev's canvas did, so the panel matches it:
 *   light = 1 - exp(-gain * E * lit), E = q^1.5 * (1 - tightness + tightness * exp(-r^2 / sigma^2)),
 *   q = Lz^2 / (r^2 + Lz^2), r the distance on the panel from under the lantern;
 *   colour = albedo * (ambient + light * (1 - shadowDepth * shadow)) + sheen * etch lines.
 * The owner's brightening: a wider pool (tightness 0.58, sigma 0.5; the lookdev had 0.66 / 0.42) and
 * the lantern up from 2.9 to 3.4, so the pool's gain rises with it (2.4 * 1.15 * 3.4 / 2.9).
 * `lanternRadius` sizes the penumbra (crisp Ebony shadows; the plan's default was 0.025).
 */
export const PANEL_LIGHT = {
  tightness: 0.58,
  sigma: 0.5,
  gain: (2.4 * 1.15 * 3.4) / 2.9,
  /** The pool's tint per channel (a warm lamp on ivory). */
  lit: [1.0, 0.95, 0.86] as const,
  /** How much of the lantern's light a full shadow takes away (the rest is the frosted glass's glow). */
  shadowDepth: 0.97,
  /** Gold-leaf lines catch a little light even in shadow. */
  sheen: 0.16,
  lanternRadius: 0.016,
} as const;

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

/**
 * Theatre lights (theatre.ts): while a box is in play the room dims so the lantern and the shadows carry the scene,
 * and the light comes back up when the box opens. Brightness the room keeps (the owner: 35% in play, 55% in menus,
 * never darker than 35%). The veil over the passthrough is near black with a breath of the film's cool tint
 * (#b9c8de at 30% saturation in the lookdev): passthrough cannot be desaturated from a web page, so dimming carries
 * it, and the faint cool lift keeps the dimmed room reading as night rather than as a brown haze.
 * The virtual room (no passthrough): a dark studio, cool charcoal above, a warm glow low in front where the lap is.
 */
export const ROOM = {
  play: 0.35,
  menu: 0.55,
  fadeS: 0.8,
  veil: "#080a0e",
  studio: { top: "#060608", horizon: "#16171c", floor: "#0e0c0b", glow: "#3a2c1c" },
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

/**
 * An open lock's banded gold foil: colour stops along a diagonal across the lock (0 at its upper
 * left, 1 at its lower right), from the lookdev's Ebony "lock opens" frame.
 */
export const FOIL: readonly (readonly [number, string])[] = [
  [0, "#8a6a22"],
  [0.2, "#f7e2a0"],
  [0.38, "#c9a24a"],
  [0.56, "#fff4cc"],
  [0.76, "#b48a33"],
  [1, "#7d5d1c"],
];
