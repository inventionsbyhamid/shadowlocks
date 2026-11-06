// The Meta Horizon Store art, made from the game itself: plates (frames rendered in the emulator on
// the virtual clock: the box lit by its lantern, from a set camera) and the art cut from them, with the
// title set in the brand font (Limelight, OFL) where the store wants it. Pure data and maths here; the
// browser work is in tests/video/store.spec.ts (scripts/store-art.sh runs it on the build server).
//
// Sizes and rules: Meta's asset guidelines (2026-05-11), plan/shadow-locks-ship-steps.md step 21, and the
// art direction (2026-11-06): branded art carries the exact title and nothing else (no tagline, price,
// badge, or text in a corner or in the top or bottom 20%), the title keeps clear of the box, the covers
// show one clean lock filling gold under the lantern, the icon is the lantern and one gold lock shape.
import { generateBox } from "../../../src/core/generator";
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

/** What is in a plate: box `n` with its lantern on lock `lock`'s spot (or at its start), chosen locks shown open. */
export interface PlateScene {
  box: number;
  lock?: number;
  open?: number[];
}

export interface Plate {
  name: string;
  width: number;
  height: number;
  scene: PlateScene;
  /** A camera on the box (the covers). */
  view?: BoxView;
  /** A camera on the lantern alone, `offset` (box units) from it, the box out of frame (the icon). */
  lanternView?: { offset: V3; vfovDeg: number };
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
  /** The plate it is cut from, or none for the logo. */
  plate?: string;
  title?: TitlePlacement;
  /** 24-bit RGB, or 32-bit with transparency (the logo only). */
  alpha: boolean;
  /** The icon: the key lock's shape in gold, with the plate (the lantern alone) placed over it. */
  icon?: boolean;
}

/**
 * The key art: box 1 (one lock, two decoys: the idea, not a scatter of shards) with its lantern on the lock's spot,
 * the lock filling gold.
 */
export const KEY_SCENE: PlateScene = { box: 1, lock: 0, open: [0] };

/**
 * Where the box can be, in box units: frame and glass, the plinth under the floor, a little margin. The title must keep
 * clear of it, and every cover must hold all of it (and the lantern).
 */
export const BOX_EXTENT = { min: [-0.62, -0.8, -0.06] as V3, max: [0.62, 0.62, 1.1] as V3 };

// Box views: from well back with a narrow field of view (a product shot: little perspective, the whole box in view).
// The lantern sits in front of the box on its spot (store.spec.ts keeps the eye behind it). tests/unit/store-art.test.ts
// checks every view: the box and lantern inside the frame, the title clear of them.
// The hero's title is centred (VRC.Quest.Asset.4, recommended), so the box stands to its right: the eye slides left of
// the box and looks almost straight ahead, which keeps the box seen nearly head-on.
const HERO_VIEW: BoxView = { eye: [-1.75, 0.3, 5.6], at: [-1.85, -0.1, 0.5], vfovDeg: 23 };
const MINI_VIEW: BoxView = { eye: [-1.75, 0.3, 6.0], at: [-1.85, -0.1, 0.5], vfovDeg: 24 };
// Title on the left, box on the right.
const LANDSCAPE_VIEW: BoxView = { eye: [-0.95, 0.3, 4.8], at: [-1.0, -0.16, 0.5], vfovDeg: 30 };
// Title below the box: the box and lantern in the upper part, clear of the title band.
const SQUARE_VIEW: BoxView = { eye: [0.2, 0.3, 5.6], at: [0.1, -0.62, 0.5], vfovDeg: 34 };
const PORTRAIT_VIEW: BoxView = { eye: [0.15, 0.3, 5.6], at: [0.05, -0.78, 0.5], vfovDeg: 40 };

export const PLATES: Plate[] = [
  { name: "hero", width: 3000, height: 900, scene: KEY_SCENE, view: HERO_VIEW },
  // 3:1, not the hero's 10:3; drawn at twice its size and scaled down.
  { name: "mini", width: 2160, height: 720, scene: KEY_SCENE, view: MINI_VIEW },
  { name: "landscape", width: 2560, height: 1440, scene: KEY_SCENE, view: LANDSCAPE_VIEW },
  { name: "square", width: 1440, height: 1440, scene: KEY_SCENE, view: SQUARE_VIEW },
  { name: "portrait", width: 1008, height: 1440, scene: KEY_SCENE, view: PORTRAIT_VIEW },
  // The lantern alone, from its right and a little above and in front, so the box lies outside the frame.
  { name: "icon-lantern", width: 1024, height: 1024, scene: KEY_SCENE, lanternView: { offset: [0.56, 0.08, 0.2], vfovDeg: 22 } },
];

/** The five screenshots: 2560x1440 real frames (store.spec.ts SCREENSHOTS sets up each one). */
export const SCREENSHOT_SIZE = { width: 2560, height: 1440 } as const;
export const SCREENSHOT_COUNT = 5;

const LEFT_TITLE = (size: number): TitlePlacement => ({ x: 0.255, y: 0.5, size, align: "center", maxWidth: 0.36 });
/** Centred in the frame, narrow enough to leave the box on the right clear. */
const CENTRE_TITLE = (size: number): TitlePlacement => ({ x: 0.5, y: 0.5, size, align: "center", maxWidth: 0.3 });

export const ART: Art[] = [
  { file: "hero-cover-3000x900.png", width: 3000, height: 900, plate: "hero", title: CENTRE_TITLE(0.2), alpha: false },
  { file: "cover-landscape-2560x1440.png", width: 2560, height: 1440, plate: "landscape", title: LEFT_TITLE(0.14), alpha: false },
  { file: "cover-square-1440x1440.png", width: 1440, height: 1440, plate: "square", title: { x: 0.5, y: 0.72, size: 0.1, align: "center", maxWidth: 0.8 }, alpha: false },
  { file: "cover-portrait-1008x1440.png", width: 1008, height: 1440, plate: "portrait", title: { x: 0.5, y: 0.72, size: 0.075, align: "center", maxWidth: 0.84 }, alpha: false },
  { file: "mini-landscape-1080x360.png", width: 1080, height: 360, plate: "mini", title: { ...CENTRE_TITLE(0.2), maxWidth: 0.27 }, alpha: false },
  { file: "icon-512x512.png", width: 512, height: 512, plate: "icon-lantern", alpha: false, icon: true },
  { file: "logo-3000x800.png", width: 3000, height: 800, title: { x: 0.5, y: 0.5, size: 0.42, align: "center", maxWidth: 0.92 }, alpha: true },
];

export const screenshotFile = (i: number): string => `screenshot-${i}-${SCREENSHOT_SIZE.width}x${SCREENSHOT_SIZE.height}.png`;

/** A box on screen, in pixels (or fractions of the frame, where a name says so). */
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

/** The title keeps `margin` (same units) of clear space from the box: their rectangles must not come closer. */
export function clearOf(title: Rect, box: Rect, margin: number): string | null {
  const apart =
    title.right + margin <= box.left || box.right + margin <= title.left || title.bottom + margin <= box.top || box.bottom + margin <= title.top;
  return apart ? null : "the title runs into the box (or comes within its clear space)";
}

/** A rectangle given as fractions of a frame, in pixels of a `width` x `height` frame. */
export const toPixels = (r: Rect, width: number, height: number): Rect => ({
  left: r.left * width,
  right: r.right * width,
  top: r.top * height,
  bottom: r.bottom * height,
});

/** The title's largest possible box (fractions of the frame): it is shrunk to its width limit, never wider. */
export function titleBound(t: TitlePlacement): Rect {
  // artHtml centres the title on (x, y) whatever its alignment; its height is the line box (1.12 of the size), as a
  // fraction of the height, and its width at most maxWidth of the width.
  const halfW = t.maxWidth / 2;
  const halfH = (t.size * 1.12) / 2;
  return { left: t.x - halfW, right: t.x + halfW, top: t.y - halfH, bottom: t.y + halfH };
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

/** The eight corners of BOX_EXTENT, and the lantern if given (box units). */
export function boxPoints(lantern?: V3): V3[] {
  const { min, max } = BOX_EXTENT;
  const pts: V3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) pts.push([x, y, z]);
  if (lantern) pts.push(lantern);
  return pts;
}

/** The screen rectangle (fractions) around `points` seen through `project`, or null when one is behind the eye. */
export function boundsOf(points: Array<[number, number] | null>): Rect | null {
  if (points.some((p) => p === null)) return null;
  const xs = points.map((p) => p![0]);
  const ys = points.map((p) => p![1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/**
 * The box and lantern on screen for a plate's view, worked out in box units (the box stands upright, so box units are
 * world metres turned and scaled, and a perspective view is the same in both). store.spec.ts measures the same in world
 * metres at render time.
 */
export function boxBoundsFor(view: BoxView, lantern: V3 | undefined, width: number, height: number): Rect | null {
  const eye = eyeBehind(view.eye, lantern?.[2] ?? 0);
  return boundsOf(boxPoints(lantern).map((p) => project(p, eye, view.at, view.vfovDeg, width, height)));
}

/** The key scene's lantern spot (box units), from the generator's own box. */
export function keyLantern(scene: PlateScene = KEY_SCENE): V3 | undefined {
  if (scene.lock === undefined) return undefined;
  const l = generateBox({ kind: "box", n: scene.box }).locks[scene.lock];
  return l ? ([...l.L] as V3) : undefined;
}

/**
 * The key lock's shape as the icon draws it: the lock's outline pieces (panel units), centred and scaled to fit a unit
 * square (0..1, y down), keeping their proportions.
 */
export function keySilhouette(scene: PlateScene = KEY_SCENE): Array<Array<[number, number]>> {
  const l = generateBox({ kind: "box", n: scene.box }).locks[scene.lock ?? 0];
  if (!l) return [];
  const pts = l.target.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.max(x1 - x0, y1 - y0) || 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return l.target.map((poly) => poly.map(([x, y]) => [0.5 + (x - cx) / s, 0.5 - (y - cy) / s] as [number, number]));
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

/** Where the icon puts its two parts (fractions of the icon): the gold lock shape, and the lantern plate over it. */
export const ICON_LAYOUT = { shape: { x: 0.08, y: 0.06, size: 0.66 }, lantern: { x: 0.36, y: 0.34, size: 0.62 } } as const;

/**
 * One piece of art as a page of exactly width x height: a dark workshop backdrop with the lantern's warm glow where the
 * box stands (`glow`, fractions of the frame), the plate over it, a soft vignette and the title in gold. The icon has the
 * key lock's shape in gold under the lantern plate instead. The logo is the title alone on a transparent page.
 */
export function artHtml(
  a: Art,
  o: { plate?: string; glow?: [number, number]; fontDataUrl: string; silhouette?: Array<Array<[number, number]>> },
): string {
  const { width: w, height: h } = a;
  const glow = o.glow ?? (a.icon ? [ICON_LAYOUT.lantern.x + ICON_LAYOUT.lantern.size / 2, ICON_LAYOUT.lantern.y + ICON_LAYOUT.lantern.size / 2] : [0.65, 0.45]);
  const t = a.title;
  const titleCss = t
    ? `.title { position: absolute; left: ${(t.x * w).toFixed(1)}px; top: ${(t.y * h).toFixed(1)}px; transform: translate(-50%, -50%);
  font-family: Limelight; font-size: ${(t.size * h).toFixed(1)}px; line-height: 1.12; white-space: nowrap; text-align: ${t.align};
  letter-spacing: 0.02em; padding: 0 0.04em;
  background: linear-gradient(180deg, ${PALETTE.goldHot} 4%, ${PALETTE.gold} 40%, ${PALETTE.brass} 64%, ${PALETTE.goldDeep} 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 ${(0.004 * h).toFixed(1)}px ${(0.012 * h).toFixed(1)}px rgba(0, 0, 0, 0.75)) drop-shadow(0 0 ${(0.03 * h).toFixed(1)}px rgba(255, 211, 106, 0.22)); }`
    : "";
  let body = "";
  if (!a.alpha) {
    body += `<div class="bg"></div>`;
    if (a.icon) {
      const sh = ICON_LAYOUT.shape;
      const ln = ICON_LAYOUT.lantern;
      const polys = (o.silhouette ?? [])
        .map((p) => `<polygon points="${p.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(" ")}"/>`)
        .join("");
      body += `<svg class="shape" viewBox="0 0 100 100" style="left:${sh.x * w}px;top:${sh.y * h}px;width:${sh.size * w}px;height:${sh.size * h}px">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PALETTE.goldHot}"/><stop offset="0.45" stop-color="${PALETTE.gold}"/><stop offset="1" stop-color="${PALETTE.goldDeep}"/></linearGradient></defs>
<g fill="url(#g)" stroke="${PALETTE.goldHot}" stroke-width="0.8" stroke-linejoin="round">${polys}</g></svg>`;
      if (o.plate) body += `<img class="plate" src="${o.plate}" style="left:${ln.x * w}px;top:${ln.y * h}px;width:${ln.size * w}px;height:${ln.size * h}px">`;
    } else if (o.plate) {
      body += `<img class="plate" src="${o.plate}" style="left:0;top:0;width:${w}px;height:${h}px">`;
    }
    body += `<div class="vignette"></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Limelight; src: url(${o.fontDataUrl}) format("truetype"); }
html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: ${a.alpha ? "transparent" : PALETTE.lining}; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(ellipse ${(0.55 * Math.max(w, h)).toFixed(0)}px ${(0.5 * Math.max(w, h)).toFixed(0)}px at ${(glow[0] * 100).toFixed(1)}% ${(glow[1] * 100).toFixed(1)}%,
    #4a3418 0%, #2b2017 26%, ${PALETTE.frame} 55%, ${PALETTE.lining} 100%); }
.plate, .shape { position: absolute; }
.shape { filter: drop-shadow(0 0 ${(0.03 * h).toFixed(1)}px rgba(255, 211, 106, 0.45)); }
.vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.42) 100%); }
${titleCss}
</style></head><body>${body}${t ? `<div class="title" id="title">${esc(TITLE)}</div>` : ""}</body></html>`;
}

/** The review sheet: every piece of art with its file name; `actual: true` shows an image at its own size (the icon at 64 and 128 px). */
export function overviewHtml(items: Array<{ file: string; width: number; height: number; dataUrl: string; actual?: boolean }>, note: string): string {
  const cells = items
    .map((i) => {
      const scale = i.actual ? 1 : Math.min(560 / i.width, 300 / i.height);
      return `<figure><div class="checker"><img src="${i.dataUrl}" width="${Math.round(i.width * scale)}" height="${Math.round(i.height * scale)}"></div>
<figcaption>${esc(i.file)}</figcaption></figure>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; padding: 24px; width: 1792px; background: #141114; color: #efe6d2; font: 15px system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 18px; color: #cdb27a; }
main { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
figure { margin: 0; }
.checker { display: inline-block; line-height: 0; background: repeating-conic-gradient(#2a2529 0% 25%, #1c191d 0% 50%) 0 0 / 20px 20px; }
figcaption { margin-top: 6px; color: #cdb27a; }
</style></head><body><h1>Shadow Locks: store art</h1><p>${esc(note)}</p><main>${cells}</main></body></html>`;
}
