// Painted faces (the plate, the keys on the box, the reward's story card): their transparent corners must not filter
// in black, which drew faint dark fringes round the keys' rounded corners.
import { describe, expect, it } from "vitest";
import { CustomBlending, Group, type Mesh, type MeshBasicMaterial, OneFactor, OneMinusSrcAlphaFactor } from "@iwsdk/core";
import { LabelCanvas, labelMaterial } from "../../src/render/label";
import { Reward } from "../../src/render/reward";
import { Plate } from "../../src/ui/plate";
import { PokeKey } from "../../src/ui/poke-key";

function premultiplied(m: MeshBasicMaterial): void {
  expect(m.map?.premultiplyAlpha).toBe(true);
  expect(m.transparent).toBe(true);
  // The colour is premultiplied already (the upload did it): the blend must not multiply by alpha again.
  expect(m.premultipliedAlpha).toBe(false);
  expect(m.blending).toBe(CustomBlending);
  expect([m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha]).toEqual([OneFactor, OneMinusSrcAlphaFactor, OneFactor, OneMinusSrcAlphaFactor]);
}

describe("painted faces", () => {
  it("upload premultiplied and blend as premultiplied, so a transparent corner never filters in black", () => {
    const l = new LabelCanvas(64, 32);
    expect(l.texture.premultiplyAlpha).toBe(true);
    const m = labelMaterial(l.texture);
    expect(m.map).toBe(l.texture);
    expect(m.toneMapped).toBe(false);
    premultiplied(m);
    expect(labelMaterial(l.texture, { depthWrite: false }).depthWrite).toBe(false);
  });

  it("the plate, the keys on the box and the reward's story card all paint that way", () => {
    const root = new Group();
    const key = new PokeKey("k", 0.1, 0.044, "Next box");
    new Plate(root);
    new Reward(root);
    // (The plate's temporary coach card went with the lessons: the coach line draws its own way.)
    const faces = [key.face, ...["Plate Face", "Reward Story"].map((n) => root.getObjectByName(n) as Mesh)];
    expect(faces.every((f) => !!f)).toBe(true);
    for (const f of faces) premultiplied(f.material as MeshBasicMaterial);
  });
});
