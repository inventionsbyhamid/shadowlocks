// The Meta Horizon Store art, made from the game itself: plates (frames rendered in the emulator on
// the virtual clock: the box lit by its lantern, from a set camera) and the art cut from them, with the
// title set in the brand font (Limelight, OFL) where the store wants it. Pure data and maths here; the
// browser work is in tests/video/store.spec.ts (scripts/store-art.sh runs it on the build server).
//
// Sizes and rules: Meta's asset guidelines (2026-05-11), plan/shadow-locks-ship-steps.md step 21.
// Branded art carries the exact title and nothing else: no tagline, price, badge, or text in a corner
// or in the top or bottom 20%. The icon has no text; screenshots are real frames with no text added.
import type { V3 } from "./camera";

/** The exact store title, the only text on any branded image. */
export const TITLE = "Shadow Locks";
export const TITLE_FONT_FILE = "tests/video/assets/fonts/Limelight-Regular.ttf";

/** The game's Ebony and Gold palette (plan/lookdev/shadow-locks/pick.md). */
export const PALETTE = {
  frame: "#1c191d",
  lining: "#0d0b0e",
  brass: "#e2bd62",
  gold: "#ffd36a",
  goldHot: "#fffbe6",
  goldDeep: "#9c7424",
  lantern: "#fff0d2",
} as const;

/**
 * A camera on the box, in box units (x right, y up across the back panel, z out of the box toward the
 * player; the panel is z = 0, the open front z = 1, 1 unit = the box size), so a view keeps working
 * whatever the box's size and placement. `vfovDeg` is the vertical field of view.
 */
export interface BoxView {
  eye: V3;
  at: V3;
  vfovDeg: number;
}

/** What is in a plate: box `n` with its lantern on lock `lock`'s spot (or at its start). */
export interface PlateScene {
  box: number;
  /** Lantern on this lock's spot (its shadows then make the lock's shape); undefined: at the start. */
  lock?: number;
  /** Locks shown open (their gold fill). */
  open?: number[];
}

export type PlateKind =
  /** The box alone on a transparent background (the room not drawn): for branded art and the icon. */
  | "box"
  /** A real frame, the room and any panel included: for screenshots. */
  | "frame";

export interface Plate {
  name: string;
  width: number;
  height: number;
  kind: PlateKind;
  scene: PlateScene;
  /** Branded art and the icon frame the box; screenshots set their own camera in store.spec.ts. */
  view?: BoxView;
}

/** Where the title goes: its centre as fractions of the width and height, its size as a fraction of the height. */
export interface TitlePlacement {
  x: number;
  y: number;
  size: number;
  align: "left" | "center";
  /** The title is shrunk to fit this fraction of the width. */
  maxWidth: number;
}

export interface Art {
  /** File name under plan/store/assets/. */
  file: string;
  width: number;
  height: number;
  /** The plate it is cut from (scaled to width x height), or none for the logo. */
  plate?: string;
  title?: TitlePlacement;
  /** 24-bit RGB, or 32-bit with transparency (the logo only). */
  alpha: boolean;
}

// Box views: from well back with a narrow field of view (a product shot: little perspective, the whole frame in view,
// the box's front edges included). The lantern sits in front of the box on its spot (store.spec.ts keeps the eye behind
// it). Each comment says where the box centre lands; the plates' JSON records where it really did. Tuned after the first
// render (2026-11-06): the hero's and mini's box moved right and back (the title touched it, the plinth was cut), the
// square's and portrait's box made smaller and higher (the title covered its base).
// The hero's title is centred (VRC.Quest.Asset.4, recommended), so the box stands to its right: the eye slides left of
// the box and looks almost straight ahead, which keeps the box seen nearly head-on. Box centre about 0.83 across.
const HERO_VIEW: BoxView = { eye: [-2.0, 0.35, 5.4], at: [-2.1, 0.02, 0.5], vfovDeg: 21 };
// Title on the left: box centre about 0.69 across (good in the first render).
const LANDSCAPE_VIEW: BoxView = { eye: [-0.5, 0.3, 3.7], at: [-0.55, 0.0, 0.5], vfovDeg: 28 };
// Title below the box: box centre about 0.33 down, the box and lantern clear of the title band (0.65 to 0.78).
const SQUARE_VIEW: BoxView = { eye: [0.2, 0.3, 5.2], at: [0.1, -0.49, 0.5], vfovDeg: 34 };
const PORTRAIT_VIEW: BoxView = { eye: [0.15, 0.3, 5.1], at: [0.05, -0.61, 0.5], vfovDeg: 40 };
// The box filling about 85% of the icon, centred.
const ICON_VIEW: BoxView = { eye: [0.25, 0.25, 3.45], at: [0.02, -0.02, 0.5], vfovDeg: 26 };

/** The key art's box and lock: the lantern on the lock's spot, the lock opening in gold. */
export const KEY_SCENE: PlateScene = { box: 3, lock: 0, open: [0] };

export const PLATES: Plate[] = [
  { name: "hero", width: 3000, height: 900, kind: "box", scene: KEY_SCENE, view: HERO_VIEW },
  // 3:1, not the hero's 10:3; drawn at twice its size and scaled down.
  { name: "mini", width: 2160, height: 720, kind: "box", scene: KEY_SCENE, view: HERO_VIEW },
  { name: "landscape", width: 2560, height: 1440, kind: "box", scene: KEY_SCENE, view: LANDSCAPE_VIEW },
  { name: "square", width: 1440, height: 1440, kind: "box", scene: KEY_SCENE, view: SQUARE_VIEW },
  { name: "portrait", width: 1008, height: 1440, kind: "box", scene: KEY_SCENE, view: PORTRAIT_VIEW },
  // Drawn at twice the icon's size and scaled down, for smooth edges.
  { name: "icon", width: 1024, height: 1024, kind: "box", scene: KEY_SCENE, view: ICON_VIEW },
];

/** The five screenshots: 2560x1440 real frames (store.spec.ts SCREENSHOTS sets up each one). */
export const SCREENSHOT_SIZE = { width: 2560, height: 1440 } as const;
export const SCREENSHOT_COUNT = 5;

const LEFT_TITLE = (size: number): TitlePlacement => ({ x: 0.255, y: 0.5, size, align: "center", maxWidth: 0.4 });
/** Centred in the frame, narrow enough to leave the box on the right clear. */
const CENTRE_TITLE = (size: number): TitlePlacement => ({ x: 0.5, y: 0.5, size, align: "center", maxWidth: 0.32 });

export const ART: Art[] = [
  { file: "hero-cover-3000x900.png", width: 3000, height: 900, plate: "hero", title: CENTRE_TITLE(0.2), alpha: false },
  { file: "cover-landscape-2560x1440.png", width: 2560, height: 1440, plate: "landscape", title: LEFT_TITLE(0.15), alpha: false },
  { file: "cover-square-1440x1440.png", width: 1440, height: 1440, plate: "square", title: { x: 0.5, y: 0.715, size: 0.105, align: "center", maxWidth: 0.84 }, alpha: false },
  { file: "cover-portrait-1008x1440.png", width: 1008, height: 1440, plate: "portrait", title: { x: 0.5, y: 0.705, size: 0.078, align: "center", maxWidth: 0.86 }, alpha: false },
  { file: "mini-landscape-1080x360.png", width: 1080, height: 360, plate: "mini", title: CENTRE_TITLE(0.21), alpha: false },
  { file: "icon-512x512.png", width: 512, height: 512, plate: "icon", alpha: false },
  { file: "logo-3000x800.png", width: 3000, height: 800, title: { x: 0.5, y: 0.5, size: 0.42, align: "center", maxWidth: 0.92 }, alpha: true },
];

export const screenshotFile = (i: number): string => `screenshot-${i}-${SCREENSHOT_SIZE.width}x${SCREENSHOT_SIZE.height}.png`;

/** A box on screen, in pixels. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where text may go on branded art: not in the top or bottom 20% (which also keeps it out of every
 * corner) and not within 4% of a side. The logo is text alone and has no such rule.
 */
export function textSafe(r: Rect, width: number, height: number): string | null {
  if (r.top < 0.2 * height) return `text starts ${((r.top / height) * 100).toFixed(1)}% from the top (the top 20% is kept clear)`;
  if (r.bottom > 0.8 * height) return `text ends ${((r.bottom / height) * 100).toFixed(1)}% down (the bottom 20% is kept clear)`;
  if (r.left < 0.04 * width || r.right > 0.96 * width) return "text runs into a side margin";
  return null;
}

/**
 * Where world point `p` lands in a `width` x `height` frame seen from `eye` looking at `at` (no roll,
 * like the headset), as fractions of the frame (0..1 from the left and from the top); null when it is
 * behind the eye. The same perspective IWER draws with its vertical field of view.
 */
export function project(p: V3, eye: V3, at: V3, vfovDeg: number, width: number, height: number): [number, number] | null {
  const f = norm(sub(at, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, eye);
  const z = dot(d, f);
  if (z <= 1e-6) return null;
  const t = Math.tan((vfovDeg * Math.PI) / 360);
  const aspect = width / height;
  return [0.5 + dot(d, r) / (z * t * aspect) / 2, 0.5 - dot(d, u) / (z * t) / 2];
}

/** IWER's `fovy` (radians) for a vertical field of view in degrees. */
export const fovyRad = (vfovDeg: number): number => (vfovDeg * Math.PI) / 180;

/** Eye in box units, moved back when needed so it stays at least `clear` units behind the lantern. */
export function eyeBehind(eye: V3, lanternZ: number, clear = 0.9): V3 {
  return [eye[0], eye[1], Math.max(eye[2], lanternZ + clear)];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One piece of art as a page of exactly width x height: a dark workshop backdrop with the lantern's
 * warm glow where the box stands (`glow`, fractions of the frame), the plate over it, a soft vignette
 * and the title in gold. The logo is the title alone on a transparent page.
 */
export function artHtml(a: Art, o: { plate?: string; glow?: [number, number]; fontDataUrl: string }): string {
  const { width: w, height: h } = a;
  const glow = o.glow ?? [0.65, 0.45];
  const t = a.title;
  const titleCss = t
    ? `.title { position: absolute; left: ${(t.x * w).toFixed(1)}px; top: ${(t.y * h).toFixed(1)}px; transform: translate(-50%, -50%);
  font-family: Limelight; font-size: ${(t.size * h).toFixed(1)}px; line-height: 1.12; white-space: nowrap; text-align: ${t.align};
  letter-spacing: 0.02em; padding: 0 0.04em;
  background: linear-gradient(180deg, ${PALETTE.goldHot} 4%, ${PALETTE.gold} 40%, ${PALETTE.brass} 64%, ${PALETTE.goldDeep} 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 ${(0.004 * h).toFixed(1)}px ${(0.012 * h).toFixed(1)}px rgba(0, 0, 0, 0.75)) drop-shadow(0 0 ${(0.03 * h).toFixed(1)}px rgba(255, 211, 106, 0.22)); }`
    : "";
  const backdrop = a.alpha
    ? ""
    : `<div class="bg"></div>${o.plate ? `<img class="plate" src="${o.plate}">` : ""}<div class="vignette"></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Limelight; src: url(${o.fontDataUrl}) format("truetype"); }
html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: ${a.alpha ? "transparent" : PALETTE.lining}; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(ellipse ${(0.55 * Math.max(w, h)).toFixed(0)}px ${(0.5 * Math.max(w, h)).toFixed(0)}px at ${(glow[0] * 100).toFixed(1)}% ${(glow[1] * 100).toFixed(1)}%,
    #4a3418 0%, #2b2017 26%, ${PALETTE.frame} 55%, ${PALETTE.lining} 100%); }
.plate { position: absolute; inset: 0; width: ${w}px; height: ${h}px; }
.vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.42) 100%); }
${titleCss}
</style></head><body>${backdrop}${t ? `<div class="title" id="title">${esc(TITLE)}</div>` : ""}</body></html>`;
}

/** The review sheet: every piece of art, scaled, with its file name, on one page. */
export function overviewHtml(items: Array<{ file: string; width: number; height: number; dataUrl: string }>, note: string): string {
  const cells = items
    .map((i) => {
      const scale = Math.min(560 / i.width, 300 / i.height);
      return `<figure><div class="checker"><img src="${i.dataUrl}" width="${Math.round(i.width * scale)}" height="${Math.round(i.height * scale)}"></div>
<figcaption>${esc(i.file)}</figcaption></figure>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; padding: 24px; width: 1792px; background: #141114; color: #efe6d2; font: 15px system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 18px; color: #cdb27a; }
main { display: flex; flex-wrap: wrap; gap: 18px; }
figure { margin: 0; }
.checker { display: inline-block; line-height: 0; background: repeating-conic-gradient(#2a2529 0% 25%, #1c191d 0% 50%) 0 0 / 20px 20px; }
figcaption { margin-top: 6px; color: #cdb27a; }
</style></head><body><h1>Shadow Locks: store art</h1><p>${esc(note)}</p><main>${cells}</main></body></html>`;
}
