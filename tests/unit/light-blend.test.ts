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
  type Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  ZeroFactor,
} from "@iwsdk/core";
import { BoxOpenFx } from "../../src/render/fx/box-open";
import { FlashBudget } from "../../src/render/fx/flash-budget";
import { LockOpenFx } from "../../src/render/fx/lock-open";
import { LIGHT_BLEND } from "../../src/render/light-blend";
import { Reward } from "../../src/render/reward";

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

/** The materials of the objects under `o` named `name` (every lock burst slot is one). */
function named(o: Object3D, name: string): Material[] {
  const out: Material[] = [];
  o.traverse((x) => {
    if (x.name === name) out.push((x as unknown as { material: Material }).material);
  });
  return out;
}

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

  it("the celebrations' glows all add light: the lock's burst and sparkle, the box's burst and sweep, the reward's glow", () => {
    const budget = new FlashBudget();
    const lockRoot = new Group(), boxRoot = new Group(), rewardRoot = new Group();
    new LockOpenFx({ root: lockRoot, scrapMesh: () => ({ setGlow: () => {} }) }, budget);
    new BoxOpenFx(boxRoot, budget);
    new Reward(rewardRoot, budget);
    const bursts = named(lockRoot, "Lock Burst");
    expect(bursts.length).toBeGreaterThanOrEqual(2);
    const all = [
      ...bursts,
      ...named(lockRoot, "Lock Sparkle"),
      ...named(boxRoot, "Box Burst"),
      ...named(boxRoot, "Box Sweep"),
      ...named(rewardRoot, "Reward Glow"),
    ];
    expect(all).toHaveLength(bursts.length + 4);
    for (const m of all) {
      expect(m.transparent).toBe(true);
      expect(m.blending).toBe(CustomBlending);
      expect([m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha]).toEqual([SrcAlphaFactor, OneFactor, ZeroFactor, OneFactor]);
    }
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
