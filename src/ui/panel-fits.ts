// The layout check for a menu panel as UIKit laid it out (test builds only): every text shown is no wider than its
// own box, sits inside every element around it (its key, its plate, the panel), and in Japanese no line starts with
// a closing mark or ends with an opening one. The layout spec (tests/e2e/i18n-menus.spec.ts) runs it on every
// screen in every language.
import { type Matrix4, type Object3D, Vector3 } from "@iwsdk/core";
import { NO_END, NO_START } from "../render/label";

/** The parts of a UIKit component the check reads. */
interface Comp extends Object3D {
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

/** An element's rectangle in the panel's space: [left, right, bottom, top]. */
function rect(c: Comp): [number, number, number, number] | null {
  const size = c.size?.peek(), m = c.globalMatrix?.peek();
  if (!size || !m) return null;
  let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity;
  for (const [x, y] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ] as const) {
    corner.set(x * size[0], y * size[1], 0).applyMatrix4(m);
    l = Math.min(l, corner.x);
    r = Math.max(r, corner.x);
    b = Math.min(b, corner.y);
    t = Math.max(t, corner.y);
  }
  return [l, r, b, t];
}

const idOf = (c: Comp): string | null => {
  const id = c.properties?.value.id;
  return typeof id === "string" ? id : null;
};

const isComp = (o: Object3D | null): o is Comp => !!o && "size" in o && "globalMatrix" in o;

/** Every text of the panel under `root` that does not fit, and why. `tol` is in the panel's units (mm). */
export function panelTextProblems(root: Object3D, tol = 0.5): PanelTextProblem[] {
  const out: PanelTextProblem[] = [];
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
    const r = rect(c);
    if (r) {
      for (let p = c.parent; p; p = p.parent) {
        if (!isComp(p)) continue;
        const a = rect(p);
        if (!a) continue;
        if (r[0] < a[0] - tol || r[1] > a[1] + tol || r[2] < a[2] - tol || r[3] > a[3] + tol) {
          say(`spills out of ${idOf(p) ?? "its container"} (${r.map((v) => v.toFixed(1)).join(", ")} in ${a.map((v) => v.toFixed(1)).join(", ")})`);
          break;
        }
      }
    }
    // Japanese: no line starts with a closing mark or small kana, none ends with an opening mark.
    const t = layout.text;
    layout.lines.forEach((line, i) => {
      if (i === 0) return;
      const start = t.slice(line.charIndexOffset).trimStart()[0] ?? "";
      const before = t.slice(0, line.charIndexOffset).trimEnd().slice(-1);
      if (NO_START.has(start)) say(`line ${i + 1} starts with "${start}"`);
      if (NO_END.has(before)) say(`line ${i} ends with "${before}"`);
    });
  });
  return out;
}
