// The layout check for a menu panel as UIKit laid it out (test builds only): every text shown is no wider than its
// own box, sits inside every element around it (its key, its plate, the panel), breaks its lines only at spaces,
// keeps a gap from any text beside it, and in Japanese no line starts with a closing mark or ends with an opening
// one. The layout spec (tests/e2e/i18n-menus.spec.ts) runs it on every screen in every language.
import { type Matrix4, type Object3D, Vector3 } from "@iwsdk/core";
import { NO_END, NO_START } from "../render/label";

/** The parts of a UIKit component the check reads. */
export interface Comp extends Object3D {
  size?: { peek(): readonly [number, number] | undefined };
  globalMatrix?: { peek(): Matrix4 | undefined };
  isVisible?: { peek(): boolean };
  properties?: { peek?(): Record<string, unknown>; value: Record<string, unknown> };
  textLayout?: { peek(): { text: string; lines: { charIndexOffset: number; charLength: number; nonWhitespaceWidth: number }[] } | undefined };
}

export interface PanelTextProblem {
  /** The text's element id (or its nearest ancestor's). */
  id: string;
  text: string;
  problem: string;
}

const corner = new Vector3();

type Rect = readonly [number, number, number, number];

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

/**
 * The pairs of texts side by side (overlapping by over half the shorter one's height) whose letters are less than
 * `gap` apart, or overlap. Rectangles are the letters' extents, [left, right, bottom, top], in the panel's units.
 */
export function crowded(texts: readonly { id: string; r: Rect }[], gap: number): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]!.r, b = texts[j]!.r;
      const overlap = Math.min(a[3], b[3]) - Math.max(a[2], b[2]);
      if (overlap <= 0.5 * Math.min(a[3] - a[2], b[3] - b[2])) continue;
      if (Math.max(a[0], b[0]) - Math.min(a[1], b[1]) < gap) out.push([texts[i]!.id, texts[j]!.id]);
    }
  }
  return out;
}

/**
 * An element's rectangle in the panel's space, in its units (UIKit pixels, mm here): [left, right, bottom, top].
 * `from` and `to` pick a part of its width (-0.5 is its left edge, 0.5 its right). UIKit's global matrix places
 * an element in pixelSize units while its size is in pixels, so the corners are scaled in and the result out.
 */
export function panelRect(c: Comp, from = -0.5, to = 0.5): [number, number, number, number] | null {
  const size = c.size?.peek(), m = c.globalMatrix?.peek();
  if (!size || !m) return null;
  const px = Number((c.properties?.peek?.() ?? c.properties?.value)?.pixelSize);
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

const idOf = (c: Comp): string | null => {
  const id = c.properties?.value.id;
  return typeof id === "string" ? id : null;
};

const isComp = (o: Object3D | null): o is Comp => !!o && "size" in o && "globalMatrix" in o;

/** The least gap between the letters of two texts side by side, in the panel's units (mm). */
const MIN_GAP = 2;

/** Every text of the panel under `root` that does not fit, and why. `tol` is in the panel's units (mm). */
export function panelTextProblems(root: Object3D, tol = 0.5): PanelTextProblem[] {
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
    // Where its letters are: the widest line, placed by its alignment.
    const align = (c.properties?.peek?.() ?? c.properties?.value)?.textAlign;
    const w = box[0] > 0 ? Math.min(1, widest / box[0]) : 1;
    const span =
      align === "right" ? panelRect(c, 0.5 - w, 0.5) : align === "center" ? panelRect(c, -w / 2, w / 2) : panelRect(c, -0.5, w - 0.5);
    if (span) letters.push({ id: id ?? "?", text: layout.text, r: span });
    const t = layout.text;
    layout.lines.forEach((line, i) => {
      if (i === 0) return;
      // Any language: a line breaks at a space, never inside a word.
      const cut = brokenWord(t, line.charIndexOffset);
      if (cut !== null) say(`line ${i + 1} breaks inside "${cut}"`);
      // Japanese: no line starts with a closing mark or small kana, none ends with an opening mark.
      const start = t.slice(line.charIndexOffset).trimStart()[0] ?? "";
      const before = t.slice(0, line.charIndexOffset).trimEnd().slice(-1);
      if (NO_START.has(start)) say(`line ${i + 1} starts with "${start}"`);
      if (NO_END.has(before)) say(`line ${i} ends with "${before}"`);
    });
  });
  // Two texts side by side keep a gap between their letters.
  for (const [a, b] of crowded(letters, MIN_GAP)) {
    const x = letters.find((t) => t.id === a), y = letters.find((t) => t.id === b);
    const apart = x && y ? Math.max(x.r[0], y.r[0]) - Math.min(x.r[1], y.r[1]) : Number.NaN;
    out.push({ id: a, text: x?.text ?? "", problem: `crowds ${b}: letters ${apart.toFixed(1)} mm apart (at least ${MIN_GAP})` });
  }
  return out;
}
