// Where the menu panels stand: on the box's open drawer, leaning back from upright. A headset's lean is the lap's
// number exactly; on a phone's leaning box a panel keeps the lap's angle to the box, so no panel reaches into the box
// mouth at either of the phone's lean limits (-20 and 40 degrees).
import { Euler, type Matrix4, Vector3 } from "@iwsdk/core";
import { describe, expect, it } from "vitest";
import type { V3 } from "../../src/core/types";
import { DRAWER_PANEL_ANCHOR } from "../../src/render/drawer";
import { PHONE_LEAN_DEG, Placement, TILT_DEG, worldToBox } from "../../src/render/placement";
import { MENU_PLACE, panelLean, standPanel } from "../../src/ui/menus/place";

const DEG = Math.PI / 180;

/** The box placed for each case: the lap's (a headset's), and a phone held level and pointed 60 degrees down. */
const CASES: [string, (p: Placement) => void, number][] = [
  ["a headset's lap", (p) => p.start({ position: [0.1, 1.2, -0.3], yaw: 0.6 }), TILT_DEG],
  ["a phone held level", (p) => p.startInView({ position: [0.1, 1.25, -0.3], yaw: 0.6 }, 0), PHONE_LEAN_DEG.min],
  ["a phone 60 degrees down", (p) => p.startInView({ position: [0.1, 1.25, -0.3], yaw: 0.6 }, -60 * DEG), PHONE_LEAN_DEG.max],
];

/** A panel `heightM` tall standing on box `m`'s drawer, leaning as for `tiltDeg`: its bottom and top edges' middles in box units. */
function panelInBox(m: Readonly<Matrix4>, yaw: number, tiltDeg: number, heightM: number): { bottom: V3; top: V3 } {
  const anchor = new Vector3(...DRAWER_PANEL_ANCHOR).applyMatrix4(m as Matrix4);
  const pos = new Vector3(), rot = new Euler();
  standPanel(anchor, yaw, tiltDeg, pos, rot);
  const up = new Vector3(0, 1, 0).applyEuler(rot);
  return {
    bottom: worldToBox(m as Matrix4, pos, [0, 0, 0]),
    top: worldToBox(m as Matrix4, pos.clone().addScaledVector(up, heightM), [0, 0, 0]),
  };
}

describe("the menu panels on the drawer", () => {
  it("a headset's lean is the lap's exactly; a phone's keeps the lap's angle to its leaning box", () => {
    expect(panelLean(TILT_DEG)).toBe(MENU_PLACE.leanRad);
    expect(MENU_PLACE.leanRad).toBeCloseTo(15 * DEG, 12);
    expect(panelLean(PHONE_LEAN_DEG.min)).toBeCloseTo(MENU_PLACE.leanRad + (PHONE_LEAN_DEG.min - TILT_DEG) * DEG, 12);
    expect(panelLean(PHONE_LEAN_DEG.max)).toBeCloseTo(MENU_PLACE.leanRad + (PHONE_LEAN_DEG.max - TILT_DEG) * DEG, 12);
    // Stood for a box: `toward` nearer the player along its heading, turned to it, leaning back panelLean.
    const pos = new Vector3(), rot = new Euler();
    standPanel(new Vector3(1, 0.8, -0.5), 0.6, TILT_DEG, pos, rot);
    expect(pos.distanceTo(new Vector3(1 + Math.sin(0.6) * MENU_PLACE.toward, 0.8, -0.5 + Math.cos(0.6) * MENU_PLACE.toward))).toBeLessThan(1e-12);
    expect([rot.x, rot.y, rot.z, rot.order]).toEqual([-MENU_PLACE.leanRad, 0.6, 0, "YXZ"]);
  });

  it("no panel up to 35 cm tall reaches into the box mouth, in the lap or on a phone's box at either lean limit", () => {
    for (const [name, place, tilt] of CASES) {
      for (const cm of [18, 24, 30]) {
        const p = new Placement();
        p.setSize(cm);
        place(p);
        expect(p.tiltDeg, name).toBeCloseTo(tilt, 9);
        for (const h of [0.1, 0.2, 0.35]) {
          const { bottom, top } = panelInBox(p.matrix(), p.pose().yaw, p.pose().tiltDeg, h);
          // In front of the mouth's plane (box z 1) from its bottom edge to its top.
          expect(bottom[2], `${name}, ${cm} cm box, ${h} m panel: bottom`).toBeGreaterThan(1.05);
          expect(top[2], `${name}, ${cm} cm box, ${h} m panel: top`).toBeGreaterThan(1.05);
        }
      }
    }
  });

  it("with the lap's lean on a phone's box held level, a panel would cut into the mouth (the check bites)", () => {
    const p = new Placement();
    p.startInView({ position: [0.1, 1.25, -0.3], yaw: 0.6 }, 0);
    const { top } = panelInBox(p.matrix(), p.pose().yaw, TILT_DEG, 0.25);
    expect(top[2]).toBeLessThan(1);
  });
});
