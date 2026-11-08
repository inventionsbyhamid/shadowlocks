// The panel at a box change (render/panel.ts, Panel.setBox): the new box's open locks and warmth never show over the
// previous box's etching. The shader takes an open lock's foil and a warm lock's glow from the masks texture bound and
// picks the lock by the nearest centre; the new masks and albedo upload only at the end of the etch plan, some twenty
// frames later. So until then the panel keeps the old centres and draws no foil and no warmth, and the foil fills from
// 0 once the new art is up. The paths that change boxes with open locks at once: Continue to the numbered box after a
// Daily Box, the Left hand setting rebuilding the box behind the menus (its mirror), and Continue after a practice box
// or a lesson. The canvases here draw nothing (no 2D canvas in the unit tests); the test watches the uniforms and the
// textures' uploads (a texture's version moves on each one).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateBox } from "../../src/core/generator";
import { lessonPlan } from "../../src/core/lessons-data";
import { mirrorBox } from "../../src/core/mirror";
import type { Box } from "../../src/core/types";
import { OPEN_FILL_S, Panel } from "../../src/render/panel";

const DT = 1 / 72;

/** A 2D context that accepts every call and draws nothing. */
function fakeContext(): unknown {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const t: Record<string | symbol, unknown> = {
    measureText: (s: string) => ({ width: s.length * 10 }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
  };
  return new Proxy(t, {
    get: (o, k) => (k in o ? o[k] : noop),
    set: (o, k, v) => {
      o[k] = v;
      return true;
    },
  });
}

class FakeCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext(): unknown {
    return fakeContext();
  }
}

beforeAll(() => vi.stubGlobal("OffscreenCanvas", FakeCanvas));
afterAll(() => vi.unstubAllGlobals());

/** The lock centres the shader gets for `box` (as float32, unused slots far away). */
function centres(box: Box): number[] {
  const c = new Float32Array(6).fill(1e3);
  for (const l of box.locks) {
    c[l.i * 2] = l.center[0];
    c[l.i * 2 + 1] = l.center[1];
  }
  return [...c];
}

const max = (a: Float32Array) => Math.max(...a);

/** The panel showing `box` etched, its locks `open` full (a box in play). */
function showing(box: Box, open: number[]): Panel {
  const p = new Panel(1);
  p.setBox(box);
  p.finishEtch();
  for (const i of open) p.setOpen(i);
  for (let f = 0; f < 72; f++) p.update(DT);
  expect(max(p.uniforms.uOpen.value)).toBe(open.length ? 1 : 0);
  return p;
}

/**
 * Box `to` set over `from`'s etching, its saved locks `open` restored at once and its first lock warming at once (the
 * box session measures warmth while the box is held back), then a frame at a time until the foil is full.
 */
function change(from: Box, fromOpen: number[], to: Box, open: number[]): void {
  const p = showing(from, fromOpen);
  const u = p.uniforms, masks = u.uMasks.value!, albedo = u.uAlbedo.value!;
  const m0 = masks.version, a0 = albedo.version, before = [...u.uLockCenter.value];
  p.setBox(to);
  for (const i of open) p.setOpen(i);
  p.setWarmth(to.locks[0]!.i, 0.8);
  let upFrame = -1;
  for (let f = 0; f < 400; f++) {
    p.update(DT);
    if (albedo.version === a0) {
      // The old etching is still what the panel shows (or the new masks alone, a frame before the albedo): no foil,
      // no warmth, and the old box's centres.
      expect(max(u.uOpen.value), `frame ${f}: foil before the new art`).toBe(0);
      expect(max(u.uWarmth.value), `frame ${f}: warmth before the new art`).toBe(0);
      expect([...u.uLockCenter.value], `frame ${f}: centres before the new art`).toEqual(before);
      expect(p.etched).toBe(false);
      continue;
    }
    if (upFrame < 0) {
      // The albedo goes up this frame, the masks before it; the new centres with it, and the foil starts from 0.
      upFrame = f;
      expect(p.etched).toBe(true);
      expect(masks.version).toBeGreaterThan(m0);
      expect([...u.uLockCenter.value]).toEqual(centres(to));
      for (const i of open) expect(u.uOpen.value[i]).toBeCloseTo(DT / OPEN_FILL_S, 6);
      expect(u.uWarmth.value[to.locks[0]!.i]).toBeLessThan(0.2);
    }
    if (open.every((i) => u.uOpen.value[i] === 1)) break;
  }
  // The etching took frames (the old art stayed up meanwhile), and the foil filled in its own time after it.
  expect(upFrame).toBeGreaterThan(5);
  for (const i of open) expect(u.uOpen.value[i]).toBe(1);
  expect([...u.uLockCenter.value]).toEqual(centres(to));
  for (let f = 0; f < 144; f++) p.update(DT);
  expect(u.uWarmth.value[to.locks[0]!.i]).toBeCloseTo(0.8, 3);
}

describe("panel at a box change", () => {
  const box = generateBox({ kind: "box", n: 6 });
  const all = box.locks.map((l) => l.i);

  it("Continue to the numbered box after a Daily Box: no foil or warmth on the Daily Box's etching", () => {
    const daily = generateBox({ kind: "daily", day: "2026-11-08" });
    change(daily, [daily.locks[0]!.i], box, all.slice(0, -1));
  });

  it("the Left hand setting rebuilding the box behind the menus: its mirror's foil waits for the mirrored etching", () => {
    change(box, all.slice(0, -1), mirrorBox(box), all.slice(0, -1));
  });

  it("Continue after a practice box or a lesson: the saved box's foil waits for its own etching", () => {
    change(generateBox({ kind: "box", n: 11 }), [0], box, all.slice(0, -1));
    change(lessonPlan("l1", false).box, [0], box, all.slice(0, -1));
  });

  it("a box set with nothing to restore shows its etching with no foil, as before", () => {
    const p = showing(box, all);
    p.setBox(generateBox({ kind: "box", n: 2 }));
    p.finishEtch();
    p.update(DT);
    expect(max(p.uniforms.uOpen.value)).toBe(0);
    expect([...p.uniforms.uLockCenter.value]).toEqual(centres(generateBox({ kind: "box", n: 2 })));
  });
});
