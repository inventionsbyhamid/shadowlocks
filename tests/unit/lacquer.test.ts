// The frame's lacquer grain (the owner's pick: lacquer #1c191d with grain #2a2529): fine streaks along each bar,
// drawn in the lacquer's own shader (no texture, no extra draw call), and none on parts without a grain direction.
import { describe, expect, it } from "vitest";
import { BoxGeometry, Color, MeshPhysicalMaterial } from "@iwsdk/core";
import { frameGeometry } from "../../src/render/box-scene";
import { grained, LACQUER_GRAIN, withGrain } from "../../src/render/lacquer";
import { mergeParts } from "../../src/render/merge";
import { COLORS } from "../../src/render/theme";

const axisOf = (a: { getX(i: number): number; getY(i: number): number; getZ(i: number): number }, i: number) =>
  [a.getX(i), a.getY(i), a.getZ(i)].join(",");

describe("the lacquer's grain", () => {
  it("each part carries the direction its grain runs; merged, every vertex keeps its own", () => {
    const a = grained(new BoxGeometry(1, 0.1, 0.1), "x"), b = grained(new BoxGeometry(0.1, 1, 0.1), "y");
    // Box geometries are indexed: merged, each face corner becomes its own vertex.
    const na = a.index!.count, nb = b.index!.count;
    const m = mergeParts([a, b], ["grain"]);
    const g = m.getAttribute("grain");
    expect(g.count).toBe(m.getAttribute("position").count);
    const seen = Array.from({ length: g.count }, (_, i) => axisOf(g, i));
    expect(seen.slice(0, na).every((s) => s === "1,0,0")).toBe(true);
    expect(seen.slice(na, na + nb).every((s) => s === "0,1,0")).toBe(true);
    // Merged without asking, nothing extra is kept (the other merged parts in the box stay as they were).
    expect(mergeParts([grained(new BoxGeometry(), "z")]).getAttribute("grain")).toBeUndefined();
  });

  it("the frame's grain runs along every bar: front to back, across and up, the slabs across", () => {
    const f = frameGeometry(), g = f.getAttribute("grain");
    expect(g.count).toBe(f.getAttribute("position").count);
    const kinds = new Set<string>();
    for (let i = 0; i < g.count; i++) kinds.add(axisOf(g, i));
    expect([...kinds].sort()).toEqual(["0,0,1", "0,1,0", "1,0,0"]);
  });

  it("the lacquer's shader tones its colour and sheen with the grain, with no texture; parts without a direction get none", () => {
    const m = withGrain(new MeshPhysicalMaterial({ color: COLORS.frame }));
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "#include <common>\nvoid main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n}",
    };
    m.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain("attribute vec3 grain;");
    expect(shader.vertexShader).toMatch(/#include <begin_vertex>\s*vGrainAxis = grain;\s*vGrainPos = position;/);
    // The colour: light streaks toward the grain tone, dark ones below the lacquer.
    expect(shader.fragmentShader).toMatch(
      /#include <color_fragment>\s*float grainK = lacquerGrain\(vGrainPos, vGrainAxis\);\s*diffuseColor\.rgb = lacquerTone\(diffuseColor\.rgb, grainK\);/,
    );
    expect(shader.fragmentShader).toContain("mix(base, grainColor,");
    // The sheen: the base layer's roughness follows the streaks (the clearcoat's does not).
    expect(shader.fragmentShader).toMatch(/#include <roughnessmap_fragment>\s*roughnessFactor = clamp\(roughnessFactor - grainK \* /);
    expect(shader.fragmentShader).not.toContain("clearcoatRoughness");
    // It fades out where its streaks get finer than a pixel (no shimmer in the headset).
    expect(shader.fragmentShader).toContain("fwidth(");
    expect((shader.uniforms.grainColor!.value as Color).getHex()).toBe(new Color(COLORS.frameGrain).getHex());
    expect(COLORS.frameGrain).toBe("#2a2529");
    // A part with no grain attribute (the lantern's foot shares this lacquer) reads no direction: plain lacquer.
    expect((m as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues.grain).toEqual([0, 0, 0]);
    expect(m.customProgramCacheKey()).toBe("sl-lacquer-grain");
    // Subtle: streaks a few millimetres apart at the box's size, never brighter than the grain tone, never black, the
    // sheen moved a little.
    expect(LACQUER_GRAIN.strength).toBeLessThanOrEqual(1);
    expect(LACQUER_GRAIN.dark).toBeGreaterThanOrEqual(0.4);
    expect(LACQUER_GRAIN.roughness).toBeLessThanOrEqual(0.25);
    expect(LACQUER_GRAIN.streaksPerUnit).toBeGreaterThan(30);
  });
});
