import { describe, expect, it } from "vitest";
import { BoxGeometry, ExtrudeGeometry, Shape } from "@iwsdk/core";
import { FLOOR_ORDER, frameGeometry, withoutFront } from "../../src/render/box-scene";
import { HAND_MASK_ORDER } from "../../src/render/hand-mask";
import { THEATRE } from "../../src/render/theatre";
import { SLAB_ORDER } from "../../src/ui/panel-slab";

/** Triangles of a non-indexed geometry lying flat in the plane z = `z`. */
function flatAt(g: { getAttribute(n: string): { count: number; getZ(i: number): number } }, z: number): number {
  const p = g.getAttribute("position");
  let n = 0;
  for (let t = 0; t + 2 < p.count; t += 3) if ([0, 1, 2].every((k) => Math.abs(p.getZ(t + k) - z) < 1e-6)) n++;
  return n;
}

describe("hidden overdraw", () => {
  it("draws what stands in front of the lacquer before it: the menu slabs and the velvet floor, after the veil and the hand mask", () => {
    // The box's other opaque parts (frame, trim, scraps, lantern) keep three's default order, 0.
    expect(THEATRE.renderOrder).toBeLessThan(HAND_MASK_ORDER);
    for (const order of [SLAB_ORDER, FLOOR_ORDER]) {
      expect(HAND_MASK_ORDER).toBeLessThan(order);
      expect(order).toBeLessThan(0);
    }
  });

  it("leaves out only a geometry's flat face at its largest z", () => {
    const s = new Shape();
    s.moveTo(-1, -1);
    s.lineTo(1, -1);
    s.lineTo(1, 1);
    s.lineTo(-1, 1);
    const g = new ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: false });
    const before = g.getAttribute("position").count / 3;
    const out = withoutFront(g);
    // A square cap is two triangles; the back cap and the four sides stay.
    expect(out.getAttribute("position").count / 3).toBe(before - 2);
    expect(flatAt(out, 0.5)).toBe(0);
    expect(flatAt(out, 0)).toBe(2);
    expect(out.getAttribute("normal").count).toBe(out.getAttribute("position").count);
    expect(withoutFront(new BoxGeometry(1, 1, 1)).getAttribute("position").count).toBe(36 - 6);
  });

  it("builds the frame without the back slab's front face, the face the panel covers", () => {
    // The back slab: 0.035 deep round z = -0.045, so its front face is at z = -0.0275 (box units).
    expect(flatAt(frameGeometry(), -0.045 + 0.035 / 2)).toBe(0);
  });
});
