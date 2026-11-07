// The layout check for a menu panel as UIKit laid it out (test builds only). Every text shown:
// - is no wider than its own box, and sits inside every element around it;
// - keeps its letters at least MARGIN inside its frame: the key's gold hairline where it has one, else the nearest
//   element drawn with a background or a border (a key cap, a plate, the panel);
// - breaks its lines only at spaces;
// - keeps its letters MIN_GAP from any other text's, side by side or one above the other;
// - in Japanese: no line starts with a closing mark or ends with an opening one, and no plain space is left that
//   PanelView did not put there (the Japanese atlas draws one with no width: "Shadow Locks" would read "ShadowLocks").
// Letters are measured by their em box: the line box less half the leading above and below.
// The layout spec (tests/e2e/i18n-menus.spec.ts) runs it on every screen in every language.
import { type Matrix4, type Object3D, Vector3 } from "@iwsdk/core";
import { NO_END, NO_START } from "../render/label";

/** The parts of a UIKit component the check reads. */
export interface Comp extends Object3D {
  size?: { peek(): readonly [number, number] | undefined };
  globalMatrix?: { peek(): Matrix4 | undefined };
  isVisible?: { peek(): boolean };
  properties?: { peek?(): Record<string, unknown>; value: Record<string, unknown> };
  classList?: { contains(c: string): boolean };
  textLayout?: { peek(): { text: string; lines: { charIndexOffset: number; charLength: number; nonWhitespaceWidth: number }[] } | undefined };
}

export interface PanelTextProblem {
  /** The text's element id (or its nearest ancestor's). */
  id: string;
  text: string;
  problem: string;
}

/** How the check reads a panel. */
export interface PanelCheck {
  /** Allowed overshoot (mm) for containment. */
  tol?: number;
  /** The panel is in Japanese. */
  japanese?: boolean;
  /** What PanelView last wrote on an element, by id (null: nothing). */
  wrote?: (id: string) => string | null;
}

const corner = new Vector3();

type Rect = readonly [number, number, number, number];

/** The least gap between the letters of two texts, side by side or one above the other (mm). */
const MIN_GAP = 2;
/** The least room between a text's letters and its frame (mm). */
const MARGIN = 1;

/**
 * The word a line break at `offset` of `text` falls inside, or null when the break is at a space (one ends the line
 * before or starts this one). UIKit breaks only at plain spaces unless a word is wider than its box: then it cuts
 * the word anywhere. A no-break space is part of its word.
 */
export function brokenWord(text: string, offset: number): string | null {
  if (text[offset - 1] === " " || text[offset] === " " || text[offset - 1] === "\n") return null;
  const from = text.lastIndexOf(" ", offset - 1) + 1;
  const to = text.indexOf(" ", offset);
  return text.slice(from, to < 0 ? text.length : to);
}

/** Two texts too close: side by side ("beside") or one above the other ("above"), `apart` mm (negative: overlap). */
export interface Crowding {
  a: string;
  b: string;
  how: "beside" | "above";
  apart: number;
}

/**
 * The pairs of texts whose letters are less than `gap` apart, or overlap. Side by side: overlapping by over half the
 * shorter one's height, measured across. One above the other: overlapping across, measured up and down. Rectangles
 * are the letters' extents, [left, right, bottom, top], in the panel's units.
 */
export function crowded(texts: readonly { id: string; r: Rect }[], gap: number): Crowding[] {
  const out: Crowding[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!.r, b = texts[j]!.r;
      const up = Math.min(a[3], b[3]) - Math.max(a[2], b[2]);
      const across = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
      if (up > 0.5 * Math.min(a[3] - a[2], b[3] - b[2])) {
        if (-across < gap) out.push({ a: texts[i]!.id, b: texts[j]!.id, how: "beside", apart: -across });
      } else if (across > 0 && -up < gap) out.push({ a: texts[i]!.id, b: texts[j]!.id, how: "above", apart: -up });
    }
  }
  return out;
}

/** A line box's letters: `r` less half the leading above and below, for `fontSize` lettering on `lineHeight` lines. */
export function emBox(r: Rect, fontSize: number, lineHeight: unknown): Rect {
  const lh =
    typeof lineHeight === "number" ? lineHeight : typeof lineHeight === "string" && lineHeight.endsWith("%") ? (parseFloat(lineHeight) / 100) * fontSize : fontSize * 1.2;
  const half = Math.max(0, (lh - fontSize) / 2);
  return [r[0], r[1], r[2] + half, r[3] - half];
}

/** How far inside `frame` the rectangle `r` sits, at its closest edge (negative: outside). */
export function insideBy(r: Rect, frame: Rect): number {
  return Math.min(r[0] - frame[0], frame[1] - r[1], r[2] - frame[2], frame[3] - r[3]);
}

/**
 * On a Japanese panel, a plain space PanelView did not put there (`wrote`: what it last wrote on the element, or
 * null). The Japanese atlas draws a plain space with no width, so only PanelView's own (places a line may break) may
 * stand; a space a reader sees is a no-break space.
 */
export function strayPlainSpace(text: string, japanese: boolean, wrote: string | null): boolean {
  return japanese && text.includes(" ") && wrote !== text;
}

/**
 * An element's rectangle in the panel's space, in its units (UIKit pixels, mm here): [left, right, bottom, top].
 * `from` and `to` pick a part of its width (-0.5 is its left edge, 0.5 its right). UIKit's global matrix places
 * an element in pixelSize units while its size is in pixels, so the corners are scaled in and the result out.
 */
export function panelRect(c: Comp, from = -0.5, to = 0.5): [number, number, number, number] | null {
  const size = c.size?.peek(), m = c.globalMatrix?.peek();
  if (!size || !m) return null;
  const px = Number(props(c)?.pixelSize);
  const ps = px > 0 ? px : 0.01;
  let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity;
  for (const [x, y] of [
    [from, -0.5],
    [to, -0.5],
    [from, 0.5],
    [to, 0.5],
  ] as const) {
    corner.set(x * size[0] * ps, y * size[1] * ps, 0).applyMatrix4(m);
    l = Math.min(l, corner.x / ps);
    r = Math.max(r, corner.x / ps);
    b = Math.min(b, corner.y / ps);
    t = Math.max(t, corner.y / ps);
  }
  return [l, r, b, t];
}

const props = (c: Comp): Record<string, unknown> | undefined => c.properties?.peek?.() ?? c.properties?.value;

const idOf = (c: Comp): string | null => {
  const id = c.properties?.value.id;
  return typeof id === "string" ? id : null;
};

const isComp = (o: Object3D | null): o is Comp => !!o && "size" in o && "globalMatrix" in o;

/** Drawn with a background or a border: an edge a reader sees. */
function boxed(c: Comp): boolean {
  const p = props(c);
  if (!p) return false;
  if (p.backgroundColor != null && p.backgroundColor !== "transparent") return true;
  return Object.entries(p).some(([k, v]) => /^border\w*Width$/.test(k) && Number(v) > 0);
}

/** The frame a text inside `c` reads against: its gold hairline child if it has one, else `c` itself. */
function frameOf(c: Comp): Comp {
  for (const ch of c.children) if (isComp(ch) && ch.classList?.contains("hair")) return ch;
  return c;
}

/** Every text of the panel under `root` that does not fit, and why. */
export function panelTextProblems(root: Object3D, check: PanelCheck = {}): PanelTextProblem[] {
  const { tol = 0.5, japanese = false, wrote } = check;
  const out: PanelTextProblem[] = [];
  const letters: { id: string; text: string; r: Rect }[] = [];
  root.traverse((o) => {
    const c = o as Comp;
    const layout = c.textLayout?.peek();
    if (!layout || layout.text.trim() === "") return;
    // Shown: the element and everything around it.
    for (let p: Object3D | null = c; p; p = p.parent) if (isComp(p) && p.isVisible && !p.isVisible.peek()) return;
    let id = idOf(c);
    for (let p = c.parent; !id && p; p = p.parent) if (isComp(p)) id = idOf(p);
    const say = (problem: string) => out.push({ id: id ?? "?", text: layout.text, problem });
    const box = c.size?.peek();
    if (!box) return;
    const widest = Math.max(0, ...layout.lines.map((l) => l.nonWhitespaceWidth));
    // The element's own box (UIKit wraps within it; one word wider than it spills out).
    if (widest > box[0] + tol) say(`a line is ${widest.toFixed(1)} wide in a ${box[0].toFixed(1)} box`);
    const r = panelRect(c);
    if (r) {
      for (let p = c.parent; p; p = p.parent) {
        if (!isComp(p)) continue;
        const a = panelRect(p);
        if (!a) continue;
        if (r[0] < a[0] - tol || r[1] > a[1] + tol || r[2] < a[2] - tol || r[3] > a[3] + tol) {
          say(`spills out of ${idOf(p) ?? "its container"} (${r.map((v) => v.toFixed(1)).join(", ")} in ${a.map((v) => v.toFixed(1)).join(", ")})`);
          break;
        }
      }
    }
    // Where its letters are: the widest line, placed by its alignment, by its em box.
    const p = props(c);
    const align = p?.textAlign;
    const w = box[0] > 0 ? Math.min(1, widest / box[0]) : 1;
    const span =
      align === "right" ? panelRect(c, 0.5 - w, 0.5) : align === "center" ? panelRect(c, -w / 2, w / 2) : panelRect(c, -0.5, w - 0.5);
    if (span) {
      const fs = Number(p?.fontSize);
      const em = fs > 0 ? emBox(span, fs, p?.lineHeight) : span;
      letters.push({ id: id ?? "?", text: layout.text, r: em });
      // Clear of its frame: the nearest element drawn with a background or a border (its hairline, for a key).
      for (let q = c.parent; q; q = q.parent) {
        if (!isComp(q) || !boxed(q)) continue;
        const f = frameOf(q), fr = panelRect(f);
        if (!fr) break;
        const room = insideBy(em, fr);
        if (room < MARGIN) say(`letters ${room.toFixed(1)} mm inside ${idOf(f) ?? idOf(q) ?? "their frame"} (at least ${MARGIN})`);
        break;
      }
    }
    const t = layout.text;
    if (strayPlainSpace(t, japanese, id !== null && wrote ? wrote(id) : null)) say("a plain space PanelView did not put there (none of its width in Japanese)");
    layout.lines.forEach((line, i) => {
      if (i === 0) return;
      // Any language: a line breaks at a space, never inside a word.
      const cut = brokenWord(t, line.charIndexOffset);
      if (cut !== null) say(`line ${i + 1} breaks inside "${cut}"`);
      // No line starts with a closing mark (or small kana, or °), none ends with an opening mark (or ¿ ¡).
      const start = t.slice(line.charIndexOffset).trimStart()[0] ?? "";
      const before = t.slice(0, line.charIndexOffset).trimEnd().slice(-1);
      if (NO_START.has(start)) say(`line ${i + 1} starts with "${start}"`);
      if (NO_END.has(before)) say(`line ${i} ends with "${before}"`);
    });
  });
  // Two texts keep a gap between their letters.
  for (const k of crowded(letters, MIN_GAP)) {
    const x = letters.find((t) => t.id === k.a);
    const where = k.how === "beside" ? "beside it" : "above or below it";
    out.push({ id: k.a, text: x?.text ?? "", problem: `crowds ${k.b} ${where}: letters ${k.apart.toFixed(1)} mm apart (at least ${MIN_GAP})` });
  }
  return out;
}
