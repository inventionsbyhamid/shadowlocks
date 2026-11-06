import { describe, expect, it } from "vitest";
import { BackSide, type Mesh, type MeshBasicMaterial, Vector3 } from "@iwsdk/core";
import { HAND_MASK_ORDER } from "../../src/render/hand-mask";
import { ROOM } from "../../src/render/theme";
import { roomLightFor, Theatre, THEATRE } from "../../src/render/theatre";

const DT = 1 / 72;

/** Step `s` seconds in frames; returns the veil's opacity after each frame. */
function run(t: Theatre, s: number, head?: Vector3): number[] {
  const out: number[] = [];
  for (let k = 0; k < Math.round(s / DT); k++) {
    t.update(DT, head);
    out.push(t.opacity);
  }
  return out;
}

const veilMat = (t: Theatre) => t.veil.material as MeshBasicMaterial;

describe("theatre lights", () => {
  it("starts with the room at full light and the veil not drawn", () => {
    const t = new Theatre();
    expect(t.opacity).toBe(0);
    expect(t.light).toBe("up");
    t.update(DT);
    expect(t.veil.visible).toBe(false);
  });

  it("dims the room to 35% over 0.8 s while a box is in play, smoothly", () => {
    const t = new Theatre();
    t.dim(true);
    expect(t.light).toBe("play");
    const xs = run(t, THEATRE.fadeS);
    // Rises every frame, never jumps by more than a few per cent a frame, lands exactly on 0.65.
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!);
      expect(xs[i]! - xs[i - 1]!).toBeLessThan(0.03);
    }
    expect(xs.at(-1)).toBeCloseTo(1 - ROOM.play, 6);
    expect(xs[Math.floor(xs.length / 2)]!).toBeGreaterThan(0.2);
    expect(xs[Math.floor(xs.length / 2)]!).toBeLessThan(0.45);
    // Eased: the first and last frames move less than the middle ones.
    expect(xs[1]! - xs[0]!).toBeLessThan(xs[Math.floor(xs.length / 2)]! - xs[Math.floor(xs.length / 2) - 1]!);
    expect(t.veil.visible).toBe(true);
    expect(veilMat(t).opacity).toBeCloseTo(t.opacity, 6);
    expect(1 - t.opacity).toBeCloseTo(0.35, 6);
  });

  it("brings the light back up over 0.8 s, and stops drawing the veil once the room is full", () => {
    const t = new Theatre();
    t.dim(true);
    run(t, 1);
    t.dim(false);
    expect(t.light).toBe("up");
    const xs = run(t, THEATRE.fadeS);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThanOrEqual(xs[i - 1]!);
    expect(xs.at(-1)).toBe(0);
    expect(t.veil.visible).toBe(false);
  });

  it("dims the room to 55% while a menu is open", () => {
    const t = new Theatre();
    t.setLight("menu");
    run(t, 1);
    expect(1 - t.opacity).toBeCloseTo(ROOM.menu, 6);
    expect(1 - t.opacity).toBeCloseTo(0.55, 6);
  });

  it("never dims the room below 35%", () => {
    for (const light of ["up", "menu", "play"] as const) {
      const t = new Theatre();
      t.setLight(light);
      run(t, 2);
      expect(1 - t.opacity).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(1 - THEATRE.opacity[light]).toBeGreaterThanOrEqual(0.35 - 1e-9);
    }
  });

  it("dims nothing when room dimming is off, and dims again when it is turned back on", () => {
    const t = new Theatre();
    t.dim(true);
    run(t, 1);
    t.setEnabled(false);
    expect(run(t, THEATRE.fadeS).at(-1)).toBe(0);
    // A box in play or a menu changes nothing while it is off.
    t.setLight("menu");
    t.dim(true);
    expect(run(t, 1).every((o) => o === 0)).toBe(true);
    expect(t.veil.visible).toBe(false);
    t.setEnabled(true);
    expect(run(t, THEATRE.fadeS).at(-1)).toBeCloseTo(1 - ROOM.play, 6);
  });

  it("a change half way through a fade starts from where the light is: no jump", () => {
    const t = new Theatre();
    t.dim(true);
    const up = run(t, THEATRE.fadeS / 2);
    t.setLight("menu");
    const back = run(t, THEATRE.fadeS);
    expect(Math.abs(back[0]! - up.at(-1)!)).toBeLessThan(0.03);
    expect(back.at(-1)).toBeCloseTo(1 - ROOM.menu, 6);
    // Asking for the light it already heads to does not restart the fade.
    t.dim(true);
    run(t, THEATRE.fadeS / 2);
    const mid = t.opacity;
    t.dim(true);
    t.update(DT);
    expect(t.opacity).toBeGreaterThanOrEqual(mid);
  });

  it("a long hitch finishes the fade rather than overshooting it", () => {
    const t = new Theatre();
    t.dim(true);
    t.update(5);
    expect(t.opacity).toBeCloseTo(1 - ROOM.play, 6);
    t.update(-1);
    expect(t.opacity).toBeCloseTo(1 - ROOM.play, 6);
  });

  it("the veil is an inside-out sphere 3 m round the head, drawn before everything see-through, writing no depth", () => {
    const t = new Theatre();
    const head = new Vector3(0.3, 1.2, -1.4);
    t.dim(true);
    run(t, 0.1, head);
    expect(t.veil.position.toArray()).toEqual(head.toArray());
    const mat = veilMat(t);
    expect(mat.side).toBe(BackSide);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(true);
    expect(mat.toneMapped).toBe(false);
    expect(t.veil.frustumCulled).toBe(false);
    expect(t.veil.renderOrder).toBeLessThan(HAND_MASK_ORDER);
    t.veil.geometry.computeBoundingSphere();
    expect(t.veil.geometry.boundingSphere!.radius).toBeCloseTo(THEATRE.radiusM, 3);
    expect(THEATRE.radiusM).toBe(3);
    // Near black, with a breath of the cool film tint.
    const c = mat.color;
    expect(Math.max(c.r, c.g, c.b)).toBeLessThan(0.02);
    expect(c.b).toBeGreaterThanOrEqual(c.r);
  });

  it("a virtual room for when there is no passthrough: opaque, dark, round the veil", () => {
    const t = new Theatre();
    const meshes: Mesh[] = [];
    t.room.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(2);
    for (const m of meshes) {
      const mat = m.material as MeshBasicMaterial;
      expect(mat.transparent).toBe(false);
      m.geometry.computeBoundingSphere();
      // Centred on the box, it still holds the seated head (about 0.6 m away) and the veil round it.
      expect(m.geometry.boundingSphere!.radius).toBeGreaterThan(THEATRE.radiusM + 0.75);
    }
    expect(t.room.name).toBe("Theatre Room");
  });

  it("menus and boot dim to the menu light, play to the play light", () => {
    expect(roomLightFor("play")).toBe("play");
    expect(roomLightFor("home")).toBe("menu");
    expect(roomLightFor("settings")).toBe("menu");
    expect(roomLightFor("boot")).toBe("menu");
  });
});
