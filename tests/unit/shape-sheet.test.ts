// A contact sheet of the silhouettes, for looking at them (not a check): run with SHAPE_SHEET=1, e.g.
//   scripts/remote.sh gen --env SHAPE_SHEET=1 --pull test-results -- npx vitest run tests/unit/shape-sheet.test.ts
// Each cell shows the silhouette as a soft shadow on the lit panel, then its pieces, with the piece a finger lock
// leaves out in red. Cells run left to right, top to bottom, in SILHOUETTES order; test-results/shape-sheet/ also
// gets one picture per silhouette, named after it.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerPiece } from "../../src/core/generator";
import { inPoly, segDist } from "../../src/core/geom";
import { SHAPES, SILHOUETTES } from "../../src/core/shapes";
import type { V2 } from "../../src/core/types";
import { encodePng } from "./helpers/png";

const P = 200;
const OUT = path.resolve("test-results/shape-sheet");
const PANEL: [number, number, number] = [214, 196, 160];
const SHADOW: [number, number, number] = [44, 36, 30];
const PIECES: [number, number, number][] = [[120, 150, 200], [150, 190, 140], [200, 170, 110], [170, 140, 190], [110, 180, 180], [190, 150, 150]];

/** One silhouette as two P x P panels side by side. */
function cell(pieces: V2[][]): Uint8Array {
  const W = 2 * P, img = new Uint8Array(W * P * 3), s = P / 1.16, finger = fingerPiece(pieces);
  const at = (px: number, py: number): V2 => [(px - P / 2) / s, (P / 2 - py) / s];
  // Coverage at 3 x 3 samples a pixel, then a box blur of 3 px for the penumbra.
  const cov = new Float32Array(P * P);
  for (let py = 0; py < P; py++) {
    for (let px = 0; px < P; px++) {
      let n = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (pieces.some((p) => inPoly(at(px + (i + 0.5) / 3, py + (j + 0.5) / 3), p))) n++;
      cov[py * P + px] = n / 9;
    }
  }
  const R = 3;
  for (let py = 0; py < P; py++) {
    for (let px = 0; px < P; px++) {
      let sum = 0, n = 0;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = px + dx, y = py + dy;
          if (x < 0 || y < 0 || x >= P || y >= P) continue;
          sum += cov[y * P + x]!;
          n++;
        }
      }
      const t = sum / n, o = (py * W + px) * 3;
      for (let k = 0; k < 3; k++) img[o + k] = Math.round(PANEL[k]! + (SHADOW[k]! - PANEL[k]!) * t);
    }
  }
  for (let py = 0; py < P; py++) {
    for (let px = 0; px < P; px++) {
      const p = at(px + 0.5, py + 0.5), o = (py * W + P + px) * 3;
      const j = pieces.findIndex((q) => inPoly(p, q));
      let c: [number, number, number] = [245, 240, 230];
      if (j >= 0) c = j === finger ? [215, 60, 50] : PIECES[j % PIECES.length]!;
      const edge = pieces.some((q) => q.some((a, k) => segDist(p, a, q[(k + 1) % q.length]!) < 0.6 / s));
      if (edge) c = [30, 30, 30];
      img[o] = c[0];
      img[o + 1] = c[1];
      img[o + 2] = c[2];
    }
  }
  return img;
}

describe.runIf(process.env.SHAPE_SHEET)("silhouette contact sheet", () => {
  it("draws every silhouette", () => {
    fs.mkdirSync(OUT, { recursive: true });
    const COLS = 3, B = 6, CW = 2 * P + B, CH = P + B, rows = Math.ceil(SILHOUETTES.length / COLS);
    const W = COLS * CW + B, H = rows * CH + B, sheet = new Uint8Array(W * H * 3).fill(255);
    SILHOUETTES.forEach((name, i) => {
      const img = cell(SHAPES[name]);
      fs.writeFileSync(path.join(OUT, `${String(i + 1).padStart(2, "0")}-${name}.png`), encodePng(2 * P, P, img));
      const x0 = B + (i % COLS) * CW, y0 = B + Math.floor(i / COLS) * CH;
      for (let y = 0; y < P; y++) sheet.set(img.subarray(y * 2 * P * 3, (y + 1) * 2 * P * 3), ((y0 + y) * W + x0) * 3);
    });
    fs.writeFileSync(path.join(OUT, "sheet.png"), encodePng(W, H, sheet));
    console.log(`sheet: ${SILHOUETTES.map((n, i) => `${i + 1} ${n}`).join(", ")}`);
    expect(fs.existsSync(path.join(OUT, "sheet.png"))).toBe(true);
  }, 120_000);
});
