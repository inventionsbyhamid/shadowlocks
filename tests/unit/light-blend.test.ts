// Light over passthrough. The headset lays the page over the room by the page's alpha (premultiplied), so a glow must
// add its colour and leave that alpha as it was. three's AdditiveBlending adds the source alpha to the page's as well:
// over the room the glow then paints it instead of lighting it, and a ray whose colour fades to black (the sunbursts,
// the ring beam) lays dark stripes over the room, as the box opening's burst did past the sides of the box.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AddEquation,
  CustomBlending,
  Group,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  ZeroFactor,
} from "@iwsdk/core";
import { HintMarks } from "../../src/app/hints";
import { BoxOpenFx } from "../../src/render/fx/box-open";
import { Crystals } from "../../src/render/fx/crystallise";
import { FlashBudget } from "../../src/render/fx/flash-budget";
import { LockOpenFx } from "../../src/render/fx/lock-open";
import { LanternView } from "../../src/render/lantern-view";
import { LIGHT_BLEND } from "../../src/render/light-blend";
import { Reward } from "../../src/render/reward";
import { RingBeam } from "../../src/render/ring-beam";
import { HintLantern } from "../../src/ui/hint-lantern";
import { Plate } from "../../src/ui/plate";

type Rgba = [number, number, number, number];

/** The page's pixel after drawing colour `c` at alpha `a` over `dst` with `m`'s custom blend (one channel's maths). */
function draw(m: Material, dst: Rgba, c: [number, number, number], a: number): Rgba {
  const f = (k: number | null | undefined, fallback: number) => {
    switch (k ?? fallback) {
      case OneFactor:
        return 1;
      case ZeroFactor:
        return 0;
      case SrcAlphaFactor:
        return a;
      case OneMinusSrcAlphaFactor:
        return 1 - a;
      default:
        throw new Error(`factor ${k}`);
    }
  };
  expect(m.blending).toBe(CustomBlending);
  expect(m.blendEquation).toBe(AddEquation);
  expect(m.blendEquationAlpha ?? m.blendEquation).toBe(AddEquation);
  const s = f(m.blendSrc, -1), d = f(m.blendDst, -1);
  const sa = f(m.blendSrcAlpha, m.blendSrc), da = f(m.blendDstAlpha, m.blendDst);
  return [c[0] * s + dst[0] * d, c[1] * s + dst[1] * d, c[2] * s + dst[2] * d, a * sa + dst[3] * da];
}

/** What the headset shows: the page (premultiplied) over the room. */
const over = (page: Rgba, room: number[]) => room.map((r, i) => page[i]! + (1 - page[3]) * r);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("light over the room", () => {
  it("adds its colour and leaves the page's alpha: a ray fading to black leaves the room as it was", () => {
    const m = new MeshBasicMaterial({ transparent: true, ...LIGHT_BLEND });
    const room = [0.8, 0.7, 0.6];
    // Nothing drawn yet past the box: the room shows. A black ray tip at 0.7 leaves it; a gold ray brightens it.
    const clear: Rgba = [0, 0, 0, 0];
    expect(over(draw(m, clear, [0, 0, 0], 0.7), room)).toEqual(room);
    const lit = over(draw(m, clear, [1, 0.8, 0.4], 0.5), room);
    for (let i = 0; i < 3; i++) expect(lit[i]).toBeGreaterThan(room[i]!);
    // Over the theatre's veil the room stays as dim as the veil made it, with the light added.
    const veil: Rgba = [0.02, 0.02, 0.02, 0.45];
    expect(draw(m, veil, [1, 0.8, 0.4], 0.5)[3]).toBe(0.45);
    // Over the box (opaque) it adds light as before.
    const box = draw(m, [0.2, 0.2, 0.2, 1], [1, 0.8, 0.4], 0.5);
    [0.7, 0.6, 0.4, 1].forEach((v, i) => expect(box[i]).toBeCloseTo(v, 9));
  });

  it("everything blended in the box adds light (LIGHT_BLEND) or is a painted face (labelMaterial), nothing else", () => {
    // The box's parts that blend: the celebrations, the plate and its keys, the hint lantern, the hint marks (beams
    // and ghost lanterns), the lantern (halo and ripple), the crystals (glitter) and the ring beam.
    const budget = new FlashBudget(), root = new Group();
    new LockOpenFx({ root, scrapMesh: () => ({ setGlow: () => {} }) }, budget);
    new BoxOpenFx(root, budget);
    new Reward(root, budget);
    new Plate(root);
    new HintLantern(root);
    new HintMarks({ root, scrapMesh: () => ({ setGlow: () => {} }), scraps: { setRingGlow: () => {} } });
    const lantern = new LanternView({ lacquer: new MeshStandardMaterial(), gold: new MeshStandardMaterial() }, budget);
    root.add(lantern.group, new Crystals(null, budget).group, new RingBeam().mesh);
    const LIGHT = [CustomBlending, AddEquation, SrcAlphaFactor, OneFactor, ZeroFactor, OneFactor];
    const LABEL = [CustomBlending, AddEquation, OneFactor, OneMinusSrcAlphaFactor, OneFactor, OneMinusSrcAlphaFactor];
    const light = new Set<string>(), label = new Set<string>(), other: string[] = [];
    root.traverse((o) => {
      const m = (o as { material?: Material }).material;
      if (!m || m.blending === NormalBlending || m.blending === NoBlending) return;
      const f = [m.blending, m.blendEquation, m.blendSrc, m.blendDst, m.blendSrcAlpha ?? m.blendSrc, m.blendDstAlpha ?? m.blendDst];
      const is = (want: number[]) => f.every((x, i) => x === want[i]);
      if (is(LIGHT)) light.add(o.name);
      else if (is(LABEL)) label.add(o.name);
      else other.push(`${o.name}: ${f.join(", ")}`);
    });
    expect(other).toEqual([]);
    // (The settle ripple's ring is drawn in the lantern's glow sprite.)
    const glows = ["Lock Burst", "Lock Sparkle", "Box Burst", "Box Sweep", "Reward Glow", "Lantern Glow"];
    glows.push("Hint Lantern Glow", "Ghost Lantern Glow", "Hint Beam", "Ring Beam", "Crystal Glitter");
    expect([...light].sort()).toEqual(glows.sort());
    for (const n of ["Plate Face", "Reward Story"]) expect(label.has(n)).toBe(true);
    // Every glow is in the transparent pass: drawn over what it lights.
    root.traverse((o) => {
      if (light.has(o.name)) expect((o as unknown as { material: Material }).material.transparent).toBe(true);
    });
  });

  it("nothing in the app uses three's AdditiveBlending (the lantern's halo, the hints, the ring beam, the crystal's glitter included)", () => {
    const src = join(__dirname, "../../src");
    const code = (p: string) =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => !/^\s*\/\//.test(l))
        .join("\n");
    const using = sourceFiles(src).filter((p) => /\bAdditiveBlending\b/.test(code(p)));
    expect(using.map((p) => p.slice(src.length + 1))).toEqual([]);
  });
});
